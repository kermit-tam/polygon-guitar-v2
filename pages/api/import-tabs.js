import { createTab } from '@/lib/tabs'
import { verifyAdmin } from '@/lib/firebase-admin'
import { bustHomeDataApiCache } from '@/lib/homeData'
import { bustSearchDataApiCache } from '@/lib/searchData'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // 驗證 admin token
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const token = authHeader.split('Bearer ')[1]
    const decoded = await verifyAdmin(token)

    if (!decoded) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const tabData = req.body

    // 創建樂譜
    const newTab = await createTab(tabData, decoded.uid)

    // Patch caches so the new tab immediately appears in 最新上架 and search
    try {
      const proto = req.headers['x-forwarded-proto'] || 'https'
      const host = req.headers.host
      await fetch(`${proto}://${host}/api/patch-caches-on-new-tab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ tab: newTab, action: 'create' })
      })
    } catch (e) {
      console.warn('[import-tabs] cache patch failed (non-fatal):', e?.message)
    }
    bustHomeDataApiCache()
    bustSearchDataApiCache()

    res.status(200).json({ success: true, id: newTab.id })
  } catch (error) {
    console.error('Import error:', error)
    res.status(500).json({ error: error.message })
  }
}
