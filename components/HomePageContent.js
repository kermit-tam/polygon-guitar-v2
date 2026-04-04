import { useState, useEffect, useRef, useContext } from 'react'
import { useRouter } from 'next/router'
import { getTabsByIds, getArtistSlug } from '@/lib/tabs'
import { useAuth } from '@/contexts/AuthContext'
import Link from '@/components/Link'
import Head from 'next/head'
import { siteConfig, generateBreadcrumbSchema } from '@/lib/seo'
import RecentItems from '@/components/RecentItems'
import { SongCard, PlaylistCard, ArtistAvatar } from '@/components/LazyImage'
import SectionViewportLoader from '@/components/SectionViewportLoader'
import { HomeSectionImageContext } from '@/components/HomeSectionImageContext'
import { useArtistMap, resolveHomeSongArtistLine } from '@/lib/useArtistMap'
import { Music } from 'lucide-react'

/**
 * SongCard `song` 輸入（首頁各區）— 歌手行一律經 resolveHomeSongArtistLine(song, artistMap)：
 *
 * 1) 熱門結他譜 hotTabs、最新上架 latestSongs、自訂歌單歌曲 customPlaylistSongs
 *    來自 API / slimTabForHome：{ id, title, artistId, artist?, artistIds?, artists?,
 *    coverImage?, artistPhoto?, thumbnail?, youtubeUrl? }
 *    多歌手時有 artistIds + artists[].role（feat →「 feat. 」否則「 / 」）。
 *
 * 2) 最近瀏覽 tab 列（RecentItems，非 SongCard 但同一 resolver）
 *    localStorage recentViews：{ type:'tab', id, title, artistIds, artists?, thumbnail? }
 *    舊紀錄或可有 artistId / artist / artistName。
 */

// 1-hour local cache for home payload (cache/homePage snapshot) — reload reads from here
const HOMEPAGE_LOCAL_CACHE_KEY = 'pg_home_cache_v2'
const HOMEPAGE_LOCAL_CACHE_TTL_MS = 45 * 1000 // 45s — changes visible within 1 min

function getHomeDataFromLocalCache() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(HOMEPAGE_LOCAL_CACHE_KEY)
    if (!raw) return null
    const { data, _ts } = JSON.parse(raw)
    if (!data || !_ts || Date.now() - _ts > HOMEPAGE_LOCAL_CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function setHomeDataToLocalCache(data) {
  if (typeof window === 'undefined' || !data) return
  try {
    localStorage.setItem(HOMEPAGE_LOCAL_CACHE_KEY, JSON.stringify({ data, _ts: Date.now() }))
  } catch (e) {
    try {
      localStorage.removeItem(HOMEPAGE_LOCAL_CACHE_KEY)
      localStorage.setItem(HOMEPAGE_LOCAL_CACHE_KEY, JSON.stringify({ data, _ts: Date.now() }))
    } catch (_) {}
  }
}

// 歌手分類預設資料（image starts null; real images come from Firestore/cache）
const DEFAULT_CATEGORIES = [
  {
    id: 'male',
    name: '男歌手',
    image: null,
    color: 'from-blue-900/80 to-black/80'
  },
  {
    id: 'female',
    name: '女歌手',
    image: null,
    color: 'from-pink-900/80 to-black/80'
  },
  {
    id: 'group',
    name: '組合',
    image: null,
    color: 'from-purple-900/80 to-black/80'
  }
]

const DEFAULT_SECTION_ORDER = [
  { id: 'categories', enabled: true },
  { id: 'recent', enabled: true },
  { id: 'hotTabs', enabled: true },
  { id: 'hotArtists', enabled: true },
  { id: 'autoPlaylists', enabled: true },
  { id: 'latest', enabled: true },
  { id: 'manualPlaylists', enabled: true }
]

// Initial state: always same on server and client to avoid hydration mismatch (no cache here).
function getInitialHomeState() {
  const defaultHotArtists = { male: [], female: [], group: [], all: [] }
  return {
    artists: [],
    latestSongs: [],
    hotTabs: [],
    allSongs: [],
    hotArtists: defaultHotArtists,
    autoPlaylists: [],
    manualPlaylists: [],
    categories: DEFAULT_CATEGORIES,
    homeSettings: {
      manualSelection: { male: [], female: [], group: [] },
      useManualSelection: { male: false, female: false, group: false },
      hotArtistSortBy: 'tier',
      displayCount: 20,
      sectionOrder: DEFAULT_SECTION_ORDER
    },
    recentItems: []
  }
}

const _initialHomeState = getInitialHomeState()

// 裁剪維基百科圖片URL（顯示頭部區域）
function getCroppedWikiImage(url) {
  if (!url) return url
  
  // 維基百科圖片通過添加參數來裁剪
  // /thumb/ 路徑的圖片可以修改尺寸
  if (url.includes('/thumb/')) {
    // 將現有尺寸改為正方形頭像尺寸（例如 200x200）
    // 維基圖片格式: .../thumb/.../檔名/寬度px-檔名
    // 改為: .../thumb/.../檔名/200px-檔名
    return url.replace(/\/\d+px-/, '/200px-')
  }
  
  return url
}

// 靜態備用自動歌單（當 Firestore 冇數據時使用）
const FALLBACK_AUTO_PLAYLISTS = [
  {
    id: 'trending',
    title: '24小時熱門',
    source: 'auto',
    coverImage: null,
    songIds: []
  },
  {
    id: 'weekly',
    title: '7日熱門',
    source: 'auto',
    coverImage: null,
    songIds: []
  },
  {
    id: 'monthly',
    title: '本月熱門',
    source: 'auto',
    coverImage: null,
    songIds: []
  },
  {
    id: 'last-month',
    title: '上月熱門',
    source: 'auto',
    coverImage: null,
    songIds: []
  },
  {
    id: '2025',
    title: '2025年熱門',
    source: 'auto',
    coverImage: null,
    songIds: []
  },
  {
    id: '2024',
    title: '2024年熱門',
    source: 'auto',
    coverImage: null,
    songIds: []
  }
]

// 靜態備用手動歌單
const FALLBACK_MANUAL_PLAYLISTS = [
  {
    id: 'featured-1',
    title: '陳奕迅結他精選',
    description: '香港樂壇天王的經典結他譜',
    source: 'manual',
    manualType: 'artist',
    curatedBy: 'Polygon',
    coverImage: null,
    songIds: []
  },
  {
    id: 'featured-2',
    title: '夭心夭肺 Vol.1',
    description: '慘情歌系列精選',
    source: 'manual',
    manualType: 'series',
    curatedBy: 'Polygon',
    coverImage: null,
    songIds: []
  },
  {
    id: 'featured-3',
    title: '新手入門系列',
    description: '適合初學者的簡單譜',
    source: 'manual',
    manualType: 'theme',
    curatedBy: 'Polygon',
    coverImage: null,
    songIds: []
  }
]

// 自訂歌單區域 — 有 preloadedSongs 即用（SSR/API 已載），否則一次過 fetch 再顯示
function CustomPlaylistSection({ title, songIds, onSongClick, preloadedSongs, artistMap }) {
  const [songs, setSongs] = useState(() => (Array.isArray(preloadedSongs) && preloadedSongs.length > 0 ? preloadedSongs : []))
  const [loading, setLoading] = useState(() => !(Array.isArray(preloadedSongs) && preloadedSongs.length > 0))

  useEffect(() => {
    if (Array.isArray(preloadedSongs) && preloadedSongs.length > 0) {
      setSongs(preloadedSongs)
      setLoading(false)
      return
    }
    if (!songIds?.length) {
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    getTabsByIds(songIds).then(fetched => {
      if (cancelled) return
      const byId = new Map(fetched.map(t => [t.id, t]))
      const ordered = songIds.map(id => byId.get(id)).filter(Boolean)
      setSongs(ordered)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [songIds?.join(','), preloadedSongs])

  const count = songIds?.length ?? songs.length ?? 0
  const showSkeleton = loading && count > 0

  return (
    <section className="mb-[23px] md:mb-[25px]">
      <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{title}</h2>
      <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
        {showSkeleton ? (
          [...Array(Math.min(count, 12))].map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
              <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
              <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse mb-1" />
              <div className="h-3 bg-neutral-800 rounded w-1/2 animate-pulse" />
            </div>
          ))
        ) : (
          songs.map((song) => (
            <SongCard
              key={song.id}
              song={{ ...song, artist: resolveHomeSongArtistLine(song, artistMap) }}
              artistPhoto={song.artistPhoto}
              href={`/tabs/${song.slug ?? song.id}`}
              compact
            />
          ))
        )}
      </div>
    </section>
  )
}

// 時間格式化
const formatTimeAgo = (timestamp) => {
  if (!timestamp) return ''
  
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  const now = new Date()
  const diff = Math.floor((now - date) / 1000)
  
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  return date.toLocaleDateString('zh-HK')
}

// 用於延遲加載非可視區域的 Hook
function useLazySection(sectionId, isEnabled = true) {
  const [isVisible, setIsVisible] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!isEnabled || hasLoaded) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          setHasLoaded(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100px' } // 提前 100px 開始加載
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [isEnabled, hasLoaded])

  return { ref, isVisible, hasLoaded }
}

function mergeInitialHomeSettings(initialHomeSettings = {}) {
  const sectionOrder = Array.isArray(initialHomeSettings.sectionOrder) && initialHomeSettings.sectionOrder.length > 0
    ? initialHomeSettings.sectionOrder
    : DEFAULT_SECTION_ORDER
  const customPlaylistSections = Array.isArray(initialHomeSettings.customPlaylistSections)
    ? initialHomeSettings.customPlaylistSections
    : []
  return {
    manualSelection: _initialHomeState.homeSettings.manualSelection,
    useManualSelection: _initialHomeState.homeSettings.useManualSelection,
    hotArtistSortBy: 'tier',
    displayCount: 20,
    sectionOrder,
    customPlaylistSections,
    ...initialHomeSettings,
    sectionOrder,
    customPlaylistSections
  }
}

// Category card that respects viewport image loading (used inside SectionViewportLoader) — 32vw to match 最近瀏覽
function HomeCategoryCard({ category, hotArtists }) {
  const loadImages = useContext(HomeSectionImageContext)
  const showImage = loadImages && category.image
  return (
    <Link
      href={`/artists?category=${category.id}`}
      className="flex-shrink-0 flex flex-col cursor-pointer w-[32vw] md:w-36"
    >
      <div className="relative w-[32vw] md:w-36 h-[32vw] md:h-36 rounded-[4px] overflow-hidden bg-neutral-800">
        {showImage ? (
          <img
            src={category.image}
            alt={category.name}
            className="absolute inset-0 w-full h-full object-cover object-top pointer-events-none"
            loading="lazy"
            decoding="async"
          />
        ) : category.image ? (
          <>
            <div className="absolute inset-0 bg-neutral-800 animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Music className="w-6 h-6 opacity-50 text-neutral-400" strokeWidth={1.5} />
            </div>
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-neutral-800 animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Music className="w-6 h-6 opacity-50 text-neutral-400" strokeWidth={1.5} />
            </div>
          </>
        )}
        <div className="absolute bottom-2 right-0">
          <span className={`text-black text-[106%] font-bold px-2 py-[0.2px] rounded-none block text-center whitespace-nowrap leading-tight tracking-[0.1em] ${
            category.id === 'male' ? 'bg-[#1fc3df]' :
            category.id === 'female' ? 'bg-[#ff9b98]' :
            'bg-[#fed702]'
          }`}>
            {category.name}
          </span>
        </div>
      </div>
      <div className="w-[32vw] md:w-36 mt-2 px-1">
        <p className="text-xs text-neutral-400 text-left line-clamp-2" style={{ lineHeight: 1.3 }}>
          {hotArtists[category.id]?.slice(0, 5).map(a => a.name).join(' · ')}
        </p>
      </div>
    </Link>
  )
}

function getInitialStateFromHomeData(initialHomeData) {
  if (!initialHomeData) return null
  return {
    hotTabs: initialHomeData.hotTabs || _initialHomeState.hotTabs,
    latestSongs: initialHomeData.latestSongs || _initialHomeState.latestSongs,
    allSongs: initialHomeData.allSongs || _initialHomeState.allSongs,
    hotArtists: initialHomeData.hotArtists || _initialHomeState.hotArtists,
    autoPlaylists: initialHomeData.autoPlaylists?.length ? initialHomeData.autoPlaylists : _initialHomeState.autoPlaylists,
    manualPlaylists: initialHomeData.manualPlaylists?.length ? initialHomeData.manualPlaylists : _initialHomeState.manualPlaylists,
    categories: initialHomeData.categories?.length ? initialHomeData.categories : _initialHomeState.categories,
    customPlaylistSongs: initialHomeData.customPlaylistSongs || {}
  }
}

export default function HomePageContent({ initialHomeSettings = {}, initialHomeData = null }) {
  const router = useRouter()
  const { user, isAdmin } = useAuth()
  const { artistMap } = useArtistMap()
  const fromServer = getInitialStateFromHomeData(initialHomeData)
  const [artists, setArtists] = useState(_initialHomeState.artists)
  const [latestSongs, setLatestSongs] = useState(fromServer?.latestSongs ?? _initialHomeState.latestSongs)
  const [hotTabs, setHotTabs] = useState(fromServer?.hotTabs ?? _initialHomeState.hotTabs)
  const [allSongs, setAllSongs] = useState(fromServer?.allSongs ?? _initialHomeState.allSongs)
  const [hotArtists, setHotArtists] = useState(fromServer?.hotArtists ?? _initialHomeState.hotArtists)
  const [autoPlaylists, setAutoPlaylists] = useState(fromServer?.autoPlaylists ?? _initialHomeState.autoPlaylists)
  const [manualPlaylists, setManualPlaylists] = useState(fromServer?.manualPlaylists ?? _initialHomeState.manualPlaylists)
  const [categories, setCategories] = useState(fromServer?.categories ?? _initialHomeState.categories)
  const [homeSettings, setHomeSettings] = useState(() => mergeInitialHomeSettings(initialHomeSettings))
  const [customPlaylistSongs, setCustomPlaylistSongs] = useState(() => fromServer?.customPlaylistSongs ?? {})
  const [recentItems, setRecentItems] = useState([])
  const [hasSectionData, setHasSectionData] = useState(!!fromServer)

  // Freeze layout only when we have section data from the server (not the client-side default), so home-settings sections show after fetch
  const layoutFrozenRef = useRef(null)
  const hasServerSectionData = initialHomeData?.homeSettings?.sectionOrder?.length || initialHomeData?.homeSettings?.customPlaylistSections?.length
  if (layoutFrozenRef.current === null && hasServerSectionData) {
    layoutFrozenRef.current = {
      sectionOrder: initialHomeData.homeSettings.sectionOrder || DEFAULT_SECTION_ORDER,
      customPlaylistSections: initialHomeData.homeSettings.customPlaylistSections || []
    }
  }
  const frozenLayout = layoutFrozenRef.current

  // 渲染單個區域；customPlaylistSectionsForRender 可傳入凍結的 list，避免 layout 跳動
  const renderSection = (section, customPlaylistSectionsForRender) => {
    const customSections = customPlaylistSectionsForRender ?? (homeSettings.customPlaylistSections || [])
    const sectionLabels = {
      categories: '歌手分類',
      recent: '最近瀏覽',
      hotTabs: '熱門結他譜',
      hotArtists: '熱門歌手',
      autoPlaylists: '熱門歌單',
      latest: '最新上架',
      manualPlaylists: '推薦歌單'
    }
    
    const getSectionLabel = (section) => {
      return section.customLabel || sectionLabels[section.id] || section.id
    }
    
    switch (section.id) {
      case 'categories':
        if (!hasSectionData) {
          return (
            <section key={section.id} className="pt-2 mb-[23px] md:mb-[25px]">
              <div className="flex overflow-x-auto scrollbar-hide pr-6 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex-shrink-0 flex flex-col w-[32vw] md:w-36">
                    <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 rounded-[4px] overflow-hidden bg-neutral-800 animate-pulse" />
                    <div className="w-[32vw] md:w-36 mt-2 h-3 bg-neutral-800 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </section>
          )
        }
        return (
          <SectionViewportLoader key={section.id}>
            <section className="pt-2 mb-[23px] md:mb-[25px]">
              <div className="flex overflow-x-auto scrollbar-hide pr-6 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {categories.map((category) => (
                  <HomeCategoryCard key={category.id} category={category} hotArtists={hotArtists} />
                ))}
              </div>
            </section>
          </SectionViewportLoader>
        )

      case 'recent':
        if (recentItems.length === 0) return null
        return <RecentItems key={section.id} items={recentItems} title={getSectionLabel(section)} />

      case 'hotTabs':
        if (hotTabs.length === 0) {
          return (
            <section key={section.id} className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                    <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
                    <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse mb-1" />
                    <div className="h-3 bg-neutral-800 rounded w-1/2 animate-pulse" />
                  </div>
                ))}
              </div>
            </section>
          )
        }
        return (
          <SectionViewportLoader key={section.id}>
            <section className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {hotTabs.map((song) => (
                  <SongCard
                    key={song.id}
                    song={{ ...song, artist: resolveHomeSongArtistLine(song, artistMap) }}
                    artistPhoto={song.artistPhoto}
                    href={`/tabs/${song.slug ?? song.id}`}
                    compact
                  />
                ))}
              </div>
            </section>
          </SectionViewportLoader>
        )

      case 'hotArtists':
        if (!hotArtists.all?.length) {
          return (
            <section key={section.id} className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                    <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-full animate-pulse mb-2" />
                    <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse" />
                  </div>
                ))}
              </div>
            </section>
          )
        }
        return (
          <SectionViewportLoader key={section.id}>
            <section className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {hotArtists.all.map((artist) => (
                  <ArtistAvatar
                    key={artist.id}
                    artist={artist}
                    href={`/artists/${encodeURIComponent(getArtistSlug(artist) || artist.id)}`}
                    compact
                  />
                ))}
              </div>
            </section>
          </SectionViewportLoader>
        )

      case 'autoPlaylists':
        if (autoPlaylists.length === 0) {
          return (
            <section key={section.id} className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                    <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
                    <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse" />
                  </div>
                ))}
              </div>
            </section>
          )
        }
        return (
          <SectionViewportLoader key={section.id}>
            <section className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {autoPlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    href={`/playlist/${playlist.slug ?? playlist.id}`}
                    compact
                  />
                ))}
              </div>
            </section>
          </SectionViewportLoader>
        )

      case 'latest':
        if (latestSongs.length === 0) {
          return (
            <section key={section.id} className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                    <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
                    <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse mb-1" />
                    <div className="h-3 bg-neutral-800 rounded w-1/2 animate-pulse" />
                  </div>
                ))}
              </div>
            </section>
          )
        }
        return (
          <SectionViewportLoader key={section.id}>
            <section className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {latestSongs.map((song) => (
                  <SongCard
                    key={song.id}
                    song={{ ...song, artist: resolveHomeSongArtistLine(song, artistMap) }}
                    artistPhoto={song.artistPhoto}
                    href={`/tabs/${song.slug ?? song.id}`}
                    compact
                  />
                ))}
              </div>
            </section>
          </SectionViewportLoader>
        )

      case 'manualPlaylists':
        if (manualPlaylists.length === 0) {
          return (
            <section key={section.id} className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                    <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
                    <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse" />
                  </div>
                ))}
              </div>
            </section>
          )
        }
        return (
          <SectionViewportLoader key={section.id}>
            <section className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{getSectionLabel(section)}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {manualPlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    href={`/playlist/${playlist.slug ?? playlist.id}`}
                    compact
                  />
                ))}
              </div>
            </section>
          </SectionViewportLoader>
        )

      default: {
        // 自定義歌單區域：用傳入的 customSections（凍結）或 homeSettings，避免中途被覆寫導致 section 消失
        const customSection = customSections.find(s => s.id === section.id)
        const sectionTitle = section.customLabel || section.title || (customSection && customSection.title) || ''

        if (!customSection) {
          // Section 在 sectionOrder 但沒有定義（例如首屏時 customPlaylistSections 未載入）— 預留骨架區位
          return (
            <section key={section.id} className="mb-[23px] md:mb-[25px]">
              <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{sectionTitle || '載入中...'}</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                    <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
                    <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse mb-1" />
                    <div className="h-3 bg-neutral-800 rounded w-1/2 animate-pulse" />
                  </div>
                ))}
              </div>
            </section>
          )
        }
        
        // 單歌單區域（playlistId may be omitted when it equals section id）
        const playlistId = customSection.playlistId ?? customSection.id
        if (customSection.type === 'customPlaylist' && playlistId) {
          const playlist = manualPlaylists.find(p => p.id === playlistId) ||
                          autoPlaylists.find(p => p.id === playlistId)
          const preloaded = customPlaylistSongs[section.id]
          const hasContent = (playlist?.songIds?.length > 0) || (preloaded?.length > 0)
          
          if (!hasContent) {
            return (
              <section key={section.id} className="mb-[23px] md:mb-[25px]">
                <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{sectionTitle}</h2>
                <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                      <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
                      <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse mb-1" />
                      <div className="h-3 bg-neutral-800 rounded w-1/2 animate-pulse" />
                    </div>
                  ))}
                </div>
              </section>
            )
          }
          
          return (
            <SectionViewportLoader key={section.id}>
              <CustomPlaylistSection
                title={sectionTitle}
                songIds={playlist?.songIds}
                onSongClick={handleSongClick}
                preloadedSongs={customPlaylistSongs[section.id]}
                artistMap={artistMap}
              />
            </SectionViewportLoader>
          )
        }
        
        // 多歌單區域
        if (customSection.type === 'playlistGroup' && customSection.playlistIds) {
          const playlists = customSection.playlistIds
            .map(id => manualPlaylists.find(p => p.id === id) || autoPlaylists.find(p => p.id === id))
            .filter(Boolean)
          
          if (playlists.length === 0) {
            return (
              <section key={section.id} className="mb-[23px] md:mb-[25px]">
                <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{sectionTitle}</h2>
                <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex-shrink-0 w-[32vw] md:w-36">
                      <div className="w-[32vw] md:w-36 h-[32vw] md:h-36 bg-neutral-800 rounded-[4px] animate-pulse mb-2" />
                      <div className="h-4 bg-neutral-800 rounded w-3/4 animate-pulse" />
                    </div>
                  ))}
                </div>
              </section>
            )
          }
          
          return (
            <SectionViewportLoader key={section.id}>
              <section className="mb-[23px] md:mb-[25px]">
                <h2 className="font-bold text-white pr-6 pb-2 pt-0 pl-4 text-[1.3rem] md:text-[1.375rem]">{sectionTitle}</h2>
                <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3 md:gap-4" style={{ paddingLeft: '1rem' }}>
                  {playlists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      href={`/playlist/${playlist.slug ?? playlist.id}`}
                      compact
                    />
                  ))}
                </div>
              </section>
            </SectionViewportLoader>
          )
        }
        
        return null
      }
    }
  }

  // 分階段載入（after mount only; keeps server/client first paint identical for hydration）
  useEffect(() => {
    try {
      const saved = localStorage.getItem('recentViews')
      if (saved) {
        const parsed = JSON.parse(saved)
        const list = Array.isArray(parsed) ? parsed : (parsed?.recentViews && Array.isArray(parsed.recentViews) ? parsed.recentViews : [])
        setRecentItems(list.slice(0, 10))
      }
    } catch (e) {
      console.warn('Recent views load failed:', e?.message)
    }

    // 1) Prefer 1h local cache (reload = 0 Firestore reads)
    const localCached = getHomeDataFromLocalCache()
    if (localCached) {
      applyHomeDataToState(localCached)
      setHasSectionData(true)
      loadUserData()
      return
    }

    // 2) Use server payload (getStaticProps) and cache for 1h
    if (initialHomeData) {
      setHomeDataToLocalCache(initialHomeData)
      setHasSectionData(true)
      loadUserData()
      return
    }

    // 3) Fetch from API (1 read of cache/homePage) and cache for 1h
    fetch('/api/home-data')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return
        applyHomeDataToState(data)
        setHomeDataToLocalCache(data)
        setHasSectionData(true)
        loadUserData()
      })
      .catch(err => console.error('Home data fetch failed:', err))
  }, [])

  function applyHomeDataToState(data) {
    const d = data || {}
    const settings = d.homeSettings || {}
    // First time we get section data from API: freeze layout so it doesn't jump later
    if (!layoutFrozenRef.current && (settings.sectionOrder?.length || settings.customPlaylistSections?.length)) {
      layoutFrozenRef.current = {
        sectionOrder: settings.sectionOrder || DEFAULT_SECTION_ORDER,
        customPlaylistSections: settings.customPlaylistSections || []
      }
    }
    setHomeSettings(prev => ({
      ...prev,
      ...settings,
      sectionOrder: settings.sectionOrder ?? prev.sectionOrder,
      customPlaylistSections: settings.customPlaylistSections ?? prev.customPlaylistSections
    }))
    setArtists(d.hotArtists?.all?.slice(0, 10) ?? [])
    setLatestSongs(d.latestSongs ?? [])
    setHotTabs(d.hotTabs ?? [])
    setAllSongs(d.allSongs ?? [])
    setHotArtists(d.hotArtists ?? { male: [], female: [], group: [], all: [] })
    setAutoPlaylists(d.autoPlaylists?.length ? d.autoPlaylists : FALLBACK_AUTO_PLAYLISTS)
    setManualPlaylists(d.manualPlaylists?.length ? d.manualPlaylists : FALLBACK_MANUAL_PLAYLISTS)
    if (d.categories?.length) setCategories(d.categories)
    setCustomPlaylistSongs(d.customPlaylistSongs ?? {})
  }

  // Phase 3: 載入需要登入的資料
  const loadUserData = async () => {
    try {
      if (typeof window === 'undefined') return
      const saved = localStorage.getItem('recentViews')
      if (!saved) return
      const parsed = JSON.parse(saved)
      const list = Array.isArray(parsed) ? parsed : (parsed?.recentViews && Array.isArray(parsed.recentViews) ? parsed.recentViews : [])
      setRecentItems(list.slice(0, 10))
    } catch (error) {
      console.warn('Recent views load failed:', error?.message)
    }
  };

  // 處理分類點擊
  const handleCategoryClick = (categoryId) => {
    router.push(`/artists?category=${categoryId}`)
  }

  // 處理歌手點擊（使用 slug 以便改名後 URL 跟住名）
  const handleArtistClick = (artist) => {
    router.push(`/artists/${encodeURIComponent(getArtistSlug(artist) || artist.id)}`)
  }

  // 處理歌曲點擊
  const handleSongClick = (songId) => {
    router.push(`/tabs/${songId}`)
  }

  // 處理歌單點擊
  const handlePlaylistClick = (playlistId) => {
    router.push(`/playlist/${playlistId}`)
  }

  // SEO 配置
  const seoTitle = siteConfig.name
  const seoDescription = siteConfig.description
  const seoUrl = siteConfig.url
  
  // 結構化數據 - 網站主頁
  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteConfig.url}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  }
  
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: '首頁', url: siteConfig.url }
  ])

  return (
    <>
      <Head>
        {/* 基本 Meta */}
        <title>{seoTitle}</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={seoUrl} />
        
        {/* Open Graph */}
        <meta property="og:url" content={seoUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:image" content={`${siteConfig.url}/og-image.jpg`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Polygon Guitar - 香港最大結他譜庫" />
        
        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seoTitle} />
        <meta name="twitter:description" content={seoDescription} />
        <meta name="twitter:image" content={`${siteConfig.url}/og-image.jpg`} />
        
        {/* 結構化數據 JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([websiteSchema, breadcrumbSchema])
          }}
        />
      </Head>
      <div className="min-h-screen bg-black pb-0">
        {/* 根據 sectionOrder 動態渲染（用凍結的 layout 避免 appear→disappear→reappear） */}
        <div style={{ marginTop: 25 }}>
          {(frozenLayout ? frozenLayout.sectionOrder : (homeSettings.sectionOrder || DEFAULT_SECTION_ORDER))
            .filter(section => section.enabled !== false)
            .map(section => renderSection(section, frozenLayout ? frozenLayout.customPlaylistSections : (homeSettings.customPlaylistSections || [])))}
        </div>

        {/* 底部 Spacer */}
        <div className="h-8" />
        
      </div>

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
    </>
  )
}
