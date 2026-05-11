import { useState, useEffect, useRef } from 'react'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'
import { db } from '@/lib/firebase'
import {
  collection, getDocs, doc, setDoc, deleteDoc,
  query, where, or, serverTimestamp
} from '@/lib/firestore-tracked'

function extractYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

const LEVELS = [
  { key: 'easy', label: '入門級', color: '#22c55e' },
  { key: 'medium', label: '難少少', color: '#f59e0b' },
  { key: 'hell', label: '地獄級', color: '#ef4444' },
]
const LEVEL_LABELS = LEVELS.reduce((m, l) => ({ ...m, [l.key]: l.label }), {})
const LEVEL_COLORS = LEVELS.reduce((m, l) => ({ ...m, [l.key]: l.color }), {})

// 迷你 YouTube 預覽播放器
function MiniPlayer({ videoId, startSecond, onUseTime }) {
  const containerRef = useRef(null)
  const playerRef = useRef(null)
  const pollRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(startSecond || 0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!videoId || !containerRef.current) return
    const init = () => {
      if (!window.YT?.Player) { setTimeout(init, 300); return }
      containerRef.current.innerHTML = ''
      const div = document.createElement('div')
      div.id = `yt-mini-${videoId}-${Date.now()}`
      containerRef.current.appendChild(div)
      playerRef.current = new window.YT.Player(div.id, {
        height: '160', width: '284',
        videoId,
        playerVars: { controls: 1, start: startSecond || 0, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            setReady(true)
            playerRef.current.seekTo(startSecond || 0, true)
            pollRef.current = setInterval(() => {
              try { setCurrentTime(Math.floor(playerRef.current.getCurrentTime())) } catch {}
            }, 500)
          }
        }
      })
    }
    init()
    return () => { clearInterval(pollRef.current); try { playerRef.current?.destroy() } catch {} }
  }, [videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-2">
      <div ref={containerRef} className="rounded-lg overflow-hidden bg-black" style={{ width: 284, height: 160 }} />
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[#B3B3B3]">目前：<span className="text-[#FFD700] font-mono">{currentTime}s</span></span>
        {ready && (
          <button onClick={() => onUseTime(currentTime)} className="ml-auto px-3 py-1 rounded-lg text-xs font-bold text-black" style={{ background: '#FFD700' }}>
            用 {currentTime}s 做起點
          </button>
        )}
      </div>
    </div>
  )
}

export default function GameSettingsPage() {
  // ── 歌手管理 ──
  const [gameArtists, setGameArtists] = useState([])   // gameArtists collection
  const [allArtists, setAllArtists] = useState([])     // artists collection（搜尋用）
  const [artistSearch, setArtistSearch] = useState('')
  const [artistSearchResults, setArtistSearchResults] = useState([])
  const [addingArtist, setAddingArtist] = useState(null)

  // ── 選中歌手（管理歌單）──
  const [selectedArtist, setSelectedArtist] = useState(null)

  // ── 雜錦模式：當前喺「從網站樂譜選歌」入面揀緊邊個歌手嘅歌
  const [mixedTabArtist, setMixedTabArtist] = useState(null) // {id, name, photo}
  const [mixedArtistSearch, setMixedArtistSearch] = useState('')

  // ── 歌單管理 ──
  const [tab, setTab] = useState('songs')
  const [loading, setLoading] = useState(true)
  const [gameSongs, setGameSongs] = useState([])
  const [allTabs, setAllTabs] = useState([])
  const [tabSearch, setTabSearch] = useState('')
  const [startSeconds, setStartSeconds] = useState({})
  const [songTitles, setSongTitles] = useState({})
  const [editingTitleId, setEditingTitleId] = useState(null)
  const [previewId, setPreviewId] = useState(null)
  const [saving, setSaving] = useState({})
  const [savedMsg, setSavedMsg] = useState({})

  // ── YouTube 搜尋 ──
  const [ytQuery, setYtQuery] = useState('')
  const [ytResults, setYtResults] = useState([])
  const [ytSearching, setYtSearching] = useState(false)
  const [ytError, setYtError] = useState(null)
  const [ytAddingId, setYtAddingId] = useState(null)
  const [ytPreviewId, setYtPreviewId] = useState(null)
  const [ytStartSeconds, setYtStartSeconds] = useState({})
  const [ytTitles, setYtTitles] = useState({})

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.YT) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
    loadInitial()
  }, [])

  async function loadInitial() {
    setLoading(true)
    try {
      // 載入 gameArtists
      const gaSnap = await getDocs(collection(db, 'gameArtists'))
      const ga = gaSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99))
      setGameArtists(ga)

      // 載入 artists collection（供搜尋）
      const aSnap = await getDocs(collection(db, 'artists'))
      setAllArtists(aSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } finally {
      setLoading(false)
    }
  }

  // 搜尋歌手
  const handleArtistSearch = (q) => {
    setArtistSearch(q)
    if (!q.trim()) { setArtistSearchResults([]); return }
    const gaIds = new Set(gameArtists.map(a => a.artistId))
    const results = allArtists
      .filter(a => a.name?.toLowerCase().includes(q.toLowerCase()) && !gaIds.has(a.id))
      .slice(0, 5)
    setArtistSearchResults(results)
  }

  // 加入遊戲歌手
  const handleAddArtist = async (artist) => {
    const id = `ga_${artist.id}`
    setAddingArtist(artist.id)
    try {
      const data = {
        artistId: artist.id,
        name: artist.name,
        photo: artist.photoURL || artist.wikiPhotoURL || '',
        enabled: true,
        displayOrder: gameArtists.length,
        addedAt: serverTimestamp(),
      }
      await setDoc(doc(db, 'gameArtists', id), data)
      const newArtist = { id, ...data }
      setGameArtists(p => [...p, newArtist])
      setArtistSearch('')
      setArtistSearchResults([])
    } finally {
      setAddingArtist(null)
    }
  }

  // 建立雜錦歌單（可建多個，獨立 ID）
  const handleCreateMixed = async () => {
    const ts = Date.now()
    const id = `ga_mixed_${ts}`
    const mixedArtistId = `mixed_${ts}`
    const existingMixedCount = gameArtists.filter(a => a.isMixed).length
    const data = {
      artistId: mixedArtistId,
      name: existingMixedCount === 0 ? '雜錦歌單' : `雜錦歌單 ${existingMixedCount + 1}`,
      photo: '',
      isMixed: true,
      enabled: true,
      displayOrder: gameArtists.length,
      addedAt: serverTimestamp(),
    }
    await setDoc(doc(db, 'gameArtists', id), data)
    setGameArtists(p => [...p, { id, ...data }])
  }

  // 改名（雜錦歌單）
  const [editingNameId, setEditingNameId] = useState(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const handleStartRename = (ga) => {
    setEditingNameId(ga.id)
    setEditingNameValue(ga.name || '')
  }
  const handleSaveRename = async (gaId) => {
    const newName = editingNameValue.trim()
    if (!newName) { setEditingNameId(null); return }
    await setDoc(doc(db, 'gameArtists', gaId), { name: newName }, { merge: true })
    setGameArtists(p => p.map(a => a.id === gaId ? { ...a, name: newName } : a))
    if (selectedArtist?.id === gaId) setSelectedArtist(a => ({ ...a, name: newName }))
    setEditingNameId(null)
  }

  // 移除遊戲歌手
  const handleRemoveArtist = async (gaId) => {
    if (!confirm('確定移除？')) return
    await deleteDoc(doc(db, 'gameArtists', gaId))
    setGameArtists(p => p.filter(a => a.id !== gaId))
    if (selectedArtist?.id === gaId) setSelectedArtist(null)
  }

  // 切換啟用狀態
  const handleToggleArtist = async (ga) => {
    await setDoc(doc(db, 'gameArtists', ga.id), { enabled: !ga.enabled }, { merge: true })
    setGameArtists(p => p.map(a => a.id === ga.id ? { ...a, enabled: !a.enabled } : a))
  }

  // 選擇歌手查看歌單
  const handleSelectArtist = async (ga) => {
    setSelectedArtist(ga)
    setGameSongs([])
    setAllTabs([])
    setMixedTabArtist(null)
    setMixedArtistSearch('')
    setTab('songs')
    setLoading(true)
    try {
      // gameSongs
      const gsSnap = await getDocs(query(collection(db, 'gameSongs'), where('artistId', '==', ga.artistId)))
      const gs = gsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.addedAt?.seconds ?? 0) - (b.addedAt?.seconds ?? 0))
      setGameSongs(gs)
      const init = {}; const initT = {}
      gs.forEach(s => { init[s.id] = s.gameStartSecond ?? 0; initT[s.id] = s.title || '' })
      setStartSeconds(init); setSongTitles(initT)

      // 雜錦模式唔自動載 tabs（等用戶搜尋歌手）
      if (ga.isMixed) {
        setLoading(false)
        return
      }

      // tabs
      const aSnap = await getDocs(collection(db, 'artists'))
      const matchedIds = aSnap.docs.filter(d => d.id === ga.artistId || d.data().name?.includes(ga.name)).map(d => d.id)
      if (matchedIds.length === 0) matchedIds.push(ga.artistId)
      const conditions = matchedIds.flatMap(id => [where('artistId', '==', id), where('artistIds', 'array-contains', id)])
      const tabsSnap = await getDocs(query(collection(db, 'tabs'), or(...conditions)))
      const tabs = tabsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.youtubeUrl && extractYouTubeId(s.youtubeUrl))
      const seen = new Set()
      setAllTabs(tabs.filter(s => { const k = s.title?.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
        .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hant')))
    } finally {
      setLoading(false)
    }
  }

  // 雜錦模式：揀某個歌手後載入該歌手嘅 tabs
  const handlePickMixedArtist = async (a) => {
    setMixedTabArtist(a)
    setMixedArtistSearch('')
    setAllTabs([])
    setLoading(true)
    try {
      const conditions = [where('artistId', '==', a.id), where('artistIds', 'array-contains', a.id)]
      const tabsSnap = await getDocs(query(collection(db, 'tabs'), or(...conditions)))
      const tabs = tabsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.youtubeUrl && extractYouTubeId(s.youtubeUrl))
      const seen = new Set()
      setAllTabs(tabs.filter(s => { const k = s.title?.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
        .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hant')))
    } finally {
      setLoading(false)
    }
  }

  const gameSongIds = new Set(gameSongs.map(s => s.tabId).filter(Boolean))
  const gameSongYtIds = new Set(gameSongs.map(s => extractYouTubeId(s.youtubeUrl)).filter(Boolean))

  const handleAddTab = async (song) => {
    const isMixed = selectedArtist.isMixed
    // 雜錦模式：同一首歌可能加多次，所以 id 加埋當前歌手做區分
    const id = isMixed ? `tab_mixed_${song.id}` : `tab_${song.id}`
    setSaving(p => ({ ...p, [id]: true }))
    try {
      const gsDoc = {
        title: song.title || '',
        artistName: isMixed ? (mixedTabArtist?.name || song.artistName || '') : selectedArtist.name,
        artistId: selectedArtist.artistId,
        youtubeUrl: song.youtubeUrl,
        gameStartSecond: 0,
        source: 'tab',
        tabId: song.id,
        level: 'easy',
        enabled: true,
        addedAt: serverTimestamp(),
        ...(isMixed && {
          originalArtistId: mixedTabArtist?.id || '',
          originalArtistName: mixedTabArtist?.name || '',
          originalArtistPhoto: mixedTabArtist?.photoURL || mixedTabArtist?.wikiPhotoURL || '',
        }),
      }
      await setDoc(doc(db, 'gameSongs', id), gsDoc)
      setGameSongs(p => [...p, { id, ...gsDoc }])
      setStartSeconds(p => ({ ...p, [id]: 0 })); setSongTitles(p => ({ ...p, [id]: song.title || '' }))
      flashSaved(id)
    } finally { setSaving(p => ({ ...p, [id]: false })) }
  }

  const handleRemoveSong = async (gsId) => {
    if (!confirm('確定移除？')) return
    await deleteDoc(doc(db, 'gameSongs', gsId))
    setGameSongs(p => p.filter(s => s.id !== gsId))
  }

  const handleSaveSecond = async (gsId) => {
    const sec = Number(startSeconds[gsId] ?? 0)
    const title = songTitles[gsId] ?? ''
    setSaving(p => ({ ...p, [gsId]: true }))
    try {
      await setDoc(doc(db, 'gameSongs', gsId), { gameStartSecond: sec, title }, { merge: true })
      setGameSongs(p => p.map(s => s.id === gsId ? { ...s, gameStartSecond: sec, title } : s))
      flashSaved(gsId)
    } finally { setSaving(p => ({ ...p, [gsId]: false })) }
  }

  const flashSaved = (id) => {
    setSavedMsg(p => ({ ...p, [id]: true }))
    setTimeout(() => setSavedMsg(p => ({ ...p, [id]: false })), 2000)
  }

  const handleSetLevel = async (gsId, level) => {
    await setDoc(doc(db, 'gameSongs', gsId), { level }, { merge: true })
    setGameSongs(p => p.map(s => s.id === gsId ? { ...s, level } : s))
  }

  const handleYtSearch = async (e) => {
    e.preventDefault()
    if (!ytQuery.trim()) return
    setYtSearching(true); setYtError(null); setYtResults([])
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(ytQuery)}&all=true`)
      const data = await res.json()
      if (data.videos?.length) {
        setYtResults(data.videos)
        const initT = {}; const initS = {}
        data.videos.forEach(v => { initT[v.id] = v.title; initS[v.id] = 0 })
        setYtTitles(initT); setYtStartSeconds(initS)
      } else { setYtError('找不到結果') }
    } catch { setYtError('搜尋失敗，請重試') } finally { setYtSearching(false) }
  }

  const handleAddYt = async (video) => {
    const ytId = video.id
    const gsId = `yt_${ytId}`
    setYtAddingId(ytId)
    try {
      const isMixed = selectedArtist.isMixed
      const gsDoc = {
        title: ytTitles[ytId] || video.title,
        artistName: isMixed ? (mixedTabArtist?.name || '') : selectedArtist.name,
        artistId: selectedArtist.artistId,
        youtubeUrl: `https://www.youtube.com/watch?v=${ytId}`,
        gameStartSecond: ytStartSeconds[ytId] ?? 0,
        source: 'youtube',
        level: 'easy',
        enabled: true,
        addedAt: serverTimestamp(),
        ...(isMixed && {
          originalArtistId: mixedTabArtist?.id || '',
          originalArtistName: mixedTabArtist?.name || '',
          originalArtistPhoto: mixedTabArtist?.photoURL || mixedTabArtist?.wikiPhotoURL || '',
        }),
      }
      await setDoc(doc(db, 'gameSongs', gsId), gsDoc)
      setGameSongs(p => [...p, { id: gsId, ...gsDoc }])
      setStartSeconds(p => ({ ...p, [gsId]: ytStartSeconds[ytId] ?? 0 }))
      setYtResults(p => p.filter(v => v.id !== ytId))
    } finally { setYtAddingId(null) }
  }

  const filteredTabs = allTabs.filter(s => !tabSearch || s.title?.toLowerCase().includes(tabSearch.toLowerCase()))

  return (
    <AdminGuard>
      <Layout>
        <div className="min-h-screen bg-black px-4 py-6 max-w-2xl mx-auto">

          {/* Header */}
          <div className="mb-6">
            <p className="text-[#B3B3B3] text-sm mb-1">後台管理</p>
            <h1 className="text-white text-2xl font-bold">1秒前奏估歌仔設置</h1>
          </div>

          {/* ── 遊戲歌手管理 ── */}
          <div className="mb-6">
            <h2 className="text-white font-bold text-base mb-3">
              遊戲歌手
              <span className="ml-2 text-[#B3B3B3] text-sm font-normal">({gameArtists.length})</span>
            </h2>

            {/* 歌手列表 */}
            <div className="flex flex-col gap-2 mb-3">
              {gameArtists.map((ga, i) => (
                <div
                  key={ga.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all"
                  style={{
                    background: selectedArtist?.id === ga.id ? '#1a1a00' : '#121212',
                    borderColor: selectedArtist?.id === ga.id ? '#FFD700' : '#282828',
                  }}
                  onClick={() => handleSelectArtist(ga)}
                >
                  {ga.isMixed ? (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-lg flex-shrink-0">🎵</div>
                  ) : ga.photo ? (
                    <img src={ga.photo} alt={ga.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#282828] flex items-center justify-center text-lg flex-shrink-0">🎸</div>
                  )}
                  <div className="flex-1 min-w-0">
                    {editingNameId === ga.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingNameValue}
                        onChange={e => setEditingNameValue(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onBlur={() => handleSaveRename(ga.id)}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') handleSaveRename(ga.id)
                          if (e.key === 'Escape') setEditingNameId(null)
                        }}
                        className="w-full px-2 py-0.5 rounded-lg bg-[#1a1a1a] text-white text-sm font-medium border border-pink-500 focus:outline-none"
                      />
                    ) : (
                      <p className="text-white text-sm font-medium flex items-center gap-1.5">
                        <span
                          className={ga.isMixed ? 'cursor-text hover:text-pink-300' : ''}
                          onClick={ga.isMixed ? (e => { e.stopPropagation(); handleStartRename(ga) }) : undefined}
                          title={ga.isMixed ? '點擊改名' : undefined}
                        >
                          {ga.name}
                        </span>
                        {ga.isMixed && <span className="text-xs px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 font-normal">雜錦</span>}
                      </p>
                    )}
                    <p className="text-[#B3B3B3] text-xs">{ga.enabled ? '啟用中' : '已停用'}</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleToggleArtist(ga) }}
                    className="px-2.5 py-1 rounded-lg text-xs border flex-shrink-0"
                    style={{ borderColor: ga.enabled ? '#22c55e' : '#282828', color: ga.enabled ? '#22c55e' : '#B3B3B3' }}
                  >
                    {ga.enabled ? '啟用' : '停用'}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleRemoveArtist(ga.id) }}
                    className="px-2 py-1 rounded-lg text-xs border border-red-900 text-red-400 flex-shrink-0"
                  >✕</button>
                </div>
              ))}
            </div>

            {/* 建立雜錦歌單按鈕（可建多個） */}
            <button
              onClick={handleCreateMixed}
              className="w-full mb-2 px-4 py-2 rounded-xl text-sm font-medium border border-pink-500/50 text-pink-300 bg-pink-500/10 hover:bg-pink-500/20 transition-colors"
            >
              🎵 + 建立雜錦歌單
            </button>

            {/* 搜尋加入歌手 */}
            <div className="relative">
              <input
                type="text"
                placeholder="搜尋歌手加入遊戲..."
                value={artistSearch}
                onChange={e => handleArtistSearch(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-[#121212] text-white border border-[#282828] text-sm focus:outline-none focus:border-[#FFD700]"
              />
              {artistSearchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a1a] border border-[#282828] rounded-xl overflow-hidden z-10">
                  {artistSearchResults.map(a => (
                    <button
                      key={a.id}
                      onClick={() => handleAddArtist(a)}
                      disabled={addingArtist === a.id}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#282828] transition-colors text-left"
                    >
                      {(a.photoURL || a.wikiPhotoURL) ? (
                        <img src={a.photoURL || a.wikiPhotoURL} alt={a.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#282828] flex-shrink-0" />
                      )}
                      <span className="text-white text-sm flex-1">{a.name}</span>
                      <span className="text-[#FFD700] text-xs">+ 加入</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── 歌單管理（選中歌手後顯示）── */}
          {selectedArtist && (
            <>
              <div className="border-t border-[#282828] mb-5" />

              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <img src={selectedArtist.photo} alt={selectedArtist.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                <h2 className="text-white font-bold text-base">{selectedArtist.name} 的歌單</h2>
                <span className="text-[#B3B3B3] text-sm">({gameSongs.length} 首)</span>
                <div className="flex gap-1.5 ml-auto">
                  {LEVELS.map(l => {
                    const count = gameSongs.filter(s => (s.level || 'easy') === l.key).length
                    return (
                      <span
                        key={l.key}
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{ background: `${l.color}22`, color: l.color, border: `1px solid ${l.color}66` }}
                      >
                        {l.label} {count}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* 遊戲歌單 */}
              {loading ? (
                <p className="text-[#B3B3B3] text-sm text-center py-4">載入中...</p>
              ) : (
                <div className="flex flex-col gap-2 mb-5">
                  {gameSongs.length === 0 && <p className="text-[#B3B3B3] text-sm text-center py-4">未有歌曲，請從下方加入</p>}
                  {gameSongs.map(song => {
                    const videoId = extractYouTubeId(song.youtubeUrl)
                    const isOpen = previewId === song.id
                    const curSec = startSeconds[song.id] ?? 0
                    return (
                      <div key={song.id} className="bg-[#121212] rounded-xl border border-[#282828] overflow-hidden">
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          <img src={`https://img.youtube.com/vi/${videoId}/default.jpg`} alt={song.title} className="w-9 h-9 rounded object-cover flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            {editingTitleId === song.id ? (
                              <input autoFocus type="text" value={songTitles[song.id] ?? song.title ?? ''} onChange={e => setSongTitles(p => ({ ...p, [song.id]: e.target.value }))}
                                onBlur={() => { setEditingTitleId(null); handleSaveSecond(song.id) }}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { setEditingTitleId(null); handleSaveSecond(song.id) } }}
                                className="w-full px-2 py-0.5 rounded-lg bg-[#1a1a1a] text-white text-sm font-medium border border-[#FFD700] focus:outline-none" />
                            ) : (
                              <p
                                className="text-sm font-medium truncate cursor-pointer hover:text-[#FFD700] transition-colors"
                                onClick={() => setEditingTitleId(song.id)}
                                title="點擊編輯歌名"
                                style={{ color: (songTitles[song.id] || song.title) ? '#fff' : '#666', fontStyle: (songTitles[song.id] || song.title) ? 'normal' : 'italic' }}
                              >
                                {selectedArtist?.isMixed && song.originalArtistName && (
                                  <span className="text-pink-300 mr-1">[{song.originalArtistName}]</span>
                                )}
                                {(songTitles[song.id] || song.title) || '（點擊輸入歌名）'}
                              </p>
                            )}
                            <div className="flex items-center gap-1.5 text-xs flex-wrap">
                              <span className="text-[#B3B3B3]">起始 <span className="text-[#FFD700] font-mono">{curSec}s</span></span>
                              {song.source === 'youtube' && <span className="text-blue-400">YT</span>}
                              {/* Level chips */}
                              <div className="flex gap-1">
                                {LEVELS.map(l => {
                                  const active = (song.level || 'easy') === l.key
                                  return (
                                    <button
                                      key={l.key}
                                      onClick={e => { e.stopPropagation(); handleSetLevel(song.id, l.key) }}
                                      className="px-1.5 py-0.5 rounded font-medium transition-all"
                                      style={{
                                        background: active ? l.color : 'transparent',
                                        color: active ? '#000' : l.color,
                                        border: `1px solid ${l.color}`,
                                        fontSize: 10,
                                      }}
                                    >
                                      {l.label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                          <input type="number" min={0} step={1} value={curSec} onChange={e => setStartSeconds(p => ({ ...p, [song.id]: Number(e.target.value) }))} className="w-14 px-2 py-1 rounded-lg bg-[#1a1a1a] text-white text-sm text-center border border-[#282828] focus:outline-none focus:border-[#FFD700]" />
                          <button onClick={() => handleSaveSecond(song.id)} disabled={saving[song.id]} className="px-2.5 py-1 rounded-lg text-xs font-bold text-black flex-shrink-0" style={{ background: savedMsg[song.id] ? '#22c55e' : '#FFD700', minWidth: 44 }}>
                            {saving[song.id] ? '...' : savedMsg[song.id] ? '✓' : '儲存'}
                          </button>
                          <button onClick={() => setPreviewId(isOpen ? null : song.id)} className="px-2.5 py-1 rounded-lg text-xs border border-[#282828] text-[#B3B3B3] flex-shrink-0">{isOpen ? '收起' : '▶'}</button>
                          <button onClick={() => handleRemoveSong(song.id)} className="px-2 py-1 rounded-lg text-xs border border-red-900 text-red-400 flex-shrink-0">✕</button>
                        </div>
                        {isOpen && (
                          <div className="px-3 pb-3">
                            <MiniPlayer videoId={videoId} startSecond={curSec} onUseTime={t => setStartSeconds(p => ({ ...p, [song.id]: t }))} />
                            <p className="text-[#B3B3B3] text-xs mt-1.5">💡 拖動至歌曲正式開始位置 → 按「用 Xs 做起點」→ 儲存</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Tab 切換 */}
              <div className="border-t border-[#282828] mb-4" />
              <div className="flex gap-1 mb-4 bg-[#121212] rounded-xl p-1">
                {[['songs', '從網站樂譜選歌'], ['youtube', 'YouTube 搜尋']].map(([key, label]) => (
                  <button key={key} onClick={() => setTab(key)} className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{ background: tab === key ? '#FFD700' : 'transparent', color: tab === key ? '#000' : '#B3B3B3' }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* 從網站樂譜選歌 */}
              {tab === 'songs' && (
                <div>
                  {/* 雜錦模式：先揀歌手 */}
                  {selectedArtist.isMixed && (
                    <div className="mb-3">
                      {mixedTabArtist ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-pink-500/10 border border-pink-500/50">
                          {(mixedTabArtist.photoURL || mixedTabArtist.wikiPhotoURL) ? (
                            <img src={mixedTabArtist.photoURL || mixedTabArtist.wikiPhotoURL} alt={mixedTabArtist.name} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[#282828]" />
                          )}
                          <span className="flex-1 text-white text-sm">揀緊：<span className="font-bold">{mixedTabArtist.name}</span></span>
                          <button onClick={() => { setMixedTabArtist(null); setAllTabs([]) }} className="px-2 py-1 rounded text-xs text-pink-300 border border-pink-500/50">換歌手</button>
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="搜尋歌手然後揀..."
                            value={mixedArtistSearch}
                            onChange={e => setMixedArtistSearch(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl bg-[#121212] text-white border border-pink-500/30 text-sm focus:outline-none focus:border-pink-500"
                          />
                          {mixedArtistSearch.trim() && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a1a] border border-[#282828] rounded-xl overflow-hidden z-10 max-h-60 overflow-y-auto">
                              {allArtists.filter(a => a.name?.toLowerCase().includes(mixedArtistSearch.toLowerCase())).slice(0, 8).map(a => (
                                <button key={a.id} onClick={() => handlePickMixedArtist(a)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#282828] text-left">
                                  {(a.photoURL || a.wikiPhotoURL) ? (
                                    <img src={a.photoURL || a.wikiPhotoURL} alt={a.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-[#282828] flex-shrink-0" />
                                  )}
                                  <span className="text-white text-sm">{a.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(!selectedArtist.isMixed || mixedTabArtist) && (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        <input type="text" placeholder="搜尋歌名..." value={tabSearch} onChange={e => setTabSearch(e.target.value)}
                          className="flex-1 px-4 py-2 rounded-xl bg-[#121212] text-white border border-[#282828] text-sm focus:outline-none focus:border-[#FFD700]" />
                        {!loading && <span className="text-[#B3B3B3] text-xs flex-shrink-0">共 {allTabs.length} 首</span>}
                      </div>
                      {loading && <p className="text-[#B3B3B3] text-sm text-center py-6">載入中...</p>}
                      <div className="flex flex-col gap-2">
                        {filteredTabs.map(song => {
                          const inGameKey = selectedArtist.isMixed ? `tab_mixed_${song.id}` : `tab_${song.id}`
                          const inGame = gameSongs.some(g => g.id === inGameKey)
                          const videoId = extractYouTubeId(song.youtubeUrl)
                          return (
                            <div key={song.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border" style={{ background: inGame ? '#0d1f0d' : '#121212', borderColor: inGame ? '#22c55e' : '#282828' }}>
                              <img src={`https://img.youtube.com/vi/${videoId}/default.jpg`} alt={song.title} className="w-9 h-9 rounded object-cover flex-shrink-0" />
                              <p className="flex-1 text-sm text-white truncate">{song.title}</p>
                              {inGame ? <span className="text-green-400 text-xs font-medium flex-shrink-0">✓ 已加入</span> : (
                                <button onClick={() => handleAddTab(song)} disabled={saving[inGameKey]} className="px-3 py-1 rounded-lg text-xs font-bold text-black flex-shrink-0" style={{ background: '#FFD700' }}>
                                  {saving[inGameKey] ? '...' : '+ 加入'}
                                </button>
                              )}
                            </div>
                          )
                        })}
                        {filteredTabs.length === 0 && !loading && <p className="text-[#B3B3B3] text-sm text-center py-6">{tabSearch ? '找不到相關歌曲' : '未找到有 YouTube 連結的歌曲'}</p>}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* YouTube 搜尋 */}
              {tab === 'youtube' && (
                <div>
                  {selectedArtist.isMixed && (
                    <div className="mb-3">
                      {mixedTabArtist ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-pink-500/10 border border-pink-500/50">
                          {(mixedTabArtist.photoURL || mixedTabArtist.wikiPhotoURL) ? (
                            <img src={mixedTabArtist.photoURL || mixedTabArtist.wikiPhotoURL} alt={mixedTabArtist.name} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[#282828]" />
                          )}
                          <span className="flex-1 text-white text-sm">將加入：<span className="font-bold">{mixedTabArtist.name}</span> 嘅歌</span>
                          <button onClick={() => setMixedTabArtist(null)} className="px-2 py-1 rounded text-xs text-pink-300 border border-pink-500/50">換歌手</button>
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="先揀歌手（將會記錄為原本歌手）..."
                            value={mixedArtistSearch}
                            onChange={e => setMixedArtistSearch(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl bg-[#121212] text-white border border-pink-500/30 text-sm focus:outline-none focus:border-pink-500"
                          />
                          {mixedArtistSearch.trim() && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a1a1a] border border-[#282828] rounded-xl overflow-hidden z-10 max-h-60 overflow-y-auto">
                              {allArtists.filter(a => a.name?.toLowerCase().includes(mixedArtistSearch.toLowerCase())).slice(0, 8).map(a => (
                                <button key={a.id} onClick={() => { setMixedTabArtist(a); setMixedArtistSearch('') }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#282828] text-left">
                                  {(a.photoURL || a.wikiPhotoURL) ? (
                                    <img src={a.photoURL || a.wikiPhotoURL} alt={a.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-[#282828] flex-shrink-0" />
                                  )}
                                  <span className="text-white text-sm">{a.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <form onSubmit={handleYtSearch} className="flex gap-2 mb-4">
                    <input type="text" placeholder={`搜尋 YouTube${selectedArtist.isMixed ? '' : `，例如：${selectedArtist.name}`}`} value={ytQuery} onChange={e => setYtQuery(e.target.value)}
                      className="flex-1 px-4 py-2 rounded-xl bg-[#121212] text-white border border-[#282828] text-sm focus:outline-none focus:border-[#FFD700]" />
                    <button type="submit" disabled={ytSearching} className="px-4 py-2 rounded-xl text-sm font-bold text-black flex-shrink-0" style={{ background: '#FFD700' }}>
                      {ytSearching ? '...' : '搜尋'}
                    </button>
                  </form>
                  {ytError && <p className="text-red-400 text-sm mb-3">{ytError}</p>}
                  <div className="flex flex-col gap-3">
                    {ytResults.map(video => {
                      const inGame = gameSongYtIds.has(video.id)
                      const isOpen = ytPreviewId === video.id
                      const curSec = ytStartSeconds[video.id] ?? 0
                      return (
                        <div key={video.id} className="bg-[#121212] rounded-xl border border-[#282828] overflow-hidden">
                          <div className="flex items-start gap-3 px-3 py-2.5">
                            <img src={video.thumbnail} alt={video.title} className="w-20 h-12 rounded object-cover flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <input type="text" value={ytTitles[video.id] ?? video.title} onChange={e => setYtTitles(p => ({ ...p, [video.id]: e.target.value }))}
                                className="w-full px-2 py-1 rounded-lg bg-[#1a1a1a] text-white text-sm font-medium border border-[#3a3a3a] focus:outline-none focus:border-[#FFD700]" placeholder="歌名" />
                              <p className="text-[#B3B3B3] text-xs mt-0.5 truncate">{video.channelTitle}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[#B3B3B3] text-xs">起始：</span>
                                <input type="number" min={0} step={1} value={curSec} onChange={e => setYtStartSeconds(p => ({ ...p, [video.id]: Number(e.target.value) }))}
                                  className="w-14 px-2 py-0.5 rounded bg-[#1a1a1a] text-white text-xs text-center border border-[#282828] focus:outline-none focus:border-[#FFD700]" />
                                <span className="text-[#B3B3B3] text-xs">秒</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 px-3 pb-2.5">
                            <button onClick={() => setYtPreviewId(isOpen ? null : video.id)} className="px-3 py-1 rounded-lg text-xs border border-[#282828] text-[#B3B3B3]">{isOpen ? '收起' : '▶ 預覽'}</button>
                            {inGame ? <span className="text-green-400 text-xs font-medium self-center ml-auto">✓ 已加入</span> : (
                              <button onClick={() => handleAddYt(video)} disabled={ytAddingId === video.id} className="ml-auto px-3 py-1 rounded-lg text-xs font-bold text-black" style={{ background: '#FFD700' }}>
                                {ytAddingId === video.id ? '...' : '+ 加入遊戲'}
                              </button>
                            )}
                          </div>
                          {isOpen && <div className="px-3 pb-3"><MiniPlayer videoId={video.id} startSecond={curSec} onUseTime={t => setYtStartSeconds(p => ({ ...p, [video.id]: t }))} /></div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {!selectedArtist && !loading && gameArtists.length > 0 && (
            <p className="text-[#B3B3B3] text-sm text-center py-6">👆 點擊上方歌手來管理歌單</p>
          )}

        </div>
      </Layout>
    </AdminGuard>
  )
}
