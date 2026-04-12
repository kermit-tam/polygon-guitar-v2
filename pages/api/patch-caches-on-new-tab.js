/**
 * POST /api/patch-caches-on-new-tab
 *
 * Incrementally patches Firestore cache docs when data changes,
 * instead of doing a full rebuild (~3,700 reads).
 *
 * Tab actions:
 *   { tab: { id, title, artist, ... }, action: 'create' | 'update' | 'delete' }
 *   Patches: searchData, homePage. Deletes: artistPage_{artistId}.
 *   (allTabs is skipped — it's only used by admin pages and is too large to patch safely.)
 *
 * Artist actions:
 *   { artist: { id, name, ... }, action: 'create-artist' | 'update-artist' }
 *   Patches: searchData (artists array). Deletes: artistPage_{id}.
 *   { artist: { id }, action: 'delete-artist' }
 *   Removes id from searchData.artists. Deletes: artistPage_{id}.
 *
 * Auth: Bearer <idToken> (any logged-in user)
 * Tab create/update also appends missing searchData.artists rows using artists/{id} (Firestore) for name/photo/etc.
 * Cost: extra reads per new artist id + 2-3 writes per call typical.
 */

import { getAdminDb } from '@/lib/admin-db'
import { bustSearchDataApiCache } from '@/lib/searchData'
import { bustHomeDataApiCache } from '@/lib/homeData'
import { pacificTime } from '@/lib/logTime'
import { getTabArtistId, getTabArtistIds } from '@/lib/tabs'

function resolveTabCoverImage(tab) {
  if (tab?.coverImage) return tab.coverImage
  if (tab?.albumImage) return tab.albumImage
  const videoId = tab?.youtubeVideoId ?? tab?.youtubeUrl?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1]
  if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
  if (tab?.thumbnail) return tab.thumbnail
  return null
}

function toSearchTabSlim(tab) {
  return stripUndefined({
    id: tab.id,
    title: tab.title || '',
    artistId: getTabArtistId(tab) || tab.artistId || '',
    composer: tab.composer || '',
    lyricist: tab.lyricist || '',
    arranger: tab.arranger || '',
    uploaderPenName: tab.uploaderPenName || '',
    slug: tab.slug || undefined
  })
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

function toAllTabsSlim(tab) {
  // 與 lib/tabs.js slimTabForAllTabsCache 保持一致：移除 content/artist/artistName/artistSlug
  const { content, artist, artistName, artistSlug, ...rest } = tab
  return { id: tab.id, ...rest }
}

function toHomeSlim(tab) {
  const coverImage = resolveTabCoverImage(tab)
  return stripUndefined({
    id: tab.id,
    title: tab.title,
    artistId: getTabArtistId(tab) || tab.artistId,
    ...(coverImage ? { coverImage } : {}),
    slug: tab.slug || undefined
  })
}

function toSearchArtistSlim(artist) {
  const regions = (artist.regions?.length > 0) ? artist.regions : (artist.region ? [artist.region] : [])
  return stripUndefined({
    id: artist.id,
    name: artist.name || '',
    photo: artist.photoURL || artist.wikiPhotoURL || null,
    artistType: artist.artistType || artist.gender || 'other',
    regions,
    displayOrder: artist.displayOrder ?? null,
    tier: artist.tier ?? 5,
    tabCount: artist.songCount || artist.tabCount || 0
  })
}

const MAX_CACHE_BYTES = 900 * 1024

async function patchCacheDoc(adminDb, docId, patchFn) {
  try {
    const startMs = Date.now()
    const ref = adminDb.collection('cache').doc(docId)
    const snap = await ref.get()
    if (!snap.exists) {
      console.log(`[patch-caches] cache/${docId} does not exist, skipping at ${pacificTime()}`)
      return false
    }

    const docData = snap.data()
    const payload = docData?.data
    if (!payload) {
      console.log(`[patch-caches] cache/${docId} has no data field, skipping at ${pacificTime()}`)
      return false
    }

    const patched = patchFn(payload)
    if (!patched) {
      console.log(`[patch-caches] cache/${docId} no changes needed (1 read, 0 writes) in ${Date.now() - startMs}ms at ${pacificTime()}`)
      return false
    }

    const size = JSON.stringify(patched).length
    if (size > MAX_CACHE_BYTES) {
      console.warn(`[patch-caches] cache/${docId} would be ${Math.round(size / 1024)}KB, skipping patch at ${pacificTime()}`)
      return false
    }

    const { FieldValue } = await import('firebase-admin/firestore')
    await ref.set({ data: patched, updatedAt: FieldValue.serverTimestamp() })
    console.log(`[patch-caches] cache/${docId} patched (1 read, 1 write, ${Math.round(size / 1024)}KB) in ${Date.now() - startMs}ms at ${pacificTime()}`)
    return true
  } catch (e) {
    if (e?.code === 8 || /quota|resource exhausted|RESOURCE_EXHAUSTED/i.test(e?.message || '')) {
      console.warn(`[patch-caches] skipped patch cache/${docId} (quota exceeded) at ${pacificTime()}`)
    } else {
      console.error(`[patch-caches] failed to patch cache/${docId}: ${e?.message} at ${pacificTime()}`)
    }
    return false
  }
}

function isQuotaError(e) {
  const msg = e?.message || String(e)
  return e?.code === 8 || /quota|resource exhausted|RESOURCE_EXHAUSTED/i.test(msg)
}

/**
 * Patch cache/allTabs (multi-part allTabs_0..N or single-doc) for create/delete/update tab actions.
 * Ensures getRecentTabs() immediately sees new/deleted/updated tabs without waiting for cache rebuild.
 */
async function patchAllTabsCache(adminDb, tab, action) {
  try {
    const { FieldValue } = await import('firebase-admin/firestore')
    const cacheCol = adminDb.collection('cache')
    const slim = toAllTabsSlim(tab)

    // Try multi-part format first (allTabs_meta + allTabs_0, allTabs_1, ...)
    const metaSnap = await cacheCol.doc('allTabs_meta').get()
    if (metaSnap.exists && metaSnap.data()?.partCount > 0) {
      const part0Snap = await cacheCol.doc('allTabs_0').get()
      if (!part0Snap.exists) return false
      const part0Data = part0Snap.data()?.data
      if (!Array.isArray(part0Data)) return false

      let newPart0
      if (action === 'create') {
        if (part0Data.some(t => t.id === tab.id)) return false
        newPart0 = [slim, ...part0Data]
      } else if (action === 'delete') {
        newPart0 = part0Data.filter(t => t.id !== tab.id)
        if (newPart0.length === part0Data.length) return false
      } else if (action === 'update') {
        const idx = part0Data.findIndex(t => t.id === tab.id)
        if (idx === -1) return false
        newPart0 = [...part0Data]
        newPart0[idx] = { ...newPart0[idx], ...slim }
      } else {
        return false
      }

      const size = Buffer.byteLength(JSON.stringify(newPart0), 'utf8')
      if (size > MAX_CACHE_BYTES) {
        if (action === 'create') {
          // allTabs_0 is full — add the new tab as a new trailing part so it still appears
          // in getAllTabs(). The next full rebuild will consolidate all parts.
          const currentPartCount = metaSnap.data().partCount
          await cacheCol.doc(`allTabs_${currentPartCount}`).set({ data: [slim], updatedAt: FieldValue.serverTimestamp() })
          await cacheCol.doc('allTabs_meta').set({ partCount: currentPartCount + 1, updatedAt: FieldValue.serverTimestamp() })
          console.log(`[patch-caches] allTabs_0 full (~${Math.round(size / 1024)}KB), added allTabs_${currentPartCount} for tab ${tab.id}`)
          return true
        }
        console.warn(`[patch-caches] allTabs_0 patch skipped (${action}): would exceed size limit`)
        return false
      }
      await cacheCol.doc('allTabs_0').set({ data: newPart0, updatedAt: FieldValue.serverTimestamp() })
      await cacheCol.doc('allTabs_meta').update({ updatedAt: FieldValue.serverTimestamp() })
      console.log(`[patch-caches] allTabs_0 patched (${action}) tab ${tab.id}`)
      return true
    }

    // Fall back to single-doc allTabs
    return await patchCacheDoc(adminDb, 'allTabs', (payload) => {
      if (!Array.isArray(payload)) return null
      if (action === 'create') {
        if (payload.some(t => t.id === tab.id)) return null
        return [slim, ...payload]
      } else if (action === 'delete') {
        const filtered = payload.filter(t => t.id !== tab.id)
        return filtered.length === payload.length ? null : filtered
      } else if (action === 'update') {
        const idx = payload.findIndex(t => t.id === tab.id)
        if (idx === -1) return null
        const updated = [...payload]
        updated[idx] = { ...updated[idx], ...slim }
        return updated
      }
      return null
    })
  } catch (e) {
    if (isQuotaError(e)) {
      console.warn('[patch-caches] allTabs patch skipped (quota exceeded)')
    } else {
      console.error('[patch-caches] allTabs patch failed:', e?.message)
    }
    return false
  }
}

async function deleteArtistPageCache(adminDb, artistId) {
  if (!artistId) return false
  try {
    const ref = adminDb.collection('cache').doc(`artistPage_${artistId}`)
    const snap = await ref.get()
    if (!snap.exists) return false
    await ref.delete()
    console.log(`[patch-caches] deleted cache/artistPage_${artistId} (1 read, 1 delete) at ${pacificTime()}`)
    return true
  } catch (e) {
    if (isQuotaError(e)) {
      console.warn(`[patch-caches] skipped delete artistPage_${artistId} (quota exceeded) at ${pacificTime()}`)
    } else {
      console.error(`[patch-caches] failed to delete artistPage_${artistId}: ${e?.message} at ${pacificTime()}`)
    }
    return false
  }
}

async function handleTabAction(adminDb, tab, action) {
  const results = {}

  results.searchData = await patchCacheDoc(adminDb, 'searchData', (payload) => {
    const tabs = Array.isArray(payload.tabs) ? payload.tabs : []

    if (action === 'delete') {
      const filtered = tabs.filter(t => t.id !== tab.id)
      return filtered.length === tabs.length ? null : { ...payload, tabs: filtered }
    }
    const slim = toSearchTabSlim(tab)
    if (action === 'create') {
      return { ...payload, tabs: [slim, ...tabs] }
    }
    const idx = tabs.findIndex(t => t.id === tab.id)
    if (idx === -1) return null
    const updated = [...tabs]
    updated[idx] = { ...updated[idx], ...slim }
    return { ...payload, tabs: updated }
  })

  results.homePage = await patchCacheDoc(adminDb, 'homePage', (payload) => {
    if (action === 'delete') {
      const filterArr = (arr) => Array.isArray(arr) ? arr.filter(t => t.id !== tab.id) : arr
      const latestSongs = filterArr(payload.latestSongs)
      const hotTabs = filterArr(payload.hotTabs)
      const changed = latestSongs?.length !== payload.latestSongs?.length || hotTabs?.length !== payload.hotTabs?.length
      return changed ? { ...payload, latestSongs, hotTabs } : null
    }
    const slim = toHomeSlim(tab)
    if (action === 'create') {
      const latestSongs = Array.isArray(payload.latestSongs) ? payload.latestSongs : []
      return { ...payload, latestSongs: [slim, ...latestSongs].slice(0, 10) }
    }
    let changed = false
    const patchArray = (arr) => {
      if (!Array.isArray(arr)) return arr
      const idx = arr.findIndex(t => t.id === tab.id)
      if (idx === -1) return arr
      changed = true
      const updated = [...arr]
      updated[idx] = { ...updated[idx], ...slim }
      return updated
    }
    const patched = {
      ...payload,
      latestSongs: patchArray(payload.latestSongs),
      hotTabs: patchArray(payload.hotTabs)
    }
    return changed ? patched : null
  })

  // Dedicated latestSongs cache — small doc, fast client read (no need to load full allTabs)
  results.latestSongs = await patchCacheDoc(adminDb, 'latestSongs', (payload) => {
    const list = Array.isArray(payload) ? payload : []
    if (action === 'delete') {
      const filtered = list.filter(t => t.id !== tab.id)
      return filtered.length === list.length ? null : filtered
    }
    const slim = toHomeSlim(tab)
    if (action === 'create') {
      if (list.some(t => t.id === tab.id)) return null
      return [slim, ...list].slice(0, 20)
    }
    // update
    const idx = list.findIndex(t => t.id === tab.id)
    if (idx === -1) return null
    const updated = [...list]
    updated[idx] = { ...updated[idx], ...slim }
    return updated
  })

  // When creating or updating a tab, ensure all associated artists exist in the search cache's artists array
  if (action === 'create' || action === 'update') {
    const artistIds = getTabArtistIds(tab).length > 0
      ? getTabArtistIds(tab)
      : Array.isArray(tab.collaboratorIds) && tab.collaboratorIds.length > 0
        ? tab.collaboratorIds
        : tab.artistId ? [tab.artistId] : []
    const artistNames = Array.isArray(tab.collaborators) && tab.collaborators.length > 0
      ? tab.collaborators
      : tab.artist ? [tab.artist] : []

    if (artistIds.length > 0) {
      let newArtistRows = []
      let firestorePrefetchFailed = false
      try {
        const sdSnap = await adminDb.collection('cache').doc('searchData').get()
        const sdPayload = sdSnap.exists ? sdSnap.data()?.data : null
        const curArtists = Array.isArray(sdPayload?.artists) ? sdPayload.artists : []
        const seen = new Set(curArtists.map((a) => a.id))
        for (let i = 0; i < artistIds.length; i++) {
          const aid = artistIds[i]
          if (!aid || seen.has(aid)) continue
          seen.add(aid)
          let fs = null
          try {
            const adoc = await adminDb.collection('artists').doc(String(aid)).get()
            if (adoc.exists) fs = adoc.data()
          } catch (e) {
            /* ignore */
          }
          const nameTab = (artistNames[i] || '').trim()
          const nameFs = (fs?.name || '').trim()
          const regions =
            Array.isArray(fs?.regions) && fs.regions.length > 0
              ? fs.regions
              : fs?.region
                ? [fs.region]
                : []
          newArtistRows.push(
            stripUndefined({
              id: aid,
              name: nameFs || nameTab,
              photo:
                fs?.photoURL ||
                fs?.wikiPhotoURL ||
                fs?.photo ||
                (i === 0 ? tab.artistPhoto : null) ||
                null,
              artistType: fs?.artistType || fs?.gender || (i === 0 ? tab.artistType : '') || 'other',
              regions,
              displayOrder: fs?.displayOrder ?? null,
              tier: fs?.tier ?? 5,
              tabCount: fs?.songCount ?? fs?.tabCount ?? 1
            })
          )
        }
      } catch (e) {
        firestorePrefetchFailed = true
        console.warn('[patch-caches] Firestore artist prefetch failed:', e?.message)
      }
      if (newArtistRows.length > 0) {
        results.searchDataArtists = await patchCacheDoc(adminDb, 'searchData', (payload) => {
          const artists = Array.isArray(payload.artists) ? payload.artists : []
          const ids = new Set(artists.map((a) => a.id))
          const toAppend = newArtistRows.filter((row) => row.id && !ids.has(row.id))
          if (toAppend.length === 0) return null
          return { ...payload, artists: [...artists, ...toAppend] }
        })
      } else if (firestorePrefetchFailed && artistIds.length > 0) {
        results.searchDataArtists = await patchCacheDoc(adminDb, 'searchData', (payload) => {
          const artists = Array.isArray(payload.artists) ? payload.artists : []
          const existingIds = new Set(artists.map((a) => a.id))
          const newArtists = []
          for (let i = 0; i < artistIds.length; i++) {
            if (existingIds.has(artistIds[i])) continue
            existingIds.add(artistIds[i])
            newArtists.push(
              stripUndefined({
                id: artistIds[i],
                name: artistNames[i] || '',
                photo: (i === 0 ? tab.artistPhoto : null) || null,
                artistType: (i === 0 ? tab.artistType : '') || 'other',
                regions: [],
                displayOrder: null,
                tier: 5,
                tabCount: 1
              })
            )
          }
          if (newArtists.length === 0) return null
          return { ...payload, artists: [...artists, ...newArtists] }
        })
      }
    }
  }

  const allArtistIds = [...new Set([
    ...(getTabArtistIds(tab).length > 0 ? getTabArtistIds(tab) : []),
    ...(tab.artistId ? [tab.artistId] : []),
  ])].filter(Boolean)
  let anyArtistPageDeleted = false
  for (const aid of allArtistIds) {
    const deleted = await deleteArtistPageCache(adminDb, aid)
    if (deleted) anyArtistPageDeleted = true
  }
  results.artistPageDeleted = anyArtistPageDeleted

  // Patch cache/allTabs so getRecentTabs() immediately sees new/deleted/updated tabs
  results.allTabs = await patchAllTabsCache(adminDb, tab, action)

  return results
}

async function handleArtistAction(adminDb, artist, action) {
  const results = {}

  results.searchData = await patchCacheDoc(adminDb, 'searchData', (payload) => {
    const slim = toSearchArtistSlim(artist)
    const artists = Array.isArray(payload.artists) ? payload.artists : []
    const idx = artists.findIndex(a => a.id === artist.id)

    if (idx === -1) {
      return { ...payload, artists: [...artists, slim] }
    }
    const updated = [...artists]
    updated[idx] = { ...updated[idx], ...slim }
    return { ...payload, artists: updated }
    // No need to patch tabs — artist name is resolved from the artists array at read time
  })

  results.artistPageDeleted = await deleteArtistPageCache(adminDb, artist.id)

  return results
}

async function handleDeleteArtistAction(adminDb, artistId) {
  const id = String(artistId || '').trim()
  const results = {}
  if (!id) return results

  results.searchData = await patchCacheDoc(adminDb, 'searchData', (payload) => {
    const artists = Array.isArray(payload.artists) ? payload.artists : []
    const filtered = artists.filter((a) => a && String(a.id) !== id)
    if (filtered.length === artists.length) return null
    return { ...payload, artists: filtered }
  })

  results.artistPageDeleted = await deleteArtistPageCache(adminDb, id)
  return results
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ') || authHeader.length < 20) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { tab, artist, action } = req.body || {}
  const validActions = ['create', 'update', 'delete', 'create-artist', 'update-artist', 'delete-artist']
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` })
  }

  const adminDb = getAdminDb()
  if (!adminDb) {
    console.warn('[patch-caches] Admin SDK not available')
    return res.status(200).json({ ok: false, skipped: 'Admin SDK not available' })
  }

  const startMs = Date.now()
  let results
  try {
    if (action === 'create' || action === 'update' || action === 'delete') {
      if (!tab?.id) {
        return res.status(400).json({ error: 'Missing tab.id' })
      }
      results = await handleTabAction(adminDb, tab, action)
      console.log(`[patch-caches] ${action} tab ${tab.id} "${tab.title}" — searchData:${results.searchData}, homePage:${results.homePage}, artistPage:${results.artistPageDeleted ?? '-'} in ${Date.now() - startMs}ms at ${pacificTime()}`)
    } else if (action === 'delete-artist') {
      if (!artist?.id) {
        return res.status(400).json({ error: 'Missing artist.id' })
      }
      results = await handleDeleteArtistAction(adminDb, artist.id)
      console.log(`[patch-caches] delete-artist ${artist.id} — searchData:${results.searchData}, artistPage:${results.artistPageDeleted ?? '-'} in ${Date.now() - startMs}ms at ${pacificTime()}`)
    } else {
      if (!artist?.id || !artist?.name) {
        return res.status(400).json({ error: 'Missing artist.id or artist.name' })
      }
      results = await handleArtistAction(adminDb, artist, action)
      console.log(`[patch-caches] ${action} artist ${artist.id} "${artist.name}" — searchData:${results.searchData}, artistPage:${results.artistPageDeleted ?? '-'} in ${Date.now() - startMs}ms at ${pacificTime()}`)
    }
    bustSearchDataApiCache()
    bustHomeDataApiCache()
    return res.status(200).json({ ok: true, results })
  } catch (e) {
    const msg = e?.message || String(e)
    const isQuota = /quota|resource exhausted|RESOURCE_EXHAUSTED/i.test(msg) || e?.code === 8
    if (isQuota) {
      console.warn('[patch-caches] quota exceeded, skipping patch:', msg)
    } else {
      console.error('[patch-caches]', msg)
    }
    return res.status(200).json({ ok: false, skipped: isQuota ? 'quota' : 'error', error: msg })
  }
}
