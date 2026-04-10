import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { getPlaylist, getPlaylistSongs, getAllActivePlaylists, AUTO_PLAYLIST_TYPES, updatePlaylist as updateSitePlaylist, enrichTabsWithArtists } from '@/lib/playlists'
import { isChaksaPlaylist, resolveChaksaPlaylistItems } from '@/lib/chaksaPlaylist'
import { groupChaksaSongsByYear } from '@/lib/chartYearRange'
import { getPlaylistPageCache, setPlaylistPageCache } from '@/lib/playlistPageCache'
import { toSlimSongs } from '@/lib/playlistSlim'
import { getSongThumbnail } from '@/lib/getSongThumbnail'
import SongActionSheet from '@/components/SongActionSheet'
import Layout from '@/components/Layout'
import Link from '@/components/Link'
import { recordPlaylistView } from '@/lib/recentViews'
import { useArtistMap } from '@/lib/useArtistMap'
import { useAuth } from '@/contexts/AuthContext'
import { Share, Heart, Music, User, Plus, Copy, ArrowLeft, Bookmark, ListMusic, ArrowUpDown, Pencil, X, Search, Crown, ChevronUp, ChevronDown } from 'lucide-react'
import ChaksaPasteTabLinkModal from '@/components/chaksa/ChaksaPasteTabLinkModal'
import { getTabsByIds, getArtistSlug, getRecentTabsFromFirestore } from '@/lib/tabs'
import { siteConfig, getAbsoluteOgImage, getOgImage } from '@/lib/seo'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { auth } from '@/lib/firebase'
import { toggleLikeSong, checkIsLiked, getUserPlaylists, addSongToPlaylist, createPlaylist, savePlaylistToLibrary, removeSavedPlaylist, checkIsPlaylistSaved, removeSongFromPlaylist } from '@/lib/playlistApi'

/** 叱咤「至尊歌曲」預設顯示數量（與個人主頁「所有出譜」一致） */
const CHAKSA_SUPREME_INITIAL = 10

function serializePlaylistData(obj) {
  try {
    return JSON.parse(JSON.stringify(obj, (_, v) => {
      if (v && typeof v.toDate === 'function') return v.toDate().toISOString()
      if (v && typeof v.toMillis === 'function') return new Date(v.toMillis()).toISOString()
      return v
    }))
  } catch (e) {
    console.error('[playlist] serializePlaylistData:', e?.message)
    return Array.isArray(obj) ? [] : null
  }
}

function ChaksaSongRow({
  song,
  getArtistName,
  getSongThumbnail,
  handleMoreClick,
  playlistSource,
  showViewCount,
  onChaksaOutTab,
  playlistId,
  supremeYearBadge = false,
  showChartRank = false
}) {
  const ext = song.playlistItemKind === 'external'
  const yearLabel =
    song.chartYear != null && !Number.isNaN(Number(song.chartYear)) ? String(Number(song.chartYear)) : null

  const thumb = (
    <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
      {getSongThumbnail(song) ? (
        <img
          src={getSongThumbnail(song)}
          alt={song.title}
          className={`w-full h-full object-cover ${ext ? 'opacity-75' : ''}`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="w-full h-full flex items-center justify-center text-neutral-500">
          <Music className="w-6 h-6" strokeWidth={1.5} />
        </span>
      )}
    </div>
  )

  const yearBadgeEl =
    yearLabel != null ? (
      <span
        className="text-[0.7rem] leading-none px-1.5 py-1 rounded-[4px] flex-shrink-0 tabular-nums font-semibold bg-[#3a3420] text-[#FFD700] border border-[#5c4f2a]/30 self-center"
        aria-label={`榜單年份 ${yearLabel}`}
      >
        {yearLabel}
      </span>
    ) : null

  /** 至尊歌曲：年份 tag 喺 cover 左邊 */
  const thumbWithSupremeYear =
    supremeYearBadge && yearBadgeEl ? (
      <div className="flex shrink-0 items-center gap-2">
        {yearBadgeEl}
        {thumb}
      </div>
    ) : (
      thumb
    )

  const textBlock = (
    <div className="flex-1 text-left min-w-0">
      <h3 className={`text-[1rem] font-medium truncate md:transition ${ext ? 'text-neutral-500' : 'text-[#e6e6e6] md:group-hover:text-[#FFD700]'}`}>
        {song.title}
      </h3>
      <p className={`text-[0.85rem] truncate ${ext ? 'text-neutral-600' : 'text-[#999]'}`}>{getArtistName(song)}</p>
    </div>
  )

  const rankNum =
    song.chartPosition != null && !Number.isNaN(Number(song.chartPosition)) ? Number(song.chartPosition) : null
  const rankEl =
    showChartRank && rankNum != null ? (
      <span
        className={`shrink-0 min-w-[2rem] sm:min-w-[2.25rem] inline-flex items-center justify-center leading-none pt-0.5 px-1.5 sm:px-2 ${
          rankNum === 1 ? 'text-[#FFD700]' : 'text-[#737373] text-sm font-semibold tabular-nums'
        }`}
        aria-label={`第 ${rankNum} 位`}
      >
        {rankNum === 1 ? (
          <Crown className="w-[1.125rem] h-[1.125rem] sm:w-5 sm:h-5" strokeWidth={2} aria-hidden />
        ) : (
          rankNum
        )}
      </span>
    ) : null

  return (
    <div
      className={`group flex w-full min-w-0 items-center gap-1 sm:gap-2 py-2 pl-0 pr-0 rounded-[7px] ${ext ? 'opacity-[0.88]' : 'md:hover:bg-white/5 md:transition'}`}
    >
      {rankEl}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {ext ? (
          <>
            {thumbWithSupremeYear}
            {textBlock}
          </>
        ) : (
          <Link
            href={`/tabs/${song.slug ?? song.id}`}
            prefetch={false}
            className="flex min-w-0 flex-1 items-center gap-3 py-0 pl-0 pr-0 rounded-[7px] text-left bg-transparent border-0 cursor-pointer text-inherit no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD700]/40"
          >
            {thumbWithSupremeYear}
            {textBlock}
            {playlistSource === 'auto' && showViewCount && (
              <span className="text-xs text-neutral-600 hidden sm:block shrink-0">
                {(song.viewCount || 0).toLocaleString('zh-HK')} 瀏覽
              </span>
            )}
          </Link>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end">
        {ext && playlistId && song.chaksaEntryId && (
          <button
            type="button"
            onClick={() => onChaksaOutTab?.(song)}
            className="px-2.5 sm:px-3 py-1.5 bg-[#FFD700] text-black rounded-full font-medium text-xs sm:text-sm touch-manipulation"
          >
            出譜
          </button>
        )}
        {!ext && (
          <button
            type="button"
            onClick={(e) => handleMoreClick(e, song)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 text-[#999] hover:text-white transition -my-1"
            aria-label="更多"
          >
            <svg className="w-4 h-4" viewBox="0 0 14.96 2.54" fill="currentColor" aria-hidden>
              <circle cx="1.27" cy="1.27" r="1.27" />
              <circle cx="7.48" cy="1.27" r="1.27" />
              <circle cx="13.69" cy="1.27" r="1.27" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

export default function PlaylistDetail({
  initialPlaylist,
  initialSongs = [],
  initialUniqueArtists = [],
  initialOtherPlaylists = []
}) {
  const router = useRouter()
  const { id } = router.query
  const { user, isAdmin, signInWithGoogle } = useAuth()
  const { getArtistName } = useArtistMap()
  const [playlist, setPlaylist] = useState(initialPlaylist || null)
  const [songs, setSongs] = useState(initialSongs)
  const [uniqueArtists, setUniqueArtists] = useState(initialUniqueArtists)
  const [otherPlaylists, setOtherPlaylists] = useState(initialOtherPlaylists)
  const [isLoading, setIsLoading] = useState(!initialPlaylist)
  const [sortMode, setSortMode] = useState('default') // 'default' | 'artist' | 'year' | 'shuffle'
  const [shuffleOrder, setShuffleOrder] = useState([]) // shuffle 時用嘅固定次序（indices），避免每次 re-render 重排

  // 操作選單狀態
  const [selectedSong, setSelectedSong] = useState(null)
  const [selectedSongLiked, setSelectedSongLiked] = useState(false) // menu 內「加入喜愛」顯示用
  const [showActionModal, setShowActionModal] = useState(false)
  const [userPlaylists, setUserPlaylists] = useState([])
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false)
  const [addToPlaylistSelectedIds, setAddToPlaylistSelectedIds] = useState([]) // 加入歌單 modal 多選
  const [addToPlaylistInitialIds, setAddToPlaylistInitialIds] = useState([]) // 打開 modal 時首歌已在嘅歌單，用於確認時移除
  const [showCreatePlaylistInput, setShowCreatePlaylistInput] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [recommendedArtists, setRecommendedArtists] = useState([]) // 推薦歌單內 2 位歌手（由 uniqueArtists 隨機揀）
  const [recommendedItems, setRecommendedItems] = useState([]) // 歌手 + 歌單合併後隨機排序，用於渲染
  const [isSavedToLibrary, setIsSavedToLibrary] = useState(false) // 是否已加入「已收藏歌單」
  const [isSavingPlaylist, setIsSavingPlaylist] = useState(false)
  const [showPlaylistMoreModal, setShowPlaylistMoreModal] = useState(false)
  const [playlistModalDragY, setPlaylistModalDragY] = useState(0)
  const playlistModalTouchStartY = useRef(0)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [chaksaPasteSong, setChaksaPasteSong] = useState(null)
  /** null = 顯示至尊歌曲 + 完整名單；數字 = 只顯示該年叱咤十大 */
  const [chaksaFocusYear, setChaksaFocusYear] = useState(null)
  /** 至尊歌曲：預設只顯示頭 CHAKSA_SUPREME_INITIAL 首，與個人主頁「所有出譜」同款展開 */
  const [chaksaSupremeExpanded, setChaksaSupremeExpanded] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)

  // Admin inline editing state
  const [showAdminAddSong, setShowAdminAddSong] = useState(false)
  const [adminAddSongQuery, setAdminAddSongQuery] = useState('')
  const [adminSongCatalog, setAdminSongCatalog] = useState([])
  const adminArtistMap = useRef(new Map())
  const [adminAddSongLoading, setAdminAddSongLoading] = useState(false)
  const [adminAddingSongId, setAdminAddingSongId] = useState(null)
  const [adminRemovingSongId, setAdminRemovingSongId] = useState(null)
  const [adminReordering, setAdminReordering] = useState(false)
  const [adminAddSongDragY, setAdminAddSongDragY] = useState(0)
  const adminAddSongTouchStartY = useRef(0)

  const [showAdminEditSongs, setShowAdminEditSongs] = useState(false)
  const [adminEditDragY, setAdminEditDragY] = useState(0)
  const adminEditTouchStartY = useRef(0)
  const adminEditListScrollRef = useRef(null)
  const [adminTouchDragIndex, setAdminTouchDragIndex] = useState(null)
  const [adminTouchDragY, setAdminTouchDragY] = useState(0)
  const adminTouchDragStartYRef = useRef(0)
  const adminTouchDragYRef = useRef(0)
  const adminTouchDragRowHeightRef = useRef(56)
  const adminTouchDragRowTopRef = useRef(0)
  const ADMIN_EDIT_ROW_HEIGHT = 56

  const [showAdminSettings, setShowAdminSettings] = useState(false)
  const [adminSettingsDragY, setAdminSettingsDragY] = useState(0)
  const adminSettingsTouchStartY = useRef(0)
  const [adminEditTitle, setAdminEditTitle] = useState('')
  const [adminEditDescription, setAdminEditDescription] = useState('')
  const [adminEditCuratedBy, setAdminEditCuratedBy] = useState('')
  const [adminEditAddNewSongsToTop, setAdminEditAddNewSongsToTop] = useState(false)
  const [adminSavingSettings, setAdminSavingSettings] = useState(false)
  const [adminEditCoverImage, setAdminEditCoverImage] = useState('')
  const [adminCoverUploading, setAdminCoverUploading] = useState(false)
  const adminCoverInputRef = useRef(null)

  const [isTouchDevice, setIsTouchDevice] = useState(false)

  useEffect(() => {
    setIsTouchDevice(typeof window !== 'undefined' && 'ontouchstart' in window)
  }, [])

  useEffect(() => setHasMounted(true), [])

  // 從 uniqueArtists 隨機揀 2 位做推薦歌手（唔使再 getDoc(artists)）
  const pickTwoRecommendedArtists = (artists) => {
    if (!artists?.length) return []
    const pool = [...artists]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, 2).map((a) => ({
      id: a.id,
      name: a.name,
      photo: a.photo,
      slug: a.slug
    }))
  }

  useEffect(() => {
    if (!id) return
    if (initialPlaylist && initialPlaylist.id === id) {
      setPlaylist(initialPlaylist)
      setSongs(initialSongs || [])
      setUniqueArtists(initialUniqueArtists || [])
      setOtherPlaylists(initialOtherPlaylists || [])
      setRecommendedArtists(pickTwoRecommendedArtists(initialUniqueArtists || []))
      setIsLoading(false)
      recordPlaylistView(user?.uid || null, initialPlaylist)
      return
    }
    loadPlaylistData()
  }, [id, initialPlaylist, initialSongs, initialUniqueArtists, initialOtherPlaylists])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (showPlaylistMoreModal || showAdminAddSong || showAdminEditSongs || showAdminSettings) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [showPlaylistMoreModal, showAdminAddSong, showAdminEditSongs, showAdminSettings])

  useEffect(() => {
    if (!showAdminAddSong) return
    setAdminAddSongLoading(true)
    fetch('/api/search-data')
      .then((r) => r.json())
      .then((data) => {
        const map = new Map()
        ;(data.artists || []).forEach(a => { if (a.id && a.name) map.set(a.id, a.name) })
        adminArtistMap.current = map
        setAdminSongCatalog(data.tabs || [])
      })
      .catch(() => setAdminSongCatalog([]))
      .finally(() => setAdminAddSongLoading(false))
  }, [showAdminAddSong])

  // 歌手 + 歌單合併後隨機排序，整體次序隨機
  useEffect(() => {
    const artists = recommendedArtists.map((ar) => ({ type: 'artist', data: ar }))
    const playlists = otherPlaylists.map((pl) => ({ type: 'playlist', data: pl }))
    const combined = [...artists, ...playlists]
    if (combined.length === 0) {
      setRecommendedItems([])
      return
    }
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[combined[i], combined[j]] = [combined[j], combined[i]]
    }
    setRecommendedItems(combined)
  }, [recommendedArtists, otherPlaylists])

  // 隨機排序：只喺撳 shuffle 或歌曲載入時 shuffle 一次，唔會因 scroll/re-render 重排
  const computeShuffleOrder = (length) => {
    const indices = Array.from({ length }, (_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[indices[i], indices[j]] = [indices[j], indices[i]]
    }
    return indices
  }
  // 切換歌單時清空 shuffle 次序，等下次用新歌單再算
  useEffect(() => {
    setShuffleOrder([])
  }, [id])

  useEffect(() => {
    setChaksaFocusYear(null)
    setChaksaSupremeExpanded(false)
  }, [id])

  // 載入「是否已加入已收藏歌單」
  useEffect(() => {
    if (!id || !user?.uid) {
      setIsSavedToLibrary(false)
      return
    }
    let cancelled = false
    checkIsPlaylistSaved(user.uid, id).then((saved) => {
      if (!cancelled) setIsSavedToLibrary(saved)
    })
    return () => { cancelled = true }
  }, [id, user?.uid])
  useEffect(() => {
    if (sortMode !== 'shuffle' || !songs.length) return
    if (shuffleOrder.length !== songs.length) {
      setShuffleOrder(computeShuffleOrder(songs.length))
    }
  }, [sortMode, songs.length])

  const loadPlaylistData = async (opts = {}) => {
    const { quiet = false } = opts
    try {
      if (!quiet) setIsLoading(true)
      const res = await fetch(`/api/playlist-page?id=${encodeURIComponent(id)}`)
      if (!res.ok) {
        if (res.status === 404) {
          if (!quiet) router.push('/')
          return
        }
        throw new Error(res.statusText)
      }
      const data = await res.json()
      setPlaylist(data.playlist)
      setSongs(data.songs || [])
      setUniqueArtists(data.uniqueArtists || [])
      setRecommendedArtists(pickTwoRecommendedArtists(data.uniqueArtists || []))
      const { auto = [], manual = [] } = data.otherPlaylists || {}
      const autoFiltered = (auto || []).filter((p) => p.id !== id).slice(0, 2)
      const manualFiltered = (manual || []).filter((p) => p.id !== id).slice(0, 6)
      const combined = [...autoFiltered, ...manualFiltered]
      for (let i = combined.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[combined[i], combined[j]] = [combined[j], combined[i]]
      }
      setOtherPlaylists(combined)
      if (!quiet) recordPlaylistView(user?.uid || null, data.playlist)
    } catch (error) {
      console.error('Error loading playlist:', error)
      if (!quiet) router.push('/')
    } finally {
      if (!quiet) setIsLoading(false)
    }
  }

  const isChaksa = isChaksaPlaylist(playlist)

  // 獲取排序後的歌曲列表（預設=撳排序 icon，歌手/年份/隨機）
  const getSortedSongs = () => {
    if (isChaksa) return [...songs]
    const sorted = [...songs]
    switch (sortMode) {
      case 'default':
        return sorted
      case 'artist':
        return sorted.sort((a, b) => {
          const artistA = (getArtistName(a) || '').toLowerCase()
          const artistB = (getArtistName(b) || '').toLowerCase()
          return artistA.localeCompare(artistB, 'zh-HK')
        })
      
      case 'year':
        return sorted.sort((a, b) => {
          // 先按年份排序，冇年份排最後
          const yearA = a.songYear || a.uploadYear || 0
          const yearB = b.songYear || b.uploadYear || 0
          if (yearA && yearB) return yearB - yearA // 年份由新到舊
          if (yearA) return -1
          if (yearB) return 1
          return 0
        })
      
      case 'shuffle':
        // 用已固定嘅 shuffleOrder，唔會因 re-render 再亂序
        if (shuffleOrder.length === sorted.length) {
          return shuffleOrder.map((i) => sorted[i])
        }
        return sorted
      
      default:
        return sorted
    }
  }

  const sortedSongs = getSortedSongs()

  const chaksaSupremeList = useMemo(() => {
    if (!isChaksa || !songs.length) return []
    return [...songs]
      .filter((s) => s.chartPosition === 1)
      .sort((a, b) => (b.chartYear || 0) - (a.chartYear || 0))
  }, [isChaksa, songs])

  const chaksaFullGrouped = useMemo(() => {
    if (!isChaksa || !songs.length) return []
    return groupChaksaSongsByYear([...songs])
  }, [isChaksa, songs])

  const chaksaChartYearPills = useMemo(() => {
    if (!isChaksa || !songs.length) return []
    const ys = new Set()
    for (const s of songs) {
      const y = s.chartYear
      if (y != null && !Number.isNaN(Number(y))) ys.add(Number(y))
    }
    return Array.from(ys).sort((a, b) => b - a)
  }, [isChaksa, songs])

  const chaksaYearTop10List = useMemo(() => {
    if (chaksaFocusYear == null || !isChaksa || !songs.length) return []
    return [...songs]
      .filter((s) => Number(s.chartYear) === chaksaFocusYear)
      .sort((a, b) => (a.chartPosition || 99) - (b.chartPosition || 99))
  }, [isChaksa, songs, chaksaFocusYear])

  // 格式化時間（僅 client 用，避免 server/client 時間唔同導致 hydration mismatch）
  const formatTimeAgo = (timestamp) => {
    if (!timestamp || !hasMounted) return ''
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000)
    if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
    if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
    return date.toLocaleDateString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
  }

  const getClientY = (e) => e.touches?.[0]?.clientY ?? e.clientY
  const handlePlaylistModalDragStart = (e) => {
    if (e.pointerType === 'mouse') return
    playlistModalTouchStartY.current = getClientY(e)
    try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (_) {}
  }
  const handlePlaylistModalDragMove = (e) => {
    if (e.pointerType === 'mouse') return
    const y = getClientY(e)
    const delta = y - playlistModalTouchStartY.current
    if (delta > 0) setPlaylistModalDragY(Math.min(delta, 200))
  }
  const handlePlaylistModalDragEnd = () => {
    if (playlistModalDragY >= DRAG_CLOSE_THRESHOLD) {
      setShowPlaylistMoreModal(false)
      setPlaylistModalDragY(0)
    } else {
      setPlaylistModalDragY(0)
    }
  }

  const handlePlaylistCopyShare = () => {
    setShowPlaylistMoreModal(false)
    setPlaylistModalDragY(0)
    if (navigator.share) {
      navigator.share({
        title: playlist.title,
        text: playlist.description,
        url: window.location.href
      })
    } else {
      navigator.clipboard.writeText(window.location.href)
      alert('連結已複製到剪貼簿')
    }
  }

  const handlePlaylistAddToLibrary = async () => {
    if (!user) {
      setShowPlaylistMoreModal(false)
      setShowLoginPrompt(true)
      return
    }
    if (isSavingPlaylist) return
    setIsSavingPlaylist(true)
    try {
      if (isSavedToLibrary) {
        await removeSavedPlaylist(user.uid, id)
        setIsSavedToLibrary(false)
        setPlaylist(prev => prev ? { ...prev, savedCount: Math.max(0, (prev.savedCount || 0) - 1) } : prev)
      } else {
        await savePlaylistToLibrary(user.uid, id)
        setIsSavedToLibrary(true)
        setPlaylist(prev => prev ? { ...prev, savedCount: (prev.savedCount || 0) + 1 } : prev)
      }
    } catch (err) {
      console.error('加入收藏失敗:', err)
      alert('加入收藏失敗，請重試')
    } finally {
      setIsSavingPlaylist(false)
    }
  }

  // ==================== Admin inline editing handlers ====================
  const DRAG_CLOSE_THRESHOLD = 80
  const getAdminClientY = (e) => e.touches?.[0]?.clientY ?? e.clientY

  const makeSheetDrag = (setDragY, touchStartYRef, onClose) => ({
    onStart: (e) => {
      if (e.pointerType === 'mouse') return
      touchStartYRef.current = getAdminClientY(e)
      try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId) } catch (_) {}
    },
    onMove: (e) => {
      if (e.pointerType === 'mouse') return
      const y = getAdminClientY(e)
      const delta = y - touchStartYRef.current
      if (delta > 0) setDragY(Math.min(delta, 200))
    },
    onEnd: (dragY) => {
      if (dragY >= DRAG_CLOSE_THRESHOLD) { onClose(); setDragY(0) }
      else { setDragY(0) }
    }
  })

  const adminAddSongDrag = makeSheetDrag(setAdminAddSongDragY, adminAddSongTouchStartY, () => { setShowAdminAddSong(false); setAdminAddSongQuery('') })
  const adminEditDrag = makeSheetDrag(setAdminEditDragY, adminEditTouchStartY, () => setShowAdminEditSongs(false))
  const adminSettingsDrag = makeSheetDrag(setAdminSettingsDragY, adminSettingsTouchStartY, () => setShowAdminSettings(false))

  const currentSongIds = new Set(playlist?.songIds || songs.map((s) => s.id))
  const adminAddSongFiltered = adminSongCatalog
    .filter((tab) => {
      if (currentSongIds.has(tab.id)) return false
      const q = adminAddSongQuery.trim().toLowerCase()
      if (!q) return true
      const title = (tab.title || '').toLowerCase()
      const artistName = (tab.artist || adminArtistMap.current.get(tab.artistId) || '').toLowerCase()
      const composer = (tab.composer || '').toLowerCase()
      const lyricist = (tab.lyricist || '').toLowerCase()
      const arranger = (tab.arranger || '').toLowerCase()
      const penName = (tab.uploaderPenName || '').toLowerCase()
      return title.includes(q) || artistName.includes(q) || composer.includes(q) || lyricist.includes(q) || arranger.includes(q) || penName.includes(q)
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, adminAddSongQuery.trim() ? Infinity : 20)

  const bustPlaylistPageCache = async () => {
    try {
      const token = await auth.currentUser?.getIdToken?.()
      if (token) {
        // 用 URL id（slug）作 cache key，與 getStaticProps 寫入時一致
        // 同時 bust doc ID 以防萬一兩者不同
        const urlId = id
        const docId = playlist?.id
        const ids = [...new Set([urlId, docId].filter(Boolean))]
        await Promise.all(ids.map((pid) =>
          fetch('/api/admin/bust-playlist-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ playlistId: pid })
          })
        ))
      }
    } catch (_) {}
  }

  const handleAdminAddSong = async (songId) => {
    setAdminAddingSongId(songId)
    try {
      const existing = playlist?.songIds || []
      const newSongIds = playlist?.addNewSongsToTop
        ? [songId, ...existing]
        : [...existing, songId]
      await updateSitePlaylist(playlist.id, { songIds: newSongIds })
      const [added] = await getTabsByIds([songId])
      if (added) setSongs((prev) => playlist?.addNewSongsToTop ? [added, ...prev] : [...prev, added])
      setPlaylist((p) => p ? { ...p, songIds: newSongIds } : p)
      bustPlaylistPageCache().catch(() => {})
    } catch (e) {
      console.error(e)
      alert('加入失敗，請重試')
    } finally {
      setAdminAddingSongId(null)
    }
  }

  const orderedSongsForAdminEdit = (playlist?.songIds || []).map((sid) => songs.find((s) => s.id === sid)).filter(Boolean)

  const handleAdminRemoveSong = async (songId) => {
    setAdminRemovingSongId(songId)
    try {
      const newSongIds = (playlist?.songIds || []).filter((sid) => sid !== songId)
      await updateSitePlaylist(playlist.id, { songIds: newSongIds })
      setSongs((prev) => prev.filter((s) => s.id !== songId))
      setPlaylist((p) => p ? { ...p, songIds: newSongIds } : p)
      bustPlaylistPageCache().catch(() => {})
    } catch (e) {
      console.error(e)
      alert('移除失敗，請重試')
    } finally {
      setAdminRemovingSongId(null)
    }
  }

  const handleAdminReorder = async (fromIndex, toIndex) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= orderedSongsForAdminEdit.length) return
    const reordered = [...orderedSongsForAdminEdit]
    const [removed] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, removed)
    const newSongIds = reordered.map((s) => s.id)
    setAdminReordering(true)
    try {
      await updateSitePlaylist(playlist.id, { songIds: newSongIds })
      setPlaylist((p) => p ? { ...p, songIds: newSongIds } : p)
      setSongs(reordered)
      bustPlaylistPageCache().catch(() => {})
    } catch (e) {
      console.error(e)
      alert('更新次序失敗，請重試')
    } finally {
      setAdminReordering(false)
    }
  }

  const handleAdminEditHandleTouchStart = (e, index) => {
    if (adminReordering) return
    const clientY = e.touches[0].clientY
    adminTouchDragStartYRef.current = clientY
    const row = e.currentTarget.closest('li')
    if (row) {
      const rect = row.getBoundingClientRect()
      adminTouchDragRowHeightRef.current = rect.height
      adminTouchDragRowTopRef.current = rect.top
    }
    setAdminTouchDragIndex(index)
    setAdminTouchDragY(clientY)
  }

  useEffect(() => {
    if (adminTouchDragIndex === null) return
    const onMove = (e) => {
      const clientY = e.touches?.[0]?.clientY
      if (clientY == null) return
      if (Math.abs(clientY - adminTouchDragStartYRef.current) > 8) e.preventDefault()
      adminTouchDragYRef.current = clientY
      setAdminTouchDragY(clientY)
    }
    const onEnd = () => {
      const el = adminEditListScrollRef.current
      const list = orderedSongsForAdminEdit
      const currentY = adminTouchDragYRef.current
      if (el && list.length > 0) {
        const rect = el.getBoundingClientRect()
        const rowH = adminTouchDragRowHeightRef.current || ADMIN_EDIT_ROW_HEIGHT
        const relativeY = currentY - rect.top + el.scrollTop
        const dropIndex = Math.max(0, Math.min(list.length - 1, Math.floor(relativeY / rowH)))
        if (dropIndex !== adminTouchDragIndex) handleAdminReorder(adminTouchDragIndex, dropIndex)
      }
      setAdminTouchDragIndex(null)
    }
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { once: true })
    document.addEventListener('touchcancel', onEnd, { once: true })
    return () => { document.removeEventListener('touchmove', onMove) }
  }, [adminTouchDragIndex])

  const handleAdminCoverUpload = async (file) => {
    if (!file) return
    setAdminCoverUploading(true)
    try {
      const url = await uploadToCloudinary(file, adminEditTitle || 'playlist-cover', 'playlists')
      setAdminEditCoverImage(url)
    } catch (e) {
      alert('封面上傳失敗：' + (e.message || e))
    } finally {
      setAdminCoverUploading(false)
    }
  }

  const handleAdminSaveSettings = async () => {
    const titleTrimmed = adminEditTitle.trim()
    if (!titleTrimmed) { alert('歌單名稱不可為空'); return }
    setAdminSavingSettings(true)
    try {
      const updates = {
        title: titleTrimmed,
        description: (adminEditDescription || '').trim(),
        curatedBy: (adminEditCuratedBy || '').trim(),
        coverImage: adminEditCoverImage || ''
      }
      await updateSitePlaylist(playlist.id, updates)
      setPlaylist((p) => p ? { ...p, ...updates } : p)
      setShowAdminSettings(false)
      setAdminSettingsDragY(0)
      bustPlaylistPageCache().catch(() => {})
    } catch (e) {
      console.error(e)
      alert('更新失敗，請重試')
    } finally {
      setAdminSavingSettings(false)
    }
  }

  const handleLoginPromptGoogleSignIn = async () => {
    setIsSigningIn(true)
    try {
      await signInWithGoogle()
      setShowLoginPrompt(false)
    } catch (error) {
      console.error('Google sign in error:', error)
      if (error.code === 'auth/unauthorized-domain') {
        alert(`Firebase 未授權此域名，請聯繫管理員添加：${typeof window !== 'undefined' ? window.location.hostname : ''}`)
      } else {
        alert('Google 登入失敗：' + (error.message || error))
      }
    } finally {
      setIsSigningIn(false)
    }
  }

  // 更多操作
  const handleMoreClick = async (e, song) => {
    e.stopPropagation()
    setSelectedSong(song)
    if (song.playlistItemKind === 'external') {
      setSelectedSongLiked(false)
      setUserPlaylists([])
      setShowActionModal(true)
      return
    }
    if (user) {
      const [liked, playlists] = await Promise.all([
        checkIsLiked(user.uid, song.id),
        getUserPlaylists(user.uid)
      ])
      setSelectedSongLiked(liked)
      setUserPlaylists(playlists)
    } else {
      setSelectedSongLiked(false)
    }
    setShowActionModal(true)
  }

  const handleChaksaOutTab = (song) => {
    if (!song?.chaksaEntryId) return
    if (!user) {
      setShowLoginPrompt(true)
      return
    }
    setChaksaPasteSong(song)
  }

  const handleCopyChaksaTrackLabel = async () => {
    if (!selectedSong) return
    const line = `${selectedSong.title || ''} - ${getArtistName(selectedSong)}`
    try {
      await navigator.clipboard.writeText(line)
      alert('已複製歌名同歌手')
    } catch {
      alert('複製失敗')
    }
  }

  const handleCopyShareLink = async () => {
    if (!selectedSong) return
    const url = `${window.location.origin}/tabs/${selectedSong.id}`
    try {
      await navigator.clipboard.writeText(url)
      alert('已複製連結')
    } catch (err) {
      alert('複製失敗')
    }
  }

  const handleSelectLyricsShare = () => {
    if (!selectedSong?.id) return
    setShowActionModal(false)
    router.push(`/tools/tab-share?tabId=${selectedSong.id}`)
  }

  const handleShare = async () => {
    const url = `${window.location.origin}/tabs/${selectedSong.id}`
    if (navigator.share) {
      await navigator.share({
        title: `${selectedSong.title} - ${getArtistName(selectedSong)}`,
        url
      })
    } else {
      await navigator.clipboard.writeText(url)
      alert('已複製連結到剪貼簿')
    }
    setShowActionModal(false)
  }

  const handleAddToLiked = async () => {
    if (!selectedSong || !user) {
      alert('請先登入後即可收藏喜愛的結他譜')
      return
    }
    try {
      const result = await toggleLikeSong(user.uid, selectedSong.id)
      setSelectedSongLiked(result.isLiked)
      // 唔關 menu，留喺原位
    } catch (error) {
      alert('操作失敗：' + error.message)
    }
  }

  const handleAddToPlaylistClick = () => {
    if (!user) {
      alert('請先登入後即可收藏喜愛的結他譜')
      return
    }
    setShowActionModal(false)
    // 預設剔選已包含此歌嘅歌單
    const alreadyIn = (userPlaylists || [])
      .filter((pl) => pl.songIds && pl.songIds.includes(selectedSong?.id))
      .map((pl) => pl.id)
    setAddToPlaylistSelectedIds(alreadyIn)
    setAddToPlaylistInitialIds(alreadyIn)
    setShowAddToPlaylist(true)
  }

  const toggleAddToPlaylistSelection = (playlistId) => {
    setAddToPlaylistSelectedIds((prev) =>
      prev.includes(playlistId) ? prev.filter((id) => id !== playlistId) : [...prev, playlistId]
    )
  }

  const confirmAddToPlaylist = async () => {
    if (!selectedSong) return
    const idsToAdd = addToPlaylistSelectedIds.filter((id) => !addToPlaylistInitialIds.includes(id))
    const idsToRemove = addToPlaylistInitialIds.filter((id) => !addToPlaylistSelectedIds.includes(id))
    if (idsToAdd.length === 0 && idsToRemove.length === 0) {
      setShowAddToPlaylist(false)
      setAddToPlaylistSelectedIds([])
      setAddToPlaylistInitialIds([])
      return
    }
    try {
      for (const playlistId of idsToAdd) {
        await addSongToPlaylist(playlistId, selectedSong.id)
      }
      for (const playlistId of idsToRemove) {
        await removeSongFromPlaylist(playlistId, selectedSong.id)
      }
      setShowAddToPlaylist(false)
      setAddToPlaylistSelectedIds([])
      setAddToPlaylistInitialIds([])
      if (idsToAdd.length && idsToRemove.length) {
        alert(`已加入 ${idsToAdd.length} 個歌單，已從 ${idsToRemove.length} 個歌單移除`)
      } else if (idsToRemove.length) {
        alert(idsToRemove.length > 1 ? `已從 ${idsToRemove.length} 個歌單移除` : '已從歌單移除')
      } else {
        alert(idsToAdd.length > 1 ? `已加入 ${idsToAdd.length} 個歌單` : '已加入歌單')
      }
    } catch (error) {
      alert('操作失敗：' + error.message)
    }
  }

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !user || !selectedSong) return
    try {
      const result = await createPlaylist(user.uid, newPlaylistName.trim())
      await addSongToPlaylist(result.playlistId, selectedSong.id)
      setShowCreatePlaylistInput(false)
      setShowAddToPlaylist(false)
      setNewPlaylistName('')
      alert(`已創建歌單「${newPlaylistName.trim()}」並加入歌曲`)
    } catch (error) {
      alert('創建歌單失敗：' + error.message)
    }
  }

  if (router.isFallback || isLoading) {
    return (
      <Layout fullWidth hideHeader>
        <Head>
          <title>{initialPlaylist?.title ? `${initialPlaylist.title} | Polygon - 香港廣東歌結他譜網` : 'Polygon - 香港廣東歌結他譜網'}</title>
          <meta name="theme-color" content="transparent" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta property="og:title" content={initialPlaylist?.title ? `${initialPlaylist.title} | Polygon` : 'Polygon'} />
          <meta property="og:image" content={getOgImage(initialPlaylist?.coverImage)} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:image" content={getOgImage(initialPlaylist?.coverImage)} />
        </Head>
        <div className="relative z-10 min-h-screen pb-24 pt-[env(safe-area-inset-top)] bg-black">
          <div className="h-64 bg-neutral-800/50 animate-pulse" />
          <div className="px-6 py-4 space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-16 bg-neutral-800/50 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </Layout>
    )
  }

  if (!playlist) return null

  const seoTitle = `${playlist.title} | Polygon - 香港廣東歌結他譜網`
  const seoDescription = playlist.description || `${playlist.title} — Polygon 精選歌單`
  const seoUrl = `${siteConfig.url}/playlist/${id}`
  const ogImage = getOgImage(playlist.coverImage)

  return (
    <Layout fullWidth hideHeader>
      <Head>
        <title>{seoTitle}</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={seoUrl} />
        <meta name="theme-color" content="transparent" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta key="og-url" property="og:url" content={seoUrl} />
        <meta key="og-type" property="og:type" content="website" />
        <meta key="og-site-name" property="og:site_name" content={siteConfig.name} />
        <meta key="og-title" property="og:title" content={seoTitle} />
        <meta key="og-description" property="og:description" content={seoDescription} />
        <meta key="og-image" property="og:image" content={ogImage} />
        <meta key="og-image-alt" property="og:image:alt" content={playlist.title} />
        <meta key="twitter-card" name="twitter:card" content="summary_large_image" />
        <meta key="twitter-site" name="twitter:site" content={siteConfig.twitter} />
        <meta key="twitter-title" name="twitter:title" content={seoTitle} />
        <meta key="twitter-description" name="twitter:description" content={seoDescription} />
        <meta key="twitter-image" name="twitter:image" content={ogImage} />
        <meta key="twitter-image-alt" name="twitter:image:alt" content={playlist.title} />
      </Head>
      <div className="relative z-10 min-h-screen pb-24 bg-black" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* 返回：絕對定位；封面：置中 */}
        <div className="relative pt-4 pb-4" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <Link
            href="/"
            className="absolute top-4 z-10 inline-flex items-center text-white hover:text-white/90 transition p-1.5 -ml-1.5"
            style={{ left: '1rem' }}
            aria-label="返回"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          {/* 更多 - 頁面右上方，同歌曲行一樣水平三點，撳開底部 Menu */}
          {songs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPlaylistMoreModal(true)}
              className="absolute top-4 z-10 inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 text-white hover:text-white/90 transition"
              style={{ right: '1rem' }}
              aria-label="更多"
            >
              <svg className="w-5 h-5" viewBox="0 0 14.96 2.54" fill="currentColor" aria-hidden>
                <circle cx="1.27" cy="1.27" r="1.27" />
                <circle cx="7.48" cy="1.27" r="1.27" />
                <circle cx="13.69" cy="1.27" r="1.27" />
              </svg>
            </button>
          )}
          <div className="flex justify-center">
          <div className="w-[60vw] max-w-[300px] max-h-[300px] aspect-square overflow-hidden rounded bg-[#282828] shadow-xl">
            {playlist.coverImage ? (
              <img 
                src={playlist.coverImage} 
                alt={playlist.title}
                className="w-full h-full object-cover"
                loading="eager"
                decoding="async"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#282828]" />
            )}
          </div>
          </div>
        </div>

        {/* 標題行 + Action Bar 共用左右 1rem，右緣對齊 */}
        <div style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div className="flex items-start justify-between gap-3 pb-1">
            {/* 左欄：標題 + 描述 */}
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-white truncate" style={{ fontSize: '1.5rem' }}>
                {playlist.title}
              </h1>
              {playlist.description && (
                <p className="text-[0.85rem] text-[#999] leading-snug line-clamp-4 whitespace-pre-line mt-1">{playlist.description}</p>
              )}
            </div>
            {/* 右欄：統計 + 收藏 */}
            <div className="flex flex-col items-end gap-0.5 text-[12px] md:text-[14px] text-neutral-500 whitespace-nowrap flex-shrink-0 pt-3">
              <span className="flex items-center gap-1.5">
                共 {songs.length} 首
                {playlist.source === 'manual' && playlist.curatedBy && (
                  <><span className="text-neutral-600">•</span> By {playlist.curatedBy}</>
                )}
                {playlist.source === 'auto' && playlist.lastUpdated && (
                  <><span className="text-neutral-600">•</span> 更新於 {hasMounted ? formatTimeAgo(playlist.lastUpdated) : '—'}</>
                )}
              </span>
              {playlist.savedCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Bookmark className="w-3.5 h-3.5 text-[#FFD700] fill-[#FFD700] flex-shrink-0" />
                  {playlist.savedCount} 收藏
                </span>
              )}
              {isChaksa && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!user) {
                      setShowLoginPrompt(true)
                      return
                    }
                    if (isSavingPlaylist) return
                    setIsSavingPlaylist(true)
                    try {
                      if (isSavedToLibrary) {
                        await removeSavedPlaylist(user.uid, id)
                        setIsSavedToLibrary(false)
                        setPlaylist((prev) => (prev ? { ...prev, savedCount: Math.max(0, (prev.savedCount || 0) - 1) } : prev))
                      } else {
                        await savePlaylistToLibrary(user.uid, id)
                        setIsSavedToLibrary(true)
                        setPlaylist((prev) => (prev ? { ...prev, savedCount: (prev.savedCount || 0) + 1 } : prev))
                      }
                    } catch (err) {
                      console.error('加入收藏失敗:', err)
                      alert('加入收藏失敗，請重試')
                    } finally {
                      setIsSavingPlaylist(false)
                    }
                  }}
                  disabled={isSavingPlaylist}
                  title={isSavedToLibrary ? '已收藏（撳一下取消）' : '加入我的收藏'}
                  className={`mt-1 flex items-center gap-2 rounded-full outline-none self-end ${
                    isSavedToLibrary ? 'text-[#FFD700] py-1 pl-1 pr-0' : 'text-neutral-400 p-1'
                  } ${isSavingPlaylist ? 'opacity-50' : ''}`}
                >
                  {isSavedToLibrary ? (
                    <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10">
                      <circle cx="4.36" cy="4.36" r="3.99" />
                      <line x1="2.22" y1="4.36" x2="6.51" y2="4.36" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10">
                      <circle cx="4.36" cy="4.36" r="3.99" />
                      <line x1="2.22" y1="4.36" x2="6.51" y2="4.36" />
                      <line x1="4.36" y1="2.22" x2="4.36" y2="6.51" />
                    </svg>
                  )}
                  {isSavedToLibrary && <span className="text-sm whitespace-nowrap">已收藏</span>}
                </button>
              )}
            </div>
          </div>

          {/* Admin action bar */}
          {isAdmin && playlist.source === 'manual' && isChaksa && (
            <div className="py-2 flex flex-wrap items-center gap-2">
              <Link href={`/admin/playlists/chaksa/${id}`} className="inline-flex items-center justify-center gap-1 px-4 py-1.5 rounded-full bg-[#FFD700] text-black text-sm font-medium hover:opacity-90 transition">
                <Pencil className="w-4 h-4 shrink-0" />編輯叱咤榜單
              </Link>
              <button type="button" onClick={() => { setAdminEditTitle(playlist.title || ''); setAdminEditDescription(playlist.description || ''); setAdminEditCuratedBy(playlist.curatedBy || user?.displayName || ''); setAdminEditCoverImage(playlist.coverImage || ''); setAdminEditAddNewSongsToTop(!!playlist.addNewSongsToTop); setShowAdminSettings(true) }} className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition">
                <Pencil className="w-4 h-4 shrink-0" />歌單
              </button>
            </div>
          )}
          {isAdmin && playlist.source === 'manual' && !isChaksa && (
            <div className="py-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setShowAdminAddSong(true)} className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition">
                <Plus className="w-4 h-4 shrink-0" />加入
              </button>
              <button type="button" onClick={() => setShowAdminEditSongs(true)} className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition">
                <ListMusic className="w-4 h-4 shrink-0" />編輯
              </button>
              <button type="button" onClick={() => { setAdminEditTitle(playlist.title || ''); setAdminEditDescription(playlist.description || ''); setAdminEditCuratedBy(playlist.curatedBy || user?.displayName || ''); setAdminEditCoverImage(playlist.coverImage || ''); setAdminEditAddNewSongsToTop(!!playlist.addNewSongsToTop); setShowAdminSettings(true) }} className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition">
                <Pencil className="w-4 h-4 shrink-0" />歌單
              </button>
            </div>
          )}

          {playlist && !isChaksa && (
          <div className="mb-1 pt-0 pb-1 flex items-center gap-3">
            {songs.length > 0 && (
            <div className="flex flex-1 min-w-0 overflow-x-auto scrollbar-hide items-center gap-0">
              <button
                type="button"
                onClick={() => setSortMode('default')}
                className={`pl-0 pr-2.5 py-2.5 rounded transition shrink-0 outline-none ${sortMode === 'default' ? 'text-[#FFD700]' : 'text-neutral-400 hover:text-white'}`}
                title="預設次序"
              >
                <svg className="w-7 h-7 block shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 36.42 41.51" preserveAspectRatio="xMidYMid meet">
                  <line x1="24.56" y1="7.91" x2="24.56" y2="33.33" />
                  <polyline points="19.87 29.9 24.56 34.59 29.25 29.9" />
                  <line x1="11.86" y1="33.59" x2="11.86" y2="8.17" />
                  <polyline points="16.55 11.6 11.86 6.91 7.17 11.6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setSortMode('artist')}
                className={`-ml-2 p-2.5 rounded transition shrink-0 outline-none ${sortMode === 'artist' ? 'text-[#FFD700]' : 'text-neutral-400 hover:text-white'}`}
                title="按歌手排序"
              >
                <svg className="w-7 h-7 block shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 36.42 41.51" preserveAspectRatio="xMidYMid meet">
                  <circle cx="18.21" cy="13.13" r="6.22" />
                  <path d="M29.54,34.59c0-6.26-5.07-11.33-11.33-11.33s-11.33,5.07-11.33,11.33h22.66Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setSortMode('year')}
                className={`p-2.5 rounded transition shrink-0 outline-none ${sortMode === 'year' ? 'text-[#FFD700]' : 'text-neutral-400 hover:text-white'}`}
                title="按年份排序"
              >
                <svg className="w-6 h-6 block shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 34.26 32.9" preserveAspectRatio="xMidYMid meet">
                  <line x1="23.31" y1="4.82" x2="10.94" y2="4.82" />
                  <path d="M27.01,4.82h2.84c1.32,0,2.39,1.07,2.39,2.4v21.2c0,1.33-1.07,2.4-2.39,2.4H4.4c-1.32,0-2.39-1.07-2.39-2.4V7.22c0-1.33,1.07-2.4,2.39-2.4h2.84" />
                  <path d="M9.09,2.07h0c1.02,0,1.85.83,1.85,1.85v1.82c0,1.02-.83,1.85-1.85,1.85h0c-1.02,0-1.85-.83-1.85-1.85v-1.82c0-1.02.83-1.85,1.85-1.85Z" />
                  <path d="M25.15,2.07h0c1.02,0,1.85.83,1.85,1.85v1.82c0,1.02-.83,1.85-1.85,1.85h0c-1.02,0-1.85-.83-1.85-1.85v-1.82c0-1.02.83-1.85,1.85-1.85Z" />
                  <line x1="2.55" y1="11.11" x2="31.83" y2="11.11" />
                  <line x1="6.98" y1="16.58" x2="27.27" y2="16.58" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (songs.length) {
                    setShuffleOrder(computeShuffleOrder(songs.length))
                    setSortMode('shuffle')
                  }
                }}
                className={`p-2.5 rounded transition shrink-0 outline-none ${sortMode === 'shuffle' ? 'text-[#FFD700]' : 'text-neutral-400 hover:text-white'}`}
                title="隨機排序"
              >
                <svg className="w-6 h-6 block shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="35 5 34 34" preserveAspectRatio="xMidYMid meet">
                  <polyline points="62.42 28.27 65.96 31.81 62.42 35.35" />
                  <path d="M37.68,10.76h3.03c2.29,0,4.45,1.27,5.8,3.41l8.95,14.22c1.35,2.15,3.51,3.41,5.8,3.41h4.27" />
                  <path d="M37.68,31.81h3.03c2.29,0,4.45-1.27,5.8-3.41l8.95-14.22c1.35-2.15,3.51-3.41,5.8-3.41h4.27" />
                  <polyline points="62.42 14.3 65.96 10.76 62.42 7.22" />
                </svg>
              </button>
            </div>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!user) {
                  setShowLoginPrompt(true)
                  return
                }
                if (isSavingPlaylist) return
                setIsSavingPlaylist(true)
                try {
                  if (isSavedToLibrary) {
                    await removeSavedPlaylist(user.uid, id)
                    setIsSavedToLibrary(false)
                    setPlaylist((prev) => (prev ? { ...prev, savedCount: Math.max(0, (prev.savedCount || 0) - 1) } : prev))
                  } else {
                    await savePlaylistToLibrary(user.uid, id)
                    setIsSavedToLibrary(true)
                    setPlaylist((prev) => (prev ? { ...prev, savedCount: (prev.savedCount || 0) + 1 } : prev))
                  }
                } catch (err) {
                  console.error('加入收藏失敗:', err)
                  alert('加入收藏失敗，請重試')
                } finally {
                  setIsSavingPlaylist(false)
                }
              }}
              disabled={isSavingPlaylist}
              title={isSavedToLibrary ? '已收藏（撳一下取消）' : '加入我的收藏'}
              className={`flex-shrink-0 flex items-center gap-2 rounded-full outline-none pr-0 ${
                isSavedToLibrary ? 'text-[#FFD700] py-2 pl-2' : 'text-neutral-400 p-1 pl-1'
              } ${isSavingPlaylist ? 'opacity-50' : ''}`}
            >
              {isSavedToLibrary ? (
                <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10">
                  <circle cx="4.36" cy="4.36" r="3.99" />
                  <line x1="2.22" y1="4.36" x2="6.51" y2="4.36" />
                </svg>
              ) : (
                <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10">
                  <circle cx="4.36" cy="4.36" r="3.99" />
                  <line x1="2.22" y1="4.36" x2="6.51" y2="4.36" />
                  <line x1="4.36" y1="2.22" x2="4.36" y2="6.51" />
                </svg>
              )}
              {isSavedToLibrary && <span className="text-sm whitespace-nowrap">已收藏</span>}
            </button>
          </div>
          )}
        </div>

        {/* 叱咤：年份藥丸（有邊些年份先顯示） */}
        {isChaksa && chaksaChartYearPills.length > 0 && (
          <div className="mb-3" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <div className="flex overflow-x-auto scrollbar-hide gap-2 py-1 pb-2">
              <button
                type="button"
                onClick={() => setChaksaFocusYear(null)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold transition border ${
                  chaksaFocusYear === null
                    ? 'bg-[#FFD700] text-black border-[#FFD700]'
                    : 'bg-[#282828] text-neutral-300 border-neutral-700 hover:border-neutral-500'
                }`}
              >
                全部
              </button>
              {chaksaChartYearPills.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setChaksaFocusYear(y)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold tabular-nums transition border ${
                    chaksaFocusYear === y
                      ? 'bg-[#FFD700] text-black border-[#FFD700]'
                      : 'bg-[#282828] text-neutral-300 border-neutral-700 hover:border-neutral-500'
                  }`}
                  title={`${y} 年`}
                >
                  {String(y % 100).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 叱咤：至尊歌曲（每年第 1 位）—揀咗單年時隱藏；預設最多 10 首，展開方式同個人主頁「所有出譜」 */}
        {isChaksa && chaksaFocusYear === null && chaksaSupremeList.length > 0 && (
          <section className="mb-5" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-bold text-white text-[1.2rem] md:text-[1.375rem]">至尊歌曲</h2>
              {chaksaSupremeList.length > CHAKSA_SUPREME_INITIAL && (
                <button
                  type="button"
                  onClick={() => setChaksaSupremeExpanded((prev) => !prev)}
                  className="p-1 text-[#B3B3B3] hover:text-[#FFD700] transition flex-shrink-0"
                  title={chaksaSupremeExpanded ? '收埋' : '展開'}
                  aria-expanded={chaksaSupremeExpanded}
                >
                  {chaksaSupremeExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
            <div className="space-y-0">
              {(chaksaSupremeExpanded ? chaksaSupremeList : chaksaSupremeList.slice(0, CHAKSA_SUPREME_INITIAL)).map((song) => (
                <ChaksaSongRow
                  key={`sup-${song.id}-${song.chartYear}-${song.chartPosition}`}
                  song={song}
                  getArtistName={getArtistName}
                  getSongThumbnail={getSongThumbnail}
                  handleMoreClick={handleMoreClick}
                  playlistSource={playlist.source}
                  showViewCount={false}
                  onChaksaOutTab={handleChaksaOutTab}
                  playlistId={typeof id === 'string' ? id : Array.isArray(id) ? id[0] || '' : ''}
                  supremeYearBadge
                />
              ))}
              {chaksaSupremeList.length > CHAKSA_SUPREME_INITIAL && !chaksaSupremeExpanded && (
                <div className="flex justify-center mt-3">
                  <button
                    type="button"
                    onClick={() => setChaksaSupremeExpanded(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-600 text-white/90 text-xs hover:text-[#FFD700] hover:border-[#FFD700]/50 transition"
                  >
                    顯示全部
                    <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 叱咤：揀年份後只顯示該年 10 首 */}
        {isChaksa && chaksaFocusYear != null && (
          <section className="mb-5" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <h2 className="font-bold text-white text-[1.2rem] md:text-[1.375rem] pb-3">
              {chaksaFocusYear} 叱咤十大
            </h2>
            {chaksaYearTop10List.length === 0 ? (
              <p className="text-neutral-500 text-sm py-2">呢年暫時冇榜單資料</p>
            ) : (
              <div>
                {chaksaYearTop10List.map((song) => (
                  <ChaksaSongRow
                    key={`yr-${chaksaFocusYear}-${song.id}-${song.chartPosition}`}
                    song={song}
                    getArtistName={getArtistName}
                    getSongThumbnail={getSongThumbnail}
                    handleMoreClick={handleMoreClick}
                    playlistSource={playlist.source}
                    showViewCount={false}
                    onChaksaOutTab={handleChaksaOutTab}
                    playlistId={typeof id === 'string' ? id : Array.isArray(id) ? id[0] || '' : ''}
                    showChartRank
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Songs List */}
        {songs.length > 0 && (
          <div style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            {isChaksa && chaksaFocusYear === null && (
              <h2 className="font-bold text-white text-[1.1rem] md:text-[1.25rem] pb-2">叱咤十大（完整名單）</h2>
            )}
            {isChaksa && chaksaFocusYear != null ? null : isChaksa
              ? chaksaFullGrouped.map(([yearRange, rangeSongs]) => (
                  <div key={`full-range-${yearRange}`} style={{ marginBottom: '0.5rem' }}>
                    <h3
                      className={`text-sm font-medium sticky top-0 bg-black/95 py-2 z-10 ${
                        yearRange === '未知年份' ? 'text-neutral-500 italic' : 'text-[#FFD700]'
                      }`}
                    >
                      {yearRange}
                      {yearRange === '未知年份' && rangeSongs.length > 0 && (
                        <span className="ml-2 text-xs">({rangeSongs.length} 首)</span>
                      )}
                    </h3>
                    <div>
                      {rangeSongs.map((song) => (
                        <ChaksaSongRow
                          key={`${song.id}-${song.chartYear}-${song.chartPosition}`}
                          song={song}
                          getArtistName={getArtistName}
                          getSongThumbnail={getSongThumbnail}
                          handleMoreClick={handleMoreClick}
                          playlistSource={playlist.source}
                          showViewCount={playlist.source === 'auto'}
                          onChaksaOutTab={handleChaksaOutTab}
                          playlistId={typeof id === 'string' ? id : Array.isArray(id) ? id[0] || '' : ''}
                          showChartRank
                        />
                      ))}
                    </div>
                  </div>
                ))
              : sortedSongs.map((song) => (
                  <div key={`${song.id}-${song.chartYear}-${song.chartPosition}`} className="group flex items-center gap-3 py-2 pl-0 pr-0 rounded-[7px] md:hover:bg-white/5 md:transition">
                    <Link
                      href={`/tabs/${song.slug ?? song.id}`}
                      prefetch={false}
                      className="flex-1 flex items-center gap-3 py-0 pl-0 pr-0 rounded-[7px] min-w-0 text-left bg-transparent border-0 cursor-pointer text-inherit no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD700]/40"
                    >
                      <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
                        {getSongThumbnail(song) ? (
                          <img
                            src={getSongThumbnail(song)}
                            alt={song.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></span>
                        )}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <h3 className="text-[1rem] font-medium text-[#e6e6e6] truncate md:group-hover:text-[#FFD700] md:transition">
                          {song.title}
                        </h3>
                        <p className="text-[0.85rem] text-[#999] truncate">{getArtistName(song)}</p>
                      </div>
                      {playlist.source === 'auto' && (
                        <span className="text-xs text-neutral-600 hidden sm:block">
                          {(song.viewCount || 0).toLocaleString('zh-HK')} 瀏覽
                        </span>
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => handleMoreClick(e, song)}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 text-[#999] hover:text-white transition -my-1"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 14.96 2.54" fill="currentColor" aria-hidden>
                        <circle cx="1.27" cy="1.27" r="1.27" />
                        <circle cx="7.48" cy="1.27" r="1.27" />
                        <circle cx="13.69" cy="1.27" r="1.27" />
                      </svg>
                    </button>
                  </div>
                ))}
          </div>
        )}

        {/* Empty State */}
        {songs.length === 0 && (
          <div className="text-center py-16" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <Music className="w-16 h-16 text-neutral-500 block mb-4 mx-auto" strokeWidth={1.5} />
            <h3 className="text-xl text-white mb-2">暫時冇歌曲</h3>
            <p className="text-neutral-500 mb-6">呢個歌單暫時未有歌曲</p>
            <Link
              href="/"
              className="inline-flex items-center px-6 py-3 bg-[#FFD700] text-black rounded-full font-medium hover:opacity-90 transition"
            >
              返回首頁
            </Link>
          </div>
        )}

        {/* 推薦歌單 - same size as 最近瀏覽 (32vw cards, gap-3) */}
        {recommendedItems.length > 0 && (
          <section className="pt-8 pb-6 mb-[23px] md:mb-[25px]">
            <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">推薦歌單</h2>
            <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
              {recommendedItems.map((item) =>
                item.type === 'artist' ? (
                  <Link
                    key={`artist-${item.data.id}`}
                    href={`/artists/${encodeURIComponent(getArtistSlug(item.data) || item.data.id)}`}
                    className="flex-shrink-0 w-[32vw] md:w-36 flex flex-col group"
                  >
                    <div className="w-[32vw] h-[32vw] md:w-36 md:h-36 rounded-full overflow-hidden bg-[#282828] mb-2 transition-transform duration-300 group-hover:scale-105">
                      {item.data.photo ? (
                        <img
                          src={item.data.photo}
                          alt={item.data.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-4xl">
                          <User className="w-14 h-14 text-[#3E3E3E]" />
                        </div>
                      )}
                    </div>
                    <h3 className="text-[0.95rem] md:text-[1rem] font-medium text-white truncate group-hover:text-[#FFD700] transition mb-[1px] md:mb-0">
                      {item.data.name}
                    </h3>
                  </Link>
                ) : (
                  <Link
                    key={item.data.id}
                    href={`/playlist/${item.data.id}`}
                    className="flex-shrink-0 w-[32vw] md:w-36 flex flex-col group"
                  >
                    <div className="w-[32vw] h-[32vw] md:w-36 md:h-36 rounded-[4px] overflow-hidden bg-[#282828] mb-2 transition-transform duration-300 group-hover:scale-105">
                      {item.data.coverImage ? (
                        <img
                          src={item.data.coverImage}
                          alt={item.data.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-10 h-10" strokeWidth={1.5} /></div>
                      )}
                    </div>
                    <h3 className="text-[0.95rem] md:text-[1rem] font-medium text-white truncate group-hover:text-[#FFD700] transition mb-[1px] md:mb-0">
                      {item.data.title}
                    </h3>
                  </Link>
                )
              )}
            </div>
          </section>
        )}

        </div>
        {/* 更多 - 底部彈出 Menu（同 library/playlist 排序 style） */}
        <SongActionSheet
          open={showActionModal}
          onClose={() => setShowActionModal(false)}
          title={selectedSong?.title ?? ''}
          artist={selectedSong ? getArtistName(selectedSong) : ''}
          thumbnailUrl={selectedSong ? getSongThumbnail(selectedSong) : null}
          liked={selectedSongLiked}
          likeLabel={selectedSongLiked ? '取消喜愛' : '加入喜愛結他譜'}
          onCopyShareLink={handleCopyShareLink}
          onSelectLyricsShare={handleSelectLyricsShare}
          onAddToLiked={handleAddToLiked}
          onAddToPlaylist={handleAddToPlaylistClick}
          artistHref={selectedSong && (selectedSong.artistId || selectedSong.artist_id || selectedSong.artistSlug) ? `/artists/${selectedSong.artistId || selectedSong.artist_id || selectedSong.artistSlug}` : undefined}
          externalItem={selectedSong?.playlistItemKind === 'external'}
          spotifyUrl={selectedSong?.spotifyUrl || null}
          onOpenSpotify={() => {
            if (selectedSong?.spotifyUrl && typeof window !== 'undefined') {
              window.open(selectedSong.spotifyUrl, '_blank', 'noopener,noreferrer')
            }
            setShowActionModal(false)
          }}
          onCopyTrackLabel={handleCopyChaksaTrackLabel}
          paddingBottom="env(safe-area-inset-bottom, 0)"
        />

        <ChaksaPasteTabLinkModal
          open={!!chaksaPasteSong}
          onClose={() => setChaksaPasteSong(null)}
          playlistId={typeof id === 'string' ? id : Array.isArray(id) ? id[0] || '' : ''}
          entryId={chaksaPasteSong?.chaksaEntryId || ''}
          onSuccess={() => loadPlaylistData({ quiet: true })}
        />

        {/* 歌單「更多」- 底部彈出 Menu（同歌曲「更多」一樣 style） */}
        {showPlaylistMoreModal && typeof document !== 'undefined' && createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/60 z-[9999]"
              onClick={() => { setShowPlaylistMoreModal(false); setPlaylistModalDragY(0); }}
              aria-hidden
            />
            <div
              className="fixed bottom-0 left-0 right-0 max-h-[85vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{
                paddingBottom: 'env(safe-area-inset-bottom, 0)',
                transform: `translateY(${playlistModalDragY}px)`,
                transition: playlistModalDragY === 0 ? 'transform 0.2s ease-out' : 'none'
              }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={handlePlaylistModalDragStart}
                onTouchMove={handlePlaylistModalDragMove}
                onTouchEnd={handlePlaylistModalDragEnd}
                onTouchCancel={handlePlaylistModalDragEnd}
                onPointerDown={handlePlaylistModalDragStart}
                onPointerMove={handlePlaylistModalDragMove}
                onPointerUp={handlePlaylistModalDragEnd}
                onPointerCancel={handlePlaylistModalDragEnd}
                role="button"
                tabIndex={0}
                aria-label="向下拖曳關閉"
                onKeyDown={(e) => e.key === 'Enter' && (setShowPlaylistMoreModal(false), setPlaylistModalDragY(0))}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
              </div>
              <div className="pb-4 px-4 text-left">
                {playlist && (
                  <div className="mb-4 pb-4 border-b border-[#3E3E3E] flex items-center gap-3">
                    <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
                      {playlist.coverImage ? (
                        <img
                          src={playlist.coverImage}
                          alt={playlist.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium truncate">{playlist.title}</p>
                      <p className="text-neutral-400 text-sm truncate">
                        {playlist.source === 'manual' && playlist.curatedBy ? `By ${playlist.curatedBy}` : playlist.source === 'auto' ? '自動歌單' : ''}
                      </p>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handlePlaylistCopyShare}
                  className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white"
                >
                  <span className="flex items-center gap-3">
                    <Share className="w-5 h-5 text-[#B3B3B3]" />
                    複製連結分享
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handlePlaylistAddToLibrary}
                  disabled={isSavingPlaylist}
                  className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white disabled:opacity-50"
                >
                  <span className="flex items-center gap-3">
                    {isSavedToLibrary ? (
                      <svg className="w-5 h-5 flex-shrink-0 text-[#FFD700]" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10" aria-hidden>
                        <circle cx="4.36" cy="4.36" r="3.99" />
                        <line x1="2.22" y1="4.36" x2="6.51" y2="4.36" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 flex-shrink-0 text-[#B3B3B3]" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10" aria-hidden>
                        <circle cx="4.36" cy="4.36" r="3.99" />
                        <line x1="2.22" y1="4.36" x2="6.51" y2="4.36" />
                        <line x1="4.36" y1="2.22" x2="4.36" y2="6.51" />
                      </svg>
                    )}
                    {isSavedToLibrary ? '取消收藏' : '加入收藏'}
                  </span>
                </button>
              </div>
            </div>
          </>,
          document.body
        )}

        {/* Admin: Add Song Modal */}
        {showAdminAddSong && typeof document !== 'undefined' && createPortal(
          <>
            <div className="fixed inset-0 bg-black/60 z-[9999]" onClick={() => { setShowAdminAddSong(false); setAdminAddSongQuery('') }} aria-hidden />
            <div
              className="fixed bottom-0 left-0 right-0 h-[65vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)', transform: `translateY(${adminAddSongDragY}px)`, transition: adminAddSongDragY === 0 ? 'transform 0.2s ease-out' : 'none' }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={adminAddSongDrag.onStart} onTouchMove={adminAddSongDrag.onMove} onTouchEnd={() => adminAddSongDrag.onEnd(adminAddSongDragY)} onTouchCancel={() => adminAddSongDrag.onEnd(adminAddSongDragY)}
                onPointerDown={adminAddSongDrag.onStart} onPointerMove={adminAddSongDrag.onMove} onPointerUp={() => adminAddSongDrag.onEnd(adminAddSongDragY)} onPointerCancel={() => adminAddSongDrag.onEnd(adminAddSongDragY)}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
                  <button type="button" onClick={() => { setShowAdminAddSong(false); setAdminAddSongQuery('') }} className="p-2 -ml-2 text-[#B3B3B3] md:hover:text-white rounded-lg" aria-label="關閉">
                    <X className="w-6 h-6" />
                  </button>
                  <h2 className="text-white font-bold text-lg truncate flex-1 text-center pointer-events-none">加入歌曲</h2>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !playlist?.addNewSongsToTop
                      setPlaylist((p) => p ? { ...p, addNewSongsToTop: next } : p)
                      try { await updateSitePlaylist(playlist.id, { addNewSongsToTop: next }) } catch (_) {}
                    }}
                    className={`flex-shrink-0 relative h-7 rounded-full transition-colors duration-200 ${playlist?.addNewSongsToTop ? 'bg-[#FFD700]' : 'bg-neutral-700'}`}
                    style={{ width: 64 }}
                  >
                    <span
                      className="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
                      style={{ left: playlist?.addNewSongsToTop ? 'calc(100% - 24px)' : '4px' }}
                    />
                    <span
                      className={`absolute inset-0 flex items-center text-[10px] font-bold transition-colors duration-200 ${playlist?.addNewSongsToTop ? 'text-black justify-start pl-2' : 'text-[#B3B3B3] justify-end pr-2'}`}
                    >
                      {playlist?.addNewSongsToTop ? '置頂' : '置底'}
                    </span>
                  </button>
                </div>
              </div>
              <div className="px-4 pb-3 flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#666]" />
                  <input type="text" placeholder="搜尋歌曲" value={adminAddSongQuery} onChange={(e) => setAdminAddSongQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-[#282828] text-white placeholder-[#666] rounded-full outline-none" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 pb-4 overscroll-contain bg-[#121212] touch-pan-y px-4" style={{ WebkitOverflowScrolling: 'touch' }}>
                {adminAddSongLoading ? (
                  <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" /></div>
                ) : adminAddSongFiltered.length === 0 ? (
                  <div className="text-center py-12 text-[#B3B3B3] text-sm">{adminAddSongQuery.trim() ? '搵唔到符合嘅歌曲' : '載入中…'}</div>
                ) : (
                  <ul className="space-y-0">
                    {adminAddSongFiltered.map((tab) => {
                      const isAdding = adminAddingSongId === tab.id
                      return (
                        <li key={tab.id}>
                          <button type="button" onClick={() => handleAdminAddSong(tab.id)} disabled={isAdding} className="w-full flex items-center gap-2 py-1.5 rounded-2xl md:hover:bg-white/5 text-left disabled:opacity-70">
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <p className="text-white font-medium truncate leading-tight" style={{ fontSize: 15, lineHeight: '20px' }}>{tab.title}</p>
                              <p className="text-neutral-500 truncate leading-tight" style={{ fontSize: 13, lineHeight: '16px' }}>{tab.artist || adminArtistMap.current.get(tab.artistId) || tab.artistId}</p>
                            </div>
                            <span className="w-10 h-10 flex items-center justify-center flex-shrink-0 text-[#FFD700] pointer-events-none">
                              {isAdding ? (
                                <div className="w-5 h-5 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10">
                                  <circle cx="4.36" cy="4.36" r="3.99" /><line x1="2.22" y1="4.36" x2="6.51" y2="4.36" /><line x1="4.36" y1="2.22" x2="4.36" y2="6.51" />
                                </svg>
                              )}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body
        )}

        {/* Admin: Edit/Reorder Songs Modal */}
        {showAdminEditSongs && typeof document !== 'undefined' && createPortal(
          <>
            <div className="fixed inset-0 bg-black/60 z-[9999]" onClick={() => { setShowAdminEditSongs(false); setAdminEditDragY(0) }} aria-hidden />
            <div
              className="fixed bottom-0 h-[65vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)', left: '50%', width: '100%', maxWidth: '1050px', transform: `translateX(-50%) translateY(${adminEditDragY}px)`, transition: adminEditDragY === 0 ? 'transform 0.2s ease-out' : 'none' }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={adminEditDrag.onStart} onTouchMove={adminEditDrag.onMove} onTouchEnd={() => adminEditDrag.onEnd(adminEditDragY)} onTouchCancel={() => adminEditDrag.onEnd(adminEditDragY)}
                onPointerDown={adminEditDrag.onStart} onPointerMove={adminEditDrag.onMove} onPointerUp={() => adminEditDrag.onEnd(adminEditDragY)} onPointerCancel={() => adminEditDrag.onEnd(adminEditDragY)}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
                  <button type="button" onClick={() => { setShowAdminEditSongs(false); setAdminEditDragY(0) }} className="p-2 -ml-2 text-[#B3B3B3] md:hover:text-white rounded-lg" aria-label="關閉">
                    <X className="w-6 h-6" />
                  </button>
                  <h2 className="text-white font-bold text-lg truncate flex-1 text-center pointer-events-none">編輯歌單</h2>
                  <div className="w-10" />
                </div>
              </div>
              <div ref={adminEditListScrollRef} className="overflow-y-auto flex-1 min-h-0 pb-4 overscroll-contain bg-[#121212] touch-pan-y px-4 select-none" style={{ WebkitOverflowScrolling: 'touch', WebkitTouchCallout: 'none' }}>
                {orderedSongsForAdminEdit.length === 0 ? (
                  <div className="text-center py-12 text-[#B3B3B3] text-sm">歌單入面未有歌曲</div>
                ) : (
                  <ul className="space-y-0">
                    {orderedSongsForAdminEdit.map((song, index) => {
                      const thumb = getSongThumbnail(song)
                      const isDragging = adminTouchDragIndex === index
                      return (
                        <li
                          key={song.id}
                          className={`flex items-center gap-2 py-1.5 px-1.5 rounded-2xl md:hover:bg-white/5 transition-opacity ${isDragging ? 'opacity-0' : ''}`}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                          onDrop={(e) => { e.preventDefault(); if (adminReordering) return; try { const { index: fromIndex } = JSON.parse(e.dataTransfer.getData('application/json') || '{}'); if (typeof fromIndex === 'number') handleAdminReorder(fromIndex, index) } catch (_) {} }}
                        >
                          <button type="button" disabled={!!adminRemovingSongId} onClick={(e) => { e.stopPropagation(); handleAdminRemoveSong(song.id) }} className="w-10 h-10 flex items-center justify-center flex-shrink-0 rounded-lg md:hover:opacity-90 transition -ml-1 disabled:opacity-50 disabled:cursor-wait" aria-label="從歌單移除">
                            {adminRemovingSongId === song.id ? <Loader2 className="w-5 h-5 text-[#9B2D2D] animate-spin" /> : <svg className="w-5 h-5" viewBox="0 0 9.5 9.5" fill="none" stroke="#9B2D2D" strokeLinecap="round" strokeMiterlimit={10} strokeWidth={0.8}><circle cx="4.8" cy="4.8" r="4" /><line x1="2.6" y1="4.8" x2="6.9" y2="4.8" /></svg>}
                          </button>
                          <div className="w-10 h-10 rounded-lg bg-[#282828] flex-shrink-0 overflow-hidden">
                            {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-5 h-5" strokeWidth={1.5} /></div>}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <p className="text-white font-medium truncate leading-tight" style={{ fontSize: 15, lineHeight: '20px' }}>{song.title}</p>
                            <p className="text-neutral-500 truncate leading-tight" style={{ fontSize: 13, lineHeight: '16px' }}>{getArtistName(song)}</p>
                          </div>
                          <span
                            className="cursor-grab active:cursor-grabbing p-1.5 -mr-1.5 text-[#666] md:hover:text-[#B3B3B3] flex-shrink-0 select-none touch-none"
                            style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
                            draggable={!isTouchDevice && !adminReordering}
                            onTouchStart={(e) => handleAdminEditHandleTouchStart(e, index)}
                            onContextMenu={(e) => e.preventDefault()}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/json', JSON.stringify({ index }))
                              e.dataTransfer.effectAllowed = 'move'
                              const row = e.currentTarget.closest('li')
                              if (row && e.dataTransfer.setDragImage) {
                                const clone = row.cloneNode(true)
                                clone.style.cssText = `position:absolute;left:-9999px;width:${row.offsetWidth}px;opacity:0.95;background:#282828;border-radius:8px;pointer-events:none;`
                                document.body.appendChild(clone)
                                e.dataTransfer.setDragImage(clone, row.offsetWidth / 2, row.offsetHeight / 2)
                                const el = e.currentTarget
                                const onDragEnd = () => { if (document.body.contains(clone)) document.body.removeChild(clone); el.removeEventListener('dragend', onDragEnd) }
                                el.addEventListener('dragend', onDragEnd)
                              }
                            }}
                            aria-label="拖曳改次序"
                          >
                            <svg className="w-5 h-5 shrink-0" viewBox="0 0 5.1 3.5" fill="none" stroke="#4d4d4d" strokeLinecap="round" strokeMiterlimit={10} strokeWidth={0.5}>
                              <line x1="0.4" y1="0.5" x2="4.7" y2="0.5" /><line x1="0.4" y1="1.7" x2="4.7" y2="1.7" /><line x1="0.4" y1="3" x2="4.7" y2="3" />
                            </svg>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body
        )}

        {/* Admin: Edit Reorder Touch Ghost */}
        {showAdminEditSongs && adminTouchDragIndex !== null && orderedSongsForAdminEdit[adminTouchDragIndex] && typeof document !== 'undefined' && createPortal(
          (() => {
            const listEl = adminEditListScrollRef.current
            const r = listEl?.getBoundingClientRect()
            const rowH = adminTouchDragRowHeightRef.current || ADMIN_EDIT_ROW_HEIGHT
            const rawTop = adminTouchDragRowTopRef.current + (adminTouchDragY - adminTouchDragStartYRef.current)
            const top = r ? Math.max(r.top, Math.min(r.bottom - rowH, rawTop)) : rawTop
            return (
              <div className="fixed left-0 right-0 px-4 pointer-events-none z-[10001]" style={{ top: `${top}px`, transform: 'translateZ(0)' }}>
                <div className="flex items-center gap-2 py-1.5 rounded-2xl bg-[#282828] shadow-lg border border-[#444] opacity-95">
                  <div className="w-10 flex-shrink-0" />
                  <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] flex-shrink-0 overflow-hidden">
                    {(() => { const dragThumb = getSongThumbnail(orderedSongsForAdminEdit[adminTouchDragIndex]); return dragThumb ? <img src={dragThumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-5 h-5" strokeWidth={1.5} /></div> })()}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className="text-white font-medium truncate leading-tight" style={{ fontSize: 15, lineHeight: '20px' }}>{orderedSongsForAdminEdit[adminTouchDragIndex].title}</p>
                    <p className="text-neutral-500 truncate leading-tight" style={{ fontSize: 13, lineHeight: '16px' }}>{getArtistName(orderedSongsForAdminEdit[adminTouchDragIndex])}</p>
                  </div>
                  <div className="w-10 flex-shrink-0" />
                </div>
              </div>
            )
          })(),
          document.body
        )}

        {/* Admin: Playlist Settings Modal */}
        {showAdminSettings && typeof document !== 'undefined' && createPortal(
          <>
            <div className="fixed inset-0 bg-black/60 z-[9999]" onClick={() => { setShowAdminSettings(false); setAdminSettingsDragY(0) }} aria-hidden />
            <div
              className="fixed bottom-0 left-0 right-0 h-[65vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)', transform: `translateY(${adminSettingsDragY}px)`, transition: adminSettingsDragY === 0 ? 'transform 0.2s ease-out' : 'none' }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={adminSettingsDrag.onStart} onTouchMove={adminSettingsDrag.onMove} onTouchEnd={() => adminSettingsDrag.onEnd(adminSettingsDragY)} onTouchCancel={() => adminSettingsDrag.onEnd(adminSettingsDragY)}
                onPointerDown={adminSettingsDrag.onStart} onPointerMove={adminSettingsDrag.onMove} onPointerUp={() => adminSettingsDrag.onEnd(adminSettingsDragY)} onPointerCancel={() => adminSettingsDrag.onEnd(adminSettingsDragY)}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
                  <button type="button" onClick={() => { setShowAdminSettings(false); setAdminSettingsDragY(0) }} className="p-2 -ml-2 text-[#B3B3B3] md:hover:text-white rounded-lg" aria-label="關閉">
                    <X className="w-6 h-6" />
                  </button>
                  <h2 className="text-white font-bold text-lg truncate flex-1 text-center pointer-events-none">歌單設置</h2>
                  <div className="w-10" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 pb-4 px-4 space-y-4">
                <div className="flex items-center gap-3 pt-2">
                  <input ref={adminCoverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleAdminCoverUpload(e.target.files[0]); e.target.value = '' }} />
                  <div className="relative flex-shrink-0">
                    <button type="button" onClick={() => adminCoverInputRef.current?.click()} disabled={adminCoverUploading} className="w-20 h-20 rounded-lg bg-[#282828] overflow-hidden relative group block">
                      {adminEditCoverImage ? (
                        <img src={adminEditCoverImage} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></div>
                      )}
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <Pencil className="w-4 h-4 text-white" />
                      </div>
                      {adminCoverUploading && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>}
                    </button>
                    {adminEditCoverImage && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setAdminEditCoverImage('') }} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center shadow-lg z-10" aria-label="移除封面">
                        <svg className="w-3 h-3" viewBox="0 0 9.5 9.5" fill="none" stroke="white" strokeLinecap="round" strokeWidth={1.2}><line x1="2.8" y1="4.75" x2="6.7" y2="4.75" /></svg>
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-[#B3B3B3] text-sm mb-1.5">名稱</label>
                    <input type="text" value={adminEditTitle} onChange={(e) => setAdminEditTitle(e.target.value)} placeholder="歌單名稱" className="w-full bg-[#282828] text-white px-3 py-2.5 rounded-xl outline-none placeholder-[#666]" />
                  </div>
                </div>
                <div>
                  <label className="block text-[#B3B3B3] text-sm mb-1.5">描述</label>
                  <textarea value={adminEditDescription} onChange={(e) => setAdminEditDescription(e.target.value)} placeholder="簡介（選填）" rows={3} className="w-full bg-[#282828] text-white px-3 py-2.5 rounded-xl outline-none placeholder-[#666] resize-none" />
                </div>
                <div>
                  <label className="block text-[#B3B3B3] text-sm mb-1.5">策劃人</label>
                  <input type="text" value={adminEditCuratedBy} onChange={(e) => setAdminEditCuratedBy(e.target.value)} placeholder="你的名字" className="w-full bg-[#282828] text-white px-3 py-2.5 rounded-xl outline-none placeholder-[#666]" />
                </div>
                <button type="button" onClick={handleAdminSaveSettings} disabled={adminSavingSettings || !adminEditTitle.trim()} className="w-full py-2.5 rounded-full bg-[#FFD700] text-black font-medium hover:opacity-90 disabled:opacity-50 transition">
                  {adminSavingSettings ? '儲存中…' : '儲存'}
                </button>
              </div>
            </div>
          </>,
          document.body
        )}

        {/* 未登入提示：加入收藏需先登入，可撳掣用 Google 登入 */}
        {showLoginPrompt && typeof document !== 'undefined' && createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/60 z-[10000]"
              onClick={() => setShowLoginPrompt(false)}
              aria-hidden
            />
            <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10001] w-full max-w-sm mx-4">
              <div className="bg-[#121212] rounded-2xl border border-neutral-800 shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
                <p className="text-white text-center mb-6">
                  請先登入後即可將歌單加入收藏
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={handleLoginPromptGoogleSignIn}
                    disabled={isSigningIn}
                    className="w-full flex items-center justify-center gap-3 bg-[#121212] border-2 border-neutral-700 text-white py-3 px-4 rounded-xl font-medium hover:border-[#FFD700] transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    <span>{isSigningIn ? '登入中...' : '使用 Google 登入'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLoginPrompt(false)}
                    className="w-full py-3 rounded-xl font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}

        {/* 加入歌單 Modal */}
        {showAddToPlaylist && (
          <>
            <div 
              className="fixed inset-0 bg-black/60 z-50" 
              onClick={() => {
                setShowAddToPlaylist(false)
                setShowCreatePlaylistInput(false)
                setNewPlaylistName('')
                setAddToPlaylistSelectedIds([])
                setAddToPlaylistInitialIds([])
              }} 
            />
            <div className="fixed bottom-0 left-0 right-0 bg-[#121212] rounded-t-2xl z-[60] pb-24 max-h-[70vh] overflow-y-auto">
              <div className="flex flex-col items-center justify-center py-2 min-h-[36px]">
                <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
              </div>
              <div className="text-left" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
              <h3 className="text-white text-lg font-bold mb-4">加入歌單</h3>
              
              <div className="space-y-2">
                {userPlaylists.map((pl) => {
                  const isSelected = addToPlaylistSelectedIds.includes(pl.id)
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => toggleAddToPlaylistSelection(pl.id)}
                      className="w-full flex items-center gap-3 pl-0 pr-3 py-1.5 hover:bg-[#1a1a1a] rounded-2xl text-left"
                    >
                      <div className="w-12 h-12 rounded-[4px] bg-[#282828] flex items-center justify-center flex-shrink-0">
                        <Music className="w-6 h-6 text-[#3E3E3E]" />
                      </div>
                      <span className="text-white font-medium flex-1 min-w-0 truncate">{pl.title}</span>
                      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center border-2 ${isSelected ? 'bg-[#FFD700] border-[#FFD700]' : 'border-[#525252]'}`}>
                        {isSelected && (
                          <svg className="w-3.5 h-3.5 text-black" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  )
                })}

                {/* 分隔線（space-y-2 統一 0.5rem） */}
                <div className="h-px bg-[#3E3E3E] w-full shrink-0" />

                {/* 創建新歌單按鈕（虛線方框 + 黃 Plus，無 hover） */}
                <button
                  type="button"
                  onClick={() => setShowCreatePlaylistInput(true)}
                  className="w-full flex items-center space-x-3 pl-0 pr-3 py-1.5 md:hover:bg-[#1a1a1a] rounded-2xl text-left"
                >
                  <div className="w-12 h-12 rounded-[4px] bg-[#121212] border-2 border-dashed border-[#FFD700] flex items-center justify-center flex-shrink-0">
                    <Plus className="w-6 h-6 text-[#FFD700]" />
                  </div>
                  <span className="text-[#FFD700] font-medium">創建新歌單</span>
                </button>

                <button
                  type="button"
                  onClick={confirmAddToPlaylist}
                  disabled={!addToPlaylistSelectedIds.some((id) => !addToPlaylistInitialIds.includes(id)) && !addToPlaylistInitialIds.some((id) => !addToPlaylistSelectedIds.includes(id))}
                  className={`w-full py-3 rounded-full font-medium transition ${addToPlaylistSelectedIds.some((id) => !addToPlaylistInitialIds.includes(id)) || addToPlaylistInitialIds.some((id) => !addToPlaylistSelectedIds.includes(id)) ? 'bg-[#FFD700] text-black hover:bg-yellow-400' : 'bg-[#3E3E3E] text-[#737373] cursor-not-allowed'}`}
                >
                  確認
                </button>

                {/* 創建輸入框 */}
                {showCreatePlaylistInput && (
                  <div className="mt-3 p-3 bg-[#1a1a1a] rounded-lg text-left">
                    <input
                      type="text"
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      placeholder="輸入歌單名稱"
                      className="w-full bg-[#282828] text-white px-3 py-2 rounded-lg mb-2 outline-none"
                      autoFocus
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={handleCreatePlaylist}
                        disabled={!newPlaylistName.trim()}
                        className="flex-1 bg-[#FFD700] text-black py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        創建並加入
                      </button>
                      <button
                        onClick={() => {
                          setShowCreatePlaylistInput(false)
                          setNewPlaylistName('')
                        }}
                        className="flex-1 bg-[#282828] text-white py-2 rounded-lg"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
              </div>
            </div>
          </>
        )}

      {/* Custom Styles for scrollbar-hide */}

      <style jsx global>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </Layout>
  )
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' }
}

export async function getStaticProps({ params }) {
  const id = params?.id
  if (!id) return { notFound: true }
  try {
    // isAutoRecent playlist 跳過快取，直接 fetch 最新資料
    const earlyPlaylist = await getPlaylist(id)
    if (!earlyPlaylist?.isAutoRecent) {
      const cached = await getPlaylistPageCache(id)
      if (cached) {
        // Redirect from doc ID to slug URL
        if (cached.playlist?.slug && cached.playlist.slug !== id) {
          return { redirect: { destination: `/playlist/${encodeURIComponent(cached.playlist.slug)}`, permanent: true } }
        }
        const autoF = (cached.otherPlaylists?.auto || []).filter((p) => p.id !== id).slice(0, 2)
        const manualF = (cached.otherPlaylists?.manual || []).filter((p) => p.id !== id).slice(0, 6)
        return {
          props: {
            initialPlaylist: cached.playlist,
            initialSongs: toSlimSongs(cached.songs || []),
            initialUniqueArtists: cached.uniqueArtists || [],
            initialOtherPlaylists: [...autoF, ...manualF]
          },
          revalidate: 300
        }
      }
    }
    const playlistData = earlyPlaylist
    // Redirect from doc ID to slug URL
    if (playlistData?.slug && playlistData.slug !== id) {
      return { redirect: { destination: `/playlist/${encodeURIComponent(playlistData.slug)}`, permanent: true } }
    }
    if (!playlistData) {
      return { props: { initialPlaylist: null, initialSongs: [], initialUniqueArtists: [], initialOtherPlaylists: [] }, revalidate: 60 }
    }
    let songs = []
    let uniqueArtists = []
    if (playlistData.isAutoRecent) {
      // 動態查詢最新上架，唔用固定 songIds
      const count = playlistData.autoRecentCount || 20
      const recentTabs = await getRecentTabsFromFirestore(count)
      const enriched = await enrichTabsWithArtists(recentTabs)
      songs = enriched.songs
      uniqueArtists = enriched.uniqueArtists
    } else if (isChaksaPlaylist(playlistData) && Array.isArray(playlistData.chartEntries) && playlistData.chartEntries.length > 0) {
      const resolved = await resolveChaksaPlaylistItems(playlistData.chartEntries)
      songs = resolved.songs
      uniqueArtists = resolved.uniqueArtists
    } else {
      const songIds = playlistData.songIds || []
      const res = songIds.length > 0 ? await getPlaylistSongs(songIds) : { songs: [], uniqueArtists: [] }
      songs = res.songs
      uniqueArtists = res.uniqueArtists
    }
    const otherPlaylists = await getAllActivePlaylists()
    const autoFiltered = (otherPlaylists.auto || []).filter((p) => p.id !== id).slice(0, 2)
    const manualFiltered = (otherPlaylists.manual || []).filter((p) => p.id !== id).slice(0, 6)
    const initialOtherPlaylists = [...autoFiltered, ...manualFiltered]
    const slimSongs = toSlimSongs(songs)
    const payload = {
      playlist: playlistData,
      songs: slimSongs,
      uniqueArtists,
      otherPlaylists: { auto: otherPlaylists.auto, manual: otherPlaylists.manual }
    }
    // isAutoRecent playlist 唔寫入長效快取，靠 ISR revalidate 保持新鮮
    if (!playlistData.isAutoRecent) {
      await setPlaylistPageCache(id, payload)
    }
    const initialPlaylist = serializePlaylistData(playlistData)
    const initialSongs = serializePlaylistData(slimSongs)
    const initialUniqueArtists = serializePlaylistData(uniqueArtists)
    const serializedOther = serializePlaylistData(initialOtherPlaylists)
    if (initialPlaylist === null && playlistData != null) {
      console.error('[playlist/[id]] getStaticProps: serialization failed for playlist')
    }
    return {
      props: {
        initialPlaylist: initialPlaylist ?? null,
        initialSongs: Array.isArray(initialSongs) ? initialSongs : [],
        initialUniqueArtists: Array.isArray(initialUniqueArtists) ? initialUniqueArtists : [],
        initialOtherPlaylists: Array.isArray(serializedOther) ? serializedOther : []
      },
      revalidate: 300
    }
  } catch (e) {
    console.error('[playlist/[id]] getStaticProps:', e?.message)
    return { props: { initialPlaylist: null, initialSongs: [], initialUniqueArtists: [], initialOtherPlaylists: [] }, revalidate: 60 }
  }
}
