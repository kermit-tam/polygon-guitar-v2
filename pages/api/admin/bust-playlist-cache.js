/**
 * Delete Firestore cache/playlist_{playlistId} so the next playlist page load gets fresh song list.
 * Use after admin adds/removes/reorders songs on a manual playlist.
 *
 * Auth: Bearer <idToken> (admin) or x-cron-secret header.
 * Body or query: playlistId = playlist doc id.
 */

import { verifyAdmin } from '@/lib/firebase-admin'

const CACHE_DOC_PREFIX = 'playlist_'

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cronSecret = (process.env.CRON_SECRET || process.env.HOME_CACHE_BUST_SECRET || '').trim()
  const hasCronSecret = cronSecret && req.headers['x-cron-secret'] === cronSecret

  if (!hasCronSecret) {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: use Bearer token or x-cron-secret' })
    }
    const token = authHeader.slice(7)
    const decoded = await verifyAdmin(token)
    if (!decoded) {
      return res.status(403).json({ error: 'Forbidden' })
    }
  }

  const playlistId = (req.query.playlistId || req.body?.playlistId || '').trim()
  if (!playlistId) {
    return res.status(400).json({ error: 'Missing playlistId' })
  }

  try {
    const { getAdminDb } = await import('@/lib/admin-db')
    const adminDb = getAdminDb()
    if (!adminDb) {
      return res.status(503).json({ error: 'Admin DB not available' })
    }

    const ref = adminDb.collection('cache').doc(`${CACHE_DOC_PREFIX}${playlistId}`)
    await ref.delete()

    // 額外嘗試刪 slug-based cache doc（當 playlistId 係 doc ID 時）
    try {
      const playlistDoc = await adminDb.collection('playlists').doc(playlistId).get()
      if (playlistDoc.exists) {
        const slug = playlistDoc.data()?.slug
        if (slug && slug !== playlistId) {
          await adminDb.collection('cache').doc(`${CACHE_DOC_PREFIX}${slug}`).delete()
        }
      }
    } catch (_) {}

    // Trigger Next.js ISR revalidation immediately
    let isr = false
    try {
      await res.revalidate(`/playlist/${encodeURIComponent(playlistId)}`)
      isr = true
    } catch (isrErr) {
      console.warn('[bust-playlist-cache] ISR revalidate failed:', isrErr?.message)
    }

    return res.status(200).json({
      ok: true,
      playlistId,
      deleted: true,
      isr,
      message: 'Playlist page cache cleared; next load will show updated songs'
    })
  } catch (e) {
    console.error('[bust-playlist-cache]', e?.message)
    return res.status(500).json({ error: e?.message || 'Failed to bust cache' })
  }
}
