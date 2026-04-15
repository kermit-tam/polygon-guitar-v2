import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import Layout from '@/components/Layout'
import { collection, query, where, getDocs, or } from 'firebase/firestore'
import { db } from '@/lib/firebase'

// 提取 YouTube Video ID
function extractYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

// 隨機抽取 n 個不重複元素
function sampleN(arr, n) {
  const copy = [...arr]
  const result = []
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const idx = Math.floor(Math.random() * copy.length)
    result.push(copy[idx])
    copy.splice(idx, 1)
  }
  return result
}

// 打亂陣列
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const MAX_SECONDS = 5
const ARTIST_NAME_QUERY = '陳奕迅'   // 用於搜尋 artists collection
const ARTIST_DISPLAY = '陳奕迅 Eason Chan'

export default function GamePage() {
  const [songs, setSongs] = useState([]) // 全部有 YouTube 嘅歌
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // 遊戲狀態
  const [answer, setAnswer] = useState(null)       // 正確答案（song object）
  const [options, setOptions] = useState([])        // 4 個選項（已打亂）
  const [secondsRevealed, setSecondsRevealed] = useState(1) // 當前可聽秒數
  const [guessed, setGuessed] = useState(false)     // 已猜（不論對錯）
  const [correct, setCorrect] = useState(null)      // true/false
  const [selectedId, setSelectedId] = useState(null)// 用戶揀嘅歌 id
  const [isPlaying, setIsPlaying] = useState(false) // 播放中

  const playerRef = useRef(null)     // YouTube IFrame Player
  const containerRef = useRef(null)  // iframe 容器
  const stopTimerRef = useRef(null)  // 停播定時器
  const ytReadyRef = useRef(false)   // YT API 是否已載入

  // 1. 載入陳奕迅歌曲
  useEffect(() => {
    async function loadSongs() {
      try {
        setLoading(true)

        // 先查 artists collection 找到所有包含 ARTIST_NAME_QUERY 的歌手 doc ID
        const artistsSnap = await getDocs(collection(db, 'artists'))
        const matchedIds = []
        artistsSnap.docs.forEach(d => {
          const data = d.data()
          const name = data.name || ''
          if (name.includes(ARTIST_NAME_QUERY)) {
            matchedIds.push(d.id)
          }
        })

        // 如果找不到，fallback 用 ARTIST_NAME_QUERY 本身
        if (matchedIds.length === 0) matchedIds.push(ARTIST_NAME_QUERY)

        console.log('[game] matched artist ids:', matchedIds)

        // 用所有 ID 查 tabs（or 查詢）
        const conditions = matchedIds.flatMap(id => [
          where('artistId', '==', id),
          where('artistIds', 'array-contains', id),
        ])
        const tabsQuery = query(
          collection(db, 'tabs'),
          or(...conditions)
        )
        const snap = await getDocs(tabsQuery)
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        // 去重 doc（同 doc id 只保留一次）
        const docIds = new Set()
        const deduped = all.filter(s => {
          if (docIds.has(s.id)) return false
          docIds.add(s.id)
          return true
        })

        // 只用有 YouTube URL 的歌
        const withYt = deduped.filter(s => s.youtubeUrl && extractYouTubeId(s.youtubeUrl))

        // 去重（同名歌取第一首）
        const seen = new Set()
        const unique = withYt.filter(s => {
          const key = s.title?.trim().toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        // 攞歌手相片（photoURL 或 wikiPhotoURL），補入每首歌
        const artistPhoto = (() => {
          const doc = artistsSnap.docs.find(d => d.data().name?.includes(ARTIST_NAME_QUERY))
          if (!doc) return null
          const d = doc.data()
          return d.photoURL || d.wikiPhotoURL || null
        })()

        const withPhoto = unique.map(s => ({
          ...s,
          artistPhoto: s.artistPhoto || artistPhoto || null,
        }))

        console.log(`[game] loaded ${withPhoto.length} unique songs with YouTube, artistPhoto: ${artistPhoto ? 'yes' : 'no'}`)
        setSongs(withPhoto)
      } catch (e) {
        console.error(e)
        setError('載入失敗，請重試')
      } finally {
        setLoading(false)
      }
    }
    loadSongs()
  }, [])

  // 2. 載入 YouTube IFrame API
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.YT) {
      ytReadyRef.current = true
      return
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
    window.onYouTubeIframeAPIReady = () => {
      ytReadyRef.current = true
    }
  }, [])

  // 3. 出題：隨機選一首答案 + 3 個錯誤選項
  const newRound = useCallback(() => {
    if (songs.length < 4) return
    // 清除舊 player
    if (playerRef.current) {
      try { playerRef.current.destroy() } catch {}
      playerRef.current = null
    }
    const [picked] = sampleN(songs, 1)
    const rest = songs.filter(s => s.id !== picked.id)
    const wrongs = sampleN(rest, 3)
    setAnswer(picked)
    setOptions(shuffle([picked, ...wrongs]))
    setSecondsRevealed(1)
    setGuessed(false)
    setCorrect(null)
    setSelectedId(null)
    setIsPlaying(false)
  }, [songs])

  useEffect(() => {
    if (songs.length >= 4) newRound()
  }, [songs]) // eslint-disable-line react-hooks/exhaustive-deps

  // 4. 建立 / 更新 YouTube Player
  const createPlayer = useCallback((videoId, secondsToPlay) => {
    if (!window.YT || !window.YT.Player) return
    if (!containerRef.current) return

    // 清空容器
    containerRef.current.innerHTML = ''
    const div = document.createElement('div')
    div.id = 'yt-player-inner'
    containerRef.current.appendChild(div)

    playerRef.current = new window.YT.Player('yt-player-inner', {
      height: '1',
      width: '1',
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        rel: 0,
        start: 0,
      },
      events: {
        onReady: (e) => {
          e.target.setVolume(100)
          e.target.playVideo()
          setIsPlaying(true)
          // 停播定時器
          clearTimeout(stopTimerRef.current)
          stopTimerRef.current = setTimeout(() => {
            try { e.target.pauseVideo() } catch {}
            setIsPlaying(false)
          }, secondsToPlay * 1000)
        },
        onError: () => setIsPlaying(false),
      }
    })
  }, [])

  // 5. 播放按鈕
  const handlePlay = useCallback(() => {
    if (!answer || isPlaying) return
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId) return

    const tryCreate = () => {
      if (window.YT && window.YT.Player) {
        createPlayer(videoId, secondsRevealed)
      } else {
        setTimeout(tryCreate, 300)
      }
    }
    tryCreate()
  }, [answer, isPlaying, secondsRevealed, createPlayer])

  // 6. 用戶猜歌
  const handleGuess = (song) => {
    if (guessed) return
    setSelectedId(song.id)
    const isCorrect = song.id === answer.id
    setCorrect(isCorrect)
    setGuessed(true)
    // 停止播放
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    setIsPlaying(false)
  }

  // 7. 再聽多 1 秒
  const handleMoreSeconds = () => {
    if (secondsRevealed >= MAX_SECONDS || guessed) return
    const next = secondsRevealed + 1
    setSecondsRevealed(next)
    // 重播
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId) return
    createPlayer(videoId, next)
    setIsPlaying(true)
  }

  // 封面圖
  const getCover = (song) => {
    if (!song) return null
    if (song.albumImage) return song.albumImage
    if (song.thumbnail) return song.thumbnail
    const vid = extractYouTubeId(song.youtubeUrl)
    if (vid) return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`
    return null
  }

  // 進度條：已用幾次 hint
  const attempts = secondsRevealed - 1 // 0 = 第一次聽（1秒）

  return (
    <Layout>
      <Head>
        <title>猜歌遊戲 — 陳奕迅 | Polygon Guitar</title>
      </Head>

      {/* 隱藏 YouTube iframe 容器 */}
      <div
        ref={containerRef}
        style={{ position: 'fixed', bottom: -10, left: -10, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none' }}
        aria-hidden="true"
      />

      <div className="min-h-screen bg-black px-4 py-6 flex flex-col items-center">
        {/* Header */}
        <div className="w-full max-w-md mb-6">
          <p className="text-[#B3B3B3] text-sm mb-1">猜歌遊戲</p>
          <h1 className="text-white text-2xl font-bold">{ARTIST_DISPLAY}</h1>
          <p className="text-[#B3B3B3] text-xs mt-1">聽前奏，猜歌名</p>
        </div>

        {loading && (
          <div className="text-[#B3B3B3] text-center mt-20">載入歌曲中...</div>
        )}
        {error && (
          <div className="text-red-400 text-center mt-20">{error}</div>
        )}

        {!loading && !error && answer && (
          <div className="w-full max-w-md flex flex-col gap-5">

            {/* 猜中前：問號；猜中後：顯示封面 */}
            <div className="relative mx-auto" style={{ width: 180, height: 180 }}>
              {guessed && getCover(answer) ? (
                <img
                  src={getCover(answer)}
                  alt={answer.title}
                  className="w-full h-full object-cover rounded-xl"
                />
              ) : (
                <div className="w-full h-full rounded-xl overflow-hidden">
                  {answer?.artistPhoto ? (
                    <img
                      src={answer.artistPhoto}
                      alt={answer.artistName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#121212] flex items-center justify-center text-6xl">🎸</div>
                  )}
                </div>
              )}
            </div>

            {/* 進度條（最多 5 秒 = 5 格） */}
            <div className="flex gap-1.5 justify-center">
              {Array.from({ length: MAX_SECONDS }).map((_, i) => (
                <div
                  key={i}
                  className="h-1.5 rounded-full flex-1"
                  style={{
                    background: i < secondsRevealed
                      ? (guessed ? (correct ? '#22c55e' : '#ef4444') : '#FFD700')
                      : '#282828',
                    maxWidth: 48,
                  }}
                />
              ))}
            </div>

            {/* 播放按鈕區 */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handlePlay}
                disabled={isPlaying}
                className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-black transition-all"
                style={{
                  background: isPlaying ? '#B3B3B3' : '#FFD700',
                  minWidth: 160,
                  justifyContent: 'center',
                }}
              >
                {isPlaying ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    播放中...
                  </>
                ) : (
                  <>
                    ▶ 播放 {secondsRevealed} 秒
                  </>
                )}
              </button>

              {/* 再聽多1秒 */}
              {!guessed && secondsRevealed < MAX_SECONDS && (
                <button
                  onClick={handleMoreSeconds}
                  disabled={isPlaying}
                  className="text-[#B3B3B3] text-sm underline underline-offset-2 disabled:opacity-40"
                >
                  + 再聽多 1 秒（{secondsRevealed + 1}秒）
                </button>
              )}
            </div>

            {/* 4 個選項 */}
            <div className="flex flex-col gap-2 mt-1">
              {options.map((song) => {
                const isSelected = selectedId === song.id
                const isAnswer = answer && song.id === answer.id
                let bg = '#121212'
                let border = '#282828'
                let textColor = '#FFFFFF'

                if (guessed) {
                  if (isAnswer) {
                    bg = '#14532d'
                    border = '#22c55e'
                    textColor = '#86efac'
                  } else if (isSelected && !isAnswer) {
                    bg = '#450a0a'
                    border = '#ef4444'
                    textColor = '#fca5a5'
                  }
                } else if (isSelected) {
                  bg = '#1a1a1a'
                  border = '#FFD700'
                }

                return (
                  <button
                    key={song.id}
                    onClick={() => handleGuess(song)}
                    disabled={guessed}
                    className="w-full text-left px-4 py-3 rounded-xl border transition-all text-sm font-medium"
                    style={{ background: bg, borderColor: border, color: textColor }}
                  >
                    {song.title}
                    {guessed && isAnswer && <span className="ml-2 text-green-400">✓</span>}
                    {guessed && isSelected && !isAnswer && <span className="ml-2 text-red-400">✗</span>}
                  </button>
                )
              })}
            </div>

            {/* 結果 + 下一題 */}
            {guessed && (
              <div className="flex flex-col items-center gap-4 mt-2">
                <div className={`text-lg font-bold ${correct ? 'text-green-400' : 'text-red-400'}`}>
                  {correct ? '🎉 答啱喇！' : `😅 答錯喇，係《${answer.title}》`}
                </div>
                <div className="flex gap-3">
                  <a
                    href={answer.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-full text-sm border border-[#282828] text-[#B3B3B3] hover:text-white"
                  >
                    ▶ 睇 YouTube
                  </a>
                  <button
                    onClick={newRound}
                    className="px-5 py-2 rounded-full text-sm font-bold text-black"
                    style={{ background: '#FFD700' }}
                  >
                    下一題 →
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {!loading && songs.length < 4 && !error && (
          <div className="text-[#B3B3B3] text-center mt-20 text-sm">
            歌曲數量不足（需要至少 4 首有 YouTube 連結的歌曲）
          </div>
        )}
      </div>
    </Layout>
  )
}
