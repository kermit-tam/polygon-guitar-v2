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
const TOTAL_QUESTIONS = 20

const GRADES_EASON = [
  { min: 20, max: 20, label: () => '陳奕迅耳裏條蟲' },
  { min: 16, max: 19, label: () => '只差一點點...' },
  { min: 11, max: 15, label: () => '繼續努力' },
  { min: 6,  max: 10, label: () => '要睇返多啲醫生' },
  { min: 0,  max: 5,  label: () => '我甚麼都沒有' },
]

const GRADES_GENERIC = [
  { min: 20, max: 20, label: () => '達人級樂迷' },
  { min: 16, max: 19, label: () => '專業級樂迷' },
  { min: 11, max: 15, label: () => '普通樂迷' },
  { min: 6,  max: 10, label: () => '普通人' },
  { min: 0,  max: 5,  label: () => '狠人' },
]

function getGrade(score, artistName) {
  const isEason = (artistName || '').includes('陳奕迅')
  const grades = isEason ? GRADES_EASON : GRADES_GENERIC
  const g = grades.find(g => score >= g.min && score <= g.max)
  return g ? g.label() : ''
}

// 建立 N 題隊列（歌曲不夠就循環）
function buildQueue(songs, n) {
  if (songs.length === 0) return []
  const q = []
  const shuffled = shuffle([...songs])
  while (q.length < n) {
    q.push(...shuffle([...songs]))
  }
  return q.slice(0, n)
}

export default function GamePage() {
  const router = useRouter()
  const { artistId } = router.query

  const [artist, setArtist] = useState(null)
  const [songs, setSongs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // 題目隊列
  const [songQueue, setSongQueue] = useState([])
  const [currentQIdx, setCurrentQIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)

  // 單題狀態
  const [answer, setAnswer] = useState(null)
  const [secondsRevealed, setSecondsRevealed] = useState(1)
  const [guessed, setGuessed] = useState(false)
  const [correct, setCorrect] = useState(null)
  const [userInput, setUserInput] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [hintUsed, setHintUsed] = useState(false)

  const inputRef = useRef(null)

  const playerRef = useRef(null)        // YouTube IFrame Player（只建立一次）
  const containerRef = useRef(null)     // iframe 容器
  const stopTimerRef = useRef(null)     // 停播定時器
  const ytReadyRef = useRef(false)      // YT API 是否已載入
  const playerReadyRef = useRef(false)  // Player 本身是否已 ready
  const pendingPlayRef = useRef(null)   // 等待 player ready 嘅播放請求
  const currentDurRef = useRef(1)       // 呢次要播幾秒

  // 1. 載入資料（sessionStorage 快取 + 只查 gameSongs 一個 collection）
  useEffect(() => {
    if (!artistId) return

    // 讀取歌手快取（從首頁導航過來有）
    try {
      const cached = sessionStorage.getItem('gameArtistCache')
      if (cached) {
        const a = JSON.parse(cached)
        if (a.artistId === artistId) {
          setArtist(a)
          sessionStorage.removeItem('gameArtistCache')
        }
      }
    } catch {}

    async function loadSongs() {
      try {
        setLoading(true)

        // 嘗試讀 gameSongs 快取（10分鐘有效）
        const SONG_CACHE_KEY = `gameSongs_${artistId}`
        const CACHE_TTL = 10 * 60 * 1000
        try {
          const sc = sessionStorage.getItem(SONG_CACHE_KEY)
          if (sc) {
            const { songs: cachedSongs, ts } = JSON.parse(sc)
            if (Date.now() - ts < CACHE_TTL && cachedSongs?.length > 0) {
              setSongs(cachedSongs)
              // 如果仍未有歌手資料，從歌曲補充
              setArtist(a => a || { name: cachedSongs[0]?.artistName || '', photo: cachedSongs[0]?.artistPhoto || '' })
              setLoading(false)
              return
            }
          }
        } catch {}

        // 只查 gameSongs（唔再查 gameArtists，省一半時間）
        const songsSnap = await getDocs(query(collection(db, 'gameSongs'), where('artistId', '==', artistId)))
        const all = songsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.enabled !== false && s.youtubeUrl && extractYouTubeId(s.youtubeUrl))

        // 補充歌手資料（如 sessionStorage 未有）
        setArtist(a => a || { name: all[0]?.artistName || '', photo: all[0]?.artistPhoto || '' })

        // 寫入 sessionStorage 快取
        try {
          sessionStorage.setItem(SONG_CACHE_KEY, JSON.stringify({ songs: all, ts: Date.now() }))
        } catch {}

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

  // 2. 載入 YouTube IFrame API，並預先建立 Player（只建立一次）
  useEffect(() => {
    if (typeof window === 'undefined') return

    const initPlayer = () => {
      if (playerRef.current || !containerRef.current) return
      containerRef.current.innerHTML = ''
      const div = document.createElement('div')
      div.id = 'yt-game-player'
      containerRef.current.appendChild(div)

      playerRef.current = new window.YT.Player('yt-game-player', {
        height: '1',
        width: '1',
        playerVars: {
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          rel: 0,
          playsinline: 1, // iOS Safari inline 播放（唔彈全螢幕）
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            playerReadyRef.current = true
            ytReadyRef.current = true
            // 如果用戶已撳播放但 player 未 ready，依家補播
            if (pendingPlayRef.current) {
              const { videoId, startSecond } = pendingPlayRef.current
              pendingPlayRef.current = null
              _doPlay(videoId, startSecond)
            }
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setIsBuffering(false)
              setIsPlaying(true)
              // 喺真正開始播先設定 stop timer，確保計時準確
              clearTimeout(stopTimerRef.current)
              stopTimerRef.current = setTimeout(() => {
                try { playerRef.current?.pauseVideo() } catch {}
                setIsPlaying(false)
              }, currentDurRef.current * 1000)
            } else if (e.data === window.YT.PlayerState.PAUSED || e.data === window.YT.PlayerState.ENDED) {
              setIsPlaying(false)
            }
          },
          onError: () => {
            setIsBuffering(false)
            setIsPlaying(false)
          },
        },
      })
    }

    if (window.YT?.Player) {
      initPlayer()
    } else {
      window.onYouTubeIframeAPIReady = initPlayer
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script')
        tag.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(tag)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // _doPlay：直接叫 player 播（需要在 user gesture 或 player ready callback 裡調用）
  const _doPlay = (videoId, startSecond) => {
    if (!playerRef.current) return
    // loadVideoById = 喺同一個 user gesture 裡面播，iOS 認可有聲
    playerRef.current.loadVideoById({ videoId, startSeconds: startSecond, suggestedQuality: 'small' })
    playerRef.current.setVolume(100)
  }

  // 3. 開始遊戲 / 重新開始
  const startGame = useCallback((songList) => {
    const list = songList || songs
    if (list.length < 1) return
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    const q = buildQueue(list, TOTAL_QUESTIONS)
    setSongQueue(q)
    setCurrentQIdx(0)
    setScore(0)
    setGameOver(false)
    setAnswer(q[0])
    setSecondsRevealed(1)
    setGuessed(false)
    setCorrect(null)
    setUserInput('')
    setIsPlaying(false)
    setIsBuffering(false)
    setHintUsed(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [songs])

  // 下一題
  const nextRound = useCallback(() => {
    const nextIdx = currentQIdx + 1
    if (nextIdx >= TOTAL_QUESTIONS) {
      setGameOver(true)
      clearTimeout(stopTimerRef.current)
      try { playerRef.current?.pauseVideo() } catch {}
      return
    }
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    setCurrentQIdx(nextIdx)
    setAnswer(songQueue[nextIdx])
    setSecondsRevealed(1)
    setGuessed(false)
    setCorrect(null)
    setUserInput('')
    setIsPlaying(false)
    setIsBuffering(false)
    setHintUsed(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [currentQIdx, songQueue])

  useEffect(() => {
    if (songs.length >= 1) startGame(songs)
  }, [songs]) // eslint-disable-line react-hooks/exhaustive-deps

  // 4. 播放按鈕（直接喺 user gesture 裡面叫 loadVideoById，iOS 有聲）
  const handlePlay = useCallback(() => {
    if (!answer || isPlaying || isBuffering) return
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId) return

    setIsBuffering(true)
    clearTimeout(stopTimerRef.current)
    currentDurRef.current = secondsRevealed
    const startSecond = answer.gameStartSecond || 0

    if (playerReadyRef.current && playerRef.current) {
      // Player 已 ready：直接喺呢個 gesture 裡播，iOS 有聲
      _doPlay(videoId, startSecond)
    } else {
      // Player 未 ready（少見）：存起來等 onReady 再播
      pendingPlayRef.current = { videoId, startSecond }
    }
  }, [answer, isPlaying, isBuffering, secondsRevealed]) // eslint-disable-line react-hooks/exhaustive-deps

  // 正規化字串（比較用）：移除空格、標點、轉小寫
  const normalize = (str) =>
    (str || '').toLowerCase().replace(/[\s\u3000《》「」【】〈〉''"",.!?，。！？、]/g, '')

  // 6. 用戶提交答案
  const handleSubmit = (e) => {
    e?.preventDefault()
    if (guessed || !userInput.trim()) return
    const isCorrect = normalize(userInput) === normalize(answer.title)
    if (isCorrect) setScore(s => s + 1)
    setCorrect(isCorrect)
    setGuessed(true)
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    setIsPlaying(false)
  }

  // 放棄（顯示答案，唔計分）
  const handleGiveUp = () => {
    if (guessed) return
    setCorrect(false)
    setGuessed(true)
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    setIsPlaying(false)
  }

  // 7. 再聽多 1 秒（同樣直接喺 gesture 裡播）
  const handleMoreSeconds = () => {
    if (secondsRevealed > MAX_EXTRA || guessed) return
    const next = secondsRevealed + 1
    setSecondsRevealed(next)
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId || !playerRef.current) return
    clearTimeout(stopTimerRef.current)
    currentDurRef.current = next
    const startSecond = answer.gameStartSecond || 0
    _doPlay(videoId, startSecond)
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
            {!gameOver && !loading && answer && (
              <span className="text-[#B3B3B3] text-sm pr-1">{currentQIdx + 1} / {TOTAL_QUESTIONS}</span>
            )}
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

        {/* 成績頁面 */}
        {!loading && !error && gameOver && (
          <div className="w-full max-w-md flex flex-col items-center gap-6 mt-4">
            {/* 分數圓圈 */}
            <div className="flex flex-col items-center gap-2">
              <div
                className="flex flex-col items-center justify-center rounded-full border-4"
                style={{ width: 140, height: 140, borderColor: '#FFD700' }}
              >
                <span className="text-[#FFD700] font-bold" style={{ fontSize: '2.5rem', lineHeight: 1 }}>{score}</span>
                <span className="text-[#B3B3B3] text-sm">/ {TOTAL_QUESTIONS}</span>
              </div>
            </div>

            {/* 級別 */}
            <div className="text-center">
              <p className="text-white font-bold text-xl">{getGrade(score, artist?.name || '佢')}</p>
            </div>

            {/* 按鈕 */}
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => startGame()}
                className="w-full py-3 rounded-xl font-bold text-black"
                style={{ background: '#FFD700' }}
              >
                再玩一次
              </button>
              <Link
                href="/game"
                className="w-full py-3 rounded-xl text-sm text-center border border-[#282828] text-[#B3B3B3] block"
              >
                換歌手
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && !gameOver && answer && (
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
                  <>▶ 播放</>
                )}
              </button>

              {/* 聽多1秒 + 字數提示（並排） */}
              {!guessed && (
                <div className="flex items-center gap-3">
                  {remainingChances > 0 && (
                    <button
                      onClick={handleMoreSeconds}
                      disabled={isPlaying || isBuffering}
                      className="text-[#B3B3B3] text-sm underline underline-offset-2 disabled:opacity-40"
                    >
                      聽多1秒
                    </button>
                  )}
                  {!hintUsed ? (
                    <button
                      onClick={() => setHintUsed(true)}
                      className="text-[#B3B3B3] text-sm underline underline-offset-2"
                    >
                      字數提示
                    </button>
                  ) : (
                    <span className="text-[#FFD700] text-sm font-medium">
                      {answer.title.length} 個字
                    </span>
                  )}
                </div>
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
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!userInput.trim()}
                    className="flex-1 py-3 rounded-xl font-bold text-black text-sm disabled:opacity-40"
                    style={{ background: '#FFD700' }}
                  >
                    確認
                  </button>
                  <button
                    type="button"
                    onClick={handleGiveUp}
                    className="px-4 py-3 rounded-xl text-sm border border-[#282828] text-[#B3B3B3]"
                  >
                    棄權
                  </button>
                </div>
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
                {/* 下一題 / 睇成績 */}
                <button
                  onClick={nextRound}
                  className="w-full py-3 rounded-xl text-sm font-bold text-black"
                  style={{ background: '#FFD700' }}
                >
                  {currentQIdx + 1 >= TOTAL_QUESTIONS ? '睇成績 →' : '下一題 →'}
                </button>
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
