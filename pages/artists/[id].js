// pages/artists/[id].js
import { useState, useEffect } from 'react';
import { pacificTime } from '@/lib/logTime';
import { useRouter } from 'next/router';
import Link from '@/components/Link';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, orderBy, updateDoc, increment } from '@/lib/firestore-tracked';
import { ArrowLeft, Share, Heart, ChevronDown, Music, Info, Edit, Star, Eye, Plus, Copy, PenLine } from 'lucide-react';
import SongActionSheet from '../../components/SongActionSheet';
import { getTabsByArtist, getArtistByIdOrSlug, slimTabForArtistPage, nameToSlug, getArtistSlug } from '../../lib/tabs';
import { getArtistPageCache, setArtistPageCache } from '../../lib/artistPageCache';
import { getGroupKeys } from '../../lib/tabGrouping';
import { toggleLikeSong, checkIsLiked, getUserPlaylists, addSongToPlaylist, getUserLikedSongs, createPlaylist, saveArtistToLibrary, removeSavedArtist, checkIsArtistSaved, removeSongFromPlaylist } from '../../lib/playlistApi';
import { isArtistSavedInCache } from '../../lib/userLibraryCache';
import { recordArtistView } from '../../lib/recentViews';
import { recordPageView } from '../../lib/analytics';
import { recordView } from '../../lib/libraryRecentViews';
import { ArtistHeroImage } from '../../components/ArtistImage';
import Layout from '../../components/Layout';
import Head from 'next/head';
import { generateArtistTitle, generateArtistDescription, generateArtistSchema, generateBreadcrumbSchema, siteConfig, getAbsoluteOgImage, getOgImage } from '../../lib/seo';
import { useAuth } from '../../contexts/AuthContext';

// No module-level Firestore: prefetch only loads the route chunk; data loads in useEffect after navigation.

const ARTIST_CACHE_TTL = 45 * 1000; // 45s — changes visible within 1 min
const ARTIST_CACHE_FRESH = 60 * 1000; // 1 min = skip fetch entirely

function saveArtistCache(artistId, data) {
  try {
    const payload = JSON.stringify({ _ts: Date.now(), ...data }, (key, value) => {
      if (value && typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().getTime();
      return value;
    });
    localStorage.setItem(`pg_artist_${artistId}`, payload);
  } catch (e) { /* quota exceeded - ignore */ }
}

function loadArtistCache(artistId) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`pg_artist_${artistId}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data._ts > ARTIST_CACHE_TTL) return null;
    data._fresh = (Date.now() - data._ts) < ARTIST_CACHE_FRESH;
    return data;
  } catch (e) { return null; }
}

function serializeForProps(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v)))
}

export default function ArtistPage({ initialArtist, initialHotTabs = [], initialAllTabs = [] }) {
  const router = useRouter();
  const { id } = router.query;
  const [artist, setArtist] = useState(initialArtist || null);
  const [hotTabs, setHotTabs] = useState(initialHotTabs);
  const [allTabs, setAllTabs] = useState(initialAllTabs);
  const [sortBy, setSortBy] = useState('year'); // year, strokes, views
  const [loading, setLoading] = useState(!initialArtist);
  // user 來自 AuthContext
  const [selectedTab, setSelectedTab] = useState(null);
  const [selectedTabLiked, setSelectedTabLiked] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [addToPlaylistSelectedIds, setAddToPlaylistSelectedIds] = useState([]);
  const [addToPlaylistInitialIds, setAddToPlaylistInitialIds] = useState([]);
  const [showCreatePlaylistInput, setShowCreatePlaylistInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false); // 控制歌手資訊顯示
  const [expandedTitles, setExpandedTitles] = useState({});
  const [isArtistSaved, setIsArtistSaved] = useState(false);
  const [isSavingArtist, setIsSavingArtist] = useState(false);

  // 使用 AuthContext
  const { user, isAdmin } = useAuth();

  useEffect(() => {
    if (!id) return;
    if (initialArtist && initialArtist.id === id) {
      setArtist(initialArtist);
      setHotTabs(initialHotTabs || []);
      setAllTabs(initialAllTabs || []);
      setLoading(false);
      recordArtistView(user?.uid || null, initialArtist);
      recordPageView('artist', id, initialArtist.name, {
        pageName: initialArtist.name,
        photoURL: initialArtist.photoURL || initialArtist.wikiPhotoURL
      }, user?.uid || null);
      return;
    }
    loadArtistData();
  }, [id, initialArtist, initialHotTabs, initialAllTabs]);

  // 載入「是否已收藏歌手」— 優先用 sessionStorage cache，無 cache 才 Firestore
  useEffect(() => {
    if (!id || !user?.uid) {
      setIsArtistSaved(false);
      return;
    }
    const cached = isArtistSavedInCache(user.uid, id);
    if (cached !== null) {
      setIsArtistSaved(cached);
      return;
    }
    let cancelled = false;
    checkIsArtistSaved(user.uid, id).then((saved) => {
      if (!cancelled) setIsArtistSaved(saved);
    });
    return () => { cancelled = true };
  }, [id, user?.uid]);

  const loadArtistData = async () => {
    const bust = typeof window !== 'undefined' && localStorage.getItem('pg_artists_bust')
    const cached = bust ? null : loadArtistCache(id);
    if (cached) {
      setArtist(cached.artist);
      setHotTabs(cached.hotTabs || []);
      setAllTabs(cached.allTabs || []);
      setLoading(false);

      // Analytics (fire-and-forget, doesn't block)
      recordArtistView(user?.uid || null, cached.artist);
      recordView('artist', cached.artist.id); // 收藏頁「最近瀏覽」用 document id
      recordPageView('artist', id, cached.artist.name, {
        pageName: cached.artist.name,
        photoURL: cached.artist.photoURL || cached.artist.wikiPhotoURL
      }, user?.uid || null);

      // 唔再因為 cache 新鮮就跳過 refetch，確保編輯完年份等改動後會即時反映
    } else {
      setLoading(true);
    }

    try {
      const startMs = Date.now()
      const res = await fetch(`/api/artist-page?id=${encodeURIComponent(id)}`);
      if (res.status === 404) {
        router.push('/artists');
        return;
      }
      if (!res.ok) {
        throw new Error(res.statusText || 'Failed to load');
      }
      const data = await res.json();
      const artistData = data.artist;
      const hotTabs = data.hotTabs || [];
      const allTabs = data.allTabs || [];
      console.log(`[artist/${id}] loaded ${allTabs.length} tabs in ${Date.now() - startMs}ms at ${pacificTime()}`)
      setArtist(artistData);
      setHotTabs(hotTabs);
      setAllTabs(allTabs);
      setLoading(false);

      if (!cached) {
        recordArtistView(user?.uid || null, artistData);
        recordView('artist', artistData.id);
        recordPageView('artist', artistData.id, artistData.name, {
          pageName: artistData.name,
          photoURL: artistData.photoURL || artistData.wikiPhotoURL
        }, user?.uid || null);
      }

      saveArtistCache(id, {
        artist: artistData,
        hotTabs,
        allTabs
      });
    } catch (error) {
      console.error('載入歌手資料失敗:', error);
      setLoading(false);
    }
  };

  // 從歌曲數據提取年份（只使用手動設定的年份，唔用 createdAt）
  const getYearFromCreatedAt = (tab) => {
    // 輔助函數：解析年份（支持字符串和數字）
    const parseYear = (value) => {
      if (!value) return null;
      const year = parseInt(value, 10);
      if (!isNaN(year) && year >= 1900 && year <= 2030) {
        return year;
      }
      return null;
    };
    
    // 只使用手動設定的 songYear 或 uploadYear
    // 唔再用 createdAt 作為後備，確保冇年份嘅歌會顯示喺「未知年份」組
    const songYear = parseYear(tab.songYear);
    if (songYear) return songYear;
    
    const uploadYear = parseYear(tab.uploadYear);
    if (uploadYear) return uploadYear;
    
    // 冇手動設定年份，返回 null（會被分到「未知年份」組）
    return null;
  };

  // 分組顯示（按年份）- 沒有年份的排在最後
  const groupByYear = (tabs) => {
    const groups = {};
    const noYearTabs = [];
    
    tabs.forEach(tab => {
      const year = getYearFromCreatedAt(tab);
      if (!year) {
        noYearTabs.push(tab);
        return;
      }
      const range = getYearRange(year);
      if (!groups[range]) groups[range] = [];
      groups[range].push({ ...tab, year });
    });
    
    // 把沒有年份的放在 '未知年份' 組，並按瀏覽數排序
    if (noYearTabs.length > 0) {
      noYearTabs.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
      groups['未知年份'] = noYearTabs;
    }
    
    // 返回排序後的結果，確保「未知年份」在最後
    const sortedGroups = {};
    const yearRanges = Object.keys(groups).filter(k => k !== '未知年份');
    // 按年份範圍排序（新到舊）
    yearRanges.sort((a, b) => {
      // 提取年份範圍的第一個年份進行比較
      const getFirstYear = (range) => {
        if (range.includes('-')) {
          return parseInt(range.split('-')[0]);
        }
        if (range.includes('或更早')) {
          return 0; // 最舊的排最後
        }
        return 0;
      };
      return getFirstYear(b) - getFirstYear(a);
    });
    
    // 先加入所有有年份的組別
    yearRanges.forEach(range => {
      sortedGroups[range] = groups[range];
    });
    
    // 最後加入「未知年份」
    if (groups['未知年份']) {
      sortedGroups['未知年份'] = groups['未知年份'];
    }
    
    return sortedGroups;
  };

  const getYearRange = (year) => {
    if (year >= 2021) return '2021-2026';
    if (year >= 2016) return '2016-2020';
    if (year >= 2011) return '2011-2015';
    if (year >= 2006) return '2006-2010';
    if (year >= 2000) return '2000-2005';
    if (year >= 1995) return '1995-1999';
    if (year >= 1990) return '1990-1994';
    if (year >= 1980) return '1980-1989';
    return '1979 或更早';
  };

  /** 某 tab 屬於邊個年份區（用於「按年份」時把歌名組放去對應區） */
  const getYearRangeFromTab = (tab) => {
    const y = getYearFromCreatedAt(tab);
    return y ? getYearRange(y) : '未知年份';
  };

  /** 為一個 title group 揀「放喺邊個年份區」：優先用有年份嘅版本，避免成組跌入未知年份 */
  const getYearRangeForTitleGroup = (item) => {
    const tabs = item.type === 'single' ? [item.tab] : item.versions;
    const withYear = tabs.find((t) => getYearFromCreatedAt(t));
    return withYear ? getYearRangeFromTab(withYear) : '未知年份';
  };

  /** 年份區顯示順序（有年份由新到舊，未知年份最後） */
  const YEAR_RANGE_ORDER = ['2021-2026', '2016-2020', '2011-2015', '2006-2010', '2000-2005', '1995-1999', '1990-1994', '1980-1989', '1979 或更早', '未知年份'];

  const handleMoreClick = async (e, tab) => {
    e.stopPropagation();
    setSelectedTab(tab);
    if (user) {
      const [liked, playlists] = await Promise.all([
        checkIsLiked(user.uid, tab.id),
        getUserPlaylists(user.uid)
      ]);
      setSelectedTabLiked(liked);
      setUserPlaylists(playlists);
    } else {
      setSelectedTabLiked(false);
    }
    setShowActionModal(true);
  };

  const handleCopyShareLink = async () => {
    if (!selectedTab) return;
    const url = `${window.location.origin}/tabs/${selectedTab.id}`;
    try {
      await navigator.clipboard.writeText(url);
      alert('已複製連結');
    } catch (err) {
      alert('複製失敗');
    }
  };

  const handleSelectLyricsShare = () => {
    if (!selectedTab?.id) return;
    setShowActionModal(false);
    router.push(`/tools/tab-share?tabId=${selectedTab.id}`);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/tabs/${selectedTab.id}`;
    if (navigator.share) {
      await navigator.share({
        title: `${selectedTab.title} - ${artist.name}`,
        url
      });
    } else {
      navigator.clipboard.writeText(url);
    }
    setShowActionModal(false);
  };

  const handleAddToPlaylistClick = () => {
    setShowActionModal(false);
    // 預設剔選已包含此歌嘅歌單
    const alreadyIn = (userPlaylists || [])
      .filter((pl) => pl.songIds && pl.songIds.includes(selectedTab?.id))
      .map((pl) => pl.id);
    setAddToPlaylistSelectedIds(alreadyIn);
    setAddToPlaylistInitialIds(alreadyIn);
    setShowAddToPlaylist(true);
  };

  const toggleAddToPlaylistSelection = (playlistId) => {
    setAddToPlaylistSelectedIds((prev) =>
      prev.includes(playlistId) ? prev.filter((pid) => pid !== playlistId) : [...prev, playlistId]
    );
  };

  const confirmAddToPlaylist = async () => {
    if (!selectedTab) return;
    const idsToAdd = addToPlaylistSelectedIds.filter((id) => !addToPlaylistInitialIds.includes(id));
    const idsToRemove = addToPlaylistInitialIds.filter((id) => !addToPlaylistSelectedIds.includes(id));
    if (idsToAdd.length === 0 && idsToRemove.length === 0) {
      setShowAddToPlaylist(false);
      setAddToPlaylistSelectedIds([]);
      setAddToPlaylistInitialIds([]);
      return;
    }
    try {
      for (const playlistId of idsToAdd) {
        await addSongToPlaylist(playlistId, selectedTab.id);
      }
      for (const playlistId of idsToRemove) {
        await removeSongFromPlaylist(playlistId, selectedTab.id);
      }
      setShowAddToPlaylist(false);
      setAddToPlaylistSelectedIds([]);
      setAddToPlaylistInitialIds([]);
      if (idsToAdd.length && idsToRemove.length) {
        alert(`已加入 ${idsToAdd.length} 個歌單，已從 ${idsToRemove.length} 個歌單移除`);
      } else if (idsToRemove.length) {
        alert(idsToRemove.length > 1 ? `已從 ${idsToRemove.length} 個歌單移除` : '已從歌單移除');
      } else {
        alert(idsToAdd.length > 1 ? `已加入 ${idsToAdd.length} 個歌單` : '已加入歌單');
      }
    } catch (error) {
      alert('操作失敗：' + error.message);
    }
  };

  const handleAddToLiked = async () => {
    if (!selectedTab || !user) {
      alert('請先登入後即可收藏喜愛的結他譜');
      return;
    }
    try {
      const result = await toggleLikeSong(user.uid, selectedTab.id);
      setSelectedTabLiked(result.isLiked);
    } catch (error) {
      alert('操作失敗：' + error.message);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !user) return;
    try {
      const result = await createPlaylist(user.uid, newPlaylistName.trim());
      // 創建後直接加入歌曲
      await addSongToPlaylist(result.playlistId, selectedTab.id);
      setShowCreatePlaylistInput(false);
      setShowAddToPlaylist(false);
      setNewPlaylistName('');
      alert(`已創建歌單「${newPlaylistName.trim()}」並加入歌曲`);
    } catch (error) {
      alert('創建歌單失敗：' + error.message);
    }
  };

  const addToPlaylist = async (playlistId) => {
    if (!selectedTab) return;
    try {
      await addSongToPlaylist(playlistId, selectedTab.id);
      setShowAddToPlaylist(false);
      alert('已加入歌單');
    } catch (error) {
      alert('加入失敗：' + error.message);
    }
  };

  const sortedTabs = () => {
    let tabs = [...allTabs];
    if (sortBy === 'year') {
      // 有年份的排前面（新到舊），沒有年份的排最後
      tabs.sort((a, b) => {
        const yearA = getYearFromCreatedAt(a) || 0;
        const yearB = getYearFromCreatedAt(b) || 0;
        if (yearA === 0 && yearB === 0) {
          // 都沒有年份，按瀏覽數排序
          return (b.viewCount || 0) - (a.viewCount || 0);
        }
        if (yearA === 0) return 1;  // A 沒年份，排後
        if (yearB === 0) return -1; // B 沒年份，排後
        // 先按年份新到舊，同年份按瀏覽數
        if (yearB !== yearA) {
          return yearB - yearA;
        }
        return (b.viewCount || 0) - (a.viewCount || 0);
      });
    } else if (sortBy === 'views') {
      tabs.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
    } else if (sortBy === 'strokes') {
      // 簡單筆畫排序（按標題）
      tabs.sort((a, b) => a.title.localeCompare(b.title, 'zh-HK'));
    }
    return tabs;
  };

  const groupByTitle = (tabs) => {
    const map = new Map(); // groupKey -> tab[]
    tabs.forEach(tab => {
      const keys = getGroupKeys(tab.title, tab.id);
      keys.forEach(key => {
        if (!map.has(key)) map.set(key, []);
        const arr = map.get(key);
        if (!arr.includes(tab)) arr.push(tab);
      });
    });
    // 只合併「同一首歌嘅空格變體」：兩組共享 tab 且其中一個 key = 該 tab 嘅 no-space 歌名（唔合併組合歌兩邊）
    const noSpace = (t) => (t.title || '').replace(/\s+/g, '');
    const keyParents = new Map();
    const getKeyRoot = (key) => {
      if (!keyParents.has(key)) keyParents.set(key, key);
      const p = keyParents.get(key);
      return p === key ? key : (keyParents.set(key, getKeyRoot(p)), keyParents.get(key));
    };
    const mergeKeys = (k1, k2) => { keyParents.set(getKeyRoot(k1), getKeyRoot(k2)); };
    map.forEach((group, key) => {
      group.forEach(tab => {
        const ns = noSpace(tab);
        if (ns && ns !== key && map.has(ns) && map.get(ns).includes(tab)) mergeKeys(key, ns);
      });
    });
    const rootToGroups = new Map(); // rootKey -> { keys, tabs }
    map.forEach((group, key) => {
      const root = getKeyRoot(key);
      if (!rootToGroups.has(root)) rootToGroups.set(root, { keys: [], tabs: [] });
      const r = rootToGroups.get(root);
      if (!r.keys.includes(key)) r.keys.push(key);
      group.forEach(tab => { if (!r.tabs.includes(tab)) r.tabs.push(tab); });
    });
    const result = [];
    rootToGroups.forEach(({ keys, tabs }, rootKey) => {
      const sorted = [...tabs].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
      if (tabs.length === 1) {
        result.push({ type: 'single', tab: tabs[0] });
        return;
      }
      // 多份譜：標題用「呢組代表嘅 key」（最短）— Medley 會分兩行「念念不忘」「耿耿於怀」，唔用第一份譜嘅全名
      const pool = [...new Set([rootKey, ...(keys || [])])].filter(Boolean);
      const displayKey = pool.reduce((a, b) => (a.length <= b.length ? a : b));
      result.push({ type: 'group', title: displayKey, representative: sorted[0], versions: sorted });
    });
    return result;
  };

  // 按年份時：先按歌名合併（跨全部歌曲），再按「有年份嘅版本」放入對應區（優先用有年份，避免成組跌入未知年份）
  const displayData = (() => {
    if (sortBy !== 'year') return { grouped: false, data: sortedTabs() };
    const allTabs = sortedTabs();
    const titleGroups = groupByTitle(allTabs);
    const byYear = {};
    titleGroups.forEach((item) => {
      const yearRange = getYearRangeForTitleGroup(item);
      if (!byYear[yearRange]) byYear[yearRange] = [];
      byYear[yearRange].push(item);
    });
    const ordered = {};
    YEAR_RANGE_ORDER.forEach((r) => { if (byYear[r]?.length) ordered[r] = byYear[r]; });
    return { grouped: true, data: ordered };
  })();

  const toggleTitle = (key) => {
    setExpandedTitles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 提取 YouTube Video ID
  const extractYouTubeId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  // 取得歌曲縮圖 - 順序：自訂封面 > Spotify 專輯相 > YouTube > thumbnail > 歌手相片
  const getSongThumbnail = (tab) => {
    // 1. 優先使用用戶自訂封面
    if (tab.coverImage) return tab.coverImage;
    // 2. 其次使用 Spotify 專輯相
    if (tab.albumImage) return tab.albumImage;
    // 3. 使用 YouTube 縮圖
    if (tab.youtubeUrl) {
      const videoId = extractYouTubeId(tab.youtubeUrl);
      if (videoId) {
        return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      }
    }
    // 4. 使用歌曲自己的縮圖
    if (tab.thumbnail) return tab.thumbnail;
    // 5. 使用歌手圖片
    return artist?.photoURL || artist?.wikiPhotoURL || null;
  };

  if (router.isFallback || loading || !artist) return (
    <Layout fullWidth>
      <Head>
        <title>{id ? `${decodeURIComponent(id)} 結他譜 chord | Polygon - 香港廣東歌結他譜網` : 'Polygon - 香港廣東歌結他譜網'}</title>
        <meta name="description" content={siteConfig.description} />
        <meta property="og:title" content={`Polygon - 香港廣東歌結他譜網 | ${id ? decodeURIComponent(id): ""}`} />
        <meta property="og:description" content={siteConfig.description} />
        <meta property="og:image" content={siteConfig.defaultOgImage || `${siteConfig.url}/og-image.jpg`} />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <div className="min-h-screen bg-black" />
    </Layout>
  );

  const songCount = allTabs.length;
  const seoTitle = generateArtistTitle(artist.name);
  const seoDescription = generateArtistDescription(artist.name, songCount);
  const artistSlug = getArtistSlug(artist) || artist.id;
  const seoUrl = `${siteConfig.url}/artists/${encodeURIComponent(artistSlug)}`;
  const artistSchema = generateArtistSchema(artist, allTabs);
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: '首頁', url: siteConfig.url },
    { name: '歌手', url: `${siteConfig.url}/artists` },
    { name: artist.name, url: seoUrl }
  ]);

  return (
    <Layout fullWidth>
    <Head>
      <title>{seoTitle}</title>
      <meta name="description" content={seoDescription} />
      <link rel="canonical" href={seoUrl} />
      {/* Open Graph — unique per artist for social share preview */}
      <meta key="og-url" property="og:url" content={seoUrl} />
      <meta key="og-type" property="og:type" content="profile" />
      <meta key="og-site-name" property="og:site_name" content={siteConfig.name} />
      <meta key="og-title" property="og:title" content={seoTitle} />
      <meta key="og-description" property="og:description" content={seoDescription} />
      <meta key="og-image" property="og:image" content={getOgImage(artist.photoURL || artist.wikiPhotoURL)} />
      <meta key="og-image-width" property="og:image:width" content="1200" />
      <meta key="og-image-height" property="og:image:height" content="630" />
      <meta key="og-image-alt" property="og:image:alt" content={`${artist.name} - Polygon Guitar`} />
      {/* Twitter Card — unique per artist */}
      <meta key="twitter-card" name="twitter:card" content="summary_large_image" />
      <meta key="twitter-site" name="twitter:site" content={siteConfig.twitter} />
      <meta key="twitter-title" name="twitter:title" content={seoTitle} />
      <meta key="twitter-description" name="twitter:description" content={seoDescription} />
      <meta key="twitter-image" name="twitter:image" content={getOgImage(artist.photoURL || artist.wikiPhotoURL)} />
      <meta key="twitter-image-alt" name="twitter:image:alt" content={`${artist.name} 結他譜 - Polygon Guitar`} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([artistSchema, breadcrumbSchema])
        }}
      />
    </Head>
    <div className="min-h-screen bg-black pb-20">
      <div className="max-w-7xl mx-auto">
      {/* Hero */}
      <div className="relative w-full aspect-[3/2] md:h-[55vh] md:aspect-auto">
        <ArtistHeroImage artist={artist} />
        {/* 底部由下而上漸變層（黑 → 透明） */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black to-transparent opacity-40 pointer-events-none z-[1]" aria-hidden />
        
        {/* 返回按鈕 */}
        <button 
          onClick={() => router.back()}
          className="absolute top-6 left-4 p-2 bg-black/30 backdrop-blur-sm rounded-full text-white hover:bg-black/50 z-10"
          aria-label="返回"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        <div className="absolute bottom-0 left-0 right-0 pt-10 pb-1 px-4 z-10">
          <div className="flex items-center gap-2 mb-1">
            {/* 歌手名 + 資訊、編輯 icon 一組，icon 貼住名右邊 */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h1 className="text-4xl font-bold text-white leading-tight truncate min-w-0">{artist.name}</h1>
              <button
                onClick={() => setShowInfo(!showInfo)}
                className="p-1.5 bg-white/10 backdrop-blur-sm rounded-full text-white hover:bg-white/20 transition flex-shrink-0"
                title="歌手資訊"
              >
                <Info className="w-5 h-5" />
              </button>
              {isAdmin && (
                <Link
                  href={`/artists/${encodeURIComponent(artistSlug)}/edit`}
                  className="p-1.5 bg-white/80 backdrop-blur-sm rounded-full text-black hover:bg-white transition flex-shrink-0"
                  title="編輯歌手"
                >
                  <Edit className="w-5 h-5" />
                </Link>
              )}
            </div>
            {/* 收藏歌手（右邊，可再撳取消收藏） */}
            <button
              type="button"
              onClick={async () => {
                if (!user) {
                  alert('請先登入後即可收藏歌手');
                  return;
                }
                if (isSavingArtist) return;
                setIsSavingArtist(true);
                try {
                  if (isArtistSaved) {
                    await removeSavedArtist(user.uid, artist.id);
                    setIsArtistSaved(false);
                  } else {
                    await saveArtistToLibrary(user.uid, artist.id);
                    setIsArtistSaved(true);
                  }
                } catch (err) {
                  console.error('收藏歌手失敗:', err);
                  alert('收藏失敗，請重試');
                } finally {
                  setIsSavingArtist(false);
                }
              }}
              disabled={isSavingArtist}
              title={isArtistSaved ? '已收藏（撳一下取消）' : '收藏歌手'}
              className={`ml-auto p-2 rounded-full flex-shrink-0 transition ${
                isArtistSaved
                  ? 'bg-[#FFD700] text-black'
                  : 'bg-white/10 text-white hover:bg-white/20'
              } ${isSavingArtist ? 'opacity-50' : ''}`}
            >
              <Heart className={`w-6 h-6 ${isArtistSaved ? 'fill-black' : 'fill-none'}`} strokeWidth={2} />
            </button>
          </div>
          
          {/* 設計圖冇顯示歌手資訊 */}
        </div>
      </div>

      {/* 歌手詳細資訊 Floating Panel */}
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowInfo(false)}>
          <div className="bg-[#121212] rounded-2xl p-6 max-w-sm w-full border border-neutral-800 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white text-lg font-bold">{artist.name}</h3>
              <button onClick={() => setShowInfo(false)} className="text-[#B3B3B3] hover:text-white">
                ✕
              </button>
            </div>
            
            {/* 資訊列表 */}
            <div className="space-y-3 text-sm">
              {artist.birthYear && (
                <div className="flex justify-between">
                  <span className="text-[#B3B3B3]">出生日期</span>
                  <span className="text-white">
                    {artist.birthYear.includes('-') 
                      ? new Date(artist.birthYear).toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric' })
                      : `${artist.birthYear}年`}
                  </span>
                </div>
              )}
              
              {artist.debutYear && (
                <div className="flex justify-between">
                  <span className="text-[#B3B3B3]">出道日期</span>
                  <span className="text-white">
                    {artist.debutYear.includes('-') 
                      ? new Date(artist.debutYear).toLocaleDateString('zh-HK', { year: 'numeric', month: 'long', day: 'numeric' })
                      : `${artist.debutYear}年`}
                  </span>
                </div>
              )}
              
              {artist.spotifyFollowers && (
                <div className="flex justify-between">
                  <span className="text-[#B3B3B3]">Spotify 粉絲</span>
                  <span className="text-[#1DB954]">{(artist.spotifyFollowers / 10000).toFixed(1)}萬</span>
                </div>
              )}
              
              <div className="flex justify-between">
                <span className="text-[#B3B3B3]">歌曲數量</span>
                <span className="text-white">{allTabs.length} 首</span>
              </div>
            </div>
            
            {/* 地區 */}
            {(artist.regions?.length > 0 || artist.region) && (
              <div className="mt-4 pt-4 border-t border-neutral-800">
                <div className="flex flex-wrap gap-2">
                  {(artist.regions || [artist.region]).map((region, idx) => (
                    <span key={idx} className="px-2 py-1 bg-[#282828] text-[#B3B3B3] text-xs rounded">
                      {region === 'hongkong' ? '香港' : 
                       region === 'taiwan' ? '台灣' : 
                       region === 'china' ? '中國' : 
                       region === 'asia' ? '亞洲' : 
                       region === 'foreign' ? '外國' : region}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* 簡介 */}
            {artist.bio && (
              <div className="mt-4 pt-4 border-t border-neutral-800">
                <p className="text-[#B3B3B3] text-sm leading-relaxed">
                  {artist.bio}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 熱門歌曲（前5首 - 有相片） */}
      <section className="px-4 mt-2">
        <h2 className="text-white font-bold mb-2 text-[1.3rem] md:text-[1.375rem]">熱門</h2>
        <div className="space-y-1">
          {hotTabs.map((tab, index) => (
            <Link 
              key={tab.id}
              href={`/tabs/${tab.slug ?? tab.id}`}
              className="flex items-center py-1 rounded-lg cursor-pointer group -mx-2 px-2"
            >
              <span className="text-[#B3B3B3] w-5 text-center text-sm font-medium mr-2">
                {index + 1}
              </span>
              
              {/* 歌曲封面 */}
              <div className="w-12 h-12 rounded-[4px] overflow-hidden mr-3 bg-[#282828] flex-shrink-0">
                {getSongThumbnail(tab) ? (
                  <img src={getSongThumbnail(tab)} alt={tab.title} className="w-full h-full object-cover pointer-events-none" loading="lazy" decoding="async" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#3E3E3E] text-xl">♪</div>
                )}
              </div>
              
              {/* 歌曲資訊 */}
              <div className="flex-1 min-w-0">
                <h3 className="text-white text-base font-medium truncate">{tab.title}</h3>
                <p className="text-[#B3B3B3] text-xs mt-0.5 flex items-center gap-1">
                  <PenLine className="w-3 h-3 flex-shrink-0" />
                  {tab.uploaderPenName || '匿名'}
                </p>
              </div>
              
              {/* 更多 - 橫向三點（與 library/playlist 一致） */}
              <button 
                onClick={(e) => { e.preventDefault(); handleMoreClick(e, tab); }}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 text-[#B3B3B3] hover:text-white"
                aria-label="更多"
              >
                <svg className="w-5 h-5" viewBox="0 0 14.96 2.54" fill="currentColor" aria-hidden>
                  <circle cx="1.27" cy="1.27" r="1.27" />
                  <circle cx="7.48" cy="1.27" r="1.27" />
                  <circle cx="13.69" cy="1.27" r="1.27" />
                </svg>
              </button>
            </Link>
          ))}
        </div>
      </section>

      {/* 所有歌曲（第6首起 - 無相片，有評分） */}
      {allTabs.length > 0 && (
      <section className="px-4 mt-8">
        {/* 標題 + 排序 */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white font-bold text-[1.3rem] md:text-[1.375rem]">所有歌曲</h2>
          
          <div className="relative">
            <button 
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center space-x-1 text-[#B3B3B3] text-sm hover:text-white bg-[#1a1a1a] px-3 py-1.5 rounded-full"
            >
              <span>{sortBy === 'year' ? '按年份' : sortBy === 'strokes' ? '按筆畫' : '按瀏覽'}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
            </button>
            
            {showSortMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowSortMenu(false)} />
                <div className="absolute right-0 top-full mt-2 bg-[#282828] rounded-lg shadow-xl py-1 min-w-[120px] z-30">
                  {['year', 'strokes', 'views'].map((type) => (
                    <button 
                      key={type}
                      onClick={() => {
                        setSortBy(type);
                        setShowSortMenu(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm ${sortBy === type ? 'text-[#FFD700]' : 'text-white hover:bg-[#3E3E3E]'}`}
                    >
                      {type === 'year' ? '按年份' : type === 'strokes' ? '按筆畫' : '按瀏覽'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 歌曲列表 - 按年份分組或平鋪顯示 */}
        {displayData.grouped ? (
          // 按年份分組顯示（每區係已按歌名合併嘅 title group items）
          YEAR_RANGE_ORDER.filter((r) => displayData.data[r]?.length).map((yearRange) => {
            const items = displayData.data[yearRange];
            return (
            <div key={yearRange} style={{ marginBottom: '0.5rem' }}>
              <h3 className={`text-sm font-mediumremo sticky top-0 bg-black/95 py-2 z-10 ${
                yearRange === '未知年份' 
                  ? 'text-neutral-500 italic' 
                  : 'text-[#FFD700]'
              }`}>
                {yearRange}
                {yearRange === '未知年份' && items.length > 0 && (
                  <span className="ml-2 text-xs">({items.length} 首)</span>
                )}
              </h3>
              <div>
                {items.map((item, idx, arr) => {
                  if (item.type === 'single') {
                    const tab = item.tab;
                    return (
                      <Link 
                        key={tab.id}
                        href={`/tabs/${tab.slug ?? tab.id}`}
                        className="flex items-center cursor-pointer group py-3 px-2 -mx-2"
                        style={idx < arr.length - 1 ? { borderBottom: '0.5px solid #333' } : {}}
                      >
                        <div className="flex-1 min-w-0 pr-4">
                          <div className="flex items-center gap-2">
                            <h4 className="text-white text-base font-medium truncate">{tab.title}</h4>
                          </div>
                        </div>
                        <div className="flex items-center justify-end flex-shrink-0" style={{ width: '3.5rem', marginRight: '0.4rem' }}>
                          <span className="text-neutral-500 text-xs">{tab.viewCount?.toLocaleString() || 0}</span>
                          <Eye className="w-3 h-3 text-neutral-500 flex-shrink-0 ml-1" style={{ marginTop: -1 }} />
                        </div>
                        <div className="text-right flex-shrink-0" style={{ width: '5.3rem' }}>
                          <span className="text-[#B3B3B3] text-sm truncate block">
                            {tab.uploaderPenName || '匿名'}
                          </span>
                        </div>
                      </Link>
                    );
                  }
                  const groupKey = `${yearRange}-${item.title}`;
                  const isExpanded = expandedTitles[groupKey];
                  const rep = item.representative;
                  return (
                    <div key={groupKey}>
                      <div
                        onClick={() => toggleTitle(groupKey)}
                        className="flex items-center cursor-pointer py-3 px-2 -mx-2"
                        style={(!isExpanded && idx < arr.length - 1) ? { borderBottom: '0.5px solid #333' } : {}}
                      >
                        <div className="flex-1 min-w-0 pr-4">
                          <div className="flex items-center gap-2">
                            <h4 className="text-white text-base font-medium truncate">{item.title}</h4>
                            <span className="text-sm px-1.5 py-0.5 rounded flex-shrink-0 bg-yellow-500/20 text-[#FFD700]">{item.versions.length}份譜</span>
                            <ChevronDown className={`w-3.5 h-3.5 text-neutral-500 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </div>
                      </div>
                      {isExpanded && item.versions.map((tab, vIdx) => (
                        <Link
                          key={tab.id}
                          href={`/tabs/${tab.slug ?? tab.id}`}
                          className="flex items-center cursor-pointer py-3 px-2 -mx-2 pl-6 bg-[#0a0a0a]"
                          style={(vIdx < item.versions.length - 1 || idx < arr.length - 1) ? { borderBottom: '0.5px solid #333' } : {}}
                        >
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="flex items-center gap-2">
                              <h4 className="text-white text-base font-normal truncate">{tab.title}</h4>
                            </div>
                          </div>
                          <div className="flex items-center justify-end flex-shrink-0" style={{ width: '3.5rem', marginRight: '0.4rem' }}>
                            <span className="text-neutral-500 text-xs">{tab.viewCount?.toLocaleString() || 0}</span>
                            <Eye className="w-3 h-3 text-neutral-500 flex-shrink-0 ml-1" style={{ marginTop: -1 }} />
                          </div>
                          <div className="text-right flex-shrink-0" style={{ width: '5.3rem' }}>
                            <span className="text-[#B3B3B3] text-sm truncate block">
                              {tab.uploaderPenName || '匿名'}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })
        ) : (
          // 平鋪顯示（按筆畫/瀏覽）
          <div>
            {groupByTitle(displayData.data).map((item, idx, arr) => {
              if (item.type === 'single') {
                const tab = item.tab;
                return (
                  <Link 
                    key={tab.id}
                    href={`/tabs/${tab.slug ?? tab.id}`}
                    className="flex items-center py-3 cursor-pointer group px-2 -mx-2"
                    style={idx < arr.length - 1 ? { borderBottom: '0.5px solid #333' } : {}}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <h4 className="text-white text-base font-medium truncate">{tab.title}</h4>
                      </div>
                    </div>
                    <div className="flex items-center justify-end flex-shrink-0" style={{ width: '3.5rem', marginRight: '0.4rem' }}>
                      <span className="text-neutral-500 text-xs">{tab.viewCount?.toLocaleString() || 0}</span>
                      <Eye className="w-3 h-3 text-neutral-500 flex-shrink-0 ml-1" style={{ marginTop: -1 }} />
                    </div>
                    <div className="text-right flex-shrink-0" style={{ width: '5.3rem' }}>
                      <span className="text-[#B3B3B3] text-sm truncate block">
                        {tab.uploaderPenName || '匿名'}
                      </span>
                    </div>
                  </Link>
                );
              }
              const groupKey = `flat-${item.title}`;
              const isExpanded = expandedTitles[groupKey];
              const rep = item.representative;
              return (
                <div key={groupKey}>
                  <div
                    onClick={() => toggleTitle(groupKey)}
                    className="flex items-center cursor-pointer py-3 px-2 -mx-2"
                    style={(!isExpanded && idx < arr.length - 1) ? { borderBottom: '0.5px solid #333' } : {}}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <h4 className="text-white text-base font-medium truncate">{item.title}</h4>
                        <span className="text-sm px-1.5 py-0.5 rounded flex-shrink-0 bg-yellow-500/20 text-[#FFD700]">{item.versions.length}份譜</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-neutral-500 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </div>
                  {isExpanded && item.versions.map((tab, vIdx) => (
                    <Link
                      key={tab.id}
                      href={`/tabs/${tab.slug ?? tab.id}`}
                      className="flex items-center cursor-pointer py-3 px-2 -mx-2 pl-6 bg-[#0a0a0a]"
                      style={(vIdx < item.versions.length - 1 || idx < arr.length - 1) ? { borderBottom: '0.5px solid #333' } : {}}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                          <h4 className="text-white text-base font-normal truncate">{tab.title}</h4>
                        </div>
                      </div>
                      <div className="flex items-center justify-end flex-shrink-0" style={{ width: '3.5rem', marginRight: '0.4rem' }}>
                        <span className="text-neutral-500 text-xs">{tab.viewCount?.toLocaleString() || 0}</span>
                        <Eye className="w-3 h-3 text-neutral-500 flex-shrink-0 ml-1" style={{ marginTop: -1 }} />
                      </div>
                      <div className="text-right flex-shrink-0" style={{ width: '5.3rem' }}>
                        <span className="text-[#B3B3B3] text-sm truncate block">
                          {tab.uploaderPenName || '匿名'}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}
      </div>

      <SongActionSheet
        open={!!(showActionModal && selectedTab)}
        onClose={() => setShowActionModal(false)}
        title={selectedTab?.title ?? ''}
        artist={artist?.name ?? ''}
        thumbnailUrl={selectedTab ? getSongThumbnail(selectedTab) : null}
        liked={selectedTabLiked}
        likeLabel={selectedTabLiked ? '取消喜愛' : '加到我最喜愛'}
        onCopyShareLink={handleCopyShareLink}
        onSelectLyricsShare={handleSelectLyricsShare}
        onAddToLiked={handleAddToLiked}
        onAddToPlaylist={handleAddToPlaylistClick}
      />

      {/* 加入歌單 Modal */}
      {showAddToPlaylist && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50" onClick={() => {
              setShowAddToPlaylist(false);
              setShowCreatePlaylistInput(false);
              setNewPlaylistName('');
              setAddToPlaylistSelectedIds([]);
              setAddToPlaylistInitialIds([]);
            }} />
          <div className="fixed bottom-0 left-0 right-0 bg-[#121212] rounded-t-2xl z-[60] pb-24 max-h-[70vh] overflow-y-auto">
            <div className="flex flex-col items-center justify-center py-2 min-h-[36px]">
              <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
            </div>
            <div className="text-left" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <h3 className="text-white text-lg font-bold mb-4">加入歌單</h3>
            
            <div className="space-y-2">
              {userPlaylists.map((pl) => {
                const isSelected = addToPlaylistSelectedIds.includes(pl.id);
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
                );
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

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.2s ease-out;
        }
      `}</style>
    </div>
    </Layout>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: 'blocking' };
}

export async function getStaticProps({ params }) {
  let id = params?.id;
  if (!id) return { notFound: true };
  try {
    // Decode URL segment (Next.js may pass percent-encoded value)
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) id = decoded;
    } catch (_) { /* keep id */ }
    const artistData = await getArtistByIdOrSlug(id);
    if (!artistData) return { notFound: true };
    const artistId = artistData.id;

    const expectedSlug = getArtistSlug(artistData) || artistId;
    if (expectedSlug !== id) {
      return { redirect: { destination: `/artists/${encodeURIComponent(expectedSlug)}`, permanent: false } };
    }

    const cached = await getArtistPageCache(artistId);
    // Do not trust cache when tab lists are empty: first visit often cached 0 songs before
    // tabs existed or before patch-caches ran; that stale doc lasts ~1y and hid all tabs on prod.
    const cachedTabsOk =
      cached?.artist &&
      Array.isArray(cached.allTabs) &&
      (cached.allTabs.length > 0 || (cached.hotTabs || []).length > 0);
    if (cachedTabsOk) {
      return {
        props: {
          initialArtist: serializeForProps(cached.artist),
          initialHotTabs: serializeForProps((cached.hotTabs || []).map(slimTabForArtistPage)),
          initialAllTabs: serializeForProps(cached.allTabs.map(slimTabForArtistPage))
        },
        revalidate: 300
      };
    }

    const tabs = await getTabsByArtist(artistData.name, artistData.normalizedName || artistId, artistData.id);
    tabs.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
    const slimTabs = tabs.map(slimTabForArtistPage);
    const initialHotTabs = slimTabs.slice(0, 5);
    const payload = {
      artist: artistData,
      hotTabs: initialHotTabs,
      allTabs: slimTabs
    };
    await setArtistPageCache(artistId, payload);

    return {
      props: {
        initialArtist: serializeForProps(artistData),
        initialHotTabs: serializeForProps(initialHotTabs),
        initialAllTabs: serializeForProps(slimTabs)
      },
      revalidate: 300
    };
  } catch (e) {
    console.error('[artists/[id]] getStaticProps:', e?.message);
    return { notFound: true };
  }
}
