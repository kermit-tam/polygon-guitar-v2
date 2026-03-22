/**
 * Search page data: full tabs + artists payload for client-side search/filter.
 * Stored in Firestore at cache/searchData, TTL 24h. Each search-data API call = 1 read when cache is fresh.
 * Full query runs at most once per day (or when admin triggers rebuild).
 */
import { pacificTime } from '@/lib/logTime'

import { doc, getDoc, collection, getDocs, query, orderBy } from '@/lib/firestore-tracked'
import { db } from '@/lib/firebase'
import { tryAcquireLock, releaseLock } from '@/lib/cache-lock'
import { getTabArtistId } from '@/lib/tabs'

const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000 // ~forever (bust on write)

function isPermissionError(e) {
  const msg = e?.message || String(e)
  return /permission|Permission/i.test(msg) || msg.includes('PERMISSION_DENIED')
}

/** Client or Admin Firestore Timestamp → epoch ms */
function firestoreTimestampToMillis(t) {
  if (!t) return null
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') {
    const ns = t.nanoseconds ?? t._nanoseconds ?? 0
    return t.seconds * 1000 + Math.floor(ns / 1e6)
  }
  return null
}

/**
 * Read cache/searchData. On the server, prefer Firebase Admin so API routes / getStaticProps
 * do not depend on the browser Firestore SDK (transient gRPC / "client is offline" in Node).
 * Falls back to client SDK when Admin is not configured (e.g. some local setups).
 * @returns {Promise<{ data: object, updatedAtMs: number } | null>}
 */
async function readSearchCacheDoc() {
  if (typeof window === 'undefined') {
    try {
      const { getAdminDb } = await import('@/lib/admin-db')
      const adminDb = getAdminDb()
      if (adminDb) {
        const snap = await adminDb.collection('cache').doc('searchData').get()
        if (!snap.exists) return null
        const d = snap.data() || {}
        const data = d.data
        const updatedAtMs = firestoreTimestampToMillis(d.updatedAt)
        if (data && updatedAtMs != null) {
          return { data, updatedAtMs }
        }
        console.log('[searchData] cache doc exists but invalid (missing data or updatedAt) [admin]')
        return null
      }
    } catch (e) {
      console.warn('[searchData] Admin read cache/searchData failed, falling back to client SDK', e?.message)
    }
  }

  const cacheRef = doc(db, 'cache', 'searchData')
  try {
    const snap = await getDoc(cacheRef)
    if (!snap?.exists()) return null
    const d = snap.data()
    const data = d?.data
    const updatedAtMs = firestoreTimestampToMillis(d?.updatedAt)
    if (data && updatedAtMs != null) return { data, updatedAtMs }
    console.log('[searchData] cache doc exists but invalid (missing data or updatedAt)')
    return null
  } catch (e) {
    if (isPermissionError(e)) {
      console.warn('[searchData] Cache read not allowed. Building payload.')
      return null
    }
    throw e
  }
}

/**
 * Write search payload to Firestore cache. Uses Admin SDK only (client cannot write to cache/ by design).
 * If FIREBASE_ADMIN_* env vars are not set, write is skipped and a one-time warning is logged.
 */
let _warnedNoAdmin = false
export async function setSearchCache(payload) {
  try {
    const { getAdminDb } = await import('@/lib/admin-db')
    const adminDb = getAdminDb()
    if (adminDb) {
      const { FieldValue } = await import('firebase-admin/firestore')
      await adminDb.collection('cache').doc('searchData').set({
        data: payload,
        updatedAt: FieldValue.serverTimestamp()
      })
      console.log('[searchData] cache written (searchData)')
      return
    }
  } catch (e) {
    console.error('[searchData] setSearchCache via Admin failed', e?.message)
    return
  }
  if (!_warnedNoAdmin) {
    _warnedNoAdmin = true
    console.warn('[searchData] Cache write skipped. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY in .env.local to enable search cache writes.')
  }
}

/**
 * Build search payload from pre-fetched snapshots (no extra Firestore reads).
 * Used by buildSearchDataPayload() and by combined rebuild-home-and-search-cache.
 * Tabs: only fields needed for search. Artists: id, name, photo, type, regions, counts. Playlists: id, title, description, coverImage.
 * Users (optional): id, displayName, penName, photoURL — only public profiles (isPublicProfile !== false).
 */
export function buildSearchDataPayloadFromSnapshots(tabsSnap, artistsSnap, playlistsSnap, usersSnap = null) {
  const slugToDocId = new Map()
  artistsSnap.docs.forEach(aDoc => {
    const ad = aDoc.data()
    slugToDocId.set(aDoc.id, aDoc.id)
    if (ad.normalizedName && ad.normalizedName !== aDoc.id) {
      slugToDocId.set(ad.normalizedName, aDoc.id)
    }
  })

  const tabs = tabsSnap.docs.map(docSnap => {
    const d = docSnap.data()
    const tab = { id: docSnap.id, ...d }
    const mainArtistId = getTabArtistId(tab) || ''
    const rawArtistId = d.artistId || mainArtistId
    return {
      id: docSnap.id,
      title: d.title || '',
      artistId: slugToDocId.get(rawArtistId) || rawArtistId || mainArtistId,
      composer: d.composer || '',
      lyricist: d.lyricist || '',
      arranger: d.arranger || '',
      uploaderPenName: d.uploaderPenName || ''
    }
  })

  const artists = artistsSnap.docs.map(docSnap => {
    const d = docSnap.data()
    const count = d.songCount || d.tabCount || 0
    const regions = (d.regions && d.regions.length > 0) ? d.regions : (d.region ? [d.region] : [])
    return {
      id: docSnap.id,
      name: d.name || '',
      photo: d.photoURL || d.wikiPhotoURL || null,
      artistType: d.artistType || d.gender || 'other',
      regions,
      displayOrder: d.displayOrder ?? null,
      tier: d.tier ?? 5,
      tabCount: count
    }
  })

  const playlists = playlistsSnap.docs
    .map(docSnap => {
      const d = docSnap.data()
      if (d.isActive === false) return null
      return {
        id: docSnap.id,
        title: d.title || '',
        description: d.description || '',
        coverImage: d.coverImage || null,
        displayOrder: d.displayOrder ?? 0
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))

  const users = !usersSnap?.docs?.length
    ? []
    : usersSnap.docs
        .filter((d) => {
          const data = d.data()
          return data.isPublicProfile !== false
        })
        .map((d) => {
          const data = d.data()
          return {
            id: d.id,
            displayName: data.displayName || '',
            penName: data.penName || '',
            photoURL: data.photoURL || null
          }
        })

  return { tabs, artists, playlists, users }
}

/**
 * Build search payload from live Firestore (all tabs + artists + playlists + users). ~3.7k+ reads.
 */
export async function buildSearchDataPayload() {
  console.log('[searchData] buildSearchDataPayload started', pacificTime())
  const startMs = Date.now()
  const [tabsSnap, artistsSnap, playlistsSnap, usersSnap] = await Promise.all([
    getDocs(query(collection(db, 'tabs'), orderBy('createdAt', 'desc'))),
    getDocs(query(collection(db, 'artists'), orderBy('name'))),
    getDocs(collection(db, 'playlists')),
    getDocs(collection(db, 'users'))
  ])
  const totalReads = tabsSnap.docs.length + artistsSnap.docs.length + playlistsSnap.docs.length + usersSnap.docs.length
  console.log(`[searchData] Firestore queries done in ${Date.now() - startMs}ms — ${tabsSnap.docs.length} tabs, ${artistsSnap.docs.length} artists, ${playlistsSnap.docs.length} playlists, ${usersSnap.docs.length} users (total reads: ${totalReads}) at ${pacificTime()}`)
  return buildSearchDataPayloadFromSnapshots(tabsSnap, artistsSnap, playlistsSnap, usersSnap)
}

/** API 用 in-memory cache，rebuild 後可 bust 令歌手頁即時拎到新地區 */
let _apiResponseCache = null
let _apiResponseCacheTime = 0
const _API_CACHE_TTL = 45 * 1000 // 45s — keep staleness under 1 min

export function bustSearchDataApiCache() {
  _apiResponseCache = null
  _apiResponseCacheTime = 0
}

/** 供 /api/search-data 用：有 in-memory 就用，否則 getSearchData() 再存 */
export async function getSearchDataCached() {
  if (_apiResponseCache && Date.now() - _apiResponseCacheTime < _API_CACHE_TTL) {
    return _apiResponseCache
  }
  const data = await getSearchData()
  _apiResponseCache = data
  _apiResponseCacheTime = Date.now()
  return data
}

/**
 * Get search data: 1 Firestore read when cache is fresh (< 24h).
 * On cache miss or stale, builds payload, writes cache, returns. Optionally serves stale and revalidates in background.
 * @param {{ includeCacheStatus?: boolean }} opts - If includeCacheStatus is true, returns { data, cacheStatus: 'hit'|'miss'|'stale' }.
 */
export async function getSearchData(opts = {}) {
  const cacheEntry = await readSearchCacheDoc()

  const now = Date.now()
  if (cacheEntry) {
    const { data, updatedAtMs } = cacheEntry
    const ageMs = now - updatedAtMs
    const ageMin = Math.round(ageMs / 60000)
    if (ageMs <= CACHE_TTL_MS) {
      console.log('[searchData] cache hit (age %d min, 1 read)', ageMin)
      if (opts.includeCacheStatus) return { data, cacheStatus: 'hit' }
      return data
    }
    console.log('[searchData] cache stale (age %d min), serving stale + attempting locked revalidate', ageMin)
    setImmediate(async () => {
      const lock = await tryAcquireLock('searchData', 120000)
      if (!lock.acquired) return
      try {
        const payload = await buildSearchDataPayload()
        await setSearchCache(payload)
      } catch (err) {
        console.error('[searchData] background revalidate failed', err)
      } finally {
        await releaseLock('searchData', lock.lockId)
      }
    })
    if (opts.includeCacheStatus) return { data, cacheStatus: 'stale' }
    return data
  }

  console.log('[searchData] cache miss (no doc or read failed), building payload...')

  const lock = await tryAcquireLock('searchData', 120000)
  if (!lock.acquired) {
    console.log('[searchData] cache miss but lock held by another instance, returning empty')
    const empty = { tabs: [], artists: [], playlists: [], users: [] }
    if (opts.includeCacheStatus) return { data: empty, cacheStatus: 'miss' }
    return empty
  }

  try {
    const payload = await buildSearchDataPayload()
    const payloadSize = typeof payload === 'object' ? JSON.stringify(payload).length : 0
    if (payloadSize <= 900 * 1024) {
      setSearchCache(payload).catch((err) => console.error('[searchData] setSearchCache failed', err?.message))
    } else {
      console.warn('[searchData] Payload too large for cache (~', Math.round(payloadSize / 1024), 'KB)')
    }
    if (opts.includeCacheStatus) return { data: payload, cacheStatus: 'miss' }
    return payload
  } finally {
    await releaseLock('searchData', lock.lockId)
  }
}
