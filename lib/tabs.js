import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  or,
  orderBy,
  where,
  limit,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  setDoc,
  writeBatch
} from '@/lib/firestore-tracked'
import { db } from './firebase'
import { pacificTime } from '@/lib/logTime'
import { canUserEditTab } from '@/lib/tabEditPermission'

const TABS_COLLECTION = 'tabs'
const ARTISTS_COLLECTION = 'artists'

/** Firestore 單筆文件上限 1 MiB（含所有欄位） */
const MAX_FIRESTORE_DOC_BYTES = 1048576

/** 估算寫入 Firestore 嘅 JSON 位元組長度（粗略，用於避免 invalid-argument） */
export function estimateFirestoreDocBytes(obj) {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length
  } catch {
    return MAX_FIRESTORE_DOC_BYTES + 1
  }
}

export function assertTabDocumentFitsForFirestore(payload) {
  const bytes = estimateFirestoreDocBytes(payload)
  if (bytes > MAX_FIRESTORE_DOC_BYTES) {
    throw new Error(
      `樂譜資料過大（約 ${Math.round(bytes / 1024)} KB），超過 Firestore 單筆上限 1MB。請縮短六線譜或文字譜後再試。`
    )
  }
}

/** 遞迴移除物件/陣列中的 undefined，Firestore 不接受 undefined */
function stripUndefined(obj) {
  if (obj === undefined) return undefined
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj
  if (Array.isArray(obj)) {
    return obj.map(item => stripUndefined(item))
  }
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue
    const cleaned = stripUndefined(value)
    if (cleaned !== undefined) out[key] = cleaned
  }
  return out
}

/**
 * 更新歌手 tabCount（用絕對數值寫入，唔用 increment）。
 * increment() 喺部分 Firestore 規則下 diff(affectedKeys) 唔穩定，會導致 permission-denied。
 */
async function adjustArtistTabCountByDelta(artistId, delta) {
  if (!artistId || delta === 0) return
  const artistRef = doc(db, ARTISTS_COLLECTION, artistId)
  const artistSnap = await getDoc(artistRef)
  if (!artistSnap.exists()) return
  const cur = artistSnap.data()?.tabCount
  const n = typeof cur === 'number' && !Number.isNaN(cur) ? cur : 0
  const next = Math.max(0, n + delta)
  await updateDoc(artistRef, { tabCount: next })
}

// ==================== 多歌手處理工具 ====================

// 解析多歌手字符串
// 支持格式："歌手A，歌手B"、"歌手A/歌手B"、"歌手A & 歌手B"、"歌手A feat. 歌手B"
export function parseCollaborators(artistString) {
  if (!artistString || typeof artistString !== 'string') {
    return {
      primaryArtist: '',
      collaborators: [],
      collaborationType: null
    }
  }
  
  const trimmed = artistString.trim()
  
  // 檢查是否包含多個歌手分隔符（支援全型同半型）
  const separators = ['，', ',', '/', '&', '、', '｜', '|', '／', '＆']
  const featPatterns = [/\s+feat\.?\s*/i, /\s+ft\.?\s*/i, /\s+featuring\s+/i, /\s+with\s+/i]
  
  let collaborators = []
  let collaborationType = null
  let primaryArtist = trimmed
  
  // 先檢查 feat. 模式（優先）- 按 pattern 長度排序，避免 'feat' 匹配 'featuring'
  const sortedPatterns = [...featPatterns].sort((a, b) => b.source.length - a.source.length)
  for (const pattern of sortedPatterns) {
    if (pattern.test(trimmed)) {
      const parts = trimmed.split(pattern).map(p => p.trim()).filter(Boolean)
      if (parts.length >= 2) {
        primaryArtist = parts[0]
        collaborators = parts
        collaborationType = 'feat'
        break
      }
    }
  }
  
  // 如果沒有 feat 模式，檢查其他分隔符
  if (collaborators.length === 0) {
    for (const sep of separators) {
      if (trimmed.includes(sep)) {
        const parts = trimmed.split(sep).map(p => p.trim()).filter(Boolean)
        if (parts.length >= 2) {
          primaryArtist = parts[0]
          collaborators = parts
          collaborationType = '合唱'
          break
        }
      }
    }
  }
  
  // 如果只有一個歌手，collaborators 只包含主歌手
  if (collaborators.length === 0) {
    collaborators = [trimmed]
  }
  
  return {
    primaryArtist,
    collaborators: [...new Set(collaborators)], // 去重
    collaborationType,
    displayName: trimmed // 原始顯示名
  }
}

// Deprecated — use getOrCreateArtist() to get the stable Firestore doc ID instead.
// Kept only for callers that haven't migrated yet.
export function normalizeArtistId(artistName) {
  if (!artistName) return ''
  return artistName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\.\-\u4e00-\u9fa5]/g, '')
}

// 簡單內存緩存（5分鐘過期）
const cache = new Map()
const CACHE_DURATION = 5 * 60 * 1000 // 5分鐘

function getCached(key) {
  const item = cache.get(key)
  if (!item) return null
  if (Date.now() - item.timestamp > CACHE_DURATION) {
    cache.delete(key)
    return null
  }
  return item.data
}

function setCached(key, data) {
  cache.set(key, { data, timestamp: Date.now() })
}

export function invalidateArtistCaches() {
  if (typeof window === 'undefined') return
  cache.delete('allArtists')
  try {
    localStorage.removeItem('pg_artists_list')
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('pg_artist_')) keysToRemove.push(key)
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
    localStorage.setItem('pg_artists_bust', String(Date.now()))
  } catch (e) { /* ignore */ }
}

/** 清除指定歌手的樂譜列表 cache（編輯保存後呼叫） */
export function invalidateArtistTabsCache(artistId) {
  if (typeof window === 'undefined' || !artistId) return
  const prefix = `artistTabs_${artistId}_`
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

// Get migrated tabs (source: 'blogger')
export async function getMigratedTabs() {
  const q = query(
    collection(db, TABS_COLLECTION),
    where('source', '==', 'blogger'),
    orderBy('createdAt', 'desc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))
}

/** Main artist doc ID — supports legacy (tab.artistId) and new (tab.artists / tab.artistIds) shape. */
export function getTabArtistId(tab) {
  if (!tab) return ''
  if (Array.isArray(tab.artists) && tab.artists[0]?.id) return tab.artists[0].id
  if (Array.isArray(tab.artistIds) && tab.artistIds[0]) return tab.artistIds[0]
  if (tab.artistId) return tab.artistId
  return ''
}

/** All artist doc IDs — supports legacy (collaboratorIds / artistId) and new (artistIds / artists) shape. */
export function getTabArtistIds(tab) {
  if (!tab) return []
  if (Array.isArray(tab.artistIds) && tab.artistIds.length > 0) return tab.artistIds
  if (Array.isArray(tab.artists) && tab.artists.length > 0) return tab.artists.map(a => a.id).filter(Boolean)
  if (Array.isArray(tab.collaboratorIds) && tab.collaboratorIds.length > 0) return tab.collaboratorIds
  if (tab.artistId) return [tab.artistId]
  return []
}

// Check tab for issues
export function checkTabIssues(tab) {
  const issues = []
  if (!getTabArtistId(tab)) issues.push('缺少 artistId')
  if (!tab.content || tab.content.length < 10) issues.push('內容過短或缺失')
  if (!tab.title) issues.push('缺少歌名')
  return issues
}

// Firestore cache for getAllTabs (persists across serverless cold starts). TTL 24h.
const ALL_TABS_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000 // ~forever (bust on write)

/** Slim tab for cache: all fields except content and stale name fields. */
function slimTabForAllTabsCache(t) {
  if (!t) return t
  const { content, artist, artistName, artistSlug, ...rest } = t
  return { id: t.id, ...rest }
}

/** Slim tab for artist page list: no content. Source of truth: artists + artistIds only. */
export function slimTabForArtistPage(t) {
  if (!t) return t
  return {
    id: t.id,
    title: t.title,
    artistId: getTabArtistId(t) || t.artistId,
    artistIds: getTabArtistIds(t).length ? getTabArtistIds(t) : undefined,
    artists: t.artists,
    viewCount: t.viewCount,
    songYear: t.songYear,
    uploadYear: t.uploadYear,
    uploaderPenName: t.uploaderPenName,
    coverImage: t.coverImage,
    albumImage: t.albumImage,
    youtubeUrl: t.youtubeUrl,
    thumbnail: t.thumbnail,
    createdAt: t.createdAt,
    originalKey: t.originalKey,
    ...(t.slug ? { slug: t.slug } : {})
  }
}

/** Read all-tabs payload from Firestore cache. Returns { data } if fresh, { data, stale: true } if expired, null if missing. */
async function getAllTabsFromFirestoreCache() {
  try {
    const exists = (s) => s?.exists === true || (typeof s?.exists === 'function' && s.exists())
    const toMillis = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 + (t.nanoseconds || 0) / 1e6 : 0)

    const metaRef = doc(db, 'cache', 'allTabs_meta')
    const metaSnap = await getDoc(metaRef)
    if (exists(metaSnap) && metaSnap.data()?.partCount > 0) {
      const partCount = metaSnap.data().partCount
      const updatedAt = metaSnap.data().updatedAt
      if (!updatedAt) return null
      const age = Date.now() - toMillis(updatedAt)
      const merged = []
      for (let p = 0; p < partCount; p++) {
        const partSnap = await getDoc(doc(db, 'cache', `allTabs_${p}`))
        if (!exists(partSnap)) return null
        const partData = partSnap.data()?.data
        if (Array.isArray(partData)) merged.push(...partData)
      }
      if (merged.length === 0) return null
      if (age <= ALL_TABS_CACHE_TTL_MS) return { data: merged }
      return { data: merged, stale: true }
    }

    const ref = doc(db, 'cache', 'allTabs')
    const snap = await getDoc(ref)
    if (!exists(snap)) return null
    const d = snap.data()
    const data = d?.data
    const updatedAt = d?.updatedAt
    if (!data || !Array.isArray(data) || !updatedAt) return null
    const age = Date.now() - toMillis(updatedAt)
    if (age <= ALL_TABS_CACHE_TTL_MS) return { data }
    return { data, stale: true }
  } catch (e) {
    const msg = e?.message || String(e)
    if (/permission|Permission|PERMISSION_DENIED/i.test(msg)) return null
    throw e
  }
}

/** Build slim tabs list from Firestore (full collection read). Used by rebuild API or on cache miss. */
export async function buildAllTabsSlim() {
  const startMs = Date.now()
  const q = query(collection(db, TABS_COLLECTION), orderBy('createdAt', 'desc'))
  const snapshot = await getDocs(q)
  console.log(`[buildAllTabsSlim] ${snapshot.docs.length} tabs read in ${Date.now() - startMs}ms at ${pacificTime()}`)
  return snapshot.docs.map(d => slimTabForAllTabsCache({ id: d.id, ...d.data() }))
}

/** Write all-tabs slim payload to Firestore cache. Uses client SDK only so this file stays safe for browser (no firebase-admin). For Admin SDK write use setAllTabsCacheAdmin from lib/admin-cache.js in API routes. */
export async function setAllTabsCache(payload) {
  await setDoc(doc(db, 'cache', 'allTabs'), { data: payload, updatedAt: serverTimestamp() })
}

/**
 * Get all tabs. Uses Firestore cache (cache/allTabs, 24h TTL) so cold start = 1 read when cache fresh.
 * In-memory cache still used as L1 within same instance.
 * @param {{ withContent?: boolean }} opts - If withContent: true, skips Firestore cache and returns full docs (for data-review, analyze-tabs).
 */
export async function getAllTabs(opts = {}) {
  const withContent = opts?.withContent === true

  if (withContent) {
    const cacheKey = 'allTabs_full'
    const cached = getCached(cacheKey)
    if (cached) return cached
    const startMs = Date.now()
    const q = query(collection(db, TABS_COLLECTION), orderBy('createdAt', 'desc'))
    const snapshot = await getDocs(q)
    console.log(`[getAllTabs] withContent full read: ${snapshot.docs.length} tabs in ${Date.now() - startMs}ms at ${pacificTime()}`)
    const result = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    setCached(cacheKey, result)
    return result
  }

  const cacheKey = 'allTabs'
  const cached = getCached(cacheKey)
  if (cached) return cached

  const fromFirestore = await getAllTabsFromFirestoreCache()
  if (fromFirestore?.data) {
    setCached(cacheKey, fromFirestore.data)
    if (fromFirestore.stale) {
      setImmediate(() => {
        buildAllTabsSlim()
          .then((payload) => setAllTabsCache(payload))
          .catch((err) => console.error('[allTabs] background revalidate failed', err))
      })
    }
    return fromFirestore.data
  }

  const payload = await buildAllTabsSlim()
  setAllTabsCache(payload).catch((err) => console.error('[allTabs] setAllTabsCache failed', err?.message))
  setCached(cacheKey, payload)
  return payload
}

/** Parse createdAt (Firestore Timestamp, ISO string, or Date) into epoch ms for reliable sorting. */
function createdAtToMs(val) {
  if (!val) return 0
  if (typeof val.toMillis === 'function') return val.toMillis()
  if (typeof val.seconds === 'number') return val.seconds * 1000
  const d = new Date(val)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

// Get recent tabs (for homepage - limited count)
// Reads cache/latestSongs (small dedicated doc) — 1 Firestore read, no need to load all tabs.
// Falls back to a direct Firestore query (getRecentTabsFromFirestore) if the dedicated cache is missing — always correct.
export async function getRecentTabs(count = 20) {
  const cacheKey = `recentTabs_${count}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  try {
    const snap = await getDoc(doc(db, 'cache', 'latestSongs'))
    if (snap.exists()) {
      const data = snap.data()?.data
      if (Array.isArray(data) && data.length > 0) {
        const result = data.slice(0, count)
        setCached(cacheKey, result)
        return result
      }
    }
  } catch (e) {
    const msg = e?.message || String(e)
    if (!/permission|Permission|PERMISSION_DENIED/i.test(msg)) {
      console.warn('[getRecentTabs] latestSongs read failed, falling back to Firestore query:', msg)
    }
  }

  // Fallback: query Firestore directly — always correct, costs exactly `count` reads
  const tabs = await getRecentTabsFromFirestore(count)
  setCached(cacheKey, tabs)
  return tabs
}

/**
 * Fetch the N most recent tabs directly from Firestore (no cache/allTabs).
 * Uses `uploadedAt` (always a Timestamp, set on create) to avoid the mixed-type ordering bug:
 * Firestore sorts strings before Timestamps in DESC order, so imported tabs with string `createdAt`
 * values would surface before genuine new uploads. `uploadedAt` is never sourced from import data.
 * Falls back to `createdAt` ordering if no tabs have `uploadedAt` yet (first deploy).
 * Cost: exactly `count` reads (or 2×count on first deploy before uploadedAt exists).
 */
export async function getRecentTabsFromFirestore(count = 10) {
  // Primary: order by uploadedAt (always a fresh Timestamp, never from import data)
  try {
    const q = query(
      collection(db, TABS_COLLECTION),
      orderBy('uploadedAt', 'desc'),
      limit(count)
    )
    const snapshot = await getDocs(q)
    if (snapshot.docs.length > 0) {
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    }
  } catch (_) {
    // uploadedAt index may not exist yet — fall through to createdAt
  }

  // Fallback: createdAt (may have mixed types on older data, but better than nothing)
  const q = query(
    collection(db, TABS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(count)
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Get tabs by IDs (for manual selection - fetches specific tabs regardless of views)
export async function getTabsByIds(ids = []) {
  if (!ids.length) return []
  
  const validIds = ids.filter(id => typeof id === 'string' && id.trim() !== '')
  if (!validIds.length) return []
  
  // Firestore 'in' query supports max 10 IDs — run all batches in parallel
  const batchSize = 10
  const batches = []
  for (let i = 0; i < validIds.length; i += batchSize) {
    batches.push(validIds.slice(i, i + batchSize))
  }
  
  const snapshots = await Promise.all(
    batches.map(batch => {
      const q = query(
        collection(db, TABS_COLLECTION),
        where('__name__', 'in', batch)
      )
      return getDocs(q)
    })
  )
  
  const results = snapshots.flatMap(snapshot =>
    snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  )
  
  const orderMap = new Map(validIds.map((id, index) => [id, index]))
  return results.sort((a, b) => orderMap.get(a.id) - orderMap.get(b.id))
}

// Search tabs by title or artist (for admin selection - no view count restrictions)
export async function searchTabs(searchTerm, count = 20) {
  if (!searchTerm || searchTerm.trim().length < 2) return []
  
  const term = searchTerm.toLowerCase().trim()
  
  // 使用範圍查詢進行標題搜索（前綴匹配）
  const titleQuery = query(
    collection(db, TABS_COLLECTION),
    orderBy('title'),
    where('title', '>=', term),
    where('title', '<=', term + '\uf8ff'),
    limit(count)
  )
  
  const artistQuery = query(
    collection(db, TABS_COLLECTION),
    orderBy('artistName'),
    where('artistName', '>=', term),
    where('artistName', '<=', term + '\uf8ff'),
    limit(count)
  )
  
  const [titleSnapshot, artistSnapshot] = await Promise.all([
    getDocs(titleQuery),
    getDocs(artistQuery)
  ])
  
  const results = new Map()
  
  titleSnapshot.docs.forEach(doc => {
    results.set(doc.id, { id: doc.id, ...doc.data() })
  })
  
  artistSnapshot.docs.forEach(doc => {
    results.set(doc.id, { id: doc.id, ...doc.data() })
  })
  
  return Array.from(results.values()).slice(0, count)
}

// Get hot tabs (by view count - limited count)
export async function getHotTabs(count = 12) {
  const cacheKey = `hotTabs_${count}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  const q = query(
    collection(db, TABS_COLLECTION),
    orderBy('viewCount', 'desc'),
    limit(count)
  )
  const snapshot = await getDocs(q)
  const result = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))
  setCached(cacheKey, result)
  return result
}


// Get tabs by artist — queries by primary id and optional alternate id (e.g. doc id + normalizedName)
// so tabs stored with either id are found (fixes "song shows artist but artist page doesn't list the song").
export async function getTabsByArtist(artistName, artistDocId = null, alternateArtistId = null) {
  const primaryId = artistDocId || artistName.toLowerCase().replace(/\s+/g, '-')
  const ids = [primaryId]
  if (alternateArtistId && alternateArtistId !== primaryId && !ids.includes(alternateArtistId)) {
    ids.push(alternateArtistId)
  }
  const cacheKey = `artistTabs_${ids.sort().join('_')}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const startMs = Date.now()
  // Support both legacy (artistId, collaboratorIds) and new (artistIds only) tab shape.
  // Query for every id (doc id + normalizedName) so tabs saved with either are returned.
  const conditions = ids.flatMap(id => [
    where('artistId', '==', id),
    where('collaboratorIds', 'array-contains', id),
    where('artistIds', 'array-contains', id)
  ])
  const q = query(
    collection(db, TABS_COLLECTION),
    or(...conditions)
  )
  const snapshot = await getDocs(q).catch(() => null)
  const docIds = new Set()
  const allTabs = (snapshot ? snapshot.docs : [])
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => {
      if (docIds.has(t.id)) return false
      docIds.add(t.id)
      return true
    })
  console.log(`[getTabsByArtist] ${artistName} (${ids.join(', ')}) — ${allTabs.length} tabs in ${Date.now() - startMs}ms at ${pacificTime()}`)

  const result = allTabs.sort((a, b) => {
    const dateA = a.createdAt?.seconds ? new Date(a.createdAt.seconds * 1000) : new Date(a.createdAt || 0)
    const dateB = b.createdAt?.seconds ? new Date(b.createdAt.seconds * 1000) : new Date(b.createdAt || 0)
    return dateB - dateA
  })
  setCached(cacheKey, result)
  return result
}

// Sync cache lookup — returns enriched tab if available, null otherwise
export function getTabCached(id) {
  return getCached(`tab_${id}`)
}

// Write enriched tab back to cache (called after artist photo etc. are resolved)
export function setTabCache(id, data) {
  setCached(`tab_${id}`, data)
}

// 清除單一樂譜 cache（編輯保存後呼叫，避免顯示舊資料）
export function clearTabCache(id) {
  if (id) cache.delete(`tab_${id}`)
}

// Get single tab (with 5-min cache)
export async function getTab(idOrSlug, { skipCache = false } = {}) {
  if (!skipCache) {
    const cached = getTabCached(idOrSlug)
    if (cached) return cached
  }

  // Try as Firestore doc ID first
  const docRef = doc(db, TABS_COLLECTION, idOrSlug)
  const docSnap = await getDoc(docRef)
  if (docSnap.exists()) {
    const result = { id: docSnap.id, ...docSnap.data() }
    setTabCache(idOrSlug, result)
    return result
  }

  // Fall back to slug lookup
  try {
    const slugSnap = await getDocs(query(collection(db, TABS_COLLECTION), where('slug', '==', idOrSlug), limit(1)))
    if (!slugSnap.empty) {
      const d = slugSnap.docs[0]
      const result = { id: d.id, ...d.data() }
      setTabCache(idOrSlug, result)
      return result
    }
  } catch (_) {}

  return null
}

// Increment view count
export async function incrementViewCount(id) {
  try {
    const tabRef = doc(db, TABS_COLLECTION, id)
    await updateDoc(tabRef, {
      viewCount: increment(1)
    })
  } catch (error) {
    console.error('Error incrementing view count:', error)
  }
}

// Get or create artist.
// Checks by doc ID first, then by normalizedName to avoid creating duplicates
// when an artist was previously renamed (doc ID stays the same but normalizedName changes).
async function getOrCreateArtist(artistName, artistData = {}) {
  if (!artistName) return null
  
  const artistId = artistName.toLowerCase().replace(/\s+/g, '-')
  const artistRef = doc(db, ARTISTS_COLLECTION, artistId)
  const artistSnap = await getDoc(artistRef)
  
  if (artistSnap.exists()) {
    // Found by doc ID — optionally backfill empty fields
    const existingData = artistSnap.data()
    const updates = {}
    if (artistData.photo && !existingData.photo) updates.photo = artistData.photo
    if (artistData.heroPhoto) updates.heroPhoto = artistData.heroPhoto
    if (artistData.bio && !existingData.bio) updates.bio = artistData.bio
    if (artistData.year && !existingData.year) updates.year = artistData.year
    if (artistData.birthYear && !existingData.birthYear) updates.birthYear = artistData.birthYear
    if (artistData.debutYear && !existingData.debutYear) updates.debutYear = artistData.debutYear
    if (artistData.artistType && !existingData.artistType) updates.artistType = artistData.artistType
    if (Array.isArray(artistData.regions) && artistData.regions.length > 0 && (!Array.isArray(existingData.regions) || existingData.regions.length === 0)) updates.regions = artistData.regions
    if (Object.keys(updates).length > 0) {
      try {
        await updateDoc(artistRef, updates)
      } catch (e) {
        // 舊歌手冇 createdBy 時 backfill 會 permission-denied；仍可繼續建立樂譜
        if (e?.code !== 'permission-denied') console.warn('[getOrCreateArtist] backfill:', e)
      }
    }
    return artistId
  }

  // Doc ID not found — check if an existing artist has this normalizedName
  // (handles renamed artists whose doc ID differs from the current slug)
  const slug = nameToSlug(artistName)
  const bySlug = await getDocs(query(
    collection(db, ARTISTS_COLLECTION),
    where('normalizedName', '==', slug)
  ))
  if (!bySlug.empty) {
    const existing = bySlug.docs[0]
    const existingData = existing.data()
    const updates = {}
    if (artistData.photo && !existingData.photo) updates.photo = artistData.photo
    if (artistData.heroPhoto) updates.heroPhoto = artistData.heroPhoto
    if (artistData.bio && !existingData.bio) updates.bio = artistData.bio
    if (artistData.year && !existingData.year) updates.year = artistData.year
    if (artistData.birthYear && !existingData.birthYear) updates.birthYear = artistData.birthYear
    if (artistData.debutYear && !existingData.debutYear) updates.debutYear = artistData.debutYear
    if (artistData.artistType && !existingData.artistType) updates.artistType = artistData.artistType
    if (Array.isArray(artistData.regions) && artistData.regions.length > 0 && (!Array.isArray(existingData.regions) || existingData.regions.length === 0)) updates.regions = artistData.regions
    if (Object.keys(updates).length > 0) {
      try {
        await updateDoc(existing.ref, updates)
      } catch (e) {
        if (e?.code !== 'permission-denied') console.warn('[getOrCreateArtist] backfill (slug):', e)
      }
    }
    return existing.id
  }

  // Also try name match (catches case/spacing variants)
  const byName = await getDocs(query(
    collection(db, ARTISTS_COLLECTION),
    where('name', '==', artistName)
  ))
  if (!byName.empty) {
    return byName.docs[0].id
  }

  // No existing artist found — create new (slug already set above)
  await setDoc(artistRef, {
    name: artistName,
    normalizedName: slug || artistId,
    tabCount: 0,
    photo: artistData.photo || null,
    heroPhoto: artistData.heroPhoto || null,
    bio: artistData.bio || '',
    year: artistData.year || '',
    birthYear: artistData.birthYear || '',
    debutYear: artistData.debutYear || '',
    artistType: artistData.artistType || '',
    regions: Array.isArray(artistData.regions) ? artistData.regions : [],
    createdAt: new Date().toISOString()
  })
  
  return artistId
}

// Create tab
export async function createTab(tabData, userId) {
  // 解析多歌手
  const { primaryArtist, collaborators, collaborationType, displayName } = parseCollaborators(tabData.artist)
  
  // 歌手資料模板（共用欄位）
  const baseArtistData = {
    photo: tabData.artistPhoto || null,
    bio: tabData.artistBio || '',
    year: tabData.artistYear || '',
    birthYear: tabData.artistBirthYear || '',
    debutYear: tabData.artistDebutYear || '',
    artistType: tabData.artistType || '',
    regions: tabData.region ? tabData.region.split('／').filter(Boolean) : []
  }
  
  // 為所有合作歌手創建記錄（如果不存在）
  const collaboratorIds = []
  const formArtists = Array.isArray(tabData.artists) ? tabData.artists : []
  for (let i = 0; i < collaborators.length; i++) {
    const perArtist = formArtists[i]
    const artistData = perArtist ? {
      ...baseArtistData,
      artistType: perArtist.artistType || baseArtistData.artistType,
      regions: perArtist.region ? perArtist.region.split('／').filter(Boolean) : baseArtistData.regions
    } : baseArtistData
    const collabId = await getOrCreateArtist(collaborators[i], artistData)
    if (collabId) {
      collaboratorIds.push(collabId)
    }
  }
  
  // Store only artists + artistIds (artists[].role is source of truth: main | feat | slash)
  const artists = collaboratorIds.map((id, i) => ({
    id,
    role: i === 0 ? 'main' : (collaborationType === 'feat' ? 'feat' : 'slash')
  }))
  const artistIds = [...collaboratorIds]

  const STRIP_FIELDS = new Set(['artist', 'artistName', 'artistSlug'])
  const cleanTabData = {}
  for (const [key, value] of Object.entries(tabData)) {
    if (value !== undefined && !STRIP_FIELDS.has(key)) {
      cleanTabData[key] = value
    }
  }

  const newTab = stripUndefined({
    ...cleanTabData,
    originalKey: tabData.originalKey || 'C',
    artistType: tabData.artistType || '',
    artists,
    artistIds,
    createdBy: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    uploadedAt: new Date(), // always the actual upload time; never from import data (used for ordering in 最新上架)
    likes: 0,
    likedBy: [],
    viewCount: 0,
    // 出譜者名稱：每張譜顯示「編譜：XXX」用嘅名；建立/編輯時強制用個人主頁嘅 penName，改主頁名會同步更新所有譜。
    uploaderPenName: tabData.uploaderPenName || ''
  })

  assertTabDocumentFitsForFirestore(newTab)

  const docRef = await addDoc(collection(db, TABS_COLLECTION), newTab)

  // Generate and persist URL slug after we have the doc ID
  let slug = null
  const baseSlug = generateTabSlug(primaryArtist, tabData.title || '')
  if (baseSlug) {
    try {
      const slugSnap = await getDocs(query(collection(db, TABS_COLLECTION), where('slug', '==', baseSlug)))
      slug = slugSnap.empty ? baseSlug : `${baseSlug}-${docRef.id.slice(-4)}`
      await updateDoc(docRef, { slug })
      newTab.slug = slug
    } catch (_) {
      // Slug is non-critical — proceed without it
    }
  }

  // 歌手 tabCount +1（唔用 increment，配合 Firestore 規則 diff）
  for (const collabId of collaboratorIds) {
    try {
      await adjustArtistTabCountByDelta(collabId, 1)
    } catch (e) {
      console.warn('[createTab] tabCount +1 failed:', collabId, e?.code, e?.message)
    }
  }

  return {
    id: docRef.id,
    ...newTab,
    createdAt: newTab.createdAt.toISOString(),
    updatedAt: newTab.updatedAt.toISOString(),
    uploadedAt: newTab.uploadedAt.toISOString()
  }
}

const BATCH_SIZE = 500

/**
 * 將某用戶名下所有樂譜的 uploaderPenName 更新為新名稱（例如用戶在個人主頁改咗出譜者名稱）。
 * 強制每張譜跟住用戶嘅出譜者名稱。
 */
export async function updateUploaderPenNameForUser(userId, newPenName) {
  const name = (newPenName || '').trim() || ''
  const q = query(
    collection(db, TABS_COLLECTION),
    where('createdBy', '==', userId)
  )
  const snapshot = await getDocs(q)
  if (snapshot.empty) return { updated: 0 }
  const docs = snapshot.docs
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    const chunk = docs.slice(i, i + BATCH_SIZE)
    for (const d of chunk) {
      batch.update(d.ref, { uploaderPenName: name, updatedAt: new Date().toISOString() })
    }
    await batch.commit()
  }
  return { updated: docs.length }
}

// Update tab（userPenName：與 tab.uploaderPenName 一致時等同擁有者可編輯）
export async function updateTab(id, tabData, userId, isAdmin = false, userPenName = '') {
  const tabRef = doc(db, TABS_COLLECTION, id)
  const tabSnap = await getDoc(tabRef)
  
  if (!tabSnap.exists()) {
    throw new Error('Tab not found')
  }
  
  const currentTab = tabSnap.data()
  
  // 權限檢查：createdBy 相符、或出譜者名稱與 uploaderPenName 一致、或 admin
  if (!canUserEditTab(currentTab, userId, userPenName, isAdmin)) {
    if (!currentTab.createdBy && !isAdmin) {
      throw new Error('Unauthorized: Only admin can edit old migrated tabs')
    }
    throw new Error('Unauthorized: You can only edit your own tabs')
  }
  
  // 解析新歌手：有 explicit artists[].id 就用佢（編輯時揀咗現有歌手），否則由名 resolve
  const { collaborators: parsedNames } = parseCollaborators(tabData.artist || '')
  const baseArtistData = {
    photo: tabData.artistPhoto || null,
    bio: tabData.artistBio || '',
    year: tabData.artistYear || '',
    artistType: tabData.artistType || '',
    regions: tabData.region ? tabData.region.split('／').filter(Boolean) : []
  }
  let newCollaboratorIds = []
  let collaborators = parsedNames

  if (Array.isArray(tabData.artists) && tabData.artists.length > 0) {
    collaborators = tabData.artists.map((a) => (a && a.name) || '').filter(Boolean)
    for (const a of tabData.artists) {
      const perArtistData = {
        ...baseArtistData,
        artistType: a?.artistType || baseArtistData.artistType,
        regions: a?.region ? a.region.split('／').filter(Boolean) : baseArtistData.regions
      }
      if (a?.id) {
        newCollaboratorIds.push(a.id)
        // backfill artistType / regions for existing artist if empty
        try {
          const aRef = doc(db, ARTISTS_COLLECTION, a.id)
          const aSnap = await getDoc(aRef)
          if (aSnap.exists()) {
            const existing = aSnap.data()
            const updates = {}
            if (perArtistData.artistType && !existing.artistType) updates.artistType = perArtistData.artistType
            if (Array.isArray(perArtistData.regions) && perArtistData.regions.length > 0 && (!Array.isArray(existing.regions) || existing.regions.length === 0)) updates.regions = perArtistData.regions
            if (Object.keys(updates).length > 0) await updateDoc(aRef, updates)
          }
        } catch (_) {}
      } else if (a?.name) {
        const docId = await getOrCreateArtist(a.name, perArtistData)
        if (docId) newCollaboratorIds.push(docId)
      }
    }
  }
  if (newCollaboratorIds.length === 0) {
    for (const collabName of parsedNames) {
      const docId = await getOrCreateArtist(collabName, baseArtistData)
      if (docId) newCollaboratorIds.push(docId)
    }
  }

  const oldCollaboratorIds = getTabArtistIds(currentTab)

  const addedArtists = newCollaboratorIds.filter(id => !oldCollaboratorIds.includes(id))
  const removedArtists = oldCollaboratorIds.filter(id => !newCollaboratorIds.includes(id))

  for (const aId of removedArtists) {
    try {
      await adjustArtistTabCountByDelta(aId, -1)
    } catch (e) {
      console.warn('[updateTab] tabCount -1 failed:', aId, e?.code)
    }
  }

  for (const aId of addedArtists) {
    try {
      await adjustArtistTabCountByDelta(aId, 1)
    } catch (e) {
      console.warn('[updateTab] tabCount +1 failed:', aId, e?.code)
    }
  }

  const artists = newCollaboratorIds.map((id, i) => ({
    id,
    role: i === 0 ? 'main' : (tabData.artists?.[i]?.relation === 'feat' ? 'feat' : 'slash')
  }))
  const artistIds = [...newCollaboratorIds]

  const STRIP_FIELDS = new Set(['artist', 'artistName', 'artistSlug'])
  const cleanData = Object.fromEntries(
    Object.entries(tabData).filter(([k, v]) => v !== undefined && !STRIP_FIELDS.has(k))
  )

  const updatedData = stripUndefined({
    ...cleanData,
    artists,
    artistIds,
    updatedAt: new Date().toISOString()
  })

  if (isAdmin && tabData.hasOwnProperty('createdBy')) {
    updatedData.createdBy = (tabData.createdBy === null || tabData.createdBy === '')
      ? deleteField()
      : tabData.createdBy
  }

  assertTabDocumentFitsForFirestore({ ...currentTab, ...updatedData })

  await updateDoc(tabRef, updatedData)
  clearTabCache(id)
  return { id, ...currentTab, ...updatedData }
}

// Delete tab（userPenName：與 tab.uploaderPenName 一致時等同擁有者可刪除）
export async function deleteTab(id, userId, isAdmin = false, userPenName = '') {
  const tabRef = doc(db, TABS_COLLECTION, id)
  const tabSnap = await getDoc(tabRef)
  
  if (!tabSnap.exists()) {
    throw new Error('Tab not found')
  }
  
  const tab = tabSnap.data()
  
  if (!canUserEditTab(tab, userId, userPenName, isAdmin)) {
    if (!tab.createdBy && !isAdmin) {
      throw new Error('Unauthorized: Only admin can delete old migrated tabs')
    }
    throw new Error('Unauthorized: You can only delete your own tabs')
  }
  
  // Decrement all collaborator artist tab counts
  const collaboratorIds = getTabArtistIds(tab)
  
  for (const artistId of collaboratorIds) {
    if (artistId) {
      try {
        await adjustArtistTabCountByDelta(artistId, -1)
      } catch (e) {
        console.warn('[deleteTab] tabCount -1 failed:', artistId, e?.code)
      }
    }
  }

  await deleteDoc(tabRef)
  return true
}

// Toggle like
export async function toggleLike(tabId, userId) {
  const tabRef = doc(db, TABS_COLLECTION, tabId)
  const tabSnap = await getDoc(tabRef)
  
  if (!tabSnap.exists()) {
    throw new Error('Tab not found')
  }
  
  const tab = tabSnap.data()
  const likedBy = tab.likedBy || []
  const hasLiked = likedBy.includes(userId)
  
  if (hasLiked) {
    // Unlike
    await updateDoc(tabRef, {
      likes: increment(-1),
      likedBy: arrayRemove(userId)
    })
    return { liked: false, likes: (tab.likes || 1) - 1 }
  } else {
    // Like
    await updateDoc(tabRef, {
      likes: increment(1),
      likedBy: arrayUnion(userId)
    })
    return { liked: true, likes: (tab.likes || 0) + 1 }
  }
}

// Check if user liked tab
export function hasUserLiked(tab, userId) {
  if (!tab || !userId) return false
  return (tab.likedBy || []).includes(userId)
}

// Get all artists
export async function getAllArtists() {
  const cacheKey = 'allArtists'
  const cached = getCached(cacheKey)
  if (cached) {
    console.log('[getAllArtists] in-memory cache hit')
    return cached
  }

  const t0 = performance.now()
  const q = query(collection(db, ARTISTS_COLLECTION))
  const snapshot = await getDocs(q)
  console.log('[getAllArtists] Firestore query took', Math.round(performance.now() - t0), 'ms for', snapshot.docs.length, 'docs')
  
  const result = snapshot.docs.map(doc => {
    const data = doc.data()
    const displayPhoto = data.photoURL || data.wikiPhotoURL || data.photo || null
    const count = data.songCount || data.tabCount || 0
    return {
      id: doc.id,
      ...data,
      photo: displayPhoto,
      photoURL: data.photoURL || null,
      wikiPhotoURL: data.wikiPhotoURL || null,
      songCount: count,
      tabCount: count
    }
  })

  setCached(cacheKey, result)
  return result
}

// Get popular artists (for homepage - with tab counts)
export async function getPopularArtists(count = 30) {
  const cacheKey = `popularArtists_${count}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  const q = query(
    collection(db, ARTISTS_COLLECTION),
    orderBy('viewCount', 'desc'),
    limit(count)
  )
  const snapshot = await getDocs(q)
  const result = snapshot.docs.map(doc => {
    const data = doc.data()
    return {
      id: doc.id,
      ...data,
      photo: data.photoURL || data.wikiPhotoURL || data.photo || null,
      tabCount: data.songCount || data.tabCount || 0
    }
  })
  setCached(cacheKey, result)
  return result
}

/**
 * Generate a URL slug for a tab, e.g. generateTabSlug('Beyond', '光輝歲月') → 'beyond-光輝歲月'.
 * Keeps Chinese characters as-is; lowercases ASCII; replaces spaces/runs of hyphens with a single hyphen.
 */
export function generateTabSlug(artistName, title) {
  const slugify = (s) =>
    (s || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  const a = slugify(artistName)
  const t = slugify(title)
  if (a && t) return `${a}-${t}`
  return a || t || ''
}

/** 由歌手名生成 URL slug，例如 "陳奕迅 Eason Chan" → "陳奕迅-eason-chan"（一律小寫） */
export function nameToSlug(name) {
  if (!name || typeof name !== 'string') return ''
  return name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/**
 * URL slug for artist page: use normalizedName (updated on rename) so URLs stay stable and match current name.
 * Use this when you have an artist object; when you only have artistId, use id in URL and the page will redirect to canonical slug.
 */
export function getArtistSlug(artist) {
  if (!artist || typeof artist !== 'object') return ''
  return (artist.normalizedName && artist.normalizedName.trim()) ||
    (artist.name && nameToSlug(artist.name)) ||
    (artist.id && String(artist.id)) ||
    ''
}

// Get artist by slug (normalizedName)
export async function getArtistBySlug(slug) {
  const q = query(
    collection(db, ARTISTS_COLLECTION),
    where('normalizedName', '==', slug)
  )
  const snapshot = await getDocs(q)
  if (snapshot.empty) return null
  const d = snapshot.docs[0]
  const data = d.data()
  const displayPhoto = data.photoURL || data.wikiPhotoURL || data.photo || null
  return {
    id: d.id,
    ...data,
    photo: displayPhoto,
    photoURL: data.photoURL || null,
    wikiPhotoURL: data.wikiPhotoURL || null,
    heroPhoto: data.heroPhoto || null
  }
}

/**
 * 用 URL id/slug 搵歌手：先 doc id，再 normalizedName，再試 id 第一段（如 candy-王家晴 → candy）
 * 方便「創建新歌手」時只填 candy 但有人用 candy-王家晴 連結入嚟都搵到。
 * URL 可能係 encoded（如 candy-%E7%8E%8B%E5%AE%B6%E6%99%B4），先試解碼再查。
 */
/** Decode and normalize for URL segment (handles percent-encoding and Unicode NFC). */
function decodeAndNormalizeSegment(segment) {
  if (!segment || typeof segment !== 'string') return segment
  let s = segment
  try {
    for (let i = 0; i < 3; i++) {
      const d = decodeURIComponent(s)
      if (d === s) break
      s = d
    }
  } catch (_) { /* keep s */ }
  return s.normalize ? s.normalize('NFC') : s
}

export async function getArtistByIdOrSlug(id) {
  if (!id || typeof id !== 'string') return null
  const lookupId = decodeAndNormalizeSegment(id)
  const artistRef = doc(db, ARTISTS_COLLECTION, lookupId)
  let artistSnap = await getDoc(artistRef)
  if (artistSnap.exists()) {
    const data = artistSnap.data()
    const displayPhoto = data.photoURL || data.wikiPhotoURL || data.photo || null
    return { id: artistSnap.id, ...data, photo: displayPhoto, photoURL: data.photoURL || null, wikiPhotoURL: data.wikiPhotoURL || null, heroPhoto: data.heroPhoto || null }
  }
  let bySlug = await getArtistBySlug(lookupId)
  // URL 可能係小寫（如 ak-江𤒹生）但 DB 存咗大寫（AK-江𤒹生），再試首段全大寫
  if (!bySlug && lookupId.includes('-')) {
    const parts = lookupId.split('-')
    const slugFirstUpper = parts.map((seg, i) => (i === 0 && seg.length > 0 ? seg.toUpperCase() : seg)).join('-')
    if (slugFirstUpper !== lookupId) bySlug = await getArtistBySlug(slugFirstUpper)
  }
  if (!bySlug && lookupId !== lookupId.toLowerCase()) bySlug = await getArtistBySlug(lookupId.toLowerCase())
  if (bySlug) return bySlug
  const firstSegment = lookupId.includes('-') ? lookupId.split('-')[0] : null
  if (firstSegment) {
    const ref2 = doc(db, ARTISTS_COLLECTION, firstSegment)
    const snap2 = await getDoc(ref2)
    if (snap2.exists()) {
      const data = snap2.data()
      const displayPhoto = data.photoURL || data.wikiPhotoURL || data.photo || null
      return { id: snap2.id, ...data, photo: displayPhoto, photoURL: data.photoURL || null, wikiPhotoURL: data.wikiPhotoURL || null, heroPhoto: data.heroPhoto || null }
    }
  }
  // Firestore doc ids 通常小寫（如 candy-王家晴），若 URL 用咗大寫（Candy-王家晴）再試首段小寫
  if (lookupId.includes('-')) {
    const parts = lookupId.split('-')
    const idLowerFirst = parts.map((seg, i) => (i === 0 ? seg.toLowerCase() : seg)).join('-')
    if (idLowerFirst !== lookupId) {
      const ref3 = doc(db, ARTISTS_COLLECTION, idLowerFirst)
      const snap3 = await getDoc(ref3)
      if (snap3.exists()) {
        const data = snap3.data()
        const displayPhoto = data.photoURL || data.wikiPhotoURL || data.photo || null
        return { id: snap3.id, ...data, photo: displayPhoto, photoURL: data.photoURL || null, wikiPhotoURL: data.wikiPhotoURL || null, heroPhoto: data.heroPhoto || null }
      }
    }
  }
  return null
}

// Get top songs by view count for an artist (supports legacy artistId and new artistIds)
export async function getTopSongsByArtist(artistName, artistDocId, limitCount = 5) {
  const artistId = artistDocId || artistName.toLowerCase().replace(/\s+/g, '-')
  try {
    const snapshot = await getDocs(query(
      collection(db, TABS_COLLECTION),
      or(
        where('artistId', '==', artistId),
        where('artistIds', 'array-contains', artistId)
      )
    ))
    return snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, limitCount)
  } catch (e) {
    console.log('[getTopSongsByArtist] query failed:', artistId, e)
    return []
  }
}

// Get all songs by artist ordered by creation date (supports legacy artistId and new artistIds)
export async function getAllSongsByArtistGrouped(artistName, artistDocId) {
  const artistId = artistDocId || artistName.toLowerCase().replace(/\s+/g, '-')
  try {
    const snapshot = await getDocs(query(
      collection(db, TABS_COLLECTION),
      or(
        where('artistId', '==', artistId),
        where('artistIds', 'array-contains', artistId)
      )
    ))
    return snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0)
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0)
        return dateB - dateA
      })
  } catch (e) {
    console.log('[getAllSongsByArtistGrouped] query failed:', artistId, e)
    return []
  }
}

// ==================== 系統設定 (Settings) ====================

const SETTINGS_COLLECTION = 'settings'
const GLOBAL_SETTINGS_DOC = 'global'

// 取得系統設定
export async function getGlobalSettings() {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, GLOBAL_SETTINGS_DOC)
    const docSnap = await getDoc(docRef)
    
    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...docSnap.data()
      }
    }
    
    // 如果沒有設定，返回預設值
    return {
      id: GLOBAL_SETTINGS_DOC,
      logoUrl: null,
      siteName: 'Polygon 結他譜',
      updatedAt: null,
      updatedBy: null
    }
  } catch (error) {
    console.error('Error getting global settings:', error)
    return {
      id: GLOBAL_SETTINGS_DOC,
      logoUrl: null,
      siteName: 'Polygon 結他譜',
      updatedAt: null,
      updatedBy: null
    }
  }
}

// 更新系統設定（Logo）
export async function updateGlobalSettings(settings, userId) {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, GLOBAL_SETTINGS_DOC)
    const updateData = {
      ...settings,
      updatedAt: serverTimestamp(),
      updatedBy: userId
    }
    
    await setDoc(docRef, updateData, { merge: true })
    return { success: true }
  } catch (error) {
    console.error('Error updating global settings:', error)
    throw error
  }
}

// 上傳 Logo 並更新設定
export async function uploadLogoAndUpdateSettings(cloudinaryUrl, userId) {
  try {
    // 更新系統設定
    await updateGlobalSettings({
      logoUrl: cloudinaryUrl
    }, userId)
    
    return { 
      success: true, 
      logoUrl: cloudinaryUrl 
    }
  } catch (error) {
    console.error('Error uploading logo:', error)
    throw error
  }
}

// 獲取分類封面圖片設定
export async function getCategoryImages() {
  try {
    const docRef = doc(db, 'settings', 'categoryImages')
    const docSnap = await getDoc(docRef)
    
    if (docSnap.exists()) {
      return docSnap.data()
    }
    
    return null
  } catch (error) {
    console.error('Error getting category images:', error)
    return null
  }
}

