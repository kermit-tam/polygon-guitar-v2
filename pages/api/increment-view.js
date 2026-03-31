// API endpoint for incrementing view count
// Uses Firestore REST API with a special "view counter" token

// Simple in-memory rate limiting
const viewTracker = new Map()
const RATE_LIMIT_WINDOW = 60000 // 1 minute
const MAX_VIEWS_PER_WINDOW = 3 // Max 3 views per minute per IP per tab

function checkRateLimit(ip, tabId) {
  const key = `${ip}:${tabId}`
  const now = Date.now()
  const record = viewTracker.get(key)
  
  if (!record) {
    viewTracker.set(key, { count: 1, timestamp: now })
    return true
  }
  
  // Reset if window expired
  if (now - record.timestamp > RATE_LIMIT_WINDOW) {
    viewTracker.set(key, { count: 1, timestamp: now })
    return true
  }
  
  // Check limit
  if (record.count >= MAX_VIEWS_PER_WINDOW) {
    return false
  }
  
  record.count++
  return true
}

// Clean up old entries periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, record] of viewTracker.entries()) {
      if (now - record.timestamp > RATE_LIMIT_WINDOW * 2) {
        viewTracker.delete(key)
      }
    }
  }, 60000)
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { tabId } = req.body
  
  if (!tabId) {
    return res.status(400).json({ error: 'Missing tabId' })
  }

  try {
    // Get client IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
               req.headers['x-real-ip'] || 
               req.socket?.remoteAddress || 
               'unknown'
    
    // Check rate limit
    if (!checkRateLimit(ip, tabId)) {
      return res.status(429).json({
        error: 'Rate limited',
        message: 'Too many views from this IP'
      })
    }

    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    if (!projectId) {
      return res.status(500).json({ error: 'Firebase project ID not configured' })
    }

    // Fire-and-forget — don't await so CPU is released immediately
    ;(async () => {
      try {
        const getUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tabs/${tabId}?mask.fieldPaths=viewCount`
        const getResponse = await fetch(getUrl)
        if (!getResponse.ok) return
        const docData = await getResponse.json()
        const currentViews = docData.fields?.viewCount?.integerValue || 0
        const newViews = parseInt(currentViews) + 1
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tabs/${tabId}?updateMask.fieldPaths=viewCount`
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { viewCount: { integerValue: newViews } } }),
        })
      } catch (e) {
        console.error('increment-view background error:', e?.message)
      }
    })()

    return res.status(200).json({ success: true })

  } catch (error) {
    console.error('Error incrementing view:', error)
    return res.status(500).json({ 
      error: 'Failed to record view',
      details: error.message 
    })
  }
}
