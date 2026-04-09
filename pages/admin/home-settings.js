import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'
import { db, auth } from '@/lib/firebase'
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit
} from '@/lib/firestore-tracked'
import { getHotTabs, getTabsByIds } from '@/lib/tabs'
import { getAllPlaylists } from '@/lib/playlists'
import { useArtistMap } from '@/lib/useArtistMap'

// 首頁設置頁面資料：24 小時內使用快取，減少 Firestore 讀取
const HOME_SETTINGS_CACHE_KEY = 'pg_home_settings_page_cache'
const HOME_SETTINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function serializeForCache(obj) {
  if (obj == null) return obj
  return JSON.parse(JSON.stringify(obj, (_, v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v)))
}

function getHomeSettingsFromCache() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(HOME_SETTINGS_CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !data._ts || Date.now() - data._ts > HOME_SETTINGS_CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function setHomeSettingsCache(payload) {
  if (typeof window === 'undefined' || !payload) return
  try {
    const existing = getHomeSettingsFromCache()
    const merged = existing ? { ...existing, ...payload, _ts: Date.now() } : { ...payload, _ts: Date.now() }
    localStorage.setItem(HOME_SETTINGS_CACHE_KEY, JSON.stringify(merged))
  } catch (e) { /* quota */ }
}

const SORT_OPTIONS = [
  { value: 'tier', label: 'Tier 等級', desc: 'Tier 1→2→3→4→5，同 Tier 以譜數多→少（推薦）' },
  { value: 'tabCount', label: '譜數目', desc: '按歌手歌曲數量排序' }
]

const TAB_SORT_OPTIONS = [
  { value: 'viewCount', label: '瀏覽量', desc: '按歌曲瀏覽次數排序' },
  { value: 'likes', label: '讚好數', desc: '按歌曲讚好數排序' },
  { value: 'createdAt', label: '最新上傳', desc: '按上傳時間排序' },
  { value: 'rating', label: '最高評分', desc: '按用戶評分排序' }
]

function HomeSettings() {
  const router = useRouter()
  const { getArtistName } = useArtistMap()
  const [artists, setArtists] = useState([])
  const [tabs, setTabs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // 首頁區域選項
  const SECTION_OPTIONS = [
    { id: 'categories', label: '歌手分類' },
    { id: 'recent', label: '最近瀏覽' },
    { id: 'hotTabs', label: '熱門結他譜' },
    { id: 'hotArtists', label: '熱門歌手' },
    { id: 'autoPlaylists', label: '推薦歌單' },
    { id: 'latest', label: '最新上架' },
    { id: 'manualPlaylists', label: '精選歌單' }
  ]

  const [settings, setSettings] = useState({
    // 改為單一個熱門歌手揀選列表（混合男/女/組合）
    manualSelection: [],
    hotArtistSortBy: 'tier',
    displayCount: 20,
    hotTabs: {
      manualSelection: [],
      useManual: false,
      displayCount: 20,
      sortBy: 'viewCount'
    },
    sectionOrder: [
      { id: 'categories', enabled: true, customLabel: '' },
      { id: 'recent', enabled: true, customLabel: '' },
      { id: 'hotTabs', enabled: true, customLabel: '' },
      { id: 'hotArtists', enabled: true, customLabel: '' },
      { id: 'autoPlaylists', enabled: true, customLabel: '' },
      { id: 'latest', enabled: true, customLabel: '' },
      { id: 'manualPlaylists', enabled: true, customLabel: '' }
    ],
    // 自定義歌單區域
    customPlaylistSections: []
  })
  
  // 追踪是否有未保存的改動
  const [hasChanges, setHasChanges] = useState(false)
  
  // 熱門歌手搜索
  const [artistSearchTerm, setArtistSearchTerm] = useState('')
  const [activeArtistCategory, setActiveArtistCategory] = useState('all')
  
  // 計算各類型已選歌手數目
  const getSelectedCounts = () => {
    const selectedIds = settings.manualSelection || []
    const maleCount = selectedIds.filter(id => {
      const artist = artists.find(a => a.id === id)
      return artist && (artist.artistType === 'male' || artist.gender === 'male')
    }).length
    const femaleCount = selectedIds.filter(id => {
      const artist = artists.find(a => a.id === id)
      return artist && (artist.artistType === 'female' || artist.gender === 'female')
    }).length
    const groupCount = selectedIds.filter(id => {
      const artist = artists.find(a => a.id === id)
      return artist && (artist.artistType === 'group' || artist.gender === 'group')
    }).length
    return { male: maleCount, female: femaleCount, group: groupCount }
  }
  
  // 熱門歌曲搜索
  const [tabSearchTerm, setTabSearchTerm] = useState('')
  const [tabSearchResults, setTabSearchResults] = useState([])
  const [selectedTabIds, setSelectedTabIds] = useState([])
  
  const [message, setMessage] = useState('')
  const [activeTab, setActiveTab] = useState('layout') // default to layout so on open we only load settings (1 read)
  const [showAdvancedCache, setShowAdvancedCache] = useState(false)
  
  // 歌單區域相關
  const [playlists, setPlaylists] = useState([])
  const [showPlaylistModal, setShowPlaylistModal] = useState(false)
  const [showPlaylistGroupModal, setShowPlaylistGroupModal] = useState(false)
  const [playlistSearchTerm, setPlaylistSearchTerm] = useState('')
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState([])
  const [playlistGroupTitle, setPlaylistGroupTitle] = useState('')
  
  // 拖放排序狀態
  const [draggingArtistIndex, setDraggingArtistIndex] = useState(null)
  const [draggingTabIndex, setDraggingTabIndex] = useState(null)

  // 首頁快取重建
  const [rebuildingCache, setRebuildingCache] = useState(false)
  const [rebuildingHomeAndSearchCache, setRebuildingHomeAndSearchCache] = useState(false)
  const [rebuildingAllTabsCache, setRebuildingAllTabsCache] = useState(false)

  // Lazy-load state: only fetch lists when user opens the section that needs them
  const [loadingArtists, setLoadingArtists] = useState(false)
  const [loadingTabs, setLoadingTabs] = useState(false)
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const [listsLoaded, setListsLoaded] = useState({ artists: false, tabs: false, playlists: false })

  useEffect(() => {
    loadSettingsOnly()
  }, [])

  // 歌曲搜索 - 類似 search 頁面，本地過濾所有字段
  useEffect(() => {
    if (!tabSearchTerm || tabSearchTerm.trim() === '') {
      setTabSearchResults([])
      return
    }
    
    const query = tabSearchTerm.toLowerCase()
    
    // 本地過濾 - 類似 search 頁面，搜索多個字段
    const results = tabs.filter(tab => 
      tab.title?.toLowerCase().includes(query) ||
      getArtistName(tab)?.toLowerCase().includes(query) ||
      (tab.composer && tab.composer.toLowerCase().includes(query)) ||
      (tab.lyricist && tab.lyricist.toLowerCase().includes(query)) ||
      (tab.arranger && tab.arranger.toLowerCase().includes(query)) ||
      (tab.uploaderPenName && tab.uploaderPenName.toLowerCase().includes(query))
    )
    
    setTabSearchResults(results)
  }, [tabSearchTerm, tabs])

  const applySettingsFromData = (data) => {
    if (!data) return
    let manualSelection = data.manualSelection || []
    if (typeof manualSelection === 'object' && !Array.isArray(manualSelection)) {
      const male = manualSelection.male || []
      const female = manualSelection.female || []
      const group = manualSelection.group || []
      manualSelection = [...new Set([...male, ...female, ...group])]
    }
    if (Array.isArray(manualSelection)) {
      manualSelection = manualSelection.map(item => {
        if (typeof item === 'object' && item !== null && item.id) return item.id
        return item
      }).filter(id => typeof id === 'string')
    }
    setSettings(prev => ({
      ...prev,
      ...data,
      manualSelection,
      hotTabs: { ...prev.hotTabs, ...(data.hotTabs || {}) },
      sectionOrder: data.sectionOrder || prev.sectionOrder,
      customPlaylistSections: data.customPlaylistSections || []
    }))
    if (data.hotTabs?.manualSelection) {
      let tabSelection = data.hotTabs.manualSelection
      if (Array.isArray(tabSelection)) {
        tabSelection = tabSelection.map(item => {
          if (typeof item === 'object' && item !== null && item.id) return item.id
          return item
        }).filter(id => typeof id === 'string')
      }
      setSelectedTabIds(tabSelection)
    }
  }

  /** Load only settings on open (1 read). Artists/tabs/playlists load when user opens that section. */
  const loadSettingsOnly = async () => {
    try {
      const settingsDoc = await getDoc(doc(db, 'settings', 'home'))
      if (settingsDoc.exists()) {
        applySettingsFromData(settingsDoc.data())
      }
    } catch (error) {
      console.error('Error loading settings:', error)
    } finally {
      setLoading(false)
    }
  }

  /** Load artists when user opens the "熱門歌手" tab. Uses 24h cache if available. */
  const loadArtistsIfNeeded = async () => {
    if (listsLoaded.artists) return
    const cached = getHomeSettingsFromCache()
    if (cached?.artists?.length) {
      setArtists(cached.artists)
      setListsLoaded(prev => ({ ...prev, artists: true }))
      return
    }
    setLoadingArtists(true)
    try {
      const searchRes = await fetch('/api/search-data?only=artists')
      const artistsData = searchRes.ok ? ((await searchRes.json()).artists || []) : []
      setArtists(artistsData)
      setListsLoaded(prev => ({ ...prev, artists: true }))
      setHomeSettingsCache({ artists: artistsData })
    } catch (error) {
      console.error('Error loading artists:', error)
    } finally {
      setLoadingArtists(false)
    }
  }

  /** Load tabs when user opens the "熱門歌曲" tab. Uses 24h cache if available, then supplements missing selected tabs. */
  const loadTabsIfNeeded = async () => {
    if (listsLoaded.tabs) return
    setLoadingTabs(true)
    try {
      const cached = getHomeSettingsFromCache()
      let tabsData = cached?.tabs?.length ? cached.tabs : await getHotTabs(100)
      const loadedIds = new Set(tabsData.map(t => t.id))
      const missingIds = selectedTabIds.filter(id => !loadedIds.has(id))
      if (missingIds.length > 0) {
        const missingTabs = await getTabsByIds(missingIds)
        tabsData = [...tabsData, ...missingTabs]
      }
      setTabs(tabsData)
      setListsLoaded(prev => ({ ...prev, tabs: true }))
      setHomeSettingsCache({ tabs: tabsData })
    } catch (error) {
      console.error('Error loading tabs:', error)
    } finally {
      setLoadingTabs(false)
    }
  }

  /** Load playlists when user opens a playlist modal. Uses 24h cache if available. */
  const loadPlaylistsIfNeeded = async () => {
    if (listsLoaded.playlists) return
    const cached = getHomeSettingsFromCache()
    if (cached?.playlists?.length) {
      setPlaylists(cached.playlists)
      setListsLoaded(prev => ({ ...prev, playlists: true }))
      return
    }
    setLoadingPlaylists(true)
    try {
      const playlistsData = await getAllPlaylists()
      setPlaylists(playlistsData)
      setListsLoaded(prev => ({ ...prev, playlists: true }))
      setHomeSettingsCache({ playlists: playlistsData })
    } catch (error) {
      console.error('Error loading playlists:', error)
    } finally {
      setLoadingPlaylists(false)
    }
  }

  // 從後台 menu 點「清除快取」進入時自動打開快取分頁
  useEffect(() => {
    if (router.isReady && router.query.tab === 'cache') setActiveTab('cache')
  }, [router.isReady, router.query.tab])

  // Lazy-load lists when user switches to the tab or opens the modal that needs them
  useEffect(() => {
    if (activeTab === 'artists') loadArtistsIfNeeded()
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'tabs') loadTabsIfNeeded()
  }, [activeTab])

  useEffect(() => {
    if (showPlaylistModal || showPlaylistGroupModal) loadPlaylistsIfNeeded()
  }, [showPlaylistModal, showPlaylistGroupModal])

  /** Force full reload (used by "立即更新此頁資料" button): clear cache and load everything. */
  const loadData = async () => {
    try {
      setListsLoaded({ artists: false, tabs: false, playlists: false })
      const [searchRes, tabsData, playlistsData, settingsDoc] = await Promise.all([
        fetch('/api/search-data?only=artists'),
        getHotTabs(100),
        getAllPlaylists(),
        getDoc(doc(db, 'settings', 'home'))
      ])
      const artistsData = searchRes.ok ? ((await searchRes.json()).artists || []) : []
      setPlaylists(playlistsData)
      setArtists(artistsData)
      setTabs(tabsData)
      setListsLoaded({ artists: true, tabs: true, playlists: true })
      if (settingsDoc.exists()) {
        const data = settingsDoc.data()
        applySettingsFromData(data)
        setHomeSettingsCache({
          artists: artistsData,
          tabs: tabsData,
          playlists: playlistsData,
          settings: serializeForCache(data)
        })
      } else {
        setHomeSettingsCache({
          artists: artistsData,
          tabs: tabsData,
          playlists: playlistsData,
          settings: null
        })
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      // 確保只保存 ID 字符串，並去重
      const cleanManualSelection = (settings.manualSelection || [])
        .map(item => typeof item === 'object' && item !== null && item.id ? item.id : item)
        .filter(item => typeof item === 'string')
      
      const dedupedSettings = {
        ...settings,
        manualSelection: [...new Set(cleanManualSelection)],
        hotTabs: {
          ...settings.hotTabs,
          manualSelection: [...new Set(settings.hotTabs.manualSelection)]
        },
        updatedAt: new Date().toISOString()
      }
      
      await setDoc(doc(db, 'settings', 'home'), dedupedSettings)
      setHasChanges(false)  // 保存成功後重置改動狀態
      try { localStorage.removeItem(HOME_SETTINGS_CACHE_KEY) } catch (_) {} // 下次載入會取最新資料
      setMessage('設置已保存，重建首頁快取中...')
      try {
        const token = await auth.currentUser?.getIdToken?.()
        if (token) {
          const res = await fetch('/api/admin/rebuild-home-cache', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          })
          if (res.ok) {
            try { localStorage.removeItem('pg_home_cache_v2') } catch (_) {}
            setMessage('設置已保存，首頁快取已重建')
          } else {
            setMessage('設置已保存（快取重建失敗，請手動重建）')
          }
        }
      } catch (_) {
        setMessage('設置已保存（快取重建失敗，請手動重建）')
      }
      setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      console.error('Error saving:', error)
      setMessage('保存失敗')
    } finally {
      setSaving(false)
    }
  }

  const rebuildHomeCache = async () => {
    setRebuildingCache(true)
    try {
      const token = await auth.currentUser?.getIdToken?.()
      if (!token) {
        setMessage('請先登入')
        return
      }
      const res = await fetch('/api/admin/rebuild-home-cache', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error || '重建快取失敗')
        return
      }
      setMessage('首頁快取已重建')
      try { localStorage.removeItem('pg_home_cache_v2') } catch (_) {}
      setTimeout(() => setMessage(''), 5000)
    } catch (err) {
      console.error(err)
      setMessage('重建快取失敗')
    } finally {
      setRebuildingCache(false)
    }
  }

  const rebuildHomeAndSearchCache = async () => {
    setRebuildingHomeAndSearchCache(true)
    try {
      const token = await auth.currentUser?.getIdToken?.()
      if (!token) {
        setMessage('請先登入')
        return
      }
      const res = await fetch('/api/admin/rebuild-home-and-search-cache', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error || '重建首頁 + 搜尋快取失敗')
        return
      }
      setMessage('首頁 + 搜尋快取已重建（單次讀取）')
      try {
        localStorage.removeItem('pg_home_cache_v2')
        localStorage.removeItem('searchPageData')
        localStorage.removeItem('pg_artists_list')
        localStorage.setItem('pg_artists_bust', String(Date.now()))
      } catch (_) {}
      setTimeout(() => setMessage(''), 5000)
    } catch (err) {
      console.error(err)
      setMessage('重建首頁 + 搜尋快取失敗')
    } finally {
      setRebuildingHomeAndSearchCache(false)
    }
  }

  const rebuildAllTabsCache = async () => {
    setRebuildingAllTabsCache(true)
    try {
      const token = await auth.currentUser?.getIdToken?.()
      if (!token) {
        setMessage('請先登入')
        return
      }
      const res = await fetch('/api/admin/rebuild-all-tabs-cache', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error || '重建樂譜列表快取失敗')
        return
      }
      setMessage(`樂譜列表快取已重建（${data.count ?? 0} 份）`)
      setTimeout(() => setMessage(''), 5000)
    } catch (err) {
      console.error(err)
      setMessage('重建樂譜列表快取失敗')
    } finally {
      setRebuildingAllTabsCache(false)
    }
  }

  const getArtistsByCategory = (category) => {
    return artists.filter(a => (a.artistType || a.gender) === category)
  }

  // 熱門歌手相關函數
  const toggleArtistSelection = (artistId) => {
    setSettings(prev => {
      // 確保入面只係 ID 字符串
      const currentSelection = (prev.manualSelection || [])
        .map(item => typeof item === 'object' && item !== null && item.id ? item.id : item)
        .filter(item => typeof item === 'string')
      
      const isSelected = currentSelection.includes(artistId)
      
      return {
        ...prev,
        manualSelection: isSelected
          ? currentSelection.filter(id => id !== artistId)
          : [...currentSelection, artistId]
      }
    })
    setHasChanges(true)
  }

  const moveArtistOrder = (index, direction) => {
    console.log('moveArtistOrder called:', index, direction)
    setSettings(prev => {
      // 確保只取 ID 字符串，並複製到新數組
      const currentSelection = (prev.manualSelection || [])
        .map(item => typeof item === 'object' && item !== null && item.id ? item.id : item)
        .filter(item => typeof item === 'string')
      
      console.log('Before:', currentSelection)
      
      const newSelection = [...currentSelection]
      
      if (direction === 'up' && index > 0) {
        const temp = newSelection[index]
        newSelection[index] = newSelection[index - 1]
        newSelection[index - 1] = temp
      } else if (direction === 'down' && index < newSelection.length - 1) {
        const temp = newSelection[index]
        newSelection[index] = newSelection[index + 1]
        newSelection[index + 1] = temp
      }
      
      console.log('After:', newSelection)
      
      return {
        ...prev,
        manualSelection: newSelection
      }
    })
    setHasChanges(true)
  }

  const removeArtistFromSelection = (artistId) => {
    setSettings(prev => {
      // 確保入面只係 ID 字符串
      const currentSelection = (prev.manualSelection || [])
        .map(item => typeof item === 'object' && item !== null && item.id ? item.id : item)
        .filter(item => typeof item === 'string')
      
      return {
        ...prev,
        manualSelection: currentSelection.filter(id => id !== artistId)
      }
    })
    setHasChanges(true)
  }

  // 熱門歌曲相關函數
  const toggleTabSelection = (tabId) => {
    setSelectedTabIds(prev => {
      const isSelected = prev.includes(tabId)
      const newSelection = isSelected
        ? prev.filter(id => id !== tabId)
        : [...prev, tabId]
      
      // 同時更新 settings
      setSettings(s => ({
        ...s,
        hotTabs: {
          ...s.hotTabs,
          manualSelection: newSelection
        }
      }))
      
      return newSelection
    })
    setHasChanges(true)
  }

  const moveTabOrder = (index, direction) => {
    const newSelection = [...selectedTabIds]
    if (direction === 'up' && index > 0) {
      [newSelection[index], newSelection[index - 1]] = 
      [newSelection[index - 1], newSelection[index]]
    } else if (direction === 'down' && index < newSelection.length - 1) {
      [newSelection[index], newSelection[index + 1]] = 
      [newSelection[index + 1], newSelection[index]]
    }
    
    setSelectedTabIds(newSelection)
    setSettings(prev => ({
      ...prev,
      hotTabs: {
        ...prev.hotTabs,
        manualSelection: newSelection
      }
    }))
    setHasChanges(true)
  }

  const removeTabFromSelection = (tabId) => {
    const newSelection = selectedTabIds.filter(id => id !== tabId)
    setSelectedTabIds(newSelection)
    setSettings(prev => ({
      ...prev,
      hotTabs: {
        ...prev.hotTabs,
        manualSelection: newSelection
      }
    }))
    setHasChanges(true)
  }

  // 拖放排序 - 歌手
  const handleArtistDragStart = (e, index) => {
    setDraggingArtistIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleArtistDragOver = (e, index) => {
    e.preventDefault()
    if (draggingArtistIndex === null || draggingArtistIndex === index) return
    
    const currentSelection = settings.manualSelection || []
    const newSelection = [...currentSelection]
    const [movedItem] = newSelection.splice(draggingArtistIndex, 1)
    newSelection.splice(index, 0, movedItem)
    
    setSettings(prev => ({ ...prev, manualSelection: newSelection }))
    setDraggingArtistIndex(index)
    setHasChanges(true)
  }

  const handleArtistDragEnd = () => {
    setDraggingArtistIndex(null)
  }

  // 拖放排序 - 歌曲
  const handleTabDragStart = (e, index) => {
    setDraggingTabIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleTabDragOver = (e, index) => {
    e.preventDefault()
    if (draggingTabIndex === null || draggingTabIndex === index) return
    
    const newSelection = [...selectedTabIds]
    const [movedItem] = newSelection.splice(draggingTabIndex, 1)
    newSelection.splice(index, 0, movedItem)
    
    setSelectedTabIds(newSelection)
    setSettings(prev => ({
      ...prev,
      hotTabs: { ...prev.hotTabs, manualSelection: newSelection }
    }))
    setDraggingTabIndex(index)
    setHasChanges(true)
  }

  const handleTabDragEnd = () => {
    setDraggingTabIndex(null)
  }

  const moveSection = (index, direction) => {
    const newOrder = [...settings.sectionOrder]
    if (direction === 'up' && index > 0) {
      [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]]
    } else if (direction === 'down' && index < newOrder.length - 1) {
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    }
    setSettings(prev => ({ ...prev, sectionOrder: newOrder }))
    setHasChanges(true)
  }

  const toggleSection = (index) => {
    const newOrder = [...settings.sectionOrder]
    newOrder[index] = { ...newOrder[index], enabled: !newOrder[index].enabled }
    setSettings(prev => ({ ...prev, sectionOrder: newOrder }))
    setHasChanges(true)
  }

  // 添加單歌單區域到 sectionOrder
  const addSinglePlaylistSection = (playlist) => {
    const sectionId = `playlist-${playlist.id}-${Date.now()}`
    const newSection = {
      id: sectionId,
      enabled: true,
      customLabel: playlist.title
    }
    const newCustomSection = {
      id: sectionId,
      type: 'customPlaylist',
      playlistId: playlist.id,
      title: playlist.title,
      enabled: true
    }
    setSettings(prev => ({
      ...prev,
      sectionOrder: [...prev.sectionOrder, newSection],
      customPlaylistSections: [...(prev.customPlaylistSections || []), newCustomSection]
    }))
    setHasChanges(true)
    setShowPlaylistModal(false)
  }

  // 添加多歌單區域到 sectionOrder
  const addPlaylistGroupSection = (playlistIds, title) => {
    const sectionId = `playlist-group-${Date.now()}`
    const newSection = {
      id: sectionId,
      enabled: true,
      customLabel: title
    }
    const newCustomSection = {
      id: sectionId,
      type: 'playlistGroup',
      playlistIds: playlistIds,
      title: title,
      enabled: true
    }
    setSettings(prev => ({
      ...prev,
      sectionOrder: [...prev.sectionOrder, newSection],
      customPlaylistSections: [...(prev.customPlaylistSections || []), newCustomSection]
    }))
    setHasChanges(true)
    setShowPlaylistGroupModal(false)
  }

  const sortByTier = (list) =>
    [...list].sort((a, b) => {
      const ta = a.tier ?? 99
      const tb = b.tier ?? 99
      if (ta !== tb) return ta - tb
      return (b.songCount || 0) - (a.songCount || 0)
    })

  const filteredArtists = (category) => {
    const categoryArtists = category ? getArtistsByCategory(category) : artists
    const sorted = sortByTier(categoryArtists)
    if (!artistSearchTerm) return sorted
    return sorted.filter(a => 
      a.name?.toLowerCase().includes(artistSearchTerm.toLowerCase())
    )
  }

  const filteredTabs = () => {
    // 如果有搜索詞，使用本地過濾結果（類似 search 頁面）
    if (tabSearchTerm && tabSearchTerm.trim().length > 0) {
      return tabSearchResults
    }
    // 如果冇搜索詞，顯示最近的歌曲（但顯示多啲，方便揀選）
    return tabs.slice(0, 100)
  }

  const getSelectedArtists = () => {
    const ids = (settings.manualSelection || [])
      .map(item => typeof item === 'object' && item !== null && item.id ? item.id : item)
      .filter(item => typeof item === 'string')
    // 去重，防止重複 ID 導致重複顯示
    const uniqueIds = [...new Set(ids)]
    // 過濾掉找不到的歌手，防止顯示 null
    return uniqueIds
      .map(id => artists.find(a => a.id === id))
      .filter(a => a && a.id) // 確保有有效 ID
  }
  
  // 按分類獲取已選歌手
  const getSelectedArtistsByCategory = (category) => {
    const allSelected = getSelectedArtists()
    return allSelected.filter(artist => (artist.artistType || artist.gender) === category)
  }

  const getSelectedTabs = () => {
    return selectedTabIds.map(id => {
      const tab = tabs.find(t => t.id === id)
      if (tab) return tab
      // 如果喺 tabs 數組入邊搵唔到，顯示一個佔位符
      return { id, title: '載入中...', notFound: true }
    })
  }

  if (loading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-neutral-800 rounded w-1/3"></div>
            <div className="h-64 bg-neutral-800 rounded"></div>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-3 py-4 md:px-4 md:py-8">
        <h1 className="text-xl md:text-2xl font-bold text-white mb-3">首頁設置</h1>

        {message && (
          <div className={`mb-3 p-3 rounded-lg text-sm ${
            !message.includes('失敗') && !message.includes('請先登入')
              ? 'bg-green-900/50 text-green-400 border border-green-700' 
              : 'bg-red-900/50 text-red-400 border border-red-700'
          }`}>
            {message}
          </div>
        )}

        <div className="flex border-b border-neutral-800 mb-4">
          <button
            onClick={() => setActiveTab('layout')}
            className={`flex-1 py-2 text-center text-sm font-medium transition border-b-2 ${
              activeTab === 'layout'
                ? 'text-[#FFD700] border-[#FFD700]'
                : 'text-neutral-400 border-transparent hover:text-white'
            }`}
          >
            首頁排序
          </button>
          <button
            onClick={() => setActiveTab('artists')}
            className={`flex-1 py-2 text-center text-sm font-medium transition border-b-2 ${
              activeTab === 'artists'
                ? 'text-[#FFD700] border-[#FFD700]'
                : 'text-neutral-400 border-transparent hover:text-white'
            }`}
          >
            熱門歌手
          </button>
          <button
            onClick={() => setActiveTab('tabs')}
            className={`flex-1 py-2 text-center text-sm font-medium transition border-b-2 ${
              activeTab === 'tabs'
                ? 'text-[#FFD700] border-[#FFD700]'
                : 'text-neutral-400 border-transparent hover:text-white'
            }`}
          >
            熱門歌曲
          </button>
          <button
            onClick={() => setActiveTab('cache')}
            className={`flex-1 py-2 text-center text-sm font-medium transition border-b-2 ${
              activeTab === 'cache'
                ? 'text-[#FFD700] border-[#FFD700]'
                : 'text-neutral-400 border-transparent hover:text-white'
            }`}
          >
            清除快取
          </button>
        </div>

        {/* 熱門歌手設置 */}
        {activeTab === 'artists' && (
          <div className="space-y-3">
            {/* 自動揀選 */}
            <div className={`bg-[#121212] rounded-lg border p-3 ${!(settings.hotArtistUseManual) ? 'border-[#FFD700]/50' : 'border-neutral-800 opacity-60'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer" onClick={() => { setSettings(prev => ({ ...prev, hotArtistUseManual: false })); setHasChanges(true) }}>
                  <input type="radio" checked={!(settings.hotArtistUseManual)} readOnly className="w-4 h-4 text-[#FFD700] bg-[#282828] border-neutral-600" />
                  <span className="text-sm font-medium text-white">自動揀選歌手</span>
                </label>
                <select
                  value={settings.hotArtistSortBy}
                  onChange={(e) => {
                    setSettings(prev => ({ ...prev, hotArtistSortBy: e.target.value }))
                    setHasChanges(true)
                  }}
                  className="bg-[#282828] border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white"
                >
                  {SORT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={settings.displayCount}
                  onChange={(e) => {
                    setSettings(prev => ({ ...prev, displayCount: parseInt(e.target.value) || 20 }))
                    setHasChanges(true)
                  }}
                  className="w-16 bg-[#282828] border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-white text-center"
                  min="1"
                  max="50"
                />
              </div>
            </div>

            {/* 手動選擇 */}
            <div className={`bg-[#121212] rounded-lg border ${settings.hotArtistUseManual ? 'border-[#FFD700]/50' : 'border-neutral-800'}`}>
              <div className="p-3 border-b border-neutral-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer" onClick={() => { setSettings(prev => ({ ...prev, hotArtistUseManual: true })); setHasChanges(true) }}>
                      <input type="radio" checked={settings.hotArtistUseManual || false} readOnly className="w-4 h-4 text-[#FFD700] bg-[#282828] border-neutral-600" />
                      <span className="text-sm font-medium text-white">手動揀選歌手</span>
                      {getSelectedArtists().length > 0 && (
                        <span className="text-sm text-neutral-400 ml-1">
                          ({getSelectedArtists().length})
                          <span className="text-xs text-neutral-500 ml-1">
                            男: {getSelectedCounts().male} / 女: {getSelectedCounts().female} / 組合: {getSelectedCounts().group}
                          </span>
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      value={settings.displayCount}
                      onChange={(e) => {
                        setSettings(prev => ({ ...prev, displayCount: parseInt(e.target.value) || 20 }))
                        setHasChanges(true)
                      }}
                      className="w-16 bg-[#282828] border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-white text-center"
                      min="1"
                      max="50"
                    />
                  </div>
                  {loadingArtists && (
                    <span className="text-sm text-neutral-400">Loading list…</span>
                  )}
                </div>
              </div>
              

              <div className="p-3">
                {/* 已選歌手列表 */}
                {(() => {
                  const allSelected = getSelectedArtists()
                  return allSelected.length > 0 ? (
                  <div className="mb-4">
                    <div className="space-y-1">
                      {allSelected.map((artist, index) => {
                        const artistType = artist.artistType || artist.gender
                        const typeLabel = artistType === 'male' ? '男' : artistType === 'female' ? '女' : '組'
                        const typeColor = artistType === 'male' ? 'bg-[#1fc3df]' : artistType === 'female' ? 'bg-[#ff9b98]' : 'bg-[#fed702]'
                        
                        return (
                          <div 
                            key={artist.id}
                            draggable
                            onDragStart={(e) => handleArtistDragStart(e, index)}
                            onDragOver={(e) => handleArtistDragOver(e, index)}
                            onDragEnd={handleArtistDragEnd}
                            className={`flex items-center gap-2 p-2 bg-[#1a1a1a] rounded-lg border border-neutral-800 cursor-move transition-opacity ${draggingArtistIndex === index ? 'opacity-50 border-[#FFD700]' : ''}`}
                          >
                            <span className="text-neutral-500 w-6 flex items-center gap-1">
                              <svg className="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                              </svg>
                              {index + 1}
                            </span>
                            <span className="flex-1 text-white font-medium">{artist.name}</span>
                            
                            {/* 分類標籤 */}
                            <span className={`px-2 py-0.5 text-xs font-medium text-black rounded ${typeColor}`}>
                              {typeLabel}
                            </span>
                            
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  console.log('Up button clicked for index:', index, 'artist:', artist.name)
                                  moveArtistOrder(index, 'up')
                                }}
                                disabled={index === 0}
                                className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded cursor-pointer"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  console.log('Down button clicked for index:', index, 'artist:', artist.name)
                                  moveArtistOrder(index, 'down')
                                }}
                                disabled={index === allSelected.length - 1}
                                className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded cursor-pointer"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => removeArtistFromSelection(artist.id)}
                                className="p-1.5 text-red-400 hover:text-red-300 rounded cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  ) : (
                    <div className="mb-4 p-4 bg-[#1a1a1a] rounded-lg border border-neutral-800 text-center">
                      <p className="text-neutral-500 text-sm">尚未揀選任何歌手</p>
                    </div>
                  )
                })()}

                {/* 搜索添加 */}
                <div>
                  <h3 className="text-xs font-medium text-neutral-400 mb-2">添加歌手</h3>
                  <div className="flex items-center gap-1.5 mb-2 overflow-x-auto">
                    {[
                      { id: 'all', label: '全部' },
                      { id: 'male', label: '男歌手' },
                      { id: 'female', label: '女歌手' },
                      { id: 'group', label: '組合' }
                    ].map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setActiveArtistCategory(cat.id)
                          setArtistSearchTerm('')
                        }}
                        className={`px-3 py-1.5 text-sm font-medium rounded-full transition whitespace-nowrap ${
                          activeArtistCategory === cat.id
                            ? 'bg-[#FFD700] text-black'
                            : 'bg-[#282828] text-neutral-400 hover:text-white'
                        }`}
                      >
                        {cat.label}
                        {cat.id !== 'all' && (() => {
                          const counts = getSelectedCounts()
                          const count = counts[cat.id] || 0
                          return count > 0 ? (
                            <span className="ml-1.5 text-xs">({count})</span>
                          ) : null
                        })()}
                      </button>
                    ))}
                  </div>
                  <div className="relative mb-3">
                    <input
                      type="text"
                      value={artistSearchTerm}
                      onChange={(e) => setArtistSearchTerm(e.target.value)}
                      placeholder="搜索歌手名..."
                      className="w-full bg-[#282828] border-0 rounded-full px-4 py-2 pr-10 text-white placeholder-[#666] outline-none"
                    />
                    {artistSearchTerm && (
                      <button
                        onClick={() => setArtistSearchTerm('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {filteredArtists(activeArtistCategory === 'all' ? null : activeArtistCategory).slice(0, 20).map(artist => {
                      const isSelected = settings.manualSelection?.includes(artist.id)
                      const artistType = artist.artistType || artist.gender
                      const typeLabel = artistType === 'male' ? '男' : artistType === 'female' ? '女' : '組'
                      const typeColor = artistType === 'male' ? 'bg-[#1fc3df]' : artistType === 'female' ? 'bg-[#ff9b98]' : 'bg-[#fed702]'
                      
                      return (
                        <button
                          key={artist.id}
                          onClick={() => toggleArtistSelection(artist.id)}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg transition text-left ${
                            isSelected 
                              ? 'bg-[#FFD700]/20 border border-[#FFD700]/50' 
                              : 'hover:bg-[#282828]'
                          }`}
                        >
                          <span className={`flex-1 ${isSelected ? 'text-[#FFD700]' : 'text-white'}`}>
                            {artist.name}
                          </span>
                          {/* 分類標籤 */}
                          <span className={`px-1.5 py-0.5 text-xs font-medium text-black rounded ${typeColor}`}>
                            {typeLabel}
                          </span>
                          {isSelected && <svg className="w-4 h-4 text-[#FFD700] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 12.75l6 6 9-13.5" /></svg>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 熱門歌曲設置 */}
        {activeTab === 'tabs' && (
          <div className="space-y-3">
            {/* 自動揀選 */}
            <div className={`bg-[#121212] rounded-lg border p-3 ${!(settings.hotTabs?.useManual) ? 'border-[#FFD700]/50' : 'border-neutral-800 opacity-60'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer" onClick={() => { setSettings(prev => ({ ...prev, hotTabs: { ...prev.hotTabs, useManual: false } })); setHasChanges(true) }}>
                  <input type="radio" checked={!(settings.hotTabs?.useManual)} readOnly className="w-4 h-4 text-[#FFD700] bg-[#282828] border-neutral-600" />
                  <span className="text-sm font-medium text-white">自動揀選歌曲</span>
                </label>
                <select
                  value={settings.hotTabs?.sortBy || 'viewCount'}
                  onChange={(e) => {
                    setSettings(prev => ({
                      ...prev,
                      hotTabs: { ...prev.hotTabs, sortBy: e.target.value }
                    }))
                    setHasChanges(true)
                  }}
                  className="bg-[#282828] border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white"
                >
                  {TAB_SORT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={settings.hotTabs?.displayCount || 20}
                  onChange={(e) => {
                    setSettings(prev => ({
                      ...prev,
                      hotTabs: { ...prev.hotTabs, displayCount: parseInt(e.target.value) || 20 }
                    }))
                    setHasChanges(true)
                  }}
                  className="w-16 bg-[#282828] border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-white text-center"
                  min="1"
                  max="50"
                />
              </div>
            </div>

            {/* 手動選擇歌曲 */}
            <div className={`bg-[#121212] rounded-lg border ${settings.hotTabs?.useManual ? 'border-[#FFD700]/50' : 'border-neutral-800'}`}>
              <div className="p-3 border-b border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer" onClick={() => { setSettings(prev => ({ ...prev, hotTabs: { ...prev.hotTabs, useManual: true } })); setHasChanges(true) }}>
                    <input type="radio" checked={settings.hotTabs?.useManual || false} readOnly className="w-4 h-4 text-[#FFD700] bg-[#282828] border-neutral-600" />
                    <span className="text-sm font-medium text-white">手動揀選歌曲</span>
                    {selectedTabIds.length > 0 && (
                      <span className="text-sm text-neutral-400 ml-1">({selectedTabIds.length})</span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={settings.hotTabs?.displayCount || 20}
                    onChange={(e) => {
                      setSettings(prev => ({
                        ...prev,
                        hotTabs: { ...prev.hotTabs, displayCount: parseInt(e.target.value) || 20 }
                      }))
                      setHasChanges(true)
                    }}
                    className="w-16 bg-[#282828] border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-white text-center"
                    min="1"
                    max="50"
                  />
                </div>
                {loadingTabs && (
                  <span className="text-sm text-neutral-400">Loading list…</span>
                )}
              </div>

              <div className="p-3">
                {/* 已選歌曲列表 */}
                {selectedTabIds.length > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-neutral-400">
                          已揀選 ({selectedTabIds.length})
                        </h3>
                        <span className="text-xs text-neutral-500 flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                          </svg>
                          拖曳可排序
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedTabIds([])
                          setSettings(prev => ({
                            ...prev,
                            hotTabs: {
                              ...prev.hotTabs,
                              manualSelection: []
                            }
                          }))
                          setHasChanges(true)
                        }}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        清空全部
                      </button>
                    </div>
                    <div className="space-y-1">
                      {getSelectedTabs().map((tab, index) => (
                        <div 
                          key={tab.id}
                          draggable
                          onDragStart={(e) => handleTabDragStart(e, index)}
                          onDragOver={(e) => handleTabDragOver(e, index)}
                          onDragEnd={handleTabDragEnd}
                          className={`flex items-center gap-2 p-2 bg-[#1a1a1a] rounded-lg border border-neutral-800 cursor-move transition-opacity ${draggingTabIndex === index ? 'opacity-50 border-[#FFD700]' : ''}`}
                        >
                          <span className="text-neutral-500 w-6 flex items-center gap-1">
                            <svg className="w-4 h-4 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                            </svg>
                            {index + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium truncate">{tab.title}</p>
                            <p className="text-sm text-neutral-500 truncate">
                              {getArtistName(tab)}
                              {tab.uploaderPenName && (
                                <span className="text-[#FFD700] text-[10px] ml-1.5 inline-flex items-center gap-0.5 align-middle">
                                  <svg className="w-2.5 h-2.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                    <path d="m15 5 4 4" />
                                  </svg>
                                  {tab.uploaderPenName}
                                </span>
                              )}
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => moveTabOrder(index, 'up')}
                              disabled={index === 0}
                              className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveTabOrder(index, 'down')}
                              disabled={index === selectedTabIds.length - 1}
                              className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => removeTabFromSelection(tab.id)}
                              className="p-1.5 text-red-400 hover:text-red-300 rounded"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 搜索添加 */}
                <div>
                  <h3 className="text-xs font-medium text-neutral-400 mb-2">添加歌曲</h3>
                  <div className="relative mb-2">
                    <input
                      type="text"
                      value={tabSearchTerm}
                      onChange={(e) => setTabSearchTerm(e.target.value)}
                      placeholder="搜索歌曲名、歌手、作曲、作詞..."
                      className="w-full bg-[#282828] border-0 rounded-full px-4 py-2 pr-10 text-white placeholder-[#666] outline-none"
                    />
                    {tabSearchTerm && (
                      <button
                        onClick={() => setTabSearchTerm('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  
                  {tabSearchTerm && tabSearchTerm.trim().length > 0 && tabSearchResults.length === 0 && (
                    <div className="text-center py-4 text-neutral-500 text-sm">
                      找不到符合「{tabSearchTerm}」的歌曲
                    </div>
                  )}
                  
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {filteredTabs().map(tab => {
                      const isSelected = selectedTabIds.includes(tab.id)
                      return (
                        <button
                          key={tab.id}
                          onClick={() => toggleTabSelection(tab.id)}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg transition text-left ${
                            isSelected 
                              ? 'bg-[#FFD700]/20 border border-[#FFD700]/50' 
                              : 'hover:bg-[#282828]'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium truncate ${isSelected ? 'text-[#FFD700]' : 'text-white'}`}>
                              {tab.title}
                            </p>
                            <p className="text-xs text-neutral-500 truncate">
                              {getArtistName(tab)}
                              {tab.uploaderPenName && (
                                <span className="text-[#FFD700] text-[10px] ml-1.5 inline-flex items-center gap-0.5 align-middle">
                                  <svg className="w-2.5 h-2.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                    <path d="m15 5 4 4" />
                                  </svg>
                                  {tab.uploaderPenName}
                                </span>
                              )}
                            </p>
                          </div>
                          {isSelected && <svg className="w-4 h-4 text-[#FFD700] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 12.75l6 6 9-13.5" /></svg>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 頁面布局設置 */}
        {activeTab === 'layout' && (
          <div className="bg-[#121212] rounded-xl border border-neutral-800">
            {/* 新增區域按鈕 */}
            <div className="px-3 pt-3 flex gap-2">
              <button
                onClick={() => setShowPlaylistModal(true)}
                className="flex-1 py-2 bg-[#282828] text-neutral-300 rounded-lg hover:bg-[#3E3E3E] hover:text-white transition flex items-center justify-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" /></svg>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" /></svg>
                單歌單區域
              </button>
              <button
                onClick={() => setShowPlaylistGroupModal(true)}
                className="flex-1 py-2 bg-[#282828] text-neutral-300 rounded-lg hover:bg-[#3E3E3E] hover:text-white transition flex items-center justify-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" /></svg>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>
                多歌單區域
              </button>
              <button
                onClick={() => {
                  if (confirm('確定要重置為預設布局嗎？這會恢復所有區域的顯示。')) {
                    setSettings(prev => ({
                      ...prev,
                      sectionOrder: [
                        { id: 'categories', enabled: true },
                        { id: 'recent', enabled: true },
                        { id: 'hotTabs', enabled: true },
                        { id: 'hotArtists', enabled: true },
                        { id: 'autoPlaylists', enabled: true },
                        { id: 'latest', enabled: true },
                        { id: 'manualPlaylists', enabled: true }
                      ]
                    }))
                    setHasChanges(true)
                  }
                }}
                className="px-3 py-2 bg-red-900/50 text-red-400 rounded-lg hover:bg-red-900 transition text-sm"
              >
                重置
              </button>
            </div>

            <div className="p-3">
              <div className="space-y-1.5">
                {settings.sectionOrder?.map((section, index) => {
                  // 檢查是否為自定義區域
                  const customSection = (settings.customPlaylistSections || [])
                    .find(s => s.id === section.id)
                  
                  // 如果是自定義區域
                  if (customSection) {
                    const isGroup = customSection.type === 'playlistGroup'
                    return (
                      <div 
                        key={section.id}
                        className={`flex items-center gap-2 p-2 rounded-lg border ${
                          section.enabled 
                            ? 'bg-[#FFD700]/10 border-[#FFD700]/30' 
                            : 'bg-neutral-900/30 border-neutral-800/50 opacity-50'
                        }`}
                      >
                        <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={isGroup ? "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" : "M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z"} /></svg>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={section.customLabel || customSection.title}
                            onChange={(e) => {
                              const newOrder = [...settings.sectionOrder]
                              newOrder[index] = { ...section, customLabel: e.target.value }
                              setSettings(prev => ({ ...prev, sectionOrder: newOrder }))
                              setHasChanges(true)
                            }}
                            className="w-full bg-transparent text-white font-medium border-b border-transparent hover:border-neutral-600 transition px-1 -ml-1"
                          />
                        </div>
                        
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => moveSection(index, 'up')}
                            disabled={index === 0}
                            className="p-1 text-neutral-400 hover:text-white disabled:opacity-30 text-sm"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveSection(index, 'down')}
                            disabled={index === settings.sectionOrder.length - 1}
                            className="p-1 text-neutral-400 hover:text-white disabled:opacity-30 text-sm"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => toggleSection(index)}
                            className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                              section.enabled
                                ? 'bg-green-900/50 text-green-400 hover:bg-green-900'
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                            }`}
                          >
                            {section.enabled ? '顯示' : '隱藏'}
                          </button>
                          <button
                            onClick={() => {
                              const newOrder = settings.sectionOrder.filter((_, i) => i !== index)
                              const newCustomSections = settings.customPlaylistSections.filter(s => s.id !== section.id)
                              setSettings(prev => ({
                                ...prev,
                                sectionOrder: newOrder,
                                customPlaylistSections: newCustomSections
                              }))
                              setHasChanges(true)
                            }}
                            className="p-1 text-red-400 hover:text-red-300"
                            title="移除"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  }
                  
                  // 預設區域
                  const option = SECTION_OPTIONS.find(o => o.id === section.id)
                  if (!option) return null
                  const displayLabel = section.customLabel || option.label
                  return (
                    <div 
                      key={section.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border ${
                        section.enabled 
                          ? 'bg-neutral-900/50 border-neutral-800' 
                          : 'bg-neutral-900/30 border-neutral-800/50 opacity-50'
                      }`}
                    >
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={displayLabel}
                            onChange={(e) => {
                              const newOrder = [...settings.sectionOrder]
                              newOrder[index] = { ...section, customLabel: e.target.value }
                              setSettings(prev => ({ ...prev, sectionOrder: newOrder }))
                              setHasChanges(true)
                            }}
                            placeholder={option.label}
                            className="w-full bg-transparent text-sm text-white font-medium border-b border-transparent hover:border-neutral-600 transition px-1 -ml-1"
                          />
                        </div>
                        
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => moveSection(index, 'up')}
                            disabled={index === 0}
                            className="p-1 text-neutral-400 hover:text-white disabled:opacity-30 text-sm"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveSection(index, 'down')}
                            disabled={index === settings.sectionOrder.length - 1}
                            className="p-1 text-neutral-400 hover:text-white disabled:opacity-30 text-sm"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => toggleSection(index)}
                            className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                              section.enabled
                                ? 'bg-green-900/50 text-green-400 hover:bg-green-900'
                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                            }`}
                          >
                            {section.enabled ? '顯示' : '隱藏'}
                          </button>
                        </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* 清除快取 */}
        {activeTab === 'cache' && (
          <div className="bg-[#121212] rounded-lg border border-neutral-800 p-4">
            <h2 className="text-sm font-medium text-white mb-3">快取管理</h2>
            <div className="space-y-2">
              <button
                onClick={rebuildHomeCache}
                disabled={rebuildingCache}
                className="w-full px-4 py-2.5 bg-[#282828] text-white rounded-lg hover:bg-[#3E3E3E] transition disabled:opacity-50 text-left"
              >
                <div className="font-medium">{rebuildingCache ? '重建中...' : '重建首頁'}</div>
                <div className="text-xs text-neutral-500 mt-0.5">如果你改咗 homepage setting 或者有啲嘢應該喺 homepage 見到你又見唔到，就㩒下呢個制</div>
              </button>
              <button
                onClick={rebuildHomeAndSearchCache}
                disabled={rebuildingHomeAndSearchCache}
                className="w-full px-4 py-2.5 bg-[#282828] text-white rounded-lg hover:bg-[#3E3E3E] transition disabled:opacity-50 text-left"
              >
                <div className="font-medium">{rebuildingHomeAndSearchCache ? '重建中...' : '重建所有 cache'}</div>
                <div className="text-xs text-neutral-500 mt-0.5">如果你改咗啲嘢，例如入咗新譜或者改咗歌手資料，又睇唔到，可以試下㩒呢個制</div>
              </button>
            </div>

            <button
              onClick={() => setShowAdvancedCache(v => !v)}
              className="mt-4 text-xs text-neutral-500 hover:text-neutral-300 transition flex items-center gap-1"
            >
              <span>{showAdvancedCache ? '▾' : '▸'}</span>
              <span>進階</span>
            </button>
            {showAdvancedCache && (
              <div className="mt-2 space-y-2">
                <button
                  onClick={() => {
                    try { localStorage.removeItem(HOME_SETTINGS_CACHE_KEY) } catch (_) {}
                    setLoading(true)
                    loadData()
                  }}
                  className="w-full px-4 py-2.5 bg-[#282828] text-white rounded-lg hover:bg-[#3E3E3E] transition text-left"
                >
                  <div className="font-medium">重新載入首頁設置資訊</div>
                  <div className="text-xs text-neutral-500 mt-0.5">此頁會將歌手、樂譜、歌單列表存在瀏覽器 24 小時，按此可清除並重新載入最新資料</div>
                </button>
                <button
                  onClick={rebuildAllTabsCache}
                  disabled={rebuildingAllTabsCache}
                  className="w-full px-4 py-2.5 bg-[#282828] text-white rounded-lg hover:bg-[#3E3E3E] transition disabled:opacity-50 text-left"
                >
                  <div className="font-medium">{rebuildingAllTabsCache ? '重建中...' : '重建樂譜列表快取'}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">重建時會讀取全部樂譜（約 3K 次讀取），寫入單一快取文件。之後每次 getAllTabs 只需 1 次讀取</div>
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mt-4">
          <button
            onClick={saveSettings}
            disabled={saving}
            className={`flex-1 min-w-[120px] py-2.5 rounded-lg font-medium text-sm hover:opacity-90 transition disabled:opacity-50 ${
              hasChanges 
                ? 'bg-[#FFD700] text-black'
                : 'bg-green-600 text-white'
            }`}
          >
            {saving ? '保存中...' : hasChanges ? '保存設置' : '已保存'}
          </button>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2.5 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition text-sm"
          >
            查看首頁
          </button>
        </div>

        {/* 選擇單歌單 Modal */}
        {showPlaylistModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#121212] rounded-xl border border-neutral-800 w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">選擇歌單</h3>
                <button
                  onClick={() => setShowPlaylistModal(false)}
                  className="text-neutral-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              
              <div className="p-4">
                <input
                  type="text"
                  value={playlistSearchTerm}
                  onChange={(e) => setPlaylistSearchTerm(e.target.value)}
                  placeholder="搜尋歌單..."
                  className="w-full bg-[#282828] border-0 rounded-full px-4 py-2 text-white placeholder-[#666] outline-none"
                />
              </div>
              
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="space-y-2">
                  {playlists
                    .filter(p => {
                      if (!playlistSearchTerm) return true
                      return p.title?.toLowerCase().includes(playlistSearchTerm.toLowerCase())
                    })
                    .filter(p => {
                      // 過濾已添加的歌單（單歌單）
                      return !settings.customPlaylistSections?.some(s => s.playlistId === p.id)
                    })
                    .map(playlist => (
                      <button
                        key={playlist.id}
                        onClick={() => addSinglePlaylistSection(playlist)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg bg-neutral-900/50 hover:bg-neutral-800 transition text-left"
                      >
                        <div className="w-12 h-12 rounded bg-neutral-800 flex-shrink-0 overflow-hidden">
                          {playlist.coverImage ? (
                            <img src={playlist.coverImage} alt={playlist.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" /></svg></div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{playlist.title}</p>
                          <p className="text-xs text-neutral-500">
                            {playlist.songIds?.length || 0} 首
                            {playlist.source === 'auto' && ' • 自動生成'}
                            {playlist.source === 'manual' && playlist.curatedBy && ` • By ${playlist.curatedBy}`}
                          </p>
                        </div>
                        <span className="text-[#FFD700]">+</span>
                      </button>
                    ))}
                </div>
                
                {playlists.filter(p => {
                  if (!playlistSearchTerm) return true
                  return p.title?.toLowerCase().includes(playlistSearchTerm.toLowerCase())
                }).filter(p => !settings.customPlaylistSections?.some(s => s.playlistId === p.id)).length === 0 && (
                  <div className="text-center py-8 text-neutral-500">
                    {playlistSearchTerm ? '沒有符合的歌單' : '所有歌單已添加'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 多歌單區域 Modal */}
        {showPlaylistGroupModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#121212] rounded-xl border border-neutral-800 w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">新增多歌單區域</h3>
                <button
                  onClick={() => {
                    setShowPlaylistGroupModal(false)
                    setSelectedPlaylistIds([])
                    setPlaylistGroupTitle('')
                  }}
                  className="text-neutral-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm text-neutral-400 mb-2">區域名稱</label>
                  <input
                    type="text"
                    value={playlistGroupTitle}
                    onChange={(e) => setPlaylistGroupTitle(e.target.value)}
                    placeholder="例如：精選歌單、熱門推薦"
                    className="w-full bg-[#282828] border-0 rounded-full px-4 py-2 text-white placeholder-[#666] outline-none"
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-neutral-400 mb-2">
                    選擇歌單 ({selectedPlaylistIds.length} 個)
                    {loadingPlaylists && <span className="ml-2 text-neutral-500">Loading…</span>}
                  </label>
                  <input
                    type="text"
                    value={playlistSearchTerm}
                    onChange={(e) => setPlaylistSearchTerm(e.target.value)}
                    placeholder="搜尋歌單..."
                    className="w-full bg-[#282828] border-0 rounded-full px-4 py-2 text-white placeholder-[#666] outline-none mb-3"
                  />
                  
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {playlists
                      .filter(p => {
                        if (!playlistSearchTerm) return true
                        return p.title?.toLowerCase().includes(playlistSearchTerm.toLowerCase())
                      })
                      .map(playlist => {
                        const isSelected = selectedPlaylistIds.includes(playlist.id)
                        return (
                          <button
                            key={playlist.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedPlaylistIds(prev => prev.filter(id => id !== playlist.id))
                              } else {
                                setSelectedPlaylistIds(prev => [...prev, playlist.id])
                              }
                            }}
                            className={`w-full flex items-center gap-3 p-3 rounded-lg transition text-left ${
                              isSelected 
                                ? 'bg-blue-900/50 border border-blue-700' 
                                : 'bg-neutral-900/50 hover:bg-neutral-800'
                            }`}
                          >
                            <div className={`w-6 h-6 rounded border flex items-center justify-center ${
                              isSelected ? 'bg-blue-500 border-blue-500' : 'border-neutral-600'
                            }`}>
                              {isSelected && <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 12.75l6 6 9-13.5" /></svg>}
                            </div>
                            <div className="w-12 h-12 rounded bg-neutral-800 flex-shrink-0 overflow-hidden">
                              {playlist.coverImage ? (
                                <img src={playlist.coverImage} alt={playlist.title} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center"><svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" /></svg></div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-medium truncate">{playlist.title}</p>
                              <p className="text-xs text-neutral-500">
                                {playlist.songIds?.length || 0} 首
                              </p>
                            </div>
                          </button>
                        )
                      })}
                  </div>
                </div>
              </div>
              
              <div className="p-4 border-t border-neutral-800 flex gap-3">
                <button
                  onClick={() => {
                    setShowPlaylistGroupModal(false)
                    setSelectedPlaylistIds([])
                    setPlaylistGroupTitle('')
                  }}
                  className="flex-1 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (playlistGroupTitle.trim() && selectedPlaylistIds.length > 0) {
                      addPlaylistGroupSection(selectedPlaylistIds, playlistGroupTitle.trim())
                      setSelectedPlaylistIds([])
                      setPlaylistGroupTitle('')
                    }
                  }}
                  disabled={!playlistGroupTitle.trim() || selectedPlaylistIds.length === 0}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  新增 ({selectedPlaylistIds.length})
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

export default function HomeSettingsGuard() {
  return (
    <AdminGuard>
      <HomeSettings />
    </AdminGuard>
  )
}
