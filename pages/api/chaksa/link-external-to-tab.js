/**
 * POST /api/chaksa/link-external-to-tab
 * 將叱咤榜單上「無站內譜」一格改為綁定已存在嘅結他譜（出譜）。
 *
 * Auth: Authorization: Bearer <Firebase ID token>
 * Body: { playlistId, entryId, tabUrl }
 */

import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/admin-db'
import { parsePolygonTabLink } from '@/lib/polygonTabLink'
import { songIdsFromChartEntries, isChaksaPlaylist } from '@/lib/chaksaPlaylist'

/** 與客戶端 getTab 一致：先 doc id，再 slug（canonical URL 多為中文 slug） */
async function getTabByIdOrSlugAdmin(db, idOrSlug) {
  const key = String(idOrSlug || '').trim()
  if (!key) return null
  const byId = await db.collection('tabs').doc(key).get()
  if (byId.exists) return { id: byId.id, ...byId.data() }
  const slugSnap = await db.collection('tabs').where('slug', '==', key).limit(1).get()
  if (!slugSnap.empty) {
    const d = slugSnap.docs[0]
    return { id: d.id, ...d.data() }
  }
  return null
}

/** 與客戶端 getPlaylist 一致：doc id、slug、previousSlugs；URL 可能帶 % 編碼 */
async function getPlaylistByIdOrSlugAdmin(db, idOrSlugRaw) {
  let key = String(idOrSlugRaw || '').trim()
  if (!key) return null
  try {
    key = decodeURIComponent(key)
  } catch {
    // keep key
  }
  const byId = await db.collection('playlists').doc(key).get()
  if (byId.exists) return { id: byId.id, ...byId.data() }
  const slugSnap = await db.collection('playlists').where('slug', '==', key).limit(1).get()
  if (!slugSnap.empty) {
    const d = slugSnap.docs[0]
    return { id: d.id, ...d.data() }
  }
  const oldSlugSnap = await db.collection('playlists').where('previousSlugs', 'array-contains', key).limit(1).get()
  if (!oldSlugSnap.empty) {
    const d = oldSlugSnap.docs[0]
    return { id: d.id, ...d.data() }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Bearer token required' })
  }
  const idToken = authHeader.slice(7).trim()
  if (!idToken) {
    return res.status(401).json({ error: 'Missing token' })
  }

  const db = getAdminDb()
  if (!db) {
    return res.status(503).json({ error: 'Server config: Firebase Admin not available' })
  }

  try {
    await getAuth().verifyIdToken(idToken)
  } catch (e) {
    console.error('[chaksa/link-external-to-tab] verifyIdToken', e?.message)
    return res.status(403).json({ error: 'Invalid or expired token' })
  }

  const playlistId = typeof req.body?.playlistId === 'string' ? req.body.playlistId.trim() : ''
  const entryId = typeof req.body?.entryId === 'string' ? req.body.entryId.trim() : ''
  const tabUrl = typeof req.body?.tabUrl === 'string' ? req.body.tabUrl.trim() : ''

  if (!playlistId || !entryId || !tabUrl) {
    return res.status(400).json({ error: '缺少 playlistId、entryId 或 tabUrl' })
  }

  const playlist = await getPlaylistByIdOrSlugAdmin(db, playlistId)
  if (!playlist) {
    return res.status(404).json({ error: '找不到歌單' })
  }

  const pRef = db.collection('playlists').doc(playlist.id)
  if (!isChaksaPlaylist(playlist)) {
    return res.status(400).json({ error: '此歌單唔係叱咤榜單' })
  }

  const chartEntries = Array.isArray(playlist.chartEntries) ? [...playlist.chartEntries] : []
  const idx = chartEntries.findIndex(
    (e) => e && String(e.entryId) === entryId && e.source === 'external'
  )
  if (idx === -1) {
    return res.status(404).json({ error: '找不到該無譜項目或已綁定譜' })
  }

  const tabPathSegment = parsePolygonTabLink(tabUrl)
  if (!tabPathSegment) {
    return res.status(400).json({ error: '請貼上 POLYGON 結他譜連結，例如 https://polygon.guitars/tabs/...' })
  }

  const tab = await getTabByIdOrSlugAdmin(db, tabPathSegment)
  if (!tab) {
    return res.status(400).json({ error: '出譜失敗，找不到該結他譜' })
  }

  const entry = chartEntries[idx]
  const cardTitle = (entry.title || '').trim()
  const tabTitleRaw = (tab.title || '').trim()
  const { getGroupKeys, normalizeTitleForGrouping } = await import('@/lib/tabGrouping')
  const cardKey = normalizeTitleForGrouping(cardTitle) || cardTitle
  const tabKeys = getGroupKeys(tabTitleRaw, tab.id)
  const matchByGrouping = cardKey && tabKeys.includes(cardKey)
  const matchByNoSpace = cardTitle.replace(/\s+/g, '') === tabTitleRaw.replace(/\s+/g, '')

  if (!matchByGrouping && !matchByNoSpace) {
    return res.status(400).json({ error: '出譜失敗，歌名與榜單不一致' })
  }

  chartEntries[idx] = {
    entryId: entry.entryId,
    year: entry.year,
    position: entry.position,
    source: 'tab',
    tabId: String(tab.id).trim()
  }

  const songIds = songIdsFromChartEntries(chartEntries)

  await pRef.update({
    chartEntries,
    songIds,
    songCount: chartEntries.length,
    updatedAt: FieldValue.serverTimestamp()
  })

  try {
    await db.collection('cache').doc(`playlist_${playlist.id}`).delete()
  } catch (_) {}

  return res.status(200).json({ ok: true, tabId: String(tab.id).trim() })
}
