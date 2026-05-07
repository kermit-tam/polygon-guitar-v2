import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { collection, getDocs, query, where } from 'firebase/firestore'
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

const MAX_EXTRA = 3

export default function GamePage() {
  const router = useRouter()
  const { artistId } = router.query

  const [artist, setArtist] = useState(null)
  const [songs, setSongs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // 遊戲狀態
  const [answer, setAnswer] = useState(null)
  const [secondsRevealed, setSecondsRevealed] = useState(1)
  const [guessed, setGuessed] = useState(false)
  const [correct, setCorrect] = useState(null)
  const [userInput, setUserInput] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)

  const inputRef = useRef(null)

  const playerRef = useRef(null)     // YouTube IFrame Player
  const containerRef = useRef(null)  // iframe 容器
  const stopTimerRef = useRef(null)  // 停播定時器
  const ytReadyRef = useRef(false)   // YT API 是否已載入

  // 1. 從 gameSongs + gameArtists 載入資料
  useEffect(() => {
    if (!artistId) return
    async function loadSongs() {
      try {
        setLoading(true)

        // 載入歌手資料
        const artistSnap = await getDocs(query(collection(db, 'gameArtists'), where('artistId', '==', artistId)))
        const artistData = artistSnap.docs[0]?.data() || null
        setArtist(artistData)

        // 載入該歌手嘅 gameSongs
        const snap = await getDocs(query(collection(db, 'gameSongs'), where('artistId', '==', artistId)))
        const all = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.enabled !== false && s.youtubeUrl && extractYouTubeId(s.youtubeUrl))
          .map(s => ({ ...s, artistPhoto: s.artistPhoto || artistData?.photo || null }))

        setSongs(all)
      } catch (e) {
        console.error(e)
        setError('載入失敗，請重試')
      } finally {
        setLoading(false)
      }
    }
    loadSongs()
  }, [artistId])

  // 鎖定 body scroll（Safari 需要同時鎖 html + body + touchmove）
  useEffect(() => {
    const prev = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
    }
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    const preventTouch = (e) => e.preventDefault()
    document.addEventListener('touchmove', preventTouch, { passive: false })
    return () => {
      document.documentElement.style.overflow = prev.htmlOverflow
      document.body.style.overflow = prev.bodyOverflow
      document.body.style.position = prev.bodyPosition
      document.body.style.width = ''
      document.removeEventListener('touchmove', preventTouch)
    }
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

  // 3. 出題：隨機選一首
  const newRound = useCallback(() => {
    if (songs.length < 1) return
    if (playerRef.current) {
      try { playerRef.current.destroy() } catch {}
      playerRef.current = null
    }
    const [picked] = sampleN(songs, 1)
    setAnswer(picked)
    setSecondsRevealed(1)
    setGuessed(false)
    setCorrect(null)
    setUserInput('')
    setIsPlaying(false)
    setIsBuffering(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [songs])

  useEffect(() => {
    if (songs.length >= 1) newRound()
  }, [songs]) // eslint-disable-line react-hooks/exhaustive-deps

  // 4. 建立 / 更新 YouTube Player
  const createPlayer = useCallback((videoId, secondsToPlay, startSecond = 0) => {
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
        start: startSecond,
      },
      events: {
        onReady: (e) => {
          e.target.seekTo(startSecond, true)
          e.target.setVolume(100)
          e.target.playVideo()
          setIsBuffering(false)
          setIsPlaying(true)
          clearTimeout(stopTimerRef.current)
          stopTimerRef.current = setTimeout(() => {
            try { e.target.pauseVideo() } catch {}
            setIsPlaying(false)
          }, secondsToPlay * 1000)
        },
        onError: () => { setIsBuffering(false); setIsPlaying(false) },
      }
    })
  }, [])

  // 5. 播放按鈕
  const handlePlay = useCallback(() => {
    if (!answer || isPlaying || isBuffering) return
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId) return

    setIsBuffering(true) // 即時顯示 loading
    const startSecond = answer.gameStartSecond || 0
    let attempts = 0
    const tryCreate = () => {
      if (window.YT && window.YT.Player) {
        createPlayer(videoId, secondsRevealed, startSecond)
      } else if (attempts < 20) {
        attempts++
        setTimeout(tryCreate, 300)
      } else {
        setIsBuffering(false) // timeout，放棄
      }
    }
    tryCreate()
  }, [answer, isPlaying, isBuffering, secondsRevealed, createPlayer])

  // 正規化字串（比較用）：移除空格、標點、轉小寫
  const normalize = (str) =>
    (str || '').toLowerCase().replace(/[\s\u3000《》「」【】〈〉''"",.!?，。！？、]/g, '')

  // 6. 用戶提交答案
  const handleSubmit = (e) => {
    e?.preventDefault()
    if (guessed || !userInput.trim()) return
    const isCorrect = normalize(userInput) === normalize(answer.title)
    setCorrect(isCorrect)
    setGuessed(true)
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    setIsPlaying(false)
  }

  // 放棄（顯示答案）
  const handleGiveUp = () => {
    if (guessed) return
    setCorrect(false)
    setGuessed(true)
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    setIsPlaying(false)
  }

  // 7. 再聽多 1 秒
  const handleMoreSeconds = () => {
    if (secondsRevealed > MAX_EXTRA || guessed) return
    const next = secondsRevealed + 1
    setSecondsRevealed(next)
    // 重播
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId) return
    const startSecond = answer.gameStartSecond || 0
    createPlayer(videoId, next, startSecond)
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

  // 剩餘可以「再聽多1秒」嘅次數
  const remainingChances = MAX_EXTRA - (secondsRevealed - 1)

  return (
    <Layout hideBottomNav hideFooter>
      <Head>
        <title>1秒前奏估歌仔 — {artist?.name || ''} | Polygon Guitar</title>
      </Head>

      {/* 隱藏 YouTube iframe 容器 */}
      <div
        ref={containerRef}
        style={{ position: 'fixed', bottom: -10, left: -10, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none' }}
        aria-hidden="true"
      />

      <div className="bg-black px-4 py-6 flex flex-col items-center overflow-hidden" style={{ height: '100dvh' }}>
        {/* Header */}
        <div className="w-full max-w-md mb-2">
          <div className="flex items-center justify-between mb-1">
            <Link href="/game" className="text-[#B3B3B3] text-sm px-1">← 返回</Link>
            <div className="flex-1" />
          </div>
          <img src="/game-logo.svg" alt="1秒前奏估歌仔" style={{ height: 80 }} className="mb-2 mx-auto" />
          <h1 className="text-white text-base font-medium text-center">{artist?.name || ''}</h1>
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
                <div className="w-full h-full rounded-full overflow-hidden">
                  {answer?.artistPhoto ? (
                    <img
                      src={answer.artistPhoto}
                      alt={answer.artistName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#121212] rounded-full flex items-center justify-center text-6xl">🎸</div>
                  )}
                </div>
              )}
            </div>

            {/* 3 條色條 = 剩餘再聽次數 */}
            <div className="flex gap-1.5 justify-center">
              {Array.from({ length: MAX_EXTRA }).map((_, i) => (
                <div
                  key={i}
                  className="h-1.5 rounded-full flex-1"
                  style={{
                    background: guessed
                      ? (correct ? '#22c55e' : '#ef4444')
                      : i < remainingChances ? '#FFD700' : '#282828',
                    maxWidth: 48,
                  }}
                />
              ))}
            </div>

            {/* 播放按鈕區 */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handlePlay}
                disabled={isPlaying || isBuffering}
                className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-black transition-all"
                style={{
                  background: (isPlaying || isBuffering) ? '#B3B3B3' : '#FFD700',
                  minWidth: 160,
                  justifyContent: 'center',
                }}
              >
                {isPlaying ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    播放中...
                  </>
                ) : isBuffering ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    載入中...
                  </>
                ) : (
                  <>
                    ▶ 播放 {secondsRevealed} 秒
                  </>
                )}
              </button>

              {/* 再聽多1秒 */}
              {!guessed && remainingChances > 0 && (
                <button
                  onClick={handleMoreSeconds}
                  disabled={isPlaying || isBuffering}
                  className="text-[#B3B3B3] text-sm underline underline-offset-2 disabled:opacity-40"
                >
                  + 再聽多1秒（剩餘 {remainingChances} 次機會）
                </button>
              )}
            </div>

            {/* 輸入答案 */}
            {!guessed ? (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  placeholder="輸入歌名..."
                  autoComplete="off"
                  className="w-full px-4 py-3 rounded-xl bg-[#121212] text-white border border-[#282828] text-base focus:outline-none focus:border-[#FFD700]"
                />
                <button
                  type="submit"
                  disabled={!userInput.trim()}
                  className="w-full py-3 rounded-xl font-bold text-black text-sm disabled:opacity-40"
                  style={{ background: '#FFD700' }}
                >
                  確認
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-3 mt-1">
                {/* 結果 */}
                <div
                  className="w-full px-4 py-3 rounded-xl border text-sm font-medium"
                  style={{
                    background: correct ? '#14532d' : '#450a0a',
                    borderColor: correct ? '#22c55e' : '#ef4444',
                    color: correct ? '#86efac' : '#fca5a5',
                  }}
                >
                  {correct
                    ? `🎉 答啱喇！《${answer.title}》`
                    : `😅 答案係《${answer.title}》`}
                </div>
                {/* 下一題 */}
                <div className="flex gap-2">
                  <a
                    href={answer.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-3 rounded-xl text-sm border border-[#282828] text-[#B3B3B3] text-center"
                  >
                    ▶ YouTube
                  </a>
                  <button
                    onClick={newRound}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-black"
                    style={{ background: '#FFD700' }}
                  >
                    下一題 →
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {!loading && songs.length < 1 && !error && (
          <div className="text-[#B3B3B3] text-center mt-20 text-sm">
            未有歌曲，請先在後台加入遊戲歌單
          </div>
        )}
      </div>
    </Layout>
  )
}
