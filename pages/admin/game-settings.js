import { useState, useEffect, useRef } from 'react'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'
import { db } from '@/lib/firebase'
import {
  collection, getDocs, doc, setDoc, deleteDoc,
  query, where, or, serverTimestamp
} from '@/lib/firestore-tracked'

const ARTIST_NAME_QUERY = '陳奕迅'
const ARTIST_ID_DEFAULT = '陳奕迅'

function extractYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

// 迷你 YouTube 預覽播放器（後台用）
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
          <button
            onClick={() => onUseTime(currentTime)}
            className="ml-auto px-3 py-1 rounded-lg text-xs font-bold text-black"
            style={{ background: '#FFD700' }}
          >
            用 {currentTime}s 做起點
          </button>
        )}
      </div>
    </div>
  )
}

export default function GameSettingsPage() {
  const [tab, setTab] = useState('songs') // 'songs' | 'youtube'
  const [loading, setLoading] = useState(true)

  // 遊戲歌單（gameSongs collection）
  const [gameSongs, setGameSongs] = useState([])
  // 現有樂譜（tabs collection）
  const [allTabs, setAllTabs] = useState([])
  const [tabSearch, setTabSearch] = useState('')

  // 每首歌的起始秒 & 預覽狀態
  const [startSeconds, setStartSeconds] = useState({})
  const [previewId, setPreviewId] = useState(null)
  const [saving, setSaving] = useState({})
  const [savedMsg, setSavedMsg] = useState({})

  // YouTube 搜尋
  const [ytQuery, setYtQuery] = useState('')
  const [ytResults, setYtResults] = useState([])
  const [ytSearching, setYtSearching] = useState(false)
  const [ytError, setYtError] = useState(null)
  const [ytAddingId, setYtAddingId] = useState(null)
  const [ytPreviewId, setYtPreviewId] = useState(null)
  const [ytStartSeconds, setYtStartSeconds] = useState({})
  const [ytTitles, setYtTitles] = useState({}) // 可自訂歌名

  useEffect(() => {
    // 載入 YouTube IFrame API
    if (typeof window !== 'undefined' && !window.YT) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // 載入 gameSongs
      const gsSnap = await getDocs(collection(db, 'gameSongs'))
      const gs = gsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.artistId === ARTIST_ID_DEFAULT || s.artistName?.includes(ARTIST_NAME_QUERY))
        .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hant'))
      setGameSongs(gs)

      const init = {}
      gs.forEach(s => { init[s.id] = s.gameStartSecond ?? 0 })
      setStartSeconds(init)

      // 載入現有 tabs（陳奕迅）
      const artistsSnap = await getDocs(collection(db, 'artists'))
      const matchedIds = []
      artistsSnap.docs.forEach(d => {
        if (d.data().name?.includes(ARTIST_NAME_QUERY)) matchedIds.push(d.id)
      })
      if (matchedIds.length === 0) matchedIds.push(ARTIST_ID_DEFAULT)

      const conditions = matchedIds.flatMap(id => [
        where('artistId', '==', id),
        where('artistIds', 'array-contains', id),
      ])
      const tabsSnap = await getDocs(query(collection(db, 'tabs'), or(...conditions)))
      const tabs = tabsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.youtubeUrl && extractYouTubeId(s.youtubeUrl))
      const seen = new Set()
      const unique = tabs.filter(s => {
        const k = s.title?.trim().toLowerCase()
        if (seen.has(k)) return false
        seen.add(k); return true
      }).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hant'))
      setAllTabs(unique)
    } finally {
      setLoading(false)
    }
  }

  const gameSongIds = new Set(gameSongs.map(s => s.tabId).filter(Boolean))
  const gameSongYtIds = new Set(gameSongs.map(s => extractYouTubeId(s.youtubeUrl)).filter(Boolean))

  // 從現有樂譜加入遊戲
  const handleAddTab = async (song) => {
    const id = `tab_${song.id}`
    setSaving(p => ({ ...p, [id]: true }))
    try {
      const gsDoc = {
        title: song.title || '',
        artistName: song.artistName || ARTIST_NAME_QUERY,
        artistId: song.artistId || ARTIST_ID_DEFAULT,
        youtubeUrl: song.youtubeUrl,
        gameStartSecond: song.gameStartSecond ?? 0,
        source: 'tab',
        tabId: song.id,
        enabled: true,
        addedAt: serverTimestamp(),
      }
      await setDoc(doc(db, 'gameSongs', id), gsDoc)
      setGameSongs(p => [...p, { id, ...gsDoc }].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hant')))
      setStartSeconds(p => ({ ...p, [id]: 0 }))
      flashSaved(id)
    } finally {
      setSaving(p => ({ ...p, [id]: false }))
    }
  }

  // 從遊戲移除
  const handleRemove = async (gsId) => {
    if (!confirm('確定移除？')) return
    await deleteDoc(doc(db, 'gameSongs', gsId))
    setGameSongs(p => p.filter(s => s.id !== gsId))
  }

  // 更新起始秒
  const handleSaveSecond = async (gsId) => {
    const sec = Number(startSeconds[gsId] ?? 0)
    setSaving(p => ({ ...p, [gsId]: true }))
    try {
      await setDoc(doc(db, 'gameSongs', gsId), { gameStartSecond: sec }, { merge: true })
      setGameSongs(p => p.map(s => s.id === gsId ? { ...s, gameStartSecond: sec } : s))
      flashSaved(gsId)
    } finally {
      setSaving(p => ({ ...p, [gsId]: false }))
    }
  }

  const flashSaved = (id) => {
    setSavedMsg(p => ({ ...p, [id]: true }))
    setTimeout(() => setSavedMsg(p => ({ ...p, [id]: false })), 2000)
  }

  // YouTube 搜尋
  const handleYtSearch = async (e) => {
    e.preventDefault()
    if (!ytQuery.trim()) return
    setYtSearching(true)
    setYtError(null)
    setYtResults([])
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(ytQuery)}&all=true`)
      const data = await res.json()
      if (data.videos?.length) {
        setYtResults(data.videos)
        const initTitles = {}
        const initSecs = {}
        data.videos.forEach(v => { initTitles[v.id] = v.title; initSecs[v.id] = 0 })
        setYtTitles(initTitles)
        setYtStartSeconds(initSecs)
      } else {
        setYtError('找不到結果')
      }
    } catch {
      setYtError('搜尋失敗，請重試')
    } finally {
      setYtSearching(false)
    }
  }

  // 從 YouTube 結果加入遊戲
  const handleAddYt = async (video) => {
    const ytId = video.id
    const gsId = `yt_${ytId}`
    setYtAddingId(ytId)
    try {
      const gsDoc = {
        title: ytTitles[ytId] || video.title,
        artistName: ARTIST_NAME_QUERY,
        artistId: ARTIST_ID_DEFAULT,
        youtubeUrl: `https://www.youtube.com/watch?v=${ytId}`,
        gameStartSecond: ytStartSeconds[ytId] ?? 0,
        source: 'youtube',
        enabled: true,
        addedAt: serverTimestamp(),
      }
      await setDoc(doc(db, 'gameSongs', gsId), gsDoc)
      setGameSongs(p => [...p, { id: gsId, ...gsDoc }].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hant')))
      setStartSeconds(p => ({ ...p, [gsId]: ytStartSeconds[ytId] ?? 0 }))
      // 從搜尋結果移除
      setYtResults(p => p.filter(v => v.id !== ytId))
    } finally {
      setYtAddingId(null)
    }
  }

  const filteredTabs = allTabs.filter(s =>
    !tabSearch || s.title?.toLowerCase().includes(tabSearch.toLowerCase())
  )

  return (
    <AdminGuard>
      <Layout>
        <div className="min-h-screen bg-black px-4 py-6 max-w-2xl mx-auto">

          {/* Header */}
          <div className="mb-5">
            <p className="text-[#B3B3B3] text-sm mb-1">後台管理</p>
            <h1 className="text-white text-2xl font-bold">1秒前奏估歌仔設置</h1>
            <p className="text-[#B3B3B3] text-sm mt-1">{ARTIST_NAME_QUERY}</p>
          </div>

          {/* 遊戲歌單 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-white font-bold text-base">
                遊戲歌單
                <span className="ml-2 text-[#B3B3B3] text-sm font-normal">({gameSongs.length} 首)</span>
              </h2>
            </div>

            {loading && <p className="text-[#B3B3B3] text-sm py-4 text-center">載入中...</p>}

            {!loading && gameSongs.length === 0 && (
              <p className="text-[#B3B3B3] text-sm py-4 text-center">未有歌曲，請從下方加入</p>
            )}

            <div className="flex flex-col gap-2">
              {gameSongs.map(song => {
                const videoId = extractYouTubeId(song.youtubeUrl)
                const isOpen = previewId === song.id
                const curSec = startSeconds[song.id] ?? 0

                return (
                  <div key={song.id} className="bg-[#121212] rounded-xl border border-[#282828] overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <img
                        src={`https://img.youtube.com/vi/${videoId}/default.jpg`}
                        alt={song.title}
                        className="w-9 h-9 rounded object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{song.title}</p>
                        <p className="text-[#B3B3B3] text-xs">
                          起始 <span className="text-[#FFD700] font-mono">{curSec}s</span>
                          {song.source === 'youtube' && <span className="ml-1.5 text-xs text-blue-400">YT</span>}
                        </p>
                      </div>

                      {/* 起始秒 */}
                      <input
                        type="number" min={0} step={1}
                        value={curSec}
                        onChange={e => setStartSeconds(p => ({ ...p, [song.id]: Number(e.target.value) }))}
                        className="w-14 px-2 py-1 rounded-lg bg-[#1a1a1a] text-white text-sm text-center border border-[#282828] focus:outline-none focus:border-[#FFD700]"
                      />

                      {/* 儲存 */}
                      <button
                        onClick={() => handleSaveSecond(song.id)}
                        disabled={saving[song.id]}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold text-black flex-shrink-0"
                        style={{ background: savedMsg[song.id] ? '#22c55e' : '#FFD700', minWidth: 44 }}
                      >
                        {saving[song.id] ? '...' : savedMsg[song.id] ? '✓' : '儲存'}
                      </button>

                      {/* 預覽 */}
                      <button
                        onClick={() => setPreviewId(isOpen ? null : song.id)}
                        className="px-2.5 py-1 rounded-lg text-xs border border-[#282828] text-[#B3B3B3] flex-shrink-0"
                      >
                        {isOpen ? '收起' : '▶'}
                      </button>

                      {/* 移除 */}
                      <button
                        onClick={() => handleRemove(song.id)}
                        className="px-2 py-1 rounded-lg text-xs border border-red-900 text-red-400 flex-shrink-0"
                      >
                        ✕
                      </button>
                    </div>

                    {isOpen && (
                      <div className="px-3 pb-3">
                        <MiniPlayer
                          videoId={videoId}
                          startSecond={curSec}
                          onUseTime={(t) => setStartSeconds(p => ({ ...p, [song.id]: t }))}
                        />
                        <p className="text-[#B3B3B3] text-xs mt-1.5">
                          💡 拖動至歌曲正式開始位置 → 按「用 Xs 做起點」→ 儲存
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 分隔線 */}
          <div className="border-t border-[#282828] mb-5" />

          {/* Tab 切換 */}
          <div className="flex gap-1 mb-4 bg-[#121212] rounded-xl p-1">
            {[['songs', '從網站樂譜選歌'], ['youtube', 'YouTube 搜尋']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: tab === key ? '#FFD700' : 'transparent',
                  color: tab === key ? '#000' : '#B3B3B3',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* === 從樂譜選歌 === */}
          {tab === 'songs' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  placeholder="搜尋歌名..."
                  value={tabSearch}
                  onChange={e => setTabSearch(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-xl bg-[#121212] text-white border border-[#282828] text-sm focus:outline-none focus:border-[#FFD700]"
                />
                {!loading && (
                  <span className="text-[#B3B3B3] text-xs flex-shrink-0">
                    共 {allTabs.length} 首
                  </span>
                )}
              </div>
              {loading && <p className="text-[#B3B3B3] text-sm text-center py-6">載入中...</p>}
              <div className="flex flex-col gap-2">
                {filteredTabs.map(song => {
                  const inGame = gameSongIds.has(song.id)
                  const videoId = extractYouTubeId(song.youtubeUrl)
                  return (
                    <div
                      key={song.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
                      style={{
                        background: inGame ? '#0d1f0d' : '#121212',
                        borderColor: inGame ? '#22c55e' : '#282828',
                      }}
                    >
                      <img
                        src={`https://img.youtube.com/vi/${videoId}/default.jpg`}
                        alt={song.title}
                        className="w-9 h-9 rounded object-cover flex-shrink-0"
                      />
                      <p className="flex-1 text-sm text-white truncate">{song.title}</p>
                      {inGame ? (
                        <span className="text-green-400 text-xs font-medium flex-shrink-0">✓ 已加入</span>
                      ) : (
                        <button
                          onClick={() => handleAddTab(song)}
                          disabled={saving[`tab_${song.id}`]}
                          className="px-3 py-1 rounded-lg text-xs font-bold text-black flex-shrink-0"
                          style={{ background: '#FFD700' }}
                        >
                          {saving[`tab_${song.id}`] ? '...' : '+ 加入'}
                        </button>
                      )}
                    </div>
                  )
                })}
                {filteredTabs.length === 0 && !loading && (
                  <p className="text-[#B3B3B3] text-sm text-center py-6">
                    {tabSearch ? '找不到相關歌曲' : '未找到有 YouTube 連結的歌曲'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* === YouTube 搜尋 === */}
          {tab === 'youtube' && (
            <div>
              <form onSubmit={handleYtSearch} className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="搜尋 YouTube，例如：陳奕迅 富士山下"
                  value={ytQuery}
                  onChange={e => setYtQuery(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-xl bg-[#121212] text-white border border-[#282828] text-sm focus:outline-none focus:border-[#FFD700]"
                />
                <button
                  type="submit"
                  disabled={ytSearching}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-black flex-shrink-0"
                  style={{ background: '#FFD700' }}
                >
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
                        <img src={video.thumbnail} alt={video.title}
                          className="w-20 h-12 rounded object-cover flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {/* 可編輯歌名 */}
                          <input
                            type="text"
                            value={ytTitles[video.id] ?? video.title}
                            onChange={e => setYtTitles(p => ({ ...p, [video.id]: e.target.value }))}
                            className="w-full bg-transparent text-white text-sm font-medium focus:outline-none border-b border-transparent focus:border-[#FFD700] pb-0.5 truncate"
                          />
                          <p className="text-[#B3B3B3] text-xs mt-0.5 truncate">{video.channelTitle}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[#B3B3B3] text-xs">起始：</span>
                            <input
                              type="number" min={0} step={1}
                              value={curSec}
                              onChange={e => setYtStartSeconds(p => ({ ...p, [video.id]: Number(e.target.value) }))}
                              className="w-14 px-2 py-0.5 rounded bg-[#1a1a1a] text-white text-xs text-center border border-[#282828] focus:outline-none focus:border-[#FFD700]"
                            />
                            <span className="text-[#B3B3B3] text-xs">秒</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 px-3 pb-2.5">
                        <button
                          onClick={() => setYtPreviewId(isOpen ? null : video.id)}
                          className="px-3 py-1 rounded-lg text-xs border border-[#282828] text-[#B3B3B3]"
                        >
                          {isOpen ? '收起' : '▶ 預覽'}
                        </button>
                        {inGame ? (
                          <span className="text-green-400 text-xs font-medium self-center ml-auto">✓ 已加入</span>
                        ) : (
                          <button
                            onClick={() => handleAddYt(video)}
                            disabled={ytAddingId === video.id}
                            className="ml-auto px-3 py-1 rounded-lg text-xs font-bold text-black"
                            style={{ background: '#FFD700' }}
                          >
                            {ytAddingId === video.id ? '...' : '+ 加入遊戲'}
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <div className="px-3 pb-3">
                          <MiniPlayer
                            videoId={video.id}
                            startSecond={curSec}
                            onUseTime={(t) => setYtStartSeconds(p => ({ ...p, [video.id]: t }))}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

        </div>
      </Layout>
    </AdminGuard>
  )
}
