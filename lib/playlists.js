import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy,
  where,
  serverTimestamp,
  writeBatch
} from '@/lib/firestore-tracked'
import { db } from './firebase'
import { getTabArtistId } from '@/lib/tabs'

const PLAYLISTS_COLLECTION = 'playlists'
const TABS_COLLECTION = 'tabs'
const ARTISTS_COLLECTION = 'artists'

// 簡單內存緩存（5分鐘過期）
const cache = new Map()
const CACHE_DURATION = 5 * 60 * 1000

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

// ============ 自動歌單類型定義 ============
export const AUTO_PLAYLIST_TYPES = {
  monthly: {
    id: 'monthly',
    title: '本月熱門',
    description: '過去 30 天最多人瀏覽的結他譜',
    days: 30,
    limit: 20
  },
  weekly: {
    id: 'weekly',
    title: '本週新歌',
    description: '最近 7 天上架的結他譜',
    days: 7,
    limit: 20
  },
  trending: {
    id: 'trending',
    title: '大家都在彈',
    description: '過去 24 小時熱門趨勢',
    days: 1,
    limit: 20
  },
  alltime: {
    id: 'alltime',
    title: '經典排行榜',
    description: '歷史累積最多瀏覽',
    days: 0, // 所有時間
    limit: 30
  }
}

// ============ 基本 CRUD 操作 ============

// 獲取所有歌單
export async function getAllPlaylists() {
  const q = query(
    collection(db, PLAYLISTS_COLLECTION),
    orderBy('displayOrder', 'asc')
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }))
}

// 一次取得所有活躍歌單，按 source 分組（單次 Firestore 查詢）
export async function getAllActivePlaylists() {
  const cacheKey = 'allActivePlaylists'
  const cached = getCached(cacheKey)
  if (cached) return cached

  try {
    const q = query(collection(db, PLAYLISTS_COLLECTION))
    const snapshot = await getDocs(q)
    const all = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.isActive !== false)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))

    const result = {
      auto: all.filter(p => p.source === 'auto'),
      manual: all.filter(p => p.source === 'manual')
    }
    setCached(cacheKey, result)
    return result
  } catch (e) {
    console.error('getAllActivePlaylists error:', e)
    return { auto: [], manual: [] }
  }
}

// 獲取自動歌單（簡化查詢，避免複合索引）
export async function getAutoPlaylists() {
  const cacheKey = 'autoPlaylists'
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    const q = query(
      collection(db, PLAYLISTS_COLLECTION),
      where('source', '==', 'auto')
    )
    const snapshot = await getDocs(q)
    const result = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.isActive !== false)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    setCached(cacheKey, result)
    return result
  } catch (e) {
    console.error('getAutoPlaylists error:', e)
    return []
  }
}

// 獲取精選手動歌單（簡化查詢，避免複合索引）
export async function getManualPlaylists(limitCount = null) {
  const cacheKey = `manualPlaylists_${limitCount || 'all'}`
  const cached = getCached(cacheKey)
  if (cached) return cached
  
  try {
    const q = query(
      collection(db, PLAYLISTS_COLLECTION),
      where('source', '==', 'manual')
    )
    const snapshot = await getDocs(q)
    let result = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.isActive !== false)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    
    // 只有指定 limitCount 時才限制數量
    if (limitCount && limitCount > 0) {
      result = result.slice(0, limitCount)
    }
    
    setCached(cacheKey, result)
    return result
  } catch (e) {
    console.error('getManualPlaylists error:', e)
    return []
  }
}

// 獲取單個歌單
export async function getPlaylist(id) {
  const docRef = doc(db, PLAYLISTS_COLLECTION, id)
  const docSnap = await getDoc(docRef)
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() }
  }
  return null
}

// 創建歌單
export async function createPlaylist(playlistData, userId) {
  const newPlaylist = {
    ...playlistData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: userId
  }
  
  const docRef = await addDoc(collection(db, PLAYLISTS_COLLECTION), newPlaylist)
  return { id: docRef.id, ...newPlaylist }
}

// 更新歌單
export async function updatePlaylist(id, playlistData) {
  const playlistRef = doc(db, PLAYLISTS_COLLECTION, id)
  const updatedData = {
    ...playlistData,
    updatedAt: new Date().toISOString()
  }
  
  await updateDoc(playlistRef, updatedData)
  return { id, ...updatedData }
}

// 刪除歌單
export async function deletePlaylist(id) {
  await deleteDoc(doc(db, PLAYLISTS_COLLECTION, id))
  return true
}

// ============ 自動歌單生成邏輯 ============

/** Parse createdAt (Firestore Timestamp, ISO string, or Date) into epoch ms. */
function createdAtToMs(val) {
  if (!val) return 0
  if (typeof val.toMillis === 'function') return val.toMillis()
  if (typeof val.seconds === 'number') return val.seconds * 1000
  const d = new Date(val)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

/**
 * 生成單一類型自動歌單。
 * @param {string} autoType - 'monthly' | 'weekly' | 'trending' | 'alltime'
 * @param {Array<{ id: string, [key: string]: any }>} [songsPreloaded] - 若由 refreshAllAutoPlaylists 傳入，則不再讀取整個 tabs 集合，避免重複讀取
 * @returns {Promise<{ songIds: string[], coverImage: string, songCount: number, lastUpdated: string }>}
 */
export async function generateAutoPlaylist(autoType, songsPreloaded = null) {
  const config = AUTO_PLAYLIST_TYPES[autoType]
  if (!config) {
    throw new Error(`未知的自動歌單類型: ${autoType}`)
  }

  let songs
  if (songsPreloaded != null && Array.isArray(songsPreloaded)) {
    songs = songsPreloaded
  } else {
    const allTabs = await getDocs(collection(db, TABS_COLLECTION))
    songs = allTabs.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  }
  
  let filteredSongs = []
  const now = new Date()
  
  switch (autoType) {
    case 'monthly':
      // 過去 30 天最高 viewCount
      filteredSongs = songs
        .filter(s => {
          const ms = createdAtToMs(s.createdAt)
          if (!ms) return false
          return (now - ms) / (1000 * 60 * 60 * 24) <= 30
        })
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, config.limit)
      break

    case 'weekly':
      // 最近 7 天上架
      filteredSongs = songs
        .filter(s => {
          const ms = createdAtToMs(s.createdAt)
          if (!ms) return false
          return (now - ms) / (1000 * 60 * 60 * 24) <= 7
        })
        .sort((a, b) => createdAtToMs(b.createdAt) - createdAtToMs(a.createdAt))
        .slice(0, config.limit)
      break

    case 'trending':
      // 過去 24 小時 viewCount 激增（用最近創建的熱門歌曲代替）
      filteredSongs = songs
        .filter(s => {
          const ms = createdAtToMs(s.createdAt)
          if (!ms) return false
          return (now - ms) / (1000 * 60 * 60 * 24) <= 7 // 用一週內的歌曲
        })
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, config.limit)
      break
      
    case 'alltime':
      // 歷史累積最多瀏覽
      filteredSongs = songs
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, config.limit)
      break
      
    default:
      filteredSongs = songs.slice(0, config.limit)
  }
  
  const songIds = filteredSongs.map(s => s.id)
  
  // 獲取封面圖（第一首歌的縮圖）
  const firstSong = filteredSongs[0]
  let coverImage = null
  if (firstSong) {
    if (firstSong.youtubeVideoId) {
      coverImage = `https://img.youtube.com/vi/${firstSong.youtubeVideoId}/hqdefault.jpg`
    } else if (firstSong.youtubeUrl) {
      const match = firstSong.youtubeUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)
      if (match) {
        coverImage = `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`
      }
    }
  }
  
  return {
    songIds,
    coverImage: coverImage || '/default-cover.jpg',
    songCount: songIds.length,
    lastUpdated: new Date().toISOString()
  }
}

// 刷新所有自動歌單（只讀取一次全部 tabs，再依類型篩選，避免 4 次全表讀取）
export async function refreshAllAutoPlaylists() {
  const results = []
  // 只讀取一次整個 tabs 集合，供四種自動歌單類型共用
  const allTabsSnap = await getDocs(collection(db, TABS_COLLECTION))
  const allSongs = allTabsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))

  for (const [type, config] of Object.entries(AUTO_PLAYLIST_TYPES)) {
    try {
      // 檢查是否已存在
      const q = query(
        collection(db, PLAYLISTS_COLLECTION),
        where('source', '==', 'auto'),
        where('autoType', '==', type)
      )
      const snapshot = await getDocs(q)
      
      const generated = await generateAutoPlaylist(type, allSongs)
      
      if (snapshot.empty) {
        // 創建新歌單
        await addDoc(collection(db, PLAYLISTS_COLLECTION), {
          title: config.title,
          description: config.description,
          source: 'auto',
          autoType: type,
          songIds: generated.songIds,
          coverImage: generated.coverImage,
          isActive: true,
          displayOrder: ['monthly', 'weekly', 'trending', 'alltime'].indexOf(type),
          lastUpdated: generated.lastUpdated,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        results.push({ type, action: 'created', count: generated.songCount })
      } else {
        // 更新現有歌單
        const docRef = snapshot.docs[0].ref
        const existingData = snapshot.docs[0].data()
        
        // 只有當沒有自定義封面時才更新 coverImage
        // 檢查是否有 customCover 標記或用戶上傳的封面（非自動生成的 YouTube 縮圖）
        const hasCustomCover = existingData.customCover === true || 
          (existingData.coverImage && !existingData.coverImage.includes('youtube.com'))
        
        const updateData = {
          songIds: generated.songIds,
          lastUpdated: generated.lastUpdated,
          updatedAt: new Date().toISOString()
        }
        
        // 只有沒有自定義封面時才更新 coverImage
        if (!hasCustomCover) {
          updateData.coverImage = generated.coverImage
        }
        
        await updateDoc(docRef, updateData)
        results.push({ type, action: 'updated', count: generated.songCount, preservedCover: hasCustomCover })
      }
    } catch (error) {
      console.error(`Error generating ${type} playlist:`, error)
      results.push({ type, action: 'error', error: error.message })
    }
  }
  
  return results
}

// 根據歌曲 ID 獲取完整歌曲資料（包含歌手相片 fallback）
export async function getPlaylistSongs(songIds) {
  if (!songIds || songIds.length === 0) return []
  
  const songs = []
  
  // Firestore 限制：in 查詢最多 10 個值，需要分批
  const batchSize = 10
  for (let i = 0; i < songIds.length; i += batchSize) {
    const batch = songIds.slice(i, i + batchSize)
    const q = query(
      collection(db, TABS_COLLECTION),
      where('__name__', 'in', batch)
    )
    const snapshot = await getDocs(q)
    snapshot.docs.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() }
      if (!data.artistId && getTabArtistId(data)) data.artistId = getTabArtistId(data)
      songs.push(data)
    })
  }
  
  // 收集所有可能的歌手標識（支援 tabs 只有 artistIds/artists 嘅情況）
  const artistIds = [...new Set(songs.map(s => s.artistId || getTabArtistId(s)).filter(Boolean))]
  const artistNames = [...new Set(songs.map(s => s.artistName || s.artist).filter(Boolean))]
  
  const artistPhotos = {}
  const artistNameToPhoto = {}
  /** @type {Map<string, { id: string, name?: string, slug?: string, photo?: string }>} */
  const uniqueArtistsMap = new Map()

  // 1. 先用 artistId 查詢
  if (artistIds.length > 0) {
    for (let i = 0; i < artistIds.length; i += 10) {
      const batch = artistIds.slice(i, i + 10)
      try {
        const artistsQuery = query(
          collection(db, ARTISTS_COLLECTION),
          where('__name__', 'in', batch)
        )
        const artistsSnapshot = await getDocs(artistsQuery)
        artistsSnapshot.docs.forEach(d => {
          const data = d.data()
          const photo = data.photoURL || data.wikiPhotoURL || null
          artistPhotos[d.id] = photo
          if (data.name) {
            artistNameToPhoto[data.name.toLowerCase()] = photo
          }
          if (!uniqueArtistsMap.has(d.id)) {
            uniqueArtistsMap.set(d.id, {
              id: d.id,
              name: data.name,
              slug: data.slug,
              photo: photo || undefined
            })
          }
        })
      } catch (e) {
        console.log('Error fetching artist photos by ID:', e)
      }
    }
  }

  // 2. 用歌手名稱查詢（處理冇 artistId 或 artistId 不匹配的情況）
  const unmatchedNames = artistNames.filter(name => !artistNameToPhoto[name.toLowerCase()])

  if (unmatchedNames.length > 0) {
    for (let i = 0; i < unmatchedNames.length; i += 10) {
      const batch = unmatchedNames.slice(i, i + 10)
      try {
        const nameQuery = query(
          collection(db, ARTISTS_COLLECTION),
          where('name', 'in', batch)
        )
        const nameSnapshot = await getDocs(nameQuery)
        nameSnapshot.docs.forEach(d => {
          const data = d.data()
          const photo = data.photoURL || data.wikiPhotoURL || null
          if (data.name) {
            artistNameToPhoto[data.name.toLowerCase()] = photo
          }
          if (!uniqueArtistsMap.has(d.id)) {
            uniqueArtistsMap.set(d.id, {
              id: d.id,
              name: data.name,
              slug: data.slug,
              photo: photo || undefined
            })
          }
        })
      } catch (e) {
        console.log('Error fetching artist photos by name:', e)
      }
    }
  }

  // 為每首歌添加歌手相片 fallback
  songs.forEach(song => {
    if (song.artistId && artistPhotos[song.artistId]) {
      song.artistPhoto = artistPhotos[song.artistId]
    } else if (song.artistName && artistNameToPhoto[song.artistName.toLowerCase()]) {
      song.artistPhoto = artistNameToPhoto[song.artistName.toLowerCase()]
    } else if (song.artist && artistNameToPhoto[song.artist.toLowerCase()]) {
      song.artistPhoto = artistNameToPhoto[song.artist.toLowerCase()]
    }
  })

  const songMap = new Map(songs.map(s => [s.id, s]))
  const orderedSongs = songIds.map(id => songMap.get(id)).filter(Boolean)
  const uniqueArtists = Array.from(uniqueArtistsMap.values())
  return { songs: orderedSongs, uniqueArtists }
}

// 更新歌單排序
export async function updatePlaylistsOrder(playlists) {
  const batch = writeBatch(db)
  
  playlists.forEach((playlist, index) => {
    const playlistRef = doc(db, PLAYLISTS_COLLECTION, playlist.id)
    batch.update(playlistRef, {
      displayOrder: index,
      updatedAt: new Date().toISOString()
    })
  })
  
  await batch.commit()
  return true
}
