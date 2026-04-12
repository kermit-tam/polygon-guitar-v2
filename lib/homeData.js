/**
 * Server-side: build one JSON payload with all homepage data.
 * Use from getServerSideProps or GET /api/home-data for a single round-trip load.
 *
 * Home cache: full payload is stored in Firestore at cache/homePage, updated every 6h
 * (or on manual bust). Each homepage visit = 1 Firestore read when cache is fresh.
 */

import { pacificTime } from '@/lib/logTime'
import { doc, getDoc, collection, query, where, getDocs } from '@/lib/firestore-tracked'
import { db } from '@/lib/firebase'
import {
  getAllArtists,
  getHotTabs,
  getRecentTabsFromFirestore,
  getCategoryImages,
  getTabsByIds,
  getTabArtistId,
  getTabArtistIds
} from '@/lib/tabs'
import { getAllActivePlaylists, bustPlaylistsInMemoryCache } from '@/lib/playlists'
import { tryAcquireLock, releaseLock } from '@/lib/cache-lock'

const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000 // ~forever (bust on write)

/** API in-memory cache — 45s TTL so staleness stays under 1 min. */
let _homeApiCache = null
let _homeApiCacheTime = 0
const _HOME_API_CACHE_TTL_MS = 45 * 1000

export function bustHomeDataApiCache() {
  _homeApiCache = null
  _homeApiCacheTime = 0
}

/** For /api/home-data: serve from in-memory when fresh, else getHomeData() and store. */
export async function getHomeDataCached() {
  if (_homeApiCache != null && Date.now() - _homeApiCacheTime < _HOME_API_CACHE_TTL_MS) {
    return _homeApiCache
  }
  const data = await getHomeData()
  _homeApiCache = data
  _homeApiCacheTime = Date.now()
  return data
}

const DEFAULT_CATEGORIES = [
  { id: 'male', name: '男歌手', image: null, color: 'from-blue-900/80 to-black/80' },
  { id: 'female', name: '女歌手', image: null, color: 'from-pink-900/80 to-black/80' },
  { id: 'group', name: '組合', image: null, color: 'from-purple-900/80 to-black/80' }
]

function getCroppedWikiImage(url) {
  if (!url) return url
  if (url.includes('/thumb/')) {
    return url.replace(/\/\d+px-/, '/200px-')
  }
  return url
}

function serialize(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) =>
      v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v
    )
  )
}

/** Resolve one cover image URL (same priority as SongCard: coverImage → albumImage → YouTube thumb → thumbnail) */
function resolveTabCoverImage(tab) {
  if (tab?.coverImage) return tab.coverImage
  if (tab?.albumImage) return tab.albumImage
  const videoId = tab?.youtubeVideoId ?? tab?.youtubeUrl?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1]
  if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
  if (tab?.thumbnail) return tab.thumbnail
  return null
}

/** Resolve artist name from id map; artist docs use lowercase id so try both exact and lowercase. */
function resolveArtistNameFromMap(artistNameById, artistId) {
  if (!artistNameById || !artistId) return null
  return artistNameById[artistId] || artistNameById[artistId.toLowerCase()] || null
}

/** Only fields needed for home SongCard: id, title, artistId; one image — coverImage, or artistPhoto only when no cover (saves payload). artist line from artistIds only (map lookup per id). */
function slimTabForHome(tab, photoMap, artistNameById = null) {
  if (!tab) return tab
  const mainArtistId = getTabArtistId(tab)
  const artistIds = getTabArtistIds(tab)
  const coverImage = resolveTabCoverImage(tab)
  const artistPhoto =
    !coverImage && photoMap && (photoMap[mainArtistId] || (mainArtistId && photoMap[mainArtistId.toLowerCase()]))
  const isFeat =
    tab.artists?.[1]?.role === 'feat' || tab.artists?.[1]?.relation === 'feat'
  const sepMulti = isFeat ? ' feat. ' : ' / '
  let artistDisplay
  if (artistIds.length > 1) {
    artistDisplay = artistIds
      .map((id) => resolveArtistNameFromMap(artistNameById, id) || id)
      .join(sepMulti)
  } else if (artistIds.length === 1) {
    artistDisplay =
      resolveArtistNameFromMap(artistNameById, artistIds[0]) ||
      tab.artist ||
      tab.artistName ||
      artistIds[0]
  } else {
    artistDisplay = tab.artist || tab.artistName || ''
  }
  return {
    id: tab.id,
    title: tab.title,
    artistId: mainArtistId,
    ...(artistDisplay ? { artist: artistDisplay } : {}),
    ...(artistIds.length > 1
      ? {
          artistIds,
          ...(Array.isArray(tab.artists) && tab.artists.length > 1
            ? { artists: tab.artists.map((a) => ({ role: a.role })) }
            : {})
        }
      : {}),
    ...(coverImage ? { coverImage } : {}),
    ...(artistPhoto && typeof artistPhoto === 'string' ? { artistPhoto } : {}),
    ...(tab.slug ? { slug: tab.slug } : {})
  }
}

/** Only fields needed for home ArtistAvatar / link: id, name, one photo URL */
function slimArtistForHome(artist) {
  if (!artist) return artist
  return {
    id: artist.id,
    name: artist.name,
    photo: artist.photoURL ?? artist.wikiPhotoURL ?? artist.photo
  }
}

/** customPlaylistSections: omit playlistId when it equals id (client can use id as playlistId) */
function slimCustomPlaylistSections(sections) {
  if (!Array.isArray(sections)) return sections
  return sections.map((s) => {
    const out = { id: s.id, type: s.type }
    if (s.type === 'customPlaylist' && s.playlistId !== s.id) out.playlistId = s.playlistId
    if (s.type === 'playlistGroup') out.playlistIds = s.playlistIds
    if (s.title != null) out.title = s.title
    if (s.customLabel != null && s.customLabel !== '') out.customLabel = s.customLabel
    return out
  })
}

/** Section order: only include enabled when false (client treats missing as true) */
function slimSectionOrder(order) {
  if (!Array.isArray(order)) return order
  return order.map((s) => {
    const out = { id: s.id }
    if (s.customLabel != null && s.customLabel !== '') out.customLabel = s.customLabel
    if (s.enabled === false) out.enabled = false
    return out
  })
}

/** Only fields needed for home PlaylistCard: id, title, cover; description only when non-empty. */
function slimPlaylistForHome(playlist) {
  if (!playlist) return playlist
  const desc =
    typeof playlist.description === 'string' && playlist.description.trim()
      ? playlist.description.trim()
      : null
  return {
    id: playlist.id,
    title: playlist.title,
    coverImage: playlist.coverImage,
    ...(desc != null ? { description: desc } : {}),
    ...(playlist.slug ? { slug: playlist.slug } : {})
  }
}

/**
 * Write the full home payload to Firestore cache. Uses Admin SDK only (client cannot write to cache/).
 * If Admin is not configured, write is skipped (see FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_*).
 */
let _homeCacheWarned = false
export async function setHomeCache(payload) {
  try {
    const { getAdminDb } = await import('@/lib/admin-db')
    const adminDb = getAdminDb()
    if (adminDb) {
      const { FieldValue } = await import('firebase-admin/firestore')
      await adminDb.collection('cache').doc('homePage').set({
        data: payload,
        updatedAt: FieldValue.serverTimestamp()
      })
      console.log('[homeData] cache written (homePage)')
      return
    }
  } catch (e) {
    console.error('[homeData] setHomeCache via Admin failed', e?.message)
    return
  }
  if (!_homeCacheWarned) {
    _homeCacheWarned = true
    console.warn('[homeData] Cache write skipped. Set FIREBASE_SERVICE_ACCOUNT (or FIREBASE_ADMIN_*) to enable home cache writes.')
  }
}

/** Normalise createdAt to ms for sorting (Timestamp, number, string, or Date). */
function createdAtToMs(v) {
  if (v == null) return 0
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const d = v?.toDate ? v.toDate() : (typeof v === 'string' ? new Date(v) : v)
  if (d instanceof Date) return isNaN(d.getTime()) ? 0 : d.getTime()
  if (typeof d === 'number') return Number.isFinite(d) ? d : 0
  return 0
}

/**
 * Build homepage payload from pre-fetched snapshots (no extra Firestore reads).
 * Used by combined rebuild-home-and-search-cache to share one full DB read with search.
 * Returns a plain object suitable for JSON (Timestamps → ISO strings).
 */
export function buildHomeDataPayloadFromRaw({
  tabsSnap,
  artistsSnap,
  playlistsSnap,
  settingsDoc,
  categoryImagesDoc
}) {
  const settings = (settingsDoc && settingsDoc.exists) ? settingsDoc.data() : {}
  const categoryImages = (categoryImagesDoc && categoryImagesDoc.exists) ? categoryImagesDoc.data() : null

  // popularArtists: same shape as getAllArtists()
  const popularArtistsData = artistsSnap.docs.map((d) => {
    const data = d.data()
    const count = data.songCount || data.tabCount || 0
    return {
      id: d.id,
      ...data,
      photo: data.photoURL || data.wikiPhotoURL || data.photo || null,
      songCount: count,
      tabCount: count
    }
  })

  // playlistsData: same shape as getAllActivePlaylists() { auto, manual }
  const allPlaylists = playlistsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.isActive !== false)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
  const playlistsData = {
    auto: allPlaylists.filter((p) => p.source === 'auto'),
    manual: allPlaylists.filter((p) => p.source === 'manual')
  }
  const autoPlaylistsData = playlistsData.auto || []
  const manualPlaylistsData = playlistsData.manual || []

  const tabsArray = tabsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const tabsById = new Map(tabsArray.map((t) => [t.id, t]))

  const recentTabsData = [...tabsArray]
    .sort((a, b) => createdAtToMs(b.createdAt) - createdAtToMs(a.createdAt))
    .slice(0, 10)
  const defaultHotTabsData = [...tabsArray]
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
    .slice(0, 22)

  const targetCount = Math.min(settings.hotTabs?.displayCount || 12, 100)
  let hotTabsData = defaultHotTabsData.slice(0, targetCount)
  if (settings.hotTabs?.useManual && settings.hotTabs?.manualSelection?.length > 0) {
    const manualIds = settings.hotTabs.manualSelection
      .map((t) => (typeof t === 'object' && t !== null ? t.id : t))
      .filter((id) => typeof id === 'string' && id.trim() !== '')
      .slice(0, 30)
    if (manualIds.length > 0) {
      const manualTabs = manualIds.map((id) => tabsById.get(id)).filter(Boolean)
      if (manualTabs.length >= targetCount) {
        hotTabsData = manualTabs.slice(0, targetCount)
      } else {
        const manualIdsSet = new Set(manualIds)
        const autoFill = defaultHotTabsData
          .filter((t) => !manualIdsSet.has(t.id))
          .slice(0, targetCount - manualTabs.length)
        hotTabsData = [...manualTabs, ...autoFill].slice(0, targetCount)
      }
    }
  }

  const customSections = settings.customPlaylistSections || []
  const sectionSongIds = {}
  let customPlaylistSongs = {}
  customSections.forEach((section) => {
    if (section.type === 'customPlaylist' && section.playlistId) {
      const playlist =
        autoPlaylistsData.find((p) => p.id === section.playlistId) ||
        manualPlaylistsData.find((p) => p.id === section.playlistId)
      if (playlist?.songIds?.length) {
        sectionSongIds[section.id] = playlist.songIds
        customPlaylistSongs[section.id] = (playlist.songIds || [])
          .map((id) => tabsById.get(id))
          .filter(Boolean)
      }
    }
  })

  let popularArtists = popularArtistsData || []
  const rawManualSelection = Array.isArray(settings.manualSelection)
    ? settings.manualSelection
    : [
        ...(settings.manualSelection?.male || []),
        ...(settings.manualSelection?.female || []),
        ...(settings.manualSelection?.group || [])
      ]
  const manualArtistIds = rawManualSelection
    .map((item) => (typeof item === 'object' && item !== null ? item.id : item))
    .filter((id) => typeof id === 'string' && id.trim() !== '')
  if (manualArtistIds.length > 0) {
    const existingIds = new Set(popularArtists.map((a) => a.id))
    const missingIds = manualArtistIds.filter((id) => !existingIds.has(id))
    if (missingIds.length > 0) {
      const allMissing = missingIds
        .map((id) => artistsSnap.docs.find((d) => d.id === id))
        .filter(Boolean)
        .map((d) => {
          const data = d.data()
          return {
            id: d.id,
            ...data,
            photo: data.photoURL || data.wikiPhotoURL || data.photo || null,
            tabCount: data.songCount || data.tabCount || 0
          }
        })
      popularArtists = [...popularArtists, ...allMissing]
    }
  }

  const photoMap = {}
  const artistNameById = {}
  popularArtists.forEach((artist) => {
    photoMap[artist.id] = artist.photoURL || artist.wikiPhotoURL || artist.photo || null
    if (artist.name) photoMap[artist.name] = photoMap[artist.id]
    if (artist.id && artist.name) artistNameById[artist.id] = artist.name
  })
  for (const sectionId of Object.keys(customPlaylistSongs)) {
    customPlaylistSongs[sectionId] = customPlaylistSongs[sectionId].map((t) =>
      slimTabForHome(t, photoMap, artistNameById)
    )
  }

  const displayCount = settings.displayCount || 20
  const sortBy = settings.hotArtistSortBy || 'tier'
  const DEFAULT_TIER = 5
  const ORDER_LAST = 999999
  const sortArtists = (artists) =>
    [...artists].sort((a, b) => {
      if (sortBy === 'tabCount') {
        return (b.songCount || b.tabCount || 0) - (a.songCount || a.tabCount || 0)
      }
      const oa = a.displayOrder ?? ORDER_LAST
      const ob = b.displayOrder ?? ORDER_LAST
      if (oa !== ob) return oa - ob
      const ta = a.tier ?? DEFAULT_TIER
      const tb = b.tier ?? DEFAULT_TIER
      if (ta !== tb) return ta - tb
      return (b.songCount || b.tabCount || 0) - (a.songCount || a.tabCount || 0) || (a.name || '').localeCompare(b.name || '')
    })
  const sortedArtists = sortArtists(popularArtists)
  let manualIds = []
  if (Array.isArray(settings.manualSelection)) {
    manualIds = settings.manualSelection
  } else if (typeof settings.manualSelection === 'object' && settings.manualSelection) {
    manualIds = [
      ...(settings.manualSelection?.male || []),
      ...(settings.manualSelection?.female || []),
      ...(settings.manualSelection?.group || [])
    ]
  }
  const hasManualSelection = Array.isArray(settings.manualSelection)
    ? manualIds.length > 0
    : !!(settings.useManualSelection?.male || settings.useManualSelection?.female || settings.useManualSelection?.group)
  const getHotArtists = () => {
    if (hasManualSelection && manualIds.length > 0) {
      const manualArtists = manualIds
        .map((id) => popularArtists.find((a) => a.id === id))
        .filter(Boolean)
      if (settings.hotArtistUseManual) {
        return manualArtists.slice(0, displayCount)
      }
      const manualIdsSet = new Set(manualIds)
      const autoFill = sortedArtists
        .filter((a) => !manualIdsSet.has(a.id))
        .slice(0, displayCount - manualArtists.length)
      return [...manualArtists, ...autoFill].slice(0, displayCount)
    }
    return sortedArtists.slice(0, displayCount)
  }
  const artistPageSort = (artists) =>
    [...artists].sort((a, b) => {
      const oa = a.displayOrder ?? ORDER_LAST
      const ob = b.displayOrder ?? ORDER_LAST
      if (oa !== ob) return oa - ob
      const ta = a.tier ?? DEFAULT_TIER
      const tb = b.tier ?? DEFAULT_TIER
      if (ta !== tb) return ta - tb
      return (b.songCount || b.tabCount || 0) - (a.songCount || a.tabCount || 0) || (a.name || '').localeCompare(b.name || '')
    })
  const hotArtistsData = {
    all: getHotArtists().map(slimArtistForHome),
    male: artistPageSort(popularArtists.filter((a) => (a.artistType || a.gender) === 'male')).slice(0, 5).map(slimArtistForHome),
    female: artistPageSort(popularArtists.filter((a) => (a.artistType || a.gender) === 'female')).slice(0, 5).map(slimArtistForHome),
    group: artistPageSort(popularArtists.filter((a) => (a.artistType || a.gender) === 'group')).slice(0, 5).map(slimArtistForHome)
  }
  let processedCategories = DEFAULT_CATEGORIES.map((cat) => ({ ...cat }))
  if (categoryImages) {
    const artistMap = new Map(popularArtists.map((a) => [a.id, a]))
    processedCategories = DEFAULT_CATEGORIES.map((cat) => {
      const catData = categoryImages[cat.id]
      let imageUrl = null
      if (catData?.artistId && artistMap.has(catData.artistId)) {
        const artist = artistMap.get(catData.artistId)
        imageUrl = artist.photoURL || artist.wikiPhotoURL || artist.photo || catData.image || null
      } else if (catData?.image) {
        imageUrl = catData.image
      }
      if (imageUrl?.includes('wikipedia.org')) imageUrl = getCroppedWikiImage(imageUrl)
      return { ...cat, image: imageUrl }
    })
  }
  return serialize({
    homeSettings: {
      ...settings,
      sectionOrder: slimSectionOrder(settings.sectionOrder) ?? settings.sectionOrder,
      customPlaylistSections: slimCustomPlaylistSections(settings.customPlaylistSections) ?? settings.customPlaylistSections
    },
    hotTabs: hotTabsData.map((t) => slimTabForHome(t, photoMap, artistNameById)),
    latestSongs: (recentTabsData || []).map((t) => slimTabForHome(t, photoMap, artistNameById)),
    autoPlaylists: autoPlaylistsData.length > 0 ? autoPlaylistsData.map(slimPlaylistForHome) : [],
    manualPlaylists: manualPlaylistsData.length > 0 ? manualPlaylistsData.map(slimPlaylistForHome) : [],
    hotArtists: hotArtistsData,
    categories: processedCategories,
    customPlaylistSongs
  })
}

/**
 * Build homepage payload from live Firestore data (all reads happen here).
 * Returns a plain object suitable for JSON (Timestamps → ISO strings).
 */
export async function buildHomeDataPayload() {
  console.log('[homeData] buildHomeDataPayload started', pacificTime())
  const startMs = Date.now()
  // Bust in-memory playlist cache so warm Vercel instances always read fresh playlist data
  // (avoids stale customPlaylistSongs in the rebuilt home cache when playlists were recently updated)
  bustPlaylistsInMemoryCache()
  const [
    settingsDoc,
    popularArtistsData,
    playlistsData,
    recentTabsData,
    defaultHotTabsData,
    categoryImages
  ] = await Promise.all([
    getDoc(doc(db, 'settings', 'home')),
    getAllArtists(),
    getAllActivePlaylists(),
    getRecentTabsFromFirestore(10),
    getHotTabs(22),
    getCategoryImages()
  ])
  const artistCount = Array.isArray(popularArtistsData) ? popularArtistsData.length : 0
  const playlistCount = (playlistsData?.auto?.length || 0) + (playlistsData?.manual?.length || 0)
  console.log(`[homeData] initial queries done in ${Date.now() - startMs}ms — ${artistCount} artists, ${playlistCount} playlists, ${recentTabsData?.length || 0} recent, ${defaultHotTabsData?.length || 0} hot at ${pacificTime()}`)

  const settings = settingsDoc.exists() ? settingsDoc.data() : {}
  const autoPlaylistsData = playlistsData.auto || []
  const manualPlaylistsData = playlistsData.manual || []

  // Hot tabs (manual selection or default)
  const targetCount = Math.min(settings.hotTabs?.displayCount || 10, 100)
  let hotTabsData = defaultHotTabsData.slice(0, targetCount)
  if (settings.hotTabs?.useManual && settings.hotTabs?.manualSelection?.length > 0) {
    const manualIds = settings.hotTabs.manualSelection
      .map((t) => (typeof t === 'object' && t !== null ? t.id : t))
      .filter((id) => typeof id === 'string' && id.trim() !== '')
      .slice(0, 30)
    if (manualIds.length > 0) {
      const manualTabs = await getTabsByIds(manualIds)
      if (manualTabs.length >= targetCount) {
        hotTabsData = manualTabs.slice(0, targetCount)
      } else {
        const manualIdsSet = new Set(manualIds)
        const autoFill = defaultHotTabsData
          .filter((t) => !manualIdsSet.has(t.id))
          .slice(0, targetCount - manualTabs.length)
        hotTabsData = [...manualTabs, ...autoFill].slice(0, targetCount)
      }
    }
  }

  // Custom playlist sections: collect all song IDs per section, then one batch fetch
  const customSections = settings.customPlaylistSections || []
  const sectionSongIds = {} // { [sectionId]: string[] }
  const allCustomIds = new Set()
  customSections.forEach((section) => {
    if (section.type === 'customPlaylist' && section.playlistId) {
      const playlist =
        autoPlaylistsData.find((p) => p.id === section.playlistId) ||
        manualPlaylistsData.find((p) => p.id === section.playlistId)
      if (playlist?.songIds?.length) {
        sectionSongIds[section.id] = playlist.songIds
        playlist.songIds.forEach((id) => allCustomIds.add(id))
      }
    }
  })

  let customPlaylistSongs = {} // { [sectionId]: tab[] } — raw first, slim with photoMap after it's built
  if (allCustomIds.size > 0) {
    const fetched = await getTabsByIds(Array.from(allCustomIds))
    const byId = new Map(fetched.map((t) => [t.id, t]))
    Object.keys(sectionSongIds).forEach((sectionId) => {
      const ordered = (sectionSongIds[sectionId] || [])
        .map((id) => byId.get(id))
        .filter(Boolean)
      customPlaylistSongs[sectionId] = ordered
    })
  }

  // Missing artists for manual selection
  let popularArtists = popularArtistsData || []
  const rawManualSelection = Array.isArray(settings.manualSelection)
    ? settings.manualSelection
    : [
        ...(settings.manualSelection?.male || []),
        ...(settings.manualSelection?.female || []),
        ...(settings.manualSelection?.group || [])
      ]
  const manualArtistIds = rawManualSelection
    .map((item) => (typeof item === 'object' && item !== null ? item.id : item))
    .filter((id) => typeof id === 'string' && id.trim() !== '')
  if (manualArtistIds.length > 0) {
    const existingIds = new Set(popularArtists.map((a) => a.id))
    const missingIds = manualArtistIds.filter((id) => !existingIds.has(id))
    if (missingIds.length > 0) {
      const batchSize = 10
      const allMissing = []
      for (let i = 0; i < missingIds.length; i += batchSize) {
        const batch = missingIds.slice(i, i + batchSize)
        const q = query(
          collection(db, 'artists'),
          where('__name__', 'in', batch)
        )
        const snapshot = await getDocs(q)
        snapshot.docs.forEach((d) => {
          const data = d.data()
          allMissing.push({
            id: d.id,
            ...data,
            photo: data.photoURL || data.wikiPhotoURL || data.photo || null,
            tabCount: data.songCount || data.tabCount || 0
          })
        })
      }
      popularArtists = [...popularArtists, ...allMissing]
    }
  }

  const photoMap = {}
  const artistNameById = {}
  popularArtists.forEach((artist) => {
    photoMap[artist.id] = artist.photoURL || artist.wikiPhotoURL || artist.photo || null
    if (artist.name) photoMap[artist.name] = photoMap[artist.id]
    if (artist.id && artist.name) artistNameById[artist.id] = artist.name
  })

  // Slim custom playlist songs now that we have photoMap (artist photo fallback on cards)
  for (const sectionId of Object.keys(customPlaylistSongs)) {
    customPlaylistSongs[sectionId] = customPlaylistSongs[sectionId].map((t) =>
      slimTabForHome(t, photoMap, artistNameById)
    )
  }

  const displayCount = settings.displayCount || 20
  const sortBy = settings.hotArtistSortBy || 'tier'
  const DEFAULT_TIER = 5
  const ORDER_LAST = 999999
  const sortArtists = (artists) =>
    [...artists].sort((a, b) => {
      if (sortBy === 'tabCount') {
        return (b.songCount || b.tabCount || 0) - (a.songCount || a.tabCount || 0)
      }
      // 預設：displayOrder → Tier 1→2→3→4→5，同 Tier 譜數多→少
      const oa = a.displayOrder ?? ORDER_LAST
      const ob = b.displayOrder ?? ORDER_LAST
      if (oa !== ob) return oa - ob
      const ta = a.tier ?? DEFAULT_TIER
      const tb = b.tier ?? DEFAULT_TIER
      if (ta !== tb) return ta - tb
      return (b.songCount || b.tabCount || 0) - (a.songCount || a.tabCount || 0) || (a.name || '').localeCompare(b.name || '')
    })

  const sortedArtists = sortArtists(popularArtists)
  let manualIds = []
  if (Array.isArray(settings.manualSelection)) {
    manualIds = settings.manualSelection
  } else if (typeof settings.manualSelection === 'object' && settings.manualSelection) {
    manualIds = [
      ...(settings.manualSelection?.male || []),
      ...(settings.manualSelection?.female || []),
      ...(settings.manualSelection?.group || [])
    ]
  }
  const hasManualSelection = Array.isArray(settings.manualSelection)
    ? manualIds.length > 0
    : !!(settings.useManualSelection?.male || settings.useManualSelection?.female || settings.useManualSelection?.group)

  const getHotArtists = () => {
    if (hasManualSelection && manualIds.length > 0) {
      const manualArtists = manualIds
        .map((id) => popularArtists.find((a) => a.id === id))
        .filter(Boolean)
      if (settings.hotArtistUseManual) {
        return manualArtists.slice(0, displayCount)
      }
      const manualIdsSet = new Set(manualIds)
      const autoFill = sortedArtists
        .filter((a) => !manualIdsSet.has(a.id))
        .slice(0, displayCount - manualArtists.length)
      return [...manualArtists, ...autoFill].slice(0, displayCount)
    }
    return sortedArtists.slice(0, displayCount)
  }

  const artistPageSort = (artists) =>
    [...artists].sort((a, b) => {
      const oa = a.displayOrder ?? ORDER_LAST
      const ob = b.displayOrder ?? ORDER_LAST
      if (oa !== ob) return oa - ob
      const ta = a.tier ?? DEFAULT_TIER
      const tb = b.tier ?? DEFAULT_TIER
      if (ta !== tb) return ta - tb
      return (b.songCount || b.tabCount || 0) - (a.songCount || a.tabCount || 0) || (a.name || '').localeCompare(b.name || '')
    })

  const hotArtistsData = {
    all: getHotArtists().map(slimArtistForHome),
    male: artistPageSort(popularArtists.filter((a) => (a.artistType || a.gender) === 'male')).slice(0, 5).map(slimArtistForHome),
    female: artistPageSort(popularArtists.filter((a) => (a.artistType || a.gender) === 'female')).slice(0, 5).map(slimArtistForHome),
    group: artistPageSort(popularArtists.filter((a) => (a.artistType || a.gender) === 'group')).slice(0, 5).map(slimArtistForHome)
  }

  let processedCategories = DEFAULT_CATEGORIES.map((cat) => ({ ...cat }))
  if (categoryImages) {
    const artistMap = new Map(popularArtists.map((a) => [a.id, a]))
    processedCategories = DEFAULT_CATEGORIES.map((cat) => {
      const catData = categoryImages[cat.id]
      let imageUrl = null
      if (catData?.artistId && artistMap.has(catData.artistId)) {
        const artist = artistMap.get(catData.artistId)
        imageUrl = artist.photoURL || artist.wikiPhotoURL || artist.photo || catData.image || null
      } else if (catData?.image) {
        imageUrl = catData.image
      }
      if (imageUrl?.includes('wikipedia.org')) imageUrl = getCroppedWikiImage(imageUrl)
      return { ...cat, image: imageUrl }
    })
  }

  return serialize({
    homeSettings: {
      ...settings,
      sectionOrder: slimSectionOrder(settings.sectionOrder) ?? settings.sectionOrder,
      customPlaylistSections: slimCustomPlaylistSections(settings.customPlaylistSections) ?? settings.customPlaylistSections
    },
    hotTabs: hotTabsData.map((t) => slimTabForHome(t, photoMap, artistNameById)),
    latestSongs: (recentTabsData || []).map((t) => slimTabForHome(t, photoMap, artistNameById)),
    autoPlaylists: autoPlaylistsData.length > 0 ? autoPlaylistsData.map(slimPlaylistForHome) : [],
    manualPlaylists: manualPlaylistsData.length > 0 ? manualPlaylistsData.map(slimPlaylistForHome) : [],
    hotArtists: hotArtistsData,
    categories: processedCategories,
    customPlaylistSongs
  })
}

function isPermissionError(e) {
  const msg = e?.message || String(e)
  return /permission|Permission/i.test(msg) || msg.includes('PERMISSION_DENIED')
}

function isOfflineOrUnavailable(e) {
  const msg = e?.message || String(e)
  return /offline|UNAVAILABLE|connection|socket disconnected/i.test(msg) || e?.code === 14
}

/**
 * Get homepage data: 1 Firestore read when cache is fresh (< 6h).
 * On cache miss or stale, builds payload, writes cache, returns. Optionally serves
 * stale and revalidates in background when cache exists but is expired.
 * Uses client SDK only (Admin quota separate). Retries on transient connection errors (Vercel cold start).
 */
export async function getHomeData() {
  const cacheRef = doc(db, 'cache', 'homePage')
  let snap = null
  const clientGet = async () => {
    try {
      return await getDoc(cacheRef)
    } catch (e) {
      if (isPermissionError(e)) {
        console.warn('[homeData] Cache read not allowed (deploy firestore.rules with cache block?). Building payload.')
        return null
      }
      throw e
    }
  }
  try {
    snap = await clientGet()
  } catch (e) {
    if (isOfflineOrUnavailable(e)) {
      await new Promise((r) => setTimeout(r, 800))
      try {
        snap = await clientGet()
      } catch (e2) {
        await new Promise((r) => setTimeout(r, 1200))
        try {
          snap = await clientGet()
        } catch (e3) {
          console.error('[homeData] client cache read failed after 2 retries', e3?.message)
          throw e3
        }
      }
    } else {
      throw e
    }
  }

  const now = Date.now()
  if (snap?.exists()) {
    const d = snap.data()
    const updatedAt = d?.updatedAt
    const data = d?.data
    if (data && updatedAt && typeof updatedAt.toMillis === 'function') {
      const ageMs = now - updatedAt.toMillis()
      const ageMin = Math.round(ageMs / 60000)
      if (ageMs <= CACHE_TTL_MS) {
        console.log('[homeData] cache hit (age %d min, 1 read)', ageMin)
        return data
      }
      console.log('[homeData] cache stale (age %d min), serving stale + attempting locked revalidate', ageMin)
      setImmediate(async () => {
        const lock = await tryAcquireLock('homePage', 120000)
        if (!lock.acquired) return
        try {
          const payload = await buildHomeDataPayload()
          await setHomeCache(payload)
        } catch (err) {
          console.error('[homeData] background revalidate failed', err)
        } finally {
          await releaseLock('homePage', lock.lockId)
        }
      })
      return data
    }
    console.log('[homeData] cache doc exists but invalid (missing data or updatedAt)')
  } else {
    console.log('[homeData] cache miss (no doc or read failed), building payload...')
  }

  const lock = await tryAcquireLock('homePage', 120000)
  if (!lock.acquired) {
    console.log('[homeData] cache miss but lock held by another instance, returning empty')
    return {}
  }

  try {
    const payload = await buildHomeDataPayload()
    const payloadSize = typeof payload === 'object' ? JSON.stringify(payload).length : 0
    if (payloadSize <= 900 * 1024) {
      setHomeCache(payload).catch((err) => console.error('[homeData] setHomeCache failed', err?.message))
    } else {
      console.warn('[homeData] Payload too large for cache (~', Math.round(payloadSize / 1024), 'KB). Consider reducing hotTabs/latestSongs/customPlaylistSongs size.')
    }
    return payload
  } finally {
    await releaseLock('homePage', lock.lockId)
  }
}
