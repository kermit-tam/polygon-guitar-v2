import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import Link from '@/components/Link'
import AdminGuard from '@/components/AdminGuard'
import CoverGenerator from '@/components/CoverGenerator'
import { 
  getAllPlaylists, 
  getAutoPlaylists,
  refreshAllAutoPlaylists,
  deletePlaylist,
  updatePlaylist,
  AUTO_PLAYLIST_TYPES
} from '@/lib/playlists'
import { isChaksaPlaylist } from '@/lib/chaksaPlaylist'
import { getTabsByIds } from '@/lib/tabs'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { auth } from '@/lib/firebase'
import { ArrowLeft, BarChart2, Sparkles } from 'lucide-react'

function PlaylistAdmin() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('playlistTab') || 'auto'
    }
    return 'auto'
  })
  const [autoPlaylists, setAutoPlaylists] = useState([])
  const [manualPlaylists, setManualPlaylists] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(null)
  const [message, setMessage] = useState(null)
  const [editingAuto, setEditingAuto] = useState(null) // 正在編輯的自動歌單
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  
  // 拖拽排序狀態
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [draggingAutoIndex, setDraggingAutoIndex] = useState(null)

  // 封面生成器狀態
  const [coverGenPlaylist, setCoverGenPlaylist] = useState(null)
  const [coverGenSongs, setCoverGenSongs] = useState([])
  const [coverGenLoading, setCoverGenLoading] = useState(false)

  useEffect(() => {
    loadPlaylists()
  }, [])

  const loadPlaylists = async () => {
    try {
      setIsLoading(true)
      const allPlaylists = await getAllPlaylists()
      
      setAutoPlaylists(allPlaylists.filter(p => p.source === 'auto'))
      setManualPlaylists(allPlaylists.filter(p => p.source === 'manual'))
    } catch (error) {
      console.error('Error loading playlists:', error)
      showMessage('載入失敗：' + error.message, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 5000)
  }

  // 歌單有改動時同步重建首頁快取，避免首頁「POLYGON自製歌單」仍顯示舊排序
  const rebuildHomeCacheAfterPlaylistChange = async () => {
    try {
      const token = await auth.currentUser?.getIdToken?.()
      if (!token) return
      const res = await fetch('/api/admin/rebuild-home-cache', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        try { localStorage.removeItem('pg_home_cache_v2') } catch (_) {}
      }
    } catch (e) {
      console.warn('rebuildHomeCacheAfterPlaylistChange failed:', e?.message || e)
    }
  }

  // 清除單一歌單頁快取（cache/playlist_{id}），確保封面/標題等即時反映喺 /playlist/[id]
  const bustPlaylistPageCache = async (playlistId) => {
    if (!playlistId) return
    try {
      const token = await auth.currentUser?.getIdToken?.()
      if (!token) return
      await fetch('/api/admin/bust-playlist-cache', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ playlistId })
      })
    } catch (e) {
      console.warn('bustPlaylistPageCache failed:', e?.message || e)
    }
  }

  // 刷新自動歌單
  const handleRefreshAuto = async () => {
    setIsRefreshing(true)
    try {
      const results = await refreshAllAutoPlaylists()
      const successCount = results.filter(r => r.action !== 'error').length
      showMessage(`✅ 成功刷新 ${successCount} 個自動歌單`)
      await loadPlaylists()
    } catch (error) {
      showMessage('❌ 刷新失敗：' + error.message, 'error')
    } finally {
      setIsRefreshing(false)
    }
  }

  // 切換歌單啟用狀態
  const togglePlaylistActive = async (playlist) => {
    try {
      await updatePlaylist(playlist.id, { isActive: !playlist.isActive })
      await bustPlaylistPageCache(playlist.id)
      await rebuildHomeCacheAfterPlaylistChange()
      showMessage(playlist.isActive ? '已隱藏歌單' : '已啟用歌單')
      await loadPlaylists()
    } catch (error) {
      showMessage('操作失敗：' + error.message, 'error')
    }
  }

  // 切換「自動最近上架」模式
  const toggleAutoRecent = async (playlist) => {
    const next = !playlist.isAutoRecent
    try {
      await updatePlaylist(playlist.id, { isAutoRecent: next })
      await bustPlaylistPageCache(playlist.id)
      showMessage(next ? '✅ 已啟用自動最近上架模式' : '✅ 已關閉自動模式，改回手動 songIds')
      await loadPlaylists()
    } catch (error) {
      showMessage('操作失敗：' + error.message, 'error')
    }
  }

  // 刪除手動歌單
  const handleDeleteManual = async (playlist) => {
    if (!confirm(`確定要刪除歌單「${playlist.title}」嗎？此操作不可恢復。`)) return
    
    try {
      await deletePlaylist(playlist.id)
      await bustPlaylistPageCache(playlist.id)
      await rebuildHomeCacheAfterPlaylistChange()
      showMessage('✅ 歌單已刪除')
      await loadPlaylists()
    } catch (error) {
      showMessage('❌ 刪除失敗：' + error.message, 'error')
    }
  }

  // 上下移動（備選）
  const moveUp = async (playlist, index, list) => {
    if (index === 0) return
    await swapOrder(index, index - 1, list, playlist.source)
  }

  const moveDown = async (playlist, index, list) => {
    if (index === list.length - 1) return
    await swapOrder(index, index + 1, list, playlist.source)
  }

  const swapOrder = async (fromIndex, toIndex, list, source) => {
    const newList = [...list]
    const temp = newList[fromIndex]
    newList[fromIndex] = newList[toIndex]
    newList[toIndex] = temp
    
    const updates = newList.map((p, i) => ({ ...p, displayOrder: i }))
    
    try {
      const { updatePlaylistsOrder } = await import('@/lib/playlists')
      await updatePlaylistsOrder(updates)
      await rebuildHomeCacheAfterPlaylistChange()
      
      if (source === 'auto') setAutoPlaylists(updates)
      else setManualPlaylists(updates)
      
      showMessage('✅ 排序已更新')
    } catch (error) {
      showMessage('排序更新失敗：' + error.message, 'error')
    }
  }

  // 通用拖拽排序（支援 touch + mouse）
  const touchState = useRef({ startY: 0, currentIndex: null, type: null })

  const saveSortOrder = useCallback(async (list) => {
    const updates = list.map((p, i) => ({ ...p, displayOrder: i }))
    try {
      const { updatePlaylistsOrder } = await import('@/lib/playlists')
      await updatePlaylistsOrder(updates)
      await rebuildHomeCacheAfterPlaylistChange()
      showMessage('✅ 排序已保存')
    } catch (error) {
      showMessage('❌ 排序保存失敗：' + error.message, 'error')
    }
  }, [])

  // Mouse drag - 自動歌單
  const handleAutoDragStart = (e, index) => {
    setDraggingAutoIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleAutoDragOver = (e, index) => {
    e.preventDefault()
    if (draggingAutoIndex === null || draggingAutoIndex === index) return
    const newList = [...autoPlaylists]
    const [movedItem] = newList.splice(draggingAutoIndex, 1)
    newList.splice(index, 0, movedItem)
    setAutoPlaylists(newList)
    setDraggingAutoIndex(index)
  }
  const handleAutoDragEnd = async () => {
    if (draggingAutoIndex !== null) await saveSortOrder(autoPlaylists)
    setDraggingAutoIndex(null)
  }

  // Mouse drag - 精選歌單
  const handleDragStart = (e, index) => {
    setDraggingIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (e, index) => {
    e.preventDefault()
    if (draggingIndex === null || draggingIndex === index) return
    const newList = [...manualPlaylists]
    const [movedItem] = newList.splice(draggingIndex, 1)
    newList.splice(index, 0, movedItem)
    setManualPlaylists(newList)
    setDraggingIndex(index)
  }
  const handleDragEnd = async () => {
    if (draggingIndex !== null) await saveSortOrder(manualPlaylists)
    setDraggingIndex(null)
  }

  // Touch drag - 用 ref 綁定 non-passive listener 防止頁面滾動
  const autoListRef = useRef(null)
  const manualListRef = useRef(null)
  const listsRef = useRef({ auto: autoPlaylists, manual: manualPlaylists })
  listsRef.current = { auto: autoPlaylists, manual: manualPlaylists }

  useEffect(() => {
    const onTouchMove = (e) => {
      const { currentIndex, type } = touchState.current
      if (currentIndex === null) return
      e.preventDefault()
      const touchY = e.touches[0].clientY
      const container = type === 'auto' ? autoListRef.current : manualListRef.current
      if (!container) return
      const elements = container.querySelectorAll('[data-drag-item]')
      for (let i = 0; i < elements.length; i++) {
        const rect = elements[i].getBoundingClientRect()
        if (touchY >= rect.top && touchY <= rect.bottom && i !== currentIndex) {
          const list = [...listsRef.current[type]]
          const [movedItem] = list.splice(currentIndex, 1)
          list.splice(i, 0, movedItem)
          if (type === 'auto') {
            setAutoPlaylists(list)
            setDraggingAutoIndex(i)
          } else {
            setManualPlaylists(list)
            setDraggingIndex(i)
          }
          touchState.current.currentIndex = i
          break
        }
      }
    }

    const onTouchEnd = async () => {
      const { currentIndex, type } = touchState.current
      if (currentIndex === null) return
      if (type === 'auto') {
        await saveSortOrder(listsRef.current.auto)
        setDraggingAutoIndex(null)
      } else {
        await saveSortOrder(listsRef.current.manual)
        setDraggingIndex(null)
      }
      touchState.current = { startY: 0, currentIndex: null, type: null }
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [saveSortOrder])

  const handleTouchStart = (index, type) => (e) => {
    e.stopPropagation()
    touchState.current = { startY: e.touches[0].clientY, currentIndex: index, type }
    if (type === 'auto') setDraggingAutoIndex(index)
    else setDraggingIndex(index)
  }

  const handleMouseDragStart = (index, type) => (e) => {
    const card = e.target.closest('[data-drag-item]')
    if (card) {
      e.dataTransfer.effectAllowed = 'move'
      if (type === 'auto') setDraggingAutoIndex(index)
      else setDraggingIndex(index)
    }
  }

  // 上傳封面圖片
  const handleCoverUpload = async (playlist, file) => {
    if (!file) return
    
    setUploadingCover(playlist.id)
    try {
      const imageUrl = await uploadToCloudinary(file, playlist.title, 'playlist_covers')
      await updatePlaylist(playlist.id, {
        coverImage: imageUrl,
        customCover: true,
        updatedAt: new Date().toISOString()
      })
      await bustPlaylistPageCache(playlist.id)
      await rebuildHomeCacheAfterPlaylistChange()
      showMessage('✅ 封面上傳成功')
      await loadPlaylists()
    } catch (error) {
      showMessage('❌ 上傳失敗：' + error.message, 'error')
    } finally {
      setUploadingCover(null)
    }
  }

  // 開始編輯自動歌單
  const startEditAuto = (playlist) => {
    setEditingAuto(playlist.id)
    setEditTitle(playlist.title)
    setEditDescription(playlist.description || '')
  }

  // 保存自動歌單編輯
  const saveAutoEdit = async (playlistId) => {
    try {
      await updatePlaylist(playlistId, {
        title: editTitle,
        description: editDescription,
        updatedAt: new Date().toISOString()
      })
      await bustPlaylistPageCache(playlistId)
      await rebuildHomeCacheAfterPlaylistChange()
      showMessage('✅ 歌單已更新')
      setEditingAuto(null)
      await loadPlaylists()
    } catch (error) {
      showMessage('❌ 更新失敗：' + error.message, 'error')
    }
  }

  // 取消編輯
  const cancelEditAuto = () => {
    setEditingAuto(null)
    setEditTitle('')
    setEditDescription('')
  }

  // 打開封面生成器
  const openCoverGenerator = async (playlist) => {
    setCoverGenPlaylist(playlist)
    setCoverGenSongs([])
    if (playlist.songIds?.length) {
      setCoverGenLoading(true)
      try {
        const songs = await getTabsByIds(playlist.songIds)
        setCoverGenSongs(songs)
      } catch (err) {
        console.error('Load songs error:', err)
      } finally {
        setCoverGenLoading(false)
      }
    }
  }

  const handleCoverGenerated = async (file) => {
    if (!coverGenPlaylist) return
    setUploadingCover(coverGenPlaylist.id)
    try {
      const imageUrl = await uploadToCloudinary(file, coverGenPlaylist.title, 'playlist_covers')
      await updatePlaylist(coverGenPlaylist.id, {
        coverImage: imageUrl,
        customCover: true,
        updatedAt: new Date().toISOString()
      })
      await bustPlaylistPageCache(coverGenPlaylist.id)
      await rebuildHomeCacheAfterPlaylistChange()
      showMessage('封面已生成並上傳')
      setCoverGenPlaylist(null)
      await loadPlaylists()
    } catch (err) {
      showMessage('上傳失敗：' + err.message, 'error')
    } finally {
      setUploadingCover(null)
    }
  }

  // 格式化時間
  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '從未更新'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    const now = new Date()
    const diff = Math.floor((now - date) / 1000)
    
    if (diff < 60) return '剛剛'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
    if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
    return date.toLocaleDateString('zh-HK')
  }

  // 歌單類型標籤
  const getTypeLabel = (type) => {
    const labels = {
      artist: '歌手',
      theme: '主題', 
      series: '系列',
      mood: '場景',
      custom: '精選',
      chaksa: '叱咤十大'
    }
    return labels[type] || '精選'
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-3">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <button onClick={() => router.back()} className="text-neutral-400 hover:text-white transition" aria-label="返回">
                <ArrowLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-bold text-white">歌單管理</h1>
            </div>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
            message.type === 'error' 
              ? 'bg-red-900 border border-red-700 text-red-400' 
              : 'bg-green-900 border border-green-700 text-green-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center border-b border-neutral-800">
          <button
            onClick={() => { setActiveTab('auto'); localStorage.setItem('playlistTab', 'auto') }}
            className={`px-6 py-3 font-medium transition ${
              activeTab === 'auto' ? 'text-[#FFD700] border-b-2 border-[#FFD700]' : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            自動生成歌單
            <button
              onClick={(e) => { e.stopPropagation(); handleRefreshAuto() }}
              disabled={isRefreshing}
              className="ml-2 text-neutral-400 hover:text-white transition disabled:opacity-50 inline-flex"
              title="立即刷新數據"
            >
              <svg className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </button>
          <button
            onClick={() => { setActiveTab('manual'); localStorage.setItem('playlistTab', 'manual') }}
            className={`px-6 py-3 font-medium transition ${
              activeTab === 'manual' ? 'text-[#FFD700] border-b-2 border-[#FFD700]' : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            自製歌單
            <span className="ml-2 text-xs bg-neutral-800 px-2 py-0.5 rounded-full">{manualPlaylists.length}</span>
          </button>
        </div>

        {/* Auto Playlists Tab */}
        {activeTab === 'auto' && (
          <div className="space-y-6">

            {/* Auto Playlist List */}
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 bg-neutral-800 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-1" ref={autoListRef}>
                {autoPlaylists.map((playlist, index) => (
                  <div
                    key={playlist.id}
                    data-drag-item
                    onDragOver={(e) => handleAutoDragOver(e, index)}
                    className={`p-2 bg-[#121212] rounded-lg border transition select-none ${
                      draggingAutoIndex === index ? 'border-[#FFD700] opacity-50' : 'border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 w-full">
                      {/* Drag handle */}
                      <div
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDraggingAutoIndex(index) }}
                        onDragEnd={handleAutoDragEnd}
                        onTouchStart={handleTouchStart(index, 'auto')}
                        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-neutral-600 hover:text-neutral-400 touch-none"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                        </svg>
                      </div>
                      {/* Cover */}
                      <div className="relative w-[70px] h-[70px] rounded-lg bg-neutral-800 overflow-hidden flex-shrink-0 group">
                        {playlist.coverImage ? (
                          <img src={playlist.coverImage} alt={playlist.title} className="w-full h-full object-cover pointer-events-none" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-500"><BarChart2 className="w-6 h-6" strokeWidth={1.5} /></div>
                        )}
                        <label className={`absolute inset-0 flex items-center justify-center bg-black/60 cursor-pointer transition ${playlist.coverImage ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                          {uploadingCover === playlist.id ? (
                            <svg className="w-5 h-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          )}
                          <input type="file" accept="image/*" className="hidden" disabled={uploadingCover === playlist.id}
                            onChange={(e) => { const file = e.target.files[0]; if (file) handleCoverUpload(playlist, file) }} />
                        </label>
                      </div>
                      
                      {/* Info + Actions */}
                      <div className="flex-1 min-w-0">
                        {editingAuto === playlist.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full px-2 py-1 bg-black border border-neutral-600 rounded text-white text-sm"
                              placeholder="歌單名稱"
                            />
                            <input
                              type="text"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="w-full px-2 py-1 bg-black border border-neutral-600 rounded text-neutral-400 text-xs"
                              placeholder="描述"
                            />
                            <div className="flex gap-2">
                              <button onClick={() => saveAutoEdit(playlist.id)} className="px-2 py-1 bg-green-700 text-white text-xs rounded">保存</button>
                              <button onClick={cancelEditAuto} className="px-2 py-1 bg-neutral-700 text-white text-xs rounded">取消</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <h3 className="text-white font-medium truncate">{playlist.title}</h3>
                              <button onClick={() => togglePlaylistActive(playlist)}
                                className={`w-10 h-5 rounded-full transition relative flex-shrink-0 ml-2 ${playlist.isActive ? 'bg-[#FFD700]' : 'bg-neutral-700'}`}>
                                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition"
                                  style={{ left: playlist.isActive ? '22px' : '2px' }} />
                              </button>
                            </div>
                            <p className="text-xs text-neutral-500 mt-0.5">{playlist.description?.length > 8 ? playlist.description.slice(0, 8) + '…' : playlist.description}</p>
                            <div className="flex items-center justify-between mt-1.5">
                              <p className="text-xs flex items-center gap-1.5">
                                {playlist.isAutoRecent
                                  ? <span className="text-green-400 font-medium">⚡ 自動最近上架</span>
                                  : <span className="text-neutral-600">{formatTimeAgo(playlist.lastUpdated)}更新</span>
                                }
                              </p>
                              <div className="flex items-center gap-1">
                                {(playlist.isAutoRecent || playlist.autoType === 'weekly') && (
                                  <button
                                    onClick={() => toggleAutoRecent(playlist)}
                                    title={playlist.isAutoRecent ? '關閉自動模式（返回定期更新）' : '啟用：永遠顯示最新上架嘅歌'}
                                    className={`p-1.5 transition ${playlist.isAutoRecent ? 'text-green-400 hover:text-red-400' : 'text-neutral-500 hover:text-green-400'}`}
                                  >
                                    ⚡
                                  </button>
                                )}
                                <button onClick={() => openCoverGenerator(playlist)}
                                  className="p-1.5 text-neutral-500 hover:text-[#FFD700] transition" title="生成封面">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </button>
                                <button onClick={() => startEditAuto(playlist)}
                                  className="p-1.5 text-neutral-500 hover:text-[#FFD700] transition" title="編輯名稱">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isLoading && autoPlaylists.length < 4 && (
              <div className="p-6 bg-yellow-900/20 border border-yellow-800 rounded-lg text-center">
                <p className="text-yellow-400 mb-4">缺少 {4 - autoPlaylists.length} 個自動歌單</p>
                <button onClick={handleRefreshAuto} disabled={isRefreshing}
                  className="px-6 py-2 bg-yellow-700 text-white rounded-lg hover:bg-yellow-600 transition disabled:opacity-50">
                  {isRefreshing ? '創建中...' : '創建所有自動歌單'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Manual Playlists Tab */}
        {activeTab === 'manual' && (
          <div className="space-y-6">
            {/* Header with add button and hint */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                </svg>
                拖曳歌單可調整排序
              </p>
              <div className="flex flex-wrap gap-2 justify-end">
                <Link href="/admin/playlists/chaksa/new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#282828] text-[#FFD700] border border-[#FFD700]/40 rounded-lg font-medium hover:bg-[#3E3E3E] transition text-sm">
                  新增叱咤歌單
                </Link>
                <Link href="/admin/playlists/new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700] text-black rounded-lg font-medium hover:opacity-90 transition text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  新增精選歌單
                </Link>
              </div>
            </div>

            {/* Manual Playlist List - Compact with Drag */}
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-16 bg-neutral-800 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : manualPlaylists.length > 0 ? (
              <div className="space-y-1" ref={manualListRef}>
                {manualPlaylists.map((playlist, index) => (
                  <div
                    key={playlist.id}
                    data-drag-item
                    onDragOver={(e) => handleDragOver(e, index)}
                    className={`p-2 bg-[#121212] rounded-lg border transition select-none ${
                      draggingIndex === index ? 'border-[#FFD700] opacity-50' : 'border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 w-full">
                      {/* Drag handle */}
                      <div
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDraggingIndex(index) }}
                        onDragEnd={handleDragEnd}
                        onTouchStart={handleTouchStart(index, 'manual')}
                        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-neutral-600 hover:text-neutral-400 touch-none"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                        </svg>
                      </div>
                      {/* Cover */}
                      <div className="relative w-[70px] h-[70px] rounded-lg bg-neutral-800 overflow-hidden flex-shrink-0 group">
                        {playlist.coverImage ? (
                          <img src={playlist.coverImage} alt={playlist.title} className="w-full h-full object-cover pointer-events-none" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-500"><Sparkles className="w-6 h-6" strokeWidth={1.5} /></div>
                        )}
                        <label className={`absolute inset-0 flex items-center justify-center bg-black/60 cursor-pointer transition ${playlist.coverImage ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                          {uploadingCover === playlist.id ? (
                            <svg className="w-5 h-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          )}
                          <input type="file" accept="image/*" className="hidden" disabled={uploadingCover === playlist.id}
                            onChange={(e) => { const file = e.target.files[0]; if (file) handleCoverUpload(playlist, file) }} />
                        </label>
                      </div>
                      
                      {/* Info + Actions */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="text-white font-medium truncate">{playlist.title}</h3>
                          <button onClick={() => togglePlaylistActive(playlist)}
                            className={`w-10 h-5 rounded-full transition relative flex-shrink-0 ml-2 ${playlist.isActive ? 'bg-[#FFD700]' : 'bg-neutral-700'}`}>
                            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition"
                              style={{ left: playlist.isActive ? '22px' : '2px' }} />
                          </button>
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5">{(playlist.description || '無描述').length > 8 ? (playlist.description || '無描述').slice(0, 8) + '…' : (playlist.description || '無描述')}</p>
                        <div className="flex items-center justify-between mt-1.5">
                          <p className="text-xs text-neutral-600 flex items-center gap-1.5">
                            {playlist.isAutoRecent
                              ? <span className="text-green-400 font-medium">⚡ 自動最近上架</span>
                              : <>{(isChaksaPlaylist(playlist) ? playlist.chartEntries?.length : playlist.songIds?.length) || 0} 首 • {getTypeLabel(playlist.manualType)}</>
                            }
                          </p>
                          <div className="flex items-center gap-1">
                            {playlist.isAutoRecent && (
                              <button
                                onClick={() => toggleAutoRecent(playlist)}
                                title="關閉自動模式"
                                className="p-1.5 transition text-green-400 hover:text-red-400"
                              >
                                ⚡
                              </button>
                            )}
                            {isChaksaPlaylist(playlist) && (
                              <Link href={`/admin/playlists/chaksa/${playlist.id}`}
                                className="p-1.5 text-[#FFD700] hover:text-white transition" title="編輯叱咤榜單">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </Link>
                            )}
                            <button onClick={() => openCoverGenerator(playlist)}
                              className="p-1.5 text-neutral-500 hover:text-[#FFD700] transition" title="生成封面">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <Link href={`/playlist/${playlist.slug ?? playlist.id}`}
                              className="p-1.5 text-neutral-500 hover:text-[#FFD700] transition" title="編輯">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </Link>
                            <button onClick={() => handleDeleteManual(playlist)}
                              className="p-1.5 text-neutral-500 hover:text-red-500 transition" title="刪除">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-[#121212] rounded-xl border border-neutral-800">
                <Sparkles className="w-16 h-16 block mb-4 mx-auto text-neutral-500" strokeWidth={1.5} />
                <h3 className="text-xl text-white mb-2">暫時冇精選歌單</h3>
                <p className="text-neutral-500 mb-6">建立你的第一個精選歌單</p>
                <Link href="/admin/playlists/new" className="inline-flex items-center gap-2 px-6 py-3 bg-[#FFD700] text-black rounded-lg font-medium hover:opacity-90 transition">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  新增精選歌單
                </Link>
              </div>
            )}
          </div>
        )}
        {/* Cover Generator Modal */}
        {coverGenPlaylist && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-start md:items-center justify-center overflow-y-auto" onClick={() => setCoverGenPlaylist(null)}>
            <div className="w-full max-w-lg mt-12 md:mt-4 mb-4 mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex justify-end mb-1">
                <button onClick={() => setCoverGenPlaylist(null)} className="text-neutral-400 hover:text-white transition">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="bg-[#121212] rounded-xl border border-neutral-700 p-4">
              {coverGenLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <CoverGenerator
                  key={coverGenPlaylist.id}
                  songs={coverGenSongs}
                  playlistTitle={coverGenPlaylist.title}
                  onGenerated={handleCoverGenerated}
                  showTitleTextColorPicker
                />
              )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

export default function PlaylistAdminPage() {
  return (
    <AdminGuard>
      <PlaylistAdmin />
    </AdminGuard>
  )
}
