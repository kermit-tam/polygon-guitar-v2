import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { pacificTime } from '@/lib/logTime'
import { auth } from '@/lib/firebase'
import { useRouter } from 'next/router'
import Link from '@/components/Link'
import { getTab, getTabCached, setTabCache, clearTabCache, deleteTab, incrementViewCount, getArtistByIdOrSlug, getTabArtistId, getTabArtistIds } from '@/lib/tabs'
import { findAlternateUploaderVersions } from '@/lib/tabAlternateVersions'
import { useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/Layout'
import TabContent from '@/components/TabContent'
import TabComments from '@/components/TabComments'
import SongActionSheet from '@/components/SongActionSheet'
import RatingSystem from '@/components/RatingSystem'
import GpSegmentPlayer from '@/components/GpSegmentPlayer'
import { useArtistMap } from '@/lib/useArtistMap'
import { recordSongView, removeFromRecentViews } from '@/lib/recentViews'
import { recordPageView } from '@/lib/analytics'
import { recordTabView } from '@/lib/libraryRecentViews'
import { Share, Heart, Music, Plus, Copy, ArrowLeft, PenLine, Star, Bookmark } from 'lucide-react'

const SongInfoIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 100 100" fill="currentColor" aria-hidden xmlns="http://www.w3.org/2000/svg">
    <path d="M50,0C22.42,0,0,22.42,0,50s22.42,50,50,50,50-22.42,50-50S77.58,0,50,0ZM44.95,19.05c1.37-1.37,3.16-2.11,5.26-2.11s3.89.74,5.26,2.11,2.11,3.16,2.11,5.26-.74,3.89-2.11,5.26-3.16,2.11-5.26,2.11-3.89-.74-5.26-2.11-2.11-3.16-2.11-5.26.74-3.89,2.11-5.26ZM63.16,79.16c0,1.47-1.16,2.53-2.53,2.53h-20.21c-1.47,0-2.53-1.05-2.53-2.53v-2.21c0-1.47,1.16-2.53,2.53-2.53l4.53-.42v-26.53l-4.95-.53c-1.37-.11-2.42-1.16-2.42-2.53v-2c0-1.37.95-2.42,2.21-2.53l10.63-1.79s.21-.11.63-.11h2.74c1.47,0,2.53,1.05,2.53,2.53v33.58l4.42.42c1.26,0,2.32,1.16,2.32,2.53v2.11h.11Z" />
  </svg>
)

const InstagramIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" />
  </svg>
)

/** CHORD LOG 風格：斜鉛筆 + 底線（24 方格，用固定正方形尺寸避免 flex 拉扁） */
const ChordLogPenIcon = ({ className = '' }) => (
  <svg
    className={`shrink-0 aspect-square ${className}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
)
import { toggleLikeSong, checkIsLiked, getUserPlaylists, addSongToPlaylist, createPlaylist, removeSongFromPlaylist } from '@/lib/playlistApi'
import { isSongLikedInCache, getPlaylistsFromCache } from '@/lib/userLibraryCache'
import Head from 'next/head'
import { generateTabTitle, generateTabDescription, generateTabSchema, generateBreadcrumbSchema, getAbsoluteOgImage } from '@/lib/seo'
import { siteConfig } from '@/lib/seo'
import { calculateCapo, getKeyOptions } from '@/lib/keyUtils'
import { getTransposedUniqueChordsFromContent } from '@/lib/chordUtils'
import ChordDiagramBottomSheet, { CHORD_SHEET_MAX_HEIGHT } from '@/components/ChordDiagramBottomSheet'
import { tabUploaderPenNameMatchesUser } from '@/lib/tabEditPermission'

// 主題顏色配置
const themeColors = {
  night: {
    bg: '#121212',
    text: '#FFFFFF',
    lyricNormal: '#A0A0A0',
    lyricInside: '#FFFFFF',
    chord: '#FFD700',
    sectionMarker: '#FFFFFF',
    numericNotation: '#A0A0A0',
    prefixSuffix: '#808080'
  },
  day: {
    bg: '#FFFFFF',
    text: '#000000',
    lyricNormal: '#333333',
    lyricInside: '#000000',
    chord: '#7C3AED',
    sectionMarker: '#000000',
    numericNotation: '#555555',
    prefixSuffix: '#666666'
  }
};

// Barre 和弦定義
const BARRE_CHORDS = ['B', 'Bm', 'Bb', 'Bbm', 'B7', 'Bm7', 'Bb7', 'C#', 'C#m', 'C#7', 'C#m7', 'Db', 'Dbm', 'F', 'Fm', 'F7', 'Fm7', 'F#', 'F#m', 'F#7', 'F#m7', 'Gb', 'Gbm', 'G#', 'G#m', 'G#7', 'G#m7', 'Ab', 'Abm'];

function serializeTab(tab) {
  if (!tab) return null
  return JSON.parse(JSON.stringify(tab, (_, v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v)))
}

export default function TabDetail({ initialTab, artist }) {
  const router = useRouter()
  const { artistMap, getArtistName } = useArtistMap()
  const { id, key: queryKey, updated: queryUpdated, debug: queryDebug } = router.query
  const showDebug = queryDebug === '1' || queryDebug === 'true'
  // router.query 可能未就緒（client nav），用 asPath + location.search + sessionStorage 確保捉到「剛保存」
  const fromSaveRedirect = queryUpdated != null ||
    (typeof window !== 'undefined' && id && (
      router.asPath.includes('updated=1') ||
      (window.location?.search?.includes('updated=1')) ||
      sessionStorage.getItem('pg_tab_just_updated') === id
    ))
  const { user, isAuthenticated, isAdmin } = useAuth()
  const [tab, setTab] = useState(initialTab || null)
  const [isLoading, setIsLoading] = useState(!initialTab)
  const [isDeleting, setIsDeleting] = useState(false)
  const [uploaderId, setUploaderId] = useState('') // resolved from uploaderPenName (user doc id, real or placeholder)
  const [currentKey, setCurrentKey] = useState(null)
  const [showInfo, setShowInfo] = useState(false)
  const [chordStats, setChordStats] = useState(null)
  const [theme, setTheme] = useState('night');
  const [ratingData, setRatingData] = useState({ averageRating: 0, ratingCount: 0 })
  const [playingSegmentId, setPlayingSegmentId] = useState(null)
  const colors = themeColors[theme];
  
  const [menuTabLiked, setMenuTabLiked] = useState(false) // 頂 bar 喜愛狀態
  const [likesCount, setLikesCount] = useState(0)
  const [userPlaylists, setUserPlaylists] = useState([])
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false)
  const [addToPlaylistSelectedIds, setAddToPlaylistSelectedIds] = useState([])
  const [addToPlaylistInitialIds, setAddToPlaylistInitialIds] = useState([])
  const [showCreatePlaylistInput, setShowCreatePlaylistInput] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [toastMessage, setToastMessage] = useState(null)
  // 底部黃 bar + TabContent 受控 state（樂譜頁 layout）
  const [tabPageFontSize, setTabPageFontSize] = useState(16)
  const [tabPageIsAutoScroll, setTabPageIsAutoScroll] = useState(false)
  const [tabPageScrollSpeed, setTabPageScrollSpeed] = useState(2)
  const [tabPageHideNotation, setTabPageHideNotation] = useState(true)
  const [tabPageHideTabStaff, setTabPageHideTabStaff] = useState(false)
  const [showChordDiagram, setShowChordDiagram] = useState(false)
  /** null = 本曲和弦預設順序（FAB）；非 null = 該和弦排第一 + 膠囊黃色（譜內點字） */
  const [chordSheetLeadChord, setChordSheetLeadChord] = useState(null)
  /** 和弦面板實際高度（px），用於 FAB 對位；唔好用 CHORD_SHEET_MAX_HEIGHT 以免內容較矮時空隙過大 */
  const [chordSheetHeightPx, setChordSheetHeightPx] = useState(null)
  const [showFloatingControls, setShowFloatingControls] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [alternateUploaderVersions, setAlternateUploaderVersions] = useState([])
  const [showAlternateVersionsModal, setShowAlternateVersionsModal] = useState(false)
  const [ytPlaying, setYtPlaying] = useState(false)
  const [ytCurrentTime, setYtCurrentTime] = useState(0)
  const [ytDuration, setYtDuration] = useState(0)
  const [ytReady, setYtReady] = useState(false)
  const [showYtBar, setShowYtBar] = useState(false)
  const [infoStartTime, setInfoStartTime] = useState(0)
  const [infoAutoPlay, setInfoAutoPlay] = useState(false)

  const [resolvedArtistName, setResolvedArtistName] = useState('')
  const [resolvedArtistNamesById, setResolvedArtistNamesById] = useState({})
  const [prevId, setPrevId] = useState(null)
  const [isSongMetaCollapsed, setIsSongMetaCollapsed] = useState(false)
  const justRefetchedIdRef = useRef(null)
  const viewCountFiredForRef = useRef(null)
  const topBarRef = useRef(null)
  const songMetaSectionRef = useRef(null)
  const songMetaBottomSentinelRef = useRef(null)
  const ytPlayerRef = useRef(null)
  const ytIntervalRef = useRef(null)
  const ytContainerRef = useRef(null)
  const ytInfoIframeRef = useRef(null)
  const lastInfoSyncRef = useRef(0)
  const [topBarHeight, setTopBarHeight] = useState(44)
  const [isClientMounted, setIsClientMounted] = useState(false)
  const pageWrapRef = useRef(null)
  // Fallback: when tab has no artistPhoto, get from search-data API (cache, no extra Firestore reads). Remove after backfill.
  const [fallbackArtistPhoto, setFallbackArtistPhoto] = useState(null)

  const handleChordSheetHeight = useCallback((h) => {
    if (typeof h === 'number' && h > 0) setChordSheetHeightPx(h)
  }, [])

  const handleChordPressFromTab = useCallback((chord) => {
    if (!chord) return
    setChordSheetLeadChord(chord)
    setShowChordDiagram(true)
  }, [])

  useEffect(() => {
    if (!showChordDiagram) setChordSheetHeightPx(null)
  }, [showChordDiagram])

  // Render-phase cache check — runs before paint so no skeleton flash on cache hit
  // 若有 ?updated=1 唔用 initialTab/cache，強制之後 useEffect 從 Firestore 重載
  if (id && id !== prevId) {
    setPrevId(id)
    const fromUpdated = fromSaveRedirect
    const cached = getTabCached(id)
    const fromInitial = !fromUpdated && initialTab && initialTab.id === id
    if (fromUpdated) {
      setTab(null)
      setIsLoading(true)
    } else if (fromInitial) {
      setTab(initialTab)
      setCurrentKey(queryKey || initialTab.playKey || initialTab.originalKey || 'C')
      setRatingData({ averageRating: initialTab.averageRating || 0, ratingCount: initialTab.ratingCount || 0 })
      setShowInfo(false)
      setIsLoading(false)
    } else if (cached) {
      setTab(cached)
      setCurrentKey(queryKey || cached.playKey || cached.originalKey || 'C')
      setRatingData({ averageRating: cached.averageRating || 0, ratingCount: cached.ratingCount || 0 })
      setShowInfo(false)
      setIsLoading(false)
    } else {
      setTab(null)
      setIsLoading(true)
    }
  }

  useEffect(() => {
    if (!id) return
    // 剛從編輯頁保存過來：強制重載，唔用 initialTab / cache，然後清走 URL 的 ?updated=1
    const fromSave = queryUpdated != null ||
      (typeof window !== 'undefined' && id && (router.asPath.includes('updated=1') || sessionStorage.getItem('pg_tab_just_updated') === id))
    if (fromSave) {
      justRefetchedIdRef.current = id
      try { sessionStorage.removeItem('pg_tab_just_updated') } catch (e) {}
      clearTabCache(id)
      loadTab({ skipCache: true }).then(() => {
        router.replace(`/tabs/${id}${queryKey ? `?key=${queryKey}` : ''}`, undefined, { shallow: true })
      })
      return
    }
    if (initialTab && initialTab.id === id) {
      if (justRefetchedIdRef.current === id) {
        justRefetchedIdRef.current = null
        return
      }
      setTabCache(id, initialTab)
      setTab(initialTab)
      setCurrentKey(queryKey || initialTab.playKey || initialTab.originalKey || 'C')
      setRatingData({ averageRating: initialTab.averageRating || 0, ratingCount: initialTab.ratingCount || 0 })
      setShowInfo(false)
      setIsLoading(false)
      fireSideEffects(initialTab)
      return
    }
    const cached = getTabCached(id)
    if (cached) {
      fireSideEffects(cached)
    } else {
      loadTab()
    }
  }, [id, initialTab, queryUpdated, router.asPath])

  // 計算和弦統計
  useEffect(() => {
    if (tab?.content) {
      const stats = analyzeChords(tab.content, tab.originalKey || 'C')
      setChordStats(stats)
    }
  }, [tab])

  const analyzeChords = (content, originalKey) => {
    const chordPattern = /\b[A-G][#b]?(maj|mj|m|min|dim|aug|sus|add|m7|maj7|7|9|11|13)?[0-9]*(\/[A-G][#b]?)?\b/g
    const matches = content.match(chordPattern) || []
    const validChordPattern = /^[A-G][#b]?(maj|mj|m|min|dim|aug|sus|add|m7|maj7|7|9|11|13)*$/
    const chords = matches.filter(c => validChordPattern.test(c))
    const uniqueChords = [...new Set(chords)]
    
    // 計算原調 Barre 和弦
    const barreCount = uniqueChords.filter(c => BARRE_CHORDS.includes(c)).length
    
    return {
      total: uniqueChords.length,
      barreCount: barreCount,
      chords: uniqueChords
    }
  }

  const extractYouTubeId = (url) => {
    if (!url) return null
    const match = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)
    return match ? match[1] : null
  }

  const videoId = tab ? (tab.youtubeVideoId || extractYouTubeId(tab.youtubeUrl)) : null

  const formatYtTime = (sec) => {
    if (!sec || !isFinite(sec)) return '0:00'
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const fireSideEffects = (data) => {
    setFallbackArtistPhoto(null)
    const effects = []
    if (viewCountFiredForRef.current !== id) {
      viewCountFiredForRef.current = id
      effects.push(incrementViewCount(id))
    }
    recordTabView(id, data)
    if (user) effects.push(recordSongView(user.uid, data))
    effects.push(
      recordPageView('tab', id, data.title, {
        pageName: data.title,
        artistName: getArtistName(data) || '',
        originalKey: data.originalKey,
        thumbnail: data.thumbnail || data.albumImage || data.artistPhoto
      }, user?.uid || null)
    )
    // Resolve uploaderPenName → profile id (user doc by penName, real or placeholder; else pen-* fallback)
    setUploaderId('')
    if (data.uploaderPenName) {
      fetch(`/api/resolve-pen-name?penName=${encodeURIComponent(data.uploaderPenName)}`)
        .then(r => r.ok ? r.json() : null)
        .then(payload => setUploaderId(payload?.id ?? ''))
        .catch(() => {})
    }
    // Cover fallback: search-data API (1 cache read). Remove after backfill has run.
    const mainArtistIdForData = getTabArtistId(data)
    const needsArtistPhoto = !data.artistPhoto && !data.coverImage && !data.albumImage && !data.thumbnail && mainArtistIdForData
    if (needsArtistPhoto) {
      fetch('/api/search-data?only=artists')
        .then(r => r.ok ? r.json() : null)
        .then(payload => {
          const allArtists = payload?.artists || []
          const matched = allArtists.find(a => a.id === mainArtistIdForData)
          if (matched?.photo) {
            setFallbackArtistPhoto(matched.photo)
            recordTabView(id, { ...data, artistPhoto: matched.photo })
          }
        })
        .catch(() => {})
    }
    Promise.all(effects).catch(err => console.error('Side-effect error:', err))
  }

  const loadTab = async (opts = {}) => {
    try {
      const startMs = Date.now()
      const data = await getTab(id, opts)
      console.log(`[tab/${id}] getTab in ${Date.now() - startMs}ms at ${pacificTime()}`)
      if (data) {
        if (!data.youtubeVideoId && data.youtubeUrl) {
          data.youtubeVideoId = extractYouTubeId(data.youtubeUrl)
        }

        // Cover: use only denormalized tab.artistPhoto (no artists read). New/edit saves artistPhoto.
        setTabCache(id, data)

        setTab(data)
        setCurrentKey(queryKey || data.playKey || data.originalKey || 'C')
        setShowInfo(false)
        setRatingData({
          averageRating: data.averageRating || 0,
          ratingCount: data.ratingCount || 0
        })
        fireSideEffects(data)
      } else {
        removeFromRecentViews('tab', id)
        router.push('/')
      }
    } catch (error) {
      console.error('Error loading tab:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('確定要刪除這個譜嗎？')) return
    setIsDeleting(true)
    try {
      const deletedTab = tab ? { id, artistId: getTabArtistId(tab) } : { id }
      await deleteTab(id, user.uid, isAdmin, user?.penName || '')
      try {
        const token = await auth.currentUser?.getIdToken?.()
        if (token) {
          await fetch('/api/patch-caches-on-new-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tab: deletedTab, action: 'delete' })
          })
        }
      } catch (e) { console.warn('[patch-caches] delete patch failed:', e) }
      removeFromRecentViews('tab', id)
      router.push('/')
    } catch (error) {
      alert('刪除失敗：' + error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  // 單一來源：artistId → 名；map 無時由 Firestore 取一次
  useEffect(() => {
    const mainId = tab ? getTabArtistId(tab) : ''
    if (!mainId || (getTabArtistIds(tab).length > 1)) {
      setResolvedArtistName('')
      return
    }
    const fromMap = artistMap?.get(mainId) || artistMap?.get(mainId?.toLowerCase())
    if (fromMap) {
      setResolvedArtistName('')
      return
    }
    let cancelled = false
    getArtistByIdOrSlug(mainId).then((a) => {
      if (!cancelled && a?.name) setResolvedArtistName(a.name)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [tab?.id, tab?.artists, tab?.artistIds, artistMap])

  // 多歌手時：artistMap 冇嘅 id 用 getArtistByIdOrSlug 補名，避免顯示 id
  useEffect(() => {
    const ids = tab ? getTabArtistIds(tab) : []
    if (ids.length <= 1) {
      setResolvedArtistNamesById({})
      return
    }
    let cancelled = false
    const missing = ids.filter(id => !(artistMap?.get(id) || artistMap?.get(id?.toLowerCase())))
    if (missing.length === 0) {
      setResolvedArtistNamesById({})
      return
    }
    Promise.all(missing.map(id => getArtistByIdOrSlug(id).then(a => ({ id, name: a?.name || '' }))))
      .then(results => {
        if (cancelled) return
        const next = {}
        results.forEach(({ id, name }) => { if (name) next[id] = name })
        setResolvedArtistNamesById(prev => ({ ...prev, ...next }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tab?.id, tab?.artists, tab?.artistIds, artistMap])

  // 頂 bar 喜愛狀態：tab 載入時更新
  useEffect(() => {
    if (tab) setLikesCount(tab.likes ?? 0);
  }, [tab?.id]);

  useEffect(() => {
    if (user && tab?.id) {
      const cached = isSongLikedInCache(user.uid, tab.id);
      if (cached !== null) {
        setMenuTabLiked(cached);
      } else {
        checkIsLiked(user.uid, tab.id).then(setMenuTabLiked);
      }
    } else {
      setMenuTabLiked(false);
    }
  }, [user, tab?.id]);

  const alternateVersionsKey = tab
    ? [
        tab.id,
        tab.title,
        tab.uploaderPenName || '',
        getTabArtistId(tab),
        JSON.stringify(getTabArtistIds(tab)),
      ].join('\0')
    : ''

  useEffect(() => {
    setShowAlternateVersionsModal(false)
  }, [id])

  useEffect(() => {
    if (!tab?.id) {
      setAlternateUploaderVersions([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        let catalogTabs = null
        try {
          const raw = typeof window !== 'undefined' && localStorage.getItem('searchPageData')
          if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed.tabs) && Date.now() - (parsed.ts || 0) < 45_000) {
              catalogTabs = parsed.tabs
            }
          }
        } catch {}
        if (!catalogTabs) {
          const r = await fetch('/api/search-data')
          const data = r.ok ? await r.json() : null
          catalogTabs = data?.tabs || []
          try {
            if (typeof window !== 'undefined' && data && !data.error) {
              localStorage.setItem('searchPageData', JSON.stringify({ ...data, ts: Date.now() }))
            }
          } catch {}
        }
        if (cancelled) return
        setAlternateUploaderVersions(findAlternateUploaderVersions(tab, catalogTabs))
      } catch {
        if (!cancelled) setAlternateUploaderVersions([])
      }
    })()
    return () => { cancelled = true }
  }, [alternateVersionsKey])

  // 加入歌單需要歌單列表：優先用 cache，無 cache 才 Firestore
  useEffect(() => {
    if (user) {
      const cached = getPlaylistsFromCache(user.uid);
      if (cached) {
        setUserPlaylists(cached);
      } else {
        getUserPlaylists(user.uid).then(setUserPlaylists);
      }
    }
  }, [user]);

  const showToast = (msg) => {
    setToastMessage(msg);
  };

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  useEffect(() => {
    setIsClientMounted(true)
    if (topBarRef.current) setTopBarHeight(topBarRef.current.offsetHeight);
  });

  useEffect(() => {
    const updateCollapsed = () => {
      if (!songMetaBottomSentinelRef.current) return
      const rect = songMetaBottomSentinelRef.current.getBoundingClientRect()
      // Read offsetHeight live from the DOM so we always use the current bar height,
      // not the stale closure value — prevents jitter when the collapsed bar
      // appears/disappears and shifts the sentinel before topBarHeight state updates.
      const liveTopBarHeight = topBarRef.current ? topBarRef.current.offsetHeight : topBarHeight
      const collapseAt = liveTopBarHeight + 1
      const expandAt = liveTopBarHeight + 14 // hysteresis: prevent rapid toggle near threshold
      setIsSongMetaCollapsed(prev => {
        if (!prev && rect.top <= collapseAt) return true
        if (prev && rect.top >= expandAt) return false
        return prev
      })
    }

    updateCollapsed()
    const observer = new IntersectionObserver(() => updateCollapsed(), {
      threshold: [0, 1],
    })
    if (songMetaBottomSentinelRef.current) observer.observe(songMetaBottomSentinelRef.current)

    let rafId = 0
    const tick = () => {
      updateCollapsed()
      rafId = window.requestAnimationFrame(tick)
    }
    if (tabPageIsAutoScroll) rafId = window.requestAnimationFrame(tick)

    window.addEventListener('scroll', updateCollapsed, { passive: true })
    window.addEventListener('resize', updateCollapsed)
    return () => {
      observer.disconnect()
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', updateCollapsed)
      window.removeEventListener('resize', updateCollapsed)
    }
  }, [topBarHeight, tab?.id, tabPageIsAutoScroll])

  // Pre-load YouTube IFrame API script
  useEffect(() => {
    if (!videoId) return
    if (window.YT?.Player) return
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  }, [videoId])

  // Cleanup YouTube player when video changes or unmount
  useEffect(() => {
    return () => {
      clearInterval(ytIntervalRef.current)
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.destroy() } catch(_) {}
        ytPlayerRef.current = null
      }
      setYtPlaying(false)
      setYtCurrentTime(0)
      setYtDuration(0)
      setYtReady(false)
      setShowYtBar(false)
    }
  }, [videoId])

  // Update progress while playing
  useEffect(() => {
    if (ytPlaying && ytPlayerRef.current) {
      ytIntervalRef.current = setInterval(() => {
        try {
          const t = ytPlayerRef.current.getCurrentTime()
          if (typeof t === 'number') setYtCurrentTime(t)
        } catch(_) {}
      }, 500)
    }
    return () => clearInterval(ytIntervalRef.current)
  }, [ytPlaying])

  const initAndPlayYt = () => {
    if (!videoId || !ytContainerRef.current) return
    const create = () => {
      if (!window.YT?.Player || !ytContainerRef.current) return
      const el = document.createElement('div')
      ytContainerRef.current.innerHTML = ''
      ytContainerRef.current.appendChild(el)
      try {
        new window.YT.Player(el, {
          videoId,
          height: '1',
          width: '1',
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: (e) => {
              ytPlayerRef.current = e.target
              setYtReady(true)
              setShowYtBar(true)
              try { setYtDuration(e.target.getDuration() || 0) } catch(_) {}
              e.target.playVideo()
            },
            onStateChange: (e) => {
              if (e.data === window.YT.PlayerState.PLAYING) {
                setYtPlaying(true)
                try { setYtDuration(e.target.getDuration() || 0) } catch(_) {}
              } else {
                setYtPlaying(false)
              }
            }
          }
        })
      } catch(e) { console.warn('[yt-player]', e) }
    }
    if (window.YT?.Player) {
      create()
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script')
        tag.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(tag)
      }
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev()
        create()
      }
    }
  }

  const syncInfoIframe = (func, args) => {
    try {
      const iframe = ytInfoIframeRef.current
      if (!iframe?.contentWindow) return
      iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command', func, args: args != null ? args : ''
      }), '*')
    } catch(_) {}
  }

  // Mute hidden player when info panel shows video, unmute when it closes
  useEffect(() => {
    if (!ytPlayerRef.current) return
    try {
      if (showInfo) {
        ytPlayerRef.current.mute()
      } else {
        ytPlayerRef.current.unMute()
      }
    } catch(_) {}
  }, [showInfo])

  // Listen for info panel YouTube iframe events → sync back to hidden player
  useEffect(() => {
    if (!showInfo || !videoId) return

    const handleMessage = (e) => {
      if (e.origin !== 'https://www.youtube.com') return
      let data
      try {
        data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch(_) { return }
      if (!data?.event) return

      if (data.event === 'onStateChange') {
        const state = typeof data.info === 'object' ? data.info : data.info
        if (!ytPlayerRef.current) return
        if (state === 1) {
          try { ytPlayerRef.current.playVideo() } catch(_) {}
          setShowYtBar(true)
        } else if (state === 2) {
          try { ytPlayerRef.current.pauseVideo() } catch(_) {}
        }
      }

      if (data.event === 'infoDelivery' && data.info?.currentTime != null) {
        const now = Date.now()
        if (now - lastInfoSyncRef.current < 2000) return
        const infoTime = data.info.currentTime
        if (!ytPlayerRef.current) return
        try {
          const hiddenTime = ytPlayerRef.current.getCurrentTime()
          if (Math.abs(infoTime - hiddenTime) > 3) {
            ytPlayerRef.current.seekTo(infoTime, true)
            setYtCurrentTime(infoTime)
            lastInfoSyncRef.current = now
          }
        } catch(_) {}
      }
    }

    window.addEventListener('message', handleMessage)

    const sendListening = () => {
      try {
        const iframe = ytInfoIframeRef.current
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*')
        }
      } catch(_) {}
    }
    const t1 = setTimeout(sendListening, 500)
    const t2 = setTimeout(sendListening, 1500)
    const t3 = setTimeout(sendListening, 3000)

    return () => {
      window.removeEventListener('message', handleMessage)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [showInfo, videoId])

  const toggleShowInfo = () => {
    if (!showInfo) {
      setInfoStartTime(Math.floor(ytCurrentTime || 0))
      setInfoAutoPlay(ytPlaying)
    }
    setShowInfo(!showInfo)
  }

  const toggleYtPlay = () => {
    if (!ytPlayerRef.current) {
      initAndPlayYt()
      return
    }
    if (ytPlaying) {
      ytPlayerRef.current.pauseVideo()
      syncInfoIframe('pauseVideo')
    } else {
      ytPlayerRef.current.playVideo()
      syncInfoIframe('playVideo')
      setShowYtBar(true)
    }
  }

  const handleYtSeek = (e) => {
    const time = parseFloat(e.target.value)
    if (ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(time, true)
      setYtCurrentTime(time)
    }
    syncInfoIframe('seekTo', [time, true])
  }

  const copyToClipboard = (text) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) resolve();
        else reject(new Error('execCommand copy failed'));
      } catch (e) {
        document.body.removeChild(textarea);
        reject(e);
      }
    });
  };

  const handleCopyShareLink = async () => {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/tabs/${tab.id}`;
    try {
      await copyToClipboard(url);
      showToast('已複製連結');
    } catch (err) {
      showToast('複製失敗');
    }
  };

  const handleSelectLyricsShare = () => {
    if (!tab?.id) return;
    router.push(`/tools/tab-share?tabId=${tab.id}`);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/tabs/${tab.id}`;
    const shareArtistName = getArtistName(tab) || '';
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `${tab.title} - ${shareArtistName}`,
          url
        });
      } catch (err) {
        if (err.name !== 'AbortError') showToast('分享失敗');
      }
    } else {
      try {
        await copyToClipboard(url);
        showToast('連結已複製到剪貼簿');
      } catch {
        showToast('複製失敗');
      }
    }
  };

  const handleAddToLiked = async () => {
    if (!user) {
      alert('請先登入後即可收藏喜愛的結他譜');
      return;
    }
    try {
      const result = await toggleLikeSong(user.uid, tab.id);
      setMenuTabLiked(result.isLiked);
      setLikesCount(prev => result.isLiked ? prev + 1 : Math.max(0, prev - 1));
    } catch (error) {
      alert('操作失敗：' + error.message);
    }
  };

  const handleAddToPlaylistClick = () => {
    // 預設剔選已包含此歌嘅歌單
    const alreadyIn = (userPlaylists || [])
      .filter((pl) => pl.songIds && pl.songIds.includes(tab?.id))
      .map((pl) => pl.id);
    setAddToPlaylistSelectedIds(alreadyIn);
    setAddToPlaylistInitialIds(alreadyIn);
    setShowAddToPlaylist(true);
  };

  const toggleAddToPlaylistSelection = (playlistId) => {
    setAddToPlaylistSelectedIds((prev) =>
      prev.includes(playlistId) ? prev.filter((pid) => pid !== playlistId) : [...prev, playlistId]
    )
  }

  const confirmAddToPlaylist = async () => {
    if (!tab) return
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
        await addSongToPlaylist(playlistId, tab.id)
      }
      for (const playlistId of idsToRemove) {
        await removeSongFromPlaylist(playlistId, tab.id)
      }
      const netChange = idsToAdd.length - idsToRemove.length
      if (netChange !== 0) {
        setTab(prev => prev ? { ...prev, playlistCount: Math.max(0, (prev.playlistCount || 0) + netChange) } : prev)
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
    if (!newPlaylistName.trim() || !user) return;
    try {
      const result = await createPlaylist(user.uid, newPlaylistName.trim());
      // 創建後直接加入歌曲
      await addSongToPlaylist(result.playlistId, tab.id);
      setTab(prev => prev ? { ...prev, playlistCount: (prev.playlistCount || 0) + 1 } : prev);
      setShowCreatePlaylistInput(false);
      setShowAddToPlaylist(false);
      setNewPlaylistName('');
      alert(`已創建歌單「${newPlaylistName.trim()}」並加入歌曲`);
    } catch (error) {
      alert('創建歌單失敗：' + error.message);
    }
  };

  const isOwner =
    tab &&
    user &&
    (tab.createdBy === user.uid || tabUploaderPenNameMatchesUser(tab, user.penName))
  const canEdit = isOwner || isAdmin

  if (router.isFallback || isLoading) {
    return (
      <Layout>
        <div className="w-full">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-neutral-800 rounded w-1/2"></div>
            <div className="h-6 bg-neutral-800 rounded w-1/4"></div>
            <div className="h-96 bg-neutral-800 rounded"></div>
          </div>
        </div>
      </Layout>
    )
  }

  if (!tab) return null

  /** Profile link only when a user (auth or placeholder) has this penName; otherwise no link. */
  const uploaderProfileId = uploaderId || null

  const effectiveArtistPhoto = tab.artistPhoto || fallbackArtistPhoto

  const mainArtistId = getTabArtistId(tab)
  const tabArtistIds = getTabArtistIds(tab)
  const resolvedSingleName = mainArtistId && (artistMap?.get(mainArtistId) || artistMap?.get(mainArtistId?.toLowerCase()))
  const isFeat = tab.artists?.[1]?.role === 'feat' || tab.artists?.[1]?.relation === 'feat'
  const getArtistNameById = (id) => resolvedArtistNamesById[id] || artistMap?.get(id) || artistMap?.get(id?.toLowerCase()) || id
  const artistDisplayName = tab.collaborators?.length > 1
    ? (isFeat ? tab.collaborators.join(' feat. ') : tab.collaborators.join(' / '))
    : tabArtistIds.length > 1
      ? tabArtistIds.map(getArtistNameById).join(isFeat ? ' feat. ' : ' / ')
      : (resolvedSingleName || resolvedArtistName || '')
  const tabCoverImageUrl = (() => {
    if (tab.coverImage) return tab.coverImage
    if (tab.albumImage) return tab.albumImage
    const videoId = tab.youtubeVideoId || tab.youtubeUrl?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1]
    if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    if (tab.thumbnail) return tab.thumbnail
    return effectiveArtistPhoto
  })()

  const hasSongInfo = tab.songYear || tab.composer || tab.lyricist || tab.arranger || tab.producer || tab.album || tab.uploaderPenName
  const baseKeyForChords = tab.playKey || tab.originalKey || 'C'
  const selectedKeyForChords = currentKey || tab.playKey || tab.originalKey || 'C'
  const tabChords = tab.content
    ? getTransposedUniqueChordsFromContent(tab.content, baseKeyForChords, selectedKeyForChords)
    : []
  const shouldShowCollapsedSongMeta = isSongMetaCollapsed

  // SEO 配置
  const seoTitle = generateTabTitle(tab.title, artistDisplayName)
  const seoDescription = generateTabDescription(tab.title, artistDisplayName, tab.originalKey || 'C')
  const seoUrl = `${siteConfig.url}/tabs/${tab.id}`
  
  // 結構化數據
  const tabSchema = generateTabSchema(tab, { name: artistDisplayName, photoURL: tab.thumbnail || effectiveArtistPhoto })
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: '首頁', url: siteConfig.url },
    { name: artistDisplayName, url: `${siteConfig.url}/artists/${mainArtistId}` },
    { name: tab.title, url: seoUrl }
  ])

  return (
    <>
      <Head>
        {/* 基本 Meta */}
        <title>{seoTitle}</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={seoUrl} />
        
        {/* Open Graph — unique per tab for social share preview */}
        <meta property="og:url" content={seoUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content={siteConfig.name} />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:image" content={getAbsoluteOgImage(tab.coverImage || tab.albumImage || tab.thumbnail || effectiveArtistPhoto)} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={`${tab.title} - ${artistDisplayName} 結他譜`} />
        <meta property="article:published_time" content={tab.createdAt} />
        <meta property="article:modified_time" content={tab.updatedAt} />
        
        {/* Twitter Card — unique per tab */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content={siteConfig.twitter} />
        <meta name="twitter:title" content={seoTitle} />
        <meta name="twitter:description" content={seoDescription} />
        <meta name="twitter:image" content={getAbsoluteOgImage(tab.coverImage || tab.albumImage || tab.thumbnail || effectiveArtistPhoto)} />
        <meta name="twitter:image:alt" content={`${tab.title} - ${artistDisplayName} 結他譜`} />
        
        {/* 結構化數據 JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([tabSchema, breadcrumbSchema])
          }}
        />
      </Head>
      
      <Layout>
        <div className="w-full">
        {/* Firebase 原始資料：加 ?debug=1 到 URL 即可顯示 */}
        {showDebug && tab && (
          <details className="mx-4 mt-2 p-3 bg-[#1a1a1a] border border-neutral-700 rounded-lg text-left">
            <summary className="cursor-pointer text-sm text-[#B3B3B3] hover:text-white">Firebase 原始資料 (tabs/{tab.id})</summary>
            <pre className="mt-2 p-2 bg-black rounded text-xs text-neutral-300 overflow-x-auto whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
              {JSON.stringify(tab, (_, v) => (v && typeof v?.toDate === 'function' ? v.toDate().toISOString() : v), 2)}
            </pre>
          </details>
        )}
        {/* 頂bar（固定，唔跟住滾動） */}
        <div
          ref={topBarRef}
          className="sticky top-0 z-[1000] bg-black pt-1.5 relative isolate"
          style={{
            zIndex: 2147483000,
            transform: 'translateZ(0)',
            WebkitTransform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            contain: 'paint',
          }}
        >
          <div className="px-4 pb-1.5 flex items-center justify-between gap-1 sm:gap-2 border-b border-[#1a1a1a]">
          <button type="button" onClick={() => router.back()} className="p-0 text-neutral-400 hover:text-white transition -ml-0.5 min-w-[40px] min-h-[40px] flex items-center" title="返回上一頁" aria-label="返回上一頁">
            <ArrowLeft className="w-6 h-6" strokeWidth={1.75} />
          </button>
          <div className="flex items-center gap-0.5 sm:gap-1">
          {alternateUploaderVersions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAlternateVersionsModal(true)}
              className="shrink-0 text-[10px] sm:text-xs font-semibold px-2 py-1 rounded-full border border-[#00ffab] text-[#00ffab] bg-[#00ffab]/10 hover:bg-[#00ffab]/20 transition leading-none"
              title="其他出譜人版本"
            >
              其他版本
              <span className="ml-0.5 tabular-nums opacity-90">{alternateUploaderVersions.length}</span>
            </button>
          )}
          {videoId && (
            <button onClick={toggleYtPlay} className={`p-1.5 transition ${ytPlaying ? 'text-[#FFD700]' : 'text-neutral-400 hover:text-white'}`} title={ytPlaying ? '暫停' : '播放'}>
              {ytPlaying ? (
                <svg className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="w-[22px] h-[22px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          )}
          {(tab?.youtubeVideoId || tab?.youtubeUrl || hasSongInfo) && (
            <button onClick={toggleShowInfo} className={`p-1.5 transition ${showInfo ? 'text-[#FFD700]' : 'text-neutral-400 hover:text-white'}`} title={showInfo ? '收起歌曲資訊' : '歌曲資訊'}>
              <SongInfoIcon className="w-[22px] h-[22px]" />
            </button>
          )}
          <button onClick={() => router.push(`/tools/tab-share?tabId=${tab.id}`)} className="p-1.5 text-neutral-400 hover:text-white transition" title="選取歌詞分享">
            <InstagramIcon className="w-[22px] h-[22px]" />
          </button>
          <button onClick={handleAddToLiked} className="p-1.5 text-neutral-400 hover:text-white transition" title={menuTabLiked ? '取消喜愛' : '加到我最喜愛'}>
            <Heart className={`w-6 h-6 ${menuTabLiked ? 'fill-[#FFD700] text-[#FFD700]' : 'fill-none text-neutral-400'}`} strokeWidth={1.35} />
          </button>
          <button onClick={handleAddToPlaylistClick} className="p-1.5 text-neutral-400 hover:text-white transition" title="加入歌單">
            <svg className="w-[22px] h-[22px]" viewBox="0 0 8.7 8.7" fill="none" stroke="currentColor" strokeWidth="0.65" strokeLinecap="round" strokeMiterlimit={10} aria-hidden>
              <circle cx="4.4" cy="4.4" r="4" />
              <line x1="2.2" y1="4.4" x2="6.5" y2="4.4" />
              <line x1="4.4" y1="2.2" x2="4.4" y2="6.5" />
            </svg>
          </button>
          <button onClick={() => setShowMoreMenu(!showMoreMenu)} className="p-1.5 text-neutral-400 hover:text-white transition" title="更多" aria-label="更多">
            <svg className="w-[18px] h-[18px]" viewBox="0 0 2.54 14.96" fill="currentColor" aria-hidden>
              <circle cx="1.27" cy="1.27" r="1.27" />
              <circle cx="1.27" cy="7.48" r="1.27" />
              <circle cx="1.27" cy="13.69" r="1.27" />
            </svg>
          </button>
          </div>
          </div>
          {/* YouTube 播放操作列 */}
          {showYtBar && videoId && (
            <div className="px-3 py-1.5 flex items-center gap-2 border-b border-[#1a1a1a]">
              <button onClick={toggleYtPlay} className="text-white shrink-0 w-6 h-6 flex items-center justify-center">
                {ytPlaying ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <rect x="5" y="3" width="5" height="18" rx="1" />
                    <rect x="14" y="3" width="5" height="18" rx="1" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <span className="text-[10px] text-neutral-500 shrink-0 tabular-nums w-8 text-right font-mono">{formatYtTime(ytCurrentTime)}</span>
              <div className="flex-1 relative h-5 flex items-center">
                <div className="absolute inset-x-0 h-[3px] bg-neutral-700 rounded-full overflow-hidden">
                  <div className="h-full bg-[#FFD700] rounded-full" style={{ width: ytDuration > 0 ? `${(ytCurrentTime / ytDuration) * 100}%` : '0%' }} />
                </div>
                <div
                  className="absolute w-3 h-3 bg-[#FFD700] rounded-full shadow -translate-x-1/2 pointer-events-none"
                  style={{ left: ytDuration > 0 ? `${(ytCurrentTime / ytDuration) * 100}%` : '0%' }}
                />
                <input
                  type="range"
                  min={0}
                  max={ytDuration || 1}
                  step={0.5}
                  value={ytCurrentTime}
                  onChange={handleYtSeek}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer"
                  aria-label="播放進度"
                />
              </div>
              <span className="text-[10px] text-neutral-500 shrink-0 tabular-nums w-8 font-mono">{formatYtTime(ytDuration)}</span>
              <button
                onClick={() => { if (ytPlayerRef.current && ytPlaying) ytPlayerRef.current.pauseVideo(); setShowYtBar(false) }}
                className="shrink-0 w-6 h-6 flex items-center justify-center text-neutral-500 hover:text-white transition"
                title="關閉播放列"
                aria-label="關閉播放列"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          {shouldShowCollapsedSongMeta && (
            <div className="px-4 py-2 flex items-center justify-between gap-3 border-b border-[#1a1a1a] bg-black/95">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-[4px] overflow-hidden bg-neutral-800 flex-shrink-0">
                  {tabCoverImageUrl ? (
                    <img
                      src={tabCoverImageUrl}
                      alt={tab.title}
                      className="w-full h-full object-cover"
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-600">🎵</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-semibold leading-tight truncate">{tab.title}</p>
                  <p className="mt-0.5 text-neutral-400 text-xs truncate">{artistDisplayName}</p>
                </div>
              </div>
              {tab.uploaderPenName && (
                uploaderProfileId ? (
                  <Link href={`/profile/${uploaderProfileId}`} className="text-[#FFD700] text-xs flex items-center gap-1 flex-shrink-0 self-center">
                    <PenLine className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[110px]">{tab.uploaderPenName}</span>
                  </Link>
                ) : (
                  <p className="text-[#FFD700] text-xs flex items-center gap-1 flex-shrink-0 self-center">
                    <PenLine className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate max-w-[110px]">{tab.uploaderPenName}</span>
                  </p>
                )
              )}
            </div>
          )}
        </div>

        <div ref={pageWrapRef} className="w-full">
        {/* Key 選擇器：日間／夜間模式都保持同一套深色樣式（唔跟譜面日間換白底） */}
        {tab && (
          <div className="bg-black pt-2 pb-3">
            <div className="px-4 mb-1.5">
              <div className="flex flex-nowrap items-center gap-2 text-xs whitespace-nowrap min-h-6 md:min-h-7 overflow-x-auto scrollbar-hide">
                <span className="flex-shrink-0 text-neutral-400">原調: <span className="text-white">{tab.originalKey || 'C'}</span></span>
                <span className="flex-shrink-0 text-neutral-600">→</span>
                <span className="flex-shrink-0 text-neutral-400">PLAY: <span className="text-[#FFD700] font-medium">{currentKey || tab.playKey || tab.originalKey || 'C'}</span></span>
                {(() => {
                  const orig = tab.originalKey || 'C'
                  const play = currentKey || tab.playKey || tab.originalKey || 'C'
                  const capo = calculateCapo(orig, play)
                  return capo > 0 ? (
                    <span className="flex-shrink-0 bg-[#FFD700] text-black text-[10px] md:text-xs px-1.5 py-0.5 md:px-2 md:py-1 rounded font-medium">Capo {capo}</span>
                  ) : null
                })()}
              </div>
            </div>
            <div className="max-md:w-screen max-md:ml-[calc(-50vw+50%)] md:w-full md:ml-0 box-border">
              <div className="flex flex-nowrap max-md:justify-between md:justify-start gap-0.5 overflow-x-auto scrollbar-hide px-4 max-md:w-full md:w-auto">
                {getKeyOptions(tab.playKey || tab.originalKey || 'C').map((key) => {
                  const isCurrent = key === (currentKey || tab.playKey || tab.originalKey || 'C')
                  return (
                    <button key={key} onClick={() => setCurrentKey(key)} className={`flex-shrink-0 w-7 h-7 md:w-9 md:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm md:text-base font-medium transition ${isCurrent ? 'bg-[#FFD700] text-black' : 'bg-neutral-700 text-black hover:bg-neutral-600 hover:text-black'}`}>
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Key 與 歌id 之間分隔線 */}
        <div className="px-4">
          <div className="border-b border-[#1a1a1a]" />
        </div>

        {/* 歌id section */}
        <div ref={songMetaSectionRef} className="pt-3 sm:pt-4 md:pt-5 pb-3 sm:pb-4 md:pb-5 px-4">
          <div className="flex items-start gap-4 md:gap-6">
            {/* 封面圖片 */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-[105px] md:h-[105px] flex-shrink-0 rounded-lg overflow-hidden bg-neutral-800">
              {/* 統一封面優先順序：coverImage > albumImage > youtubeVideoId > thumbnail > artistPhoto (incl. search-data fallback) */}
              {tabCoverImageUrl ? (
                <img 
                  src={tabCoverImageUrl}
                  alt={tab.title}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-600">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
              )}
            </div>
            
            {/* 歌名 + 歌手 + 操作（負 margin 令歌名第一行視覺對齊封面頂） */}
            <div className="flex-1 min-w-0 pt-0 -mt-2">
              {/* 歌名 + 編輯譜掣 */}
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-white leading-tight truncate text-xl sm:text-2xl md:text-3xl mt-0 mb-0 min-w-0">
                  {tab.title}
                </h1>
                {canEdit && (
                  <Link href={`/tabs/${tab.id}/edit`} className="px-2 py-0.5 text-[#FFD700] border border-[#FFD700]/50 hover:bg-[#FFD700]/10 transition shrink-0 rounded-full flex items-center gap-1 text-xs font-medium translate-y-[7px]" title="編輯譜">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </Link>
                )}
              </div>
              
              {/* 歌手：合唱/feat 時每個名獨立連結 */}
              <div className="flex flex-wrap items-center gap-x-0 gap-y-1 mt-1 md:mt-2 min-w-0">
                {(tab.collaborators?.length > 1 && Array.isArray(tab.collaboratorIds) && tab.collaboratorIds.length >= tab.collaborators.length) || tabArtistIds.length > 1 ? (
                  <>
                    {(tab.collaborators?.length >= tabArtistIds.length ? tab.collaborators : tabArtistIds.map(getArtistNameById)).map((name, i) => {
                      const artistId = tabArtistIds[i] ?? tab.collaboratorIds?.[i] ?? mainArtistId
                      const sep = i === 0 ? null : (
                        <span key={`sep-${i}`} className="text-neutral-400 text-sm sm:text-base md:text-lg mx-1 flex-shrink-0">
                          {isFeat ? ' feat. ' : ' / '}
                        </span>
                      )
                      return (
                        <span key={i} className="inline-flex items-center min-w-0">
                          {sep}
                          <Link
                            href={`/artists/${encodeURIComponent(artistId)}`}
                            className="text-neutral-400 text-sm sm:text-base md:text-lg hover:text-white transition truncate min-w-0"
                          >
                            {name}
                          </Link>
                        </span>
                      )
                    })}
                  </>
                ) : (
                  <Link
                    href={`/artists/${encodeURIComponent(mainArtistId)}`}
                    className="text-neutral-400 text-sm sm:text-base md:text-lg hover:text-white transition truncate min-w-0 flex-shrink"
                  >
                    {artistDisplayName}
                  </Link>
                )}
              </div>
              {/* 出譜者 + 評分、喜愛數（同一行）— 撳出譜者名稱進入出譜者主頁（uploaderPenName 對應 users.penName，真實或 placeholder） */}
              <div className="flex items-center justify-between gap-3 mt-1.5 min-w-0">
                <div className="min-w-0">
                  {tab.uploaderPenName && (
                    uploaderProfileId ? (
                      <Link
                        href={`/profile/${uploaderProfileId}`}
                        className="text-[#FFD700] text-sm flex items-center gap-1 w-fit hover:underline"
                      >
                        <PenLine className="w-3.5 h-3.5 flex-shrink-0" />
                        {tab.uploaderPenName}
                      </Link>
                    ) : (
                      <p className="text-[#FFD700] text-sm flex items-center gap-1">
                        <PenLine className="w-3.5 h-3.5 flex-shrink-0" />
                        {tab.uploaderPenName}
                      </p>
                    )
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {(ratingData.ratingCount > 20 || isAdmin) && (
                    <span className={`flex items-center gap-0.5 text-neutral-500 text-sm ${isAdmin && ratingData.ratingCount <= 20 ? 'line-through' : ''}`}>
                      <Star className="w-4 h-4 text-neutral-500 fill-neutral-500 flex-shrink-0" />
                      {ratingData.averageRating ? ratingData.averageRating.toFixed(1) : '0'}
                      <span className="text-sm text-neutral-500">({ratingData.ratingCount})</span>
                    </span>
                  )}
                  <span className="flex items-center gap-0.5 text-neutral-500 text-sm">
                    <Heart className="w-4 h-4 text-neutral-500 fill-neutral-500 flex-shrink-0" />
                    <Bookmark className="w-4 h-4 text-neutral-500 fill-neutral-500 flex-shrink-0" />
                    {(likesCount || 0) + (tab.playlistCount || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div ref={songMetaBottomSentinelRef} className="h-px w-full" aria-hidden />

        {/* 歌id section 與 譜section 之間分隔線 */}
        <div className="px-4">
          <div className={theme === 'night' ? 'border-b border-[#1a1a1a]' : 'border-b border-neutral-200'} />
        </div>

        {/* 譜section */}
        <TabContent 
          content={tab.content} 
          originalKey={tab.originalKey || 'C'}
          playKey={tab.playKey}
          initialKey={currentKey || tab.playKey || tab.originalKey}
          onKeyChange={setCurrentKey}
          fullWidth
          theme={theme}
          setTheme={setTheme}
          youtubeVideoId={tab.youtubeVideoId}
          arrangedBy={tab.uploaderPenName || '結他友'}
          uploaderId={uploaderProfileId}
          displayFont={tab.displayFont || 'mono'}
          songInfo={{
            songYear: tab.songYear,
            composer: tab.composer,
            lyricist: tab.lyricist,
            arranger: tab.arranger,
            producer: tab.producer,
            album: tab.album,
            remark: tab.remark,
          }}
          gpSegments={tab.gpSegments || []}
          gpTheme={tab.gpTheme || 'dark'}
          notationAlphaTex={tab.notationAlphaTex || ''}
          notationBlocks={
            Array.isArray(tab.notationBlocks) && tab.notationBlocks.length > 0 ? tab.notationBlocks : null
          }
          showInfo={showInfo}
          setShowInfo={toggleShowInfo}
          hideKeyRowAndBottomBar
          externalFontSize={tabPageFontSize}
          onFontSizeChange={setTabPageFontSize}
          externalIsAutoScroll={tabPageIsAutoScroll}
          onAutoScrollChange={setTabPageIsAutoScroll}
          externalScrollSpeed={tabPageScrollSpeed}
          onScrollSpeedChange={setTabPageScrollSpeed}
          externalHideNotation={tabPageHideNotation}
          onHideNotationChange={setTabPageHideNotation}
          externalHideTabStaff={tabPageHideTabStaff}
          onHideTabStaffChange={setTabPageHideTabStaff}
          scrollSmoothRef={pageWrapRef}
          onChordPress={handleChordPressFromTab}
        />

        {/* 星星評分 */}
        {tab && (
          <div className="mt-4">
            <RatingSystem 
              tabId={tab.id} 
              averageRating={ratingData.averageRating}
              ratingCount={ratingData.ratingCount}
              size="md"
              onRatingUpdate={(avg, count) => setRatingData({ averageRating: avg, ratingCount: count })}
            />
          </div>
        )}

        {/* 留言區 */}
        <div className="px-4">
          <TabComments tabId={id} />
        </div>

        {/* 更多 Action Sheet */}
        <SongActionSheet
          open={showMoreMenu}
          onClose={() => setShowMoreMenu(false)}
          title={tab.title}
          artist={artistDisplayName}
          thumbnailUrl={(() => {
            if (tab.coverImage) return tab.coverImage
            if (tab.albumImage) return tab.albumImage
            const videoId = tab.youtubeVideoId || tab.youtubeUrl?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1]
            if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
            if (tab.thumbnail) return tab.thumbnail
            return effectiveArtistPhoto
          })()}
          liked={menuTabLiked}
          likeLabel={menuTabLiked ? '取消喜愛' : '加到我最喜愛'}
          onCopyShareLink={() => { handleCopyShareLink(); setShowMoreMenu(false); }}
          onSelectLyricsShare={() => { router.push(`/tools/tab-share?tabId=${tab.id}`); setShowMoreMenu(false); }}
          onAddToLiked={() => { handleAddToLiked(); setShowMoreMenu(false); }}
          onAddToPlaylist={() => { handleAddToPlaylistClick(); setShowMoreMenu(false); }}
          onEdit={canEdit ? () => { router.push(`/tabs/${tab.id}/edit`); setShowMoreMenu(false); } : undefined}
          artistHref={mainArtistId ? `/artists/${mainArtistId}` : undefined}
        />

        {/* 自動消失 Toast（複製連結等） */}
        {toastMessage && (
          <div
            className="fixed bottom-24 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-sm z-[100] px-4 py-3 rounded-xl bg-[#282828] text-white text-center shadow-lg animate-fade-in"
            role="status"
            aria-live="polite"
          >
            {toastMessage}
          </div>
        )}

        {/* 加入歌單 Modal */}
        {showAddToPlaylist && (
          <>
            <div className="fixed inset-0 bg-black/60 z-[110]" onClick={() => {
                setShowAddToPlaylist(false);
                setShowCreatePlaylistInput(false);
                setNewPlaylistName('');
                setAddToPlaylistSelectedIds([]);
                setAddToPlaylistInitialIds([]);
              }} />
            <div className="fixed bottom-0 left-0 right-0 bg-[#121212] rounded-t-2xl z-[120] max-h-[70vh] overflow-y-auto" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
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

                {/* 創建新歌單按鈕（黃線框 + 黃 Plus，無 hover） */}
                <button
                  type="button"
                  onClick={() => setShowCreatePlaylistInput(true)}
                  className="w-full flex items-center space-x-3 pl-0 pr-3 py-1.5 hover:bg-[#1a1a1a] rounded-2xl text-left"
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
                          setShowCreatePlaylistInput(false);
                          setNewPlaylistName('');
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

        {showAlternateVersionsModal && alternateUploaderVersions.length > 0 && (
          <>
            <div
              className="fixed inset-0 bg-black/70 z-[2147483640]"
              onClick={() => setShowAlternateVersionsModal(false)}
              aria-hidden
            />
            <div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(100%-2rem,20rem)] max-h-[min(75vh,100%-2rem)] z-[2147483641] bg-[#121212] rounded-2xl border border-neutral-700 overflow-hidden flex flex-col shadow-xl"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="alternate-versions-title"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] shrink-0">
                <h3 id="alternate-versions-title" className="text-white font-bold text-base pr-2">其他版本</h3>
                <button
                  type="button"
                  onClick={() => setShowAlternateVersionsModal(false)}
                  className="p-2 text-neutral-400 hover:text-white rounded-lg shrink-0"
                  aria-label="關閉"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <ul className="overflow-y-auto px-2 py-2 space-y-1">
                {alternateUploaderVersions.map((row) => {
                  const pen = row.uploaderPenName?.trim() || '—'
                  return (
                    <li key={row.id}>
                      <Link
                        href={`/tabs/${row.id}`}
                        onClick={() => setShowAlternateVersionsModal(false)}
                        className="flex items-center gap-1.5 min-w-0 w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#1a1a1a] transition"
                      >
                        <span className="flex-1 min-w-0 truncate text-base font-bold text-white">{row.title || tab.title}</span>
                        <ChordLogPenIcon className="h-[18px] w-[18px] text-[#FFD700]" />
                        <span className="min-w-0 max-w-[42%] sm:max-w-[45%] truncate text-xs font-medium text-[#B3B3B3]">{pen}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </div>
      </div>
      {isClientMounted && showInfo && (tab?.youtubeVideoId || tab?.youtubeUrl || hasSongInfo) && createPortal(
        <div
          className="fixed left-0 right-0 z-[2000] pointer-events-none"
          style={{ top: topBarHeight }}
        >
          <div className="pointer-events-auto bg-[#111111] rounded-b-2xl shadow-xl overflow-hidden min-[600px]:max-w-[400px] min-[600px]:ml-auto">
            <div className="px-4 py-3">
              <div className="space-y-3">
                {videoId && (
                  <div className="aspect-video w-full rounded-lg overflow-hidden">
                    <iframe
                      ref={ytInfoIframeRef}
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&start=${infoStartTime}${infoAutoPlay ? '&autoplay=1' : ''}&playsinline=1`}
                      title="YouTube"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                )}
                {hasSongInfo && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] sm:text-xs text-neutral-400">
                    {tab.songYear && <span>年份：<span className="text-white">{tab.songYear}</span></span>}
                    {tab.album && <span>專輯：<span className="text-white">{tab.album}</span></span>}
                    {tab.composer && <span>作曲：<span className="text-white">{tab.composer}</span></span>}
                    {tab.lyricist && <span>填詞：<span className="text-white">{tab.lyricist}</span></span>}
                    {tab.arranger && <span>編曲：<span className="text-white">{tab.arranger}</span></span>}
                    {tab.producer && <span>監製：<span className="text-white">{tab.producer}</span></span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* 本曲和弦 sheet：必須喺 pageWrapRef 外，否則自動滾動嘅 transform 會令 fixed 相對錯位 */}
      <ChordDiagramBottomSheet
        chords={tabChords}
        leadChord={chordSheetLeadChord}
        isOpen={showChordDiagram}
        onClose={() => {
          setShowChordDiagram(false)
          setChordSheetLeadChord(null)
        }}
        theme={theme}
        onSheetHeightChange={handleChordSheetHeight}
      />
      {/* 浮動按鈕放喺 pageWrapRef 之外，避免 transform 影響 fixed 定位 */}
      {showFloatingControls && (
        <div className="fixed inset-0" style={{ zIndex: 29 }} onClick={() => setShowFloatingControls(false)} />
      )}
      <div
        className={`fixed right-4 md:right-6 flex flex-row items-end gap-2 transition-all duration-300 ease-out ${
          showChordDiagram && showFloatingControls
            ? 'z-[107]'
            : showChordDiagram
              ? 'z-[107] bottom-20 md:bottom-20'
              : 'z-30 bottom-20 md:bottom-20'
        }`}
        style={{
          /* 開和弦 panel 時唔加 paddingBottom：bottom 已計 nav+safe area，再 env(safe-area) 會喺手機頂高 FAB、空隙變好大；desktop 通常 safe-area=0 所以先覺得冇事 */
          paddingBottom: showChordDiagram ? 0 : 'env(safe-area-inset-bottom, 0)',
          /* 和弦 sheet：用實際量度高度 + 10px；未量度前先用 max 高度避免閃爍 */
          ...(showChordDiagram
            ? {
                bottom:
                  chordSheetHeightPx != null
                    ? `calc(4rem + min(env(safe-area-inset-bottom, 0px), 30px) + ${chordSheetHeightPx}px + 10px)`
                    : `calc(4rem + min(env(safe-area-inset-bottom, 0px), 30px) + ${CHORD_SHEET_MAX_HEIGHT} + 10px)`,
              }
            : {}),
        }}
      >
        {showFloatingControls && (
          <div
            className="rounded-2xl bg-[#1a1a1a] shadow-xl border border-neutral-700 shrink-0 w-[152px] px-0 py-3.5 md:w-[176px] md:px-0.5 md:py-4.5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="顯示設定"
          >
            <div className="space-y-2 md:space-y-3">
              <div className="space-y-3.5 md:space-y-4 pb-2 pl-1">
              {/* 字體大小：A − 16 +（手機版更緊湊） */}
              <div className="flex items-center justify-center gap-0.5 md:gap-1">
                <span className="w-6 md:w-7 shrink-0 flex items-center justify-center text-neutral-400">
                  <svg className="w-5 h-5 md:w-6 md:h-6" viewBox="0 0 37.47 45.21" fill="currentColor" stroke="currentColor" strokeWidth="2">
                    <path d="M37.36,43.14L20.12.93c-.23-.56-.78-.93-1.39-.93s-1.16.37-1.39.93L.11,43.14c-.31.77.05,1.64.82,1.96.77.32,1.64-.05,1.96-.82l8.24-20.17h15.22l8.24,20.17c.24.58.8.93,1.39.93.19,0,.38-.04.57-.11.77-.31,1.13-1.19.82-1.96ZM12.35,21.11l6.38-15.64,6.38,15.64h-12.77Z"/>
                  </svg>
                </span>
                <div className="flex items-center gap-0.5 translate-y-0.5 ml-1.5 md:ml-2">
                  <button
                    type="button"
                    onClick={() => setTabPageFontSize(Math.max(12, tabPageFontSize - 1))}
                    className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center text-neutral-400 hover:text-white transition text-lg md:text-xl"
                  >−</button>
                  <span className="text-[#FFD700] text-lg md:text-xl font-medium min-w-[1.25rem] md:min-w-[1.5rem] text-center tabular-nums">{tabPageFontSize}</span>
                  <button
                    type="button"
                    onClick={() => setTabPageFontSize(Math.min(24, tabPageFontSize + 1))}
                    className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center text-neutral-400 hover:text-white transition text-lg md:text-xl"
                  >+</button>
                </div>
              </div>

              {/* 自動滾動速度：↓ − 2 + */}
              <div className="flex items-center justify-center gap-0.5 md:gap-1">
                <button
                  type="button"
                  onClick={() => setTabPageIsAutoScroll(!tabPageIsAutoScroll)}
                  className={`w-6 md:w-7 shrink-0 flex items-center justify-center transition ${tabPageIsAutoScroll ? 'text-[#FFD700]' : 'text-neutral-400'}`}
                  title={tabPageIsAutoScroll ? '關閉自動滾動' : '開啟自動滾動'}
                >
                  <svg className="w-7 h-7 md:w-8 md:h-8" viewBox="0 0 35.38 47.33" fill="currentColor" stroke="none">
                    <path d="M21.9,23.81l-.02-8.2c0-.78-.55-1.37-1.26-1.41-.68-.04-1.44.51-1.44,1.32l-.02,5.55c0,.76-.7,1.27-1.38,1.24-.61-.03-1.29-.54-1.29-1.33V4.15c0-.83-.54-1.42-1.3-1.44s-1.38.56-1.38,1.45v24.9c0,.84-.68,1.35-1.32,1.37-.86.02-1.38-.63-1.38-1.48v-1.87c0-.81-.67-1.37-1.34-1.37-.84,0-1.38.65-1.37,1.51l.04,5.18c.04,4.77,3.59,9.65,7.34,12.4.64.47.97,1.2.47,1.97-.35.53-1.26.83-1.95.32-4.67-3.41-8.36-8.72-8.59-14.7l.03-5.59c.01-2.66,2.7-4.37,5.36-3.63l.07-19.57C11.15,1.49,13.19.04,15.05,0c1.99-.05,4.04,1.44,4.06,3.55l.09,8.11c2.35-.69,4.56.54,5.25,2.79,1.26-.45,2.51-.33,3.67.36.93.55,1.58,1.74,1.89,2.89,1.19-.2,2.62-.25,3.75.65.89.71,1.64,1.86,1.64,3.21v4.85c-.02,5.64-.7,16.41-5.04,20.46-.61.57-1.5.58-2.01,0-.58-.65-.4-1.49.24-2.08,2.55-2.38,3.49-8.8,3.82-12.21.34-3.58.29-7.08.29-10.68,0-.83-.34-1.52-1.16-1.63-.75-.1-1.53.44-1.53,1.33v3.3c0,.84-.59,1.45-1.34,1.44-.8,0-1.36-.6-1.36-1.44v-6.73c0-.77-.73-1.29-1.35-1.28-.67,0-1.34.52-1.35,1.29l-.03,5.58c0,.7-.64,1.19-1.25,1.24-.53.05-1.41-.41-1.41-1.21Z"/>
                    <path d="M5.07,21.53c-.6.6-1.45.61-2.02.04l-2.71-2.73c-.56-.57-.39-1.49.12-1.9.68-.56,1.41-.37,2.22.34V1.5c0-.83.48-1.42,1.22-1.49s1.49.46,1.49,1.35v16c.62-.72,1.45-1,2.14-.49s.73,1.47.07,2.13l-2.54,2.54Z"/>
                  </svg>
                </button>
                <div className="flex items-center gap-0.5 translate-y-0.5 ml-1.5 md:ml-2">
                  <button
                    type="button"
                    onClick={() => { setTabPageScrollSpeed(Math.max(1, tabPageScrollSpeed - 1)); if (!tabPageIsAutoScroll) setTabPageIsAutoScroll(true); }}
                    className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center text-neutral-400 hover:text-white transition text-lg md:text-xl"
                  >−</button>
                  <span className="text-[#FFD700] text-lg md:text-xl font-medium min-w-[1.25rem] md:min-w-[1.5rem] text-center tabular-nums">{tabPageScrollSpeed}</span>
                  <button
                    type="button"
                    onClick={() => { setTabPageScrollSpeed(Math.min(5, tabPageScrollSpeed + 1)); if (!tabPageIsAutoScroll) setTabPageIsAutoScroll(true); }}
                    className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center text-neutral-400 hover:text-white transition text-lg md:text-xl"
                  >+</button>
                </div>
              </div>
              </div>

              {/* 分隔線（縮短長度、置中） */}
              <div className="mx-auto w-[75%] md:w-[86%] border-b border-neutral-600 max-md:my-0" />

              {/* 底部圓形按鈕：日/夜 → 六線譜 → 簡譜 */}
              <div className="flex items-center justify-center gap-1.5 md:gap-2 flex-wrap">
                <button
                  onClick={() => setTheme(theme === 'night' ? 'day' : 'night')}
                  className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center shrink-0 transition ${theme === 'night' ? 'bg-neutral-700 text-neutral-400 hover:bg-neutral-600 hover:text-white' : 'bg-[#FFD700] text-black'}`}
                  title={theme === 'night' ? '日間模式' : '夜間模式'}
                >
                  {theme === 'night' ? (
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setTabPageHideTabStaff(!tabPageHideTabStaff)}
                  className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center shrink-0 transition ${tabPageHideTabStaff ? 'bg-neutral-700 text-neutral-400 hover:bg-neutral-600 hover:text-white' : 'bg-[#FFD700] text-black'}`}
                  title={tabPageHideTabStaff ? '顯示六線譜' : '隱藏六線譜'}
                  aria-label={tabPageHideTabStaff ? '顯示六線譜' : '隱藏六線譜'}
                >
                  {tabPageHideTabStaff ? (
                    <svg className="w-5 h-5 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                      <path d="M3 5h18M3 8h18M3 11h18M3 14h18M3 17h18M3 20h18" />
                      <path d="M4 4l16 16" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                      <path d="M3 5h18M3 8h18M3 11h18M3 14h18M3 17h18M3 20h18" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => setTabPageHideNotation(!tabPageHideNotation)}
                  className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center shrink-0 transition ${tabPageHideNotation ? 'bg-neutral-700 text-neutral-400 hover:bg-neutral-600' : 'bg-[#FFD700] text-black'}`}
                  title={tabPageHideNotation ? '顯示簡譜' : '隱藏簡譜'}
                >
                  {tabPageHideNotation ? (
                    <svg className="w-[2.125rem] h-[2.125rem] shrink-0" viewBox="0 0 35.54 35.54" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                      <path fill="currentColor" d="M11.87,14.35l-.73-.73h-.58c0,.41-.07.76-.2,1.06-.14.29-.31.53-.53.73-.21.19-.46.34-.73.43-.27.1-.55.15-.84.15v1.31c.27,0,.52-.03.78-.08.25-.06.48-.14.68-.25.21-.11.38-.24.53-.41.15-.16.25-.34.31-.55v4.71h-1.34v1.18h3.98v-1.18h-1.33v-6.37Z" />
                      <polygon fill="currentColor" points="16.62 20.72 17.45 19.93 16.58 19.06 14.91 20.67 14.91 21.9 19.42 21.9 18.24 20.72 16.62 20.72" />
                      <path fill="currentColor" d="M17.69,14.66c.16,0,.33.02.49.07.17.04.31.11.44.21.13.1.24.23.32.39.08.15.12.34.12.56,0,.18-.03.37-.12.57l.94.94c.07-.11.13-.21.19-.32.21-.41.31-.81.31-1.19s-.07-.74-.22-1.05c-.14-.3-.34-.55-.59-.75s-.53-.35-.86-.45c-.32-.11-.66-.16-1.02-.16-.56,0-1.04.09-1.44.29l.95.95c.15-.04.31-.06.49-.06Z" />
                      <path fill="currentColor" d="M27.15,18.92c-.07-.23-.19-.44-.34-.63-.15-.19-.34-.34-.56-.46-.22-.13-.47-.2-.76-.22.25-.02.48-.08.68-.18.21-.1.38-.23.52-.39.13-.16.24-.35.31-.55.08-.21.11-.43.11-.66,0-.37-.06-.7-.19-.98-.13-.29-.31-.54-.54-.74-.23-.2-.5-.36-.81-.47-.3-.11-.63-.16-.99-.16-.43,0-.82.06-1.17.19-.35.12-.65.31-.9.56-.25.24-.44.55-.58.92s-.21.79-.21,1.28h1.25c0-.62.14-1.07.41-1.35.28-.28.68-.42,1.2-.42.4,0,.7.11.91.32.21.22.31.5.31.84,0,.21-.05.39-.16.55-.1.15-.24.29-.42.4-.19.11-.4.19-.64.25-.25.05-.51.08-.79.08v1.18c.8,0,1.36.1,1.69.32.32.21.48.56.48,1.06,0,.36-.13.66-.38.88-.25.22-.58.33-1,.33-.49,0-.9-.16-1.21-.47-.31-.32-.49-.75-.54-1.3l-1.07.18 2.77 2.77h.05c.36,0,.7-.06,1.02-.17.32-.12.61-.28.86-.48.24-.21.44-.46.59-.75.15-.3.22-.63.22-.99,0-.25-.04-.5-.12-.74Z" />
                      <path fill="currentColor" d="M19.18,18.26l-.87-.87-2.04-2.04-.9-.9-3.71-3.71c-.25-.25-.67-.25-.92,0s-.25.66,0,.92l4.1,4.1.71.71,1.83,1.83.86.86.81.81,1.19,1.19,3.63,3.63c.13.13.29.19.46.19s.33-.06.46-.19c.25-.26.25-.67,0-.92l-5.61-5.61Z" />
                    </svg>
                  ) : (
                    <svg className="w-[2.125rem] h-[2.125rem] shrink-0" viewBox="0 0 35.54 35.54" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                      <path fill="currentColor" d="M13.2,21.91h-3.97v-1.18h1.33v-4.71c-.06.21-.16.39-.31.55-.15.16-.32.3-.53.4-.21.11-.43.19-.69.25-.25.06-.51.09-.78.09v-1.31c.29,0,.57-.05.84-.14.27-.1.52-.24.73-.44s.39-.44.52-.73c.13-.29.2-.65.2-1.06h1.31v7.1h1.33v1.18Z" />
                      <path fill="currentColor" d="M20.38,15.89c0,.39-.1.79-.31,1.19s-.49.79-.86,1.16l-2.59,2.49h2.43v-1.14h1.19v2.32h-5.33v-1.24l3.33-3.19c.29-.3.5-.57.62-.83.13-.26.19-.51.19-.75,0-.22-.04-.4-.12-.56s-.19-.28-.32-.38c-.13-.1-.28-.17-.44-.22-.17-.04-.33-.07-.49-.07-.52,0-.93.15-1.23.46s-.45.76-.45,1.35h-1.23c0-.94.25-1.67.75-2.2s1.22-.79,2.16-.79c.36,0,.7.05,1.02.16.33.1.61.25.86.45.25.2.44.45.59.76.15.3.22.65.22,1.04Z" />
                      <path fill="currentColor" d="M27.27,19.66c0,.36-.07.69-.22.99-.15.29-.35.54-.59.75-.25.21-.53.37-.86.48-.32.11-.66.17-1.02.17-.4,0-.78-.05-1.12-.16s-.65-.27-.91-.49c-.26-.22-.48-.5-.64-.85s-.26-.76-.3-1.24l1.23-.2c.04.55.22.98.53,1.29.31.32.72.47,1.21.47.42,0,.75-.11,1-.33.25-.22.38-.51.38-.88,0-.5-.16-.85-.48-1.06-.32-.21-.88-.32-1.69-.32v-1.18c.28,0,.55-.03.79-.08s.46-.14.64-.25c.18-.11.33-.24.43-.4s.16-.34.16-.54c0-.35-.1-.63-.31-.84-.21-.21-.51-.32-.91-.32-.52,0-.92.14-1.2.42-.28.28-.42.73-.42,1.35h-1.25c0-.49.07-.91.21-1.28s.33-.68.58-.92c.25-.25.55-.43.9-.56.35-.12.74-.19,1.17-.19.36,0,.69.05.99.16.31.11.58.26.81.47s.41.45.54.74c.13.29.19.61.19.98,0,.23-.04.45-.11.66-.07.21-.18.39-.32.55s-.31.29-.51.39-.43.16-.68.17c.29.03.54.1.76.22.22.12.41.28.56.46s.27.4.35.63.12.48.12.74Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col items-end gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setTabPageIsAutoScroll(!tabPageIsAutoScroll)}
              className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition opacity-60 hover:opacity-100 focus:opacity-100 ${tabPageIsAutoScroll ? 'bg-[#FFD700] text-black hover:bg-yellow-400' : 'bg-neutral-800 border border-neutral-600 text-neutral-400 hover:bg-neutral-700 hover:text-white'}`}
              title={tabPageIsAutoScroll ? '關閉自動滾動' : '開啟自動滾動'}
              aria-label={tabPageIsAutoScroll ? '關閉自動滾動' : '開啟自動滾動'}
            >
              {tabPageIsAutoScroll ? (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="7" y="5" width="3" height="14" rx="1" />
                  <rect x="14" y="5" width="3" height="14" rx="1" />
                </svg>
              ) : (
                <svg className="w-7 h-7" viewBox="0 0 35.38 47.33" fill="currentColor" stroke="none">
                  <path d="M21.9,23.81l-.02-8.2c0-.78-.55-1.37-1.26-1.41-.68-.04-1.44.51-1.44,1.32l-.02,5.55c0,.76-.7,1.27-1.38,1.24-.61-.03-1.29-.54-1.29-1.33V4.15c0-.83-.54-1.42-1.3-1.44s-1.38.56-1.38,1.45v24.9c0,.84-.68,1.35-1.32,1.37-.86.02-1.38-.63-1.38-1.48v-1.87c0-.81-.67-1.37-1.34-1.37-.84,0-1.38.65-1.37,1.51l.04,5.18c.04,4.77,3.59,9.65,7.34,12.4.64.47.97,1.2.47,1.97-.35.53-1.26.83-1.95.32-4.67-3.41-8.36-8.72-8.59-14.7l.03-5.59c.01-2.66,2.7-4.37,5.36-3.63l.07-19.57C11.15,1.49,13.19.04,15.05,0c1.99-.05,4.04,1.44,4.06,3.55l.09,8.11c2.35-.69,4.56.54,5.25,2.79,1.26-.45,2.51-.33,3.67.36.93.55,1.58,1.74,1.89,2.89,1.19-.2,2.62-.25,3.75.65.89.71,1.64,1.86,1.64,3.21v4.85c-.02,5.64-.7,16.41-5.04,20.46-.61.57-1.5.58-2.01,0-.58-.65-.4-1.49.24-2.08,2.55-2.38,3.49-8.8,3.82-12.21.34-3.58.29-7.08.29-10.68,0-.83-.34-1.52-1.16-1.63-.75-.1-1.53.44-1.53,1.33v3.3c0,.84-.59,1.45-1.34,1.44-.8,0-1.36-.6-1.36-1.44v-6.73c0-.77-.73-1.29-1.35-1.28-.67,0-1.34.52-1.35,1.29l-.03,5.58c0,.7-.64,1.19-1.25,1.24-.53.05-1.41-.41-1.41-1.21Z"/>
                  <path d="M5.07,21.53c-.6.6-1.45.61-2.02.04l-2.71-2.73c-.56-.57-.39-1.49.12-1.9.68-.56,1.41-.37,2.22.34V1.5c0-.83.48-1.42,1.22-1.49s1.49.46,1.49,1.35v16c.62-.72,1.45-1,2.14-.49s.73,1.47.07,2.13l-2.54,2.54Z"/>
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowChordDiagram((wasOpen) => {
                  if (wasOpen) {
                    setChordSheetLeadChord(null)
                    return false
                  }
                  setChordSheetLeadChord(null)
                  return true
                })
              }}
              className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition opacity-60 hover:opacity-100 focus:opacity-100 ${showChordDiagram ? 'bg-[#FFD700] text-black hover:bg-yellow-400' : 'bg-neutral-800 border border-neutral-600 text-neutral-400 hover:bg-neutral-700 hover:text-white'}`}
              title={showChordDiagram ? '關閉本曲和弦' : '本曲使用和弦'}
              aria-label={showChordDiagram ? '關閉本曲和弦' : '本曲使用和弦'}
            >
              <svg className="w-14 h-14 shrink-0" viewBox="0 0 35.54 35.54" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <g>
                  <rect x="11.28" y="9.78" width="12.97" height="16.08" fill="none" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                  <rect x="11.28" y="9.78" width="12.97" height="1.21" fill="currentColor" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                  <line x1="11.28" y1="16" x2="24.26" y2="16" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                  <line x1="21.66" y1="9.52" x2="21.66" y2="26.02" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                  <line x1="19.07" y1="9.52" x2="19.07" y2="26.02" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                  <line x1="16.47" y1="9.52" x2="16.47" y2="26.02" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                  <line x1="13.88" y1="9.52" x2="13.88" y2="26.02" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                  <line x1="11.28" y1="21.02" x2="24.26" y2="21.02" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                </g>
                <circle cx="21.66" cy="13.68" r="0.52" fill="currentColor" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                <circle cx="16.47" cy="18.53" r="0.52" fill="currentColor" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
                <circle cx="13.88" cy="23.45" r="0.52" fill="currentColor" stroke="currentColor" strokeWidth={0.7} strokeMiterlimit={10} />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setShowFloatingControls((v) => !v)}
              className={`w-14 h-14 rounded-full bg-[#FFD700] text-black shadow-lg flex items-center justify-center hover:bg-yellow-400 transition opacity-60 hover:opacity-100 focus:opacity-100 ${showFloatingControls ? 'ring-2 ring-white/50' : ''}`}
              title={showFloatingControls ? '收合顯示設定' : '顯示設定'}
              aria-label={showFloatingControls ? '收合顯示設定' : '展開顯示設定'}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
        </div>
      </div>
      <div ref={ytContainerRef} className="fixed -left-full top-0 w-px h-px overflow-hidden pointer-events-none" aria-hidden="true" />
    </Layout>
    </>
  )
}

export async function getStaticPaths() {
  return { paths: [], fallback: true }
}

export async function getStaticProps({ params }) {
  const id = params?.id
  if (!id) return { notFound: true }
  try {
    const { getTab } = await import('@/lib/tabs')
    const data = await getTab(id, { skipCache: true })
    if (!data) return { notFound: true }
    if (!data.youtubeVideoId && data.youtubeUrl) {
      const m = data.youtubeUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)
      if (m) data.youtubeVideoId = m[1]
    }
    let artist = null
    const { getTabArtistId: getTabArtistIdStatic } = await import('@/lib/tabs')
    const mainId = getTabArtistIdStatic(data)
    if (mainId) {
      try {
        const { getSearchDataCached } = await import('@/lib/searchData')
        const payload = await getSearchDataCached()
        const allArtists = payload?.artists || []
        let found = allArtists.find(a => a.id === mainId)
        if (!found) {
          const searchTabs = payload?.tabs || []
          const resolved = searchTabs.find(t => t.id === id)
          const resolvedId = resolved && getTabArtistIdStatic(resolved)
          if (resolvedId) found = allArtists.find(a => a.id === resolvedId)
        }
        if (found) {
          artist = { id: found.id, name: found.name }
          if (!data.artistPhoto && !data.coverImage && !data.albumImage && !data.thumbnail && found.photo) {
            data.artistPhoto = found.photo
          }
        }
      } catch (_) {}
    }
    return { props: { initialTab: serializeTab(data), artist }, revalidate: 300 }
  } catch (e) {
    console.error('[tabs/[id]] getStaticProps:', e?.message)
    return { notFound: true }
  }
}
