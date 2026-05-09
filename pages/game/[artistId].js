import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { getArtistByIdOrSlug } from '@/lib/tabs'

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

const TOTAL_HINTS = 3 // 整個遊戲共 3 次提示
const QUESTIONS_PER_LEVEL = 10
const LEVELS = [
  { key: 'easy', label: '入門級', color: '#22c55e' },
  { key: 'medium', label: '難少少', color: '#f59e0b' },
  { key: 'hell', label: '地獄級', color: '#ef4444' },
]
const TOTAL_QUESTIONS = LEVELS.length * QUESTIONS_PER_LEVEL

// 計算歌名字數：CJK 每字算1個、連續英文/數字算1個 word、忽略空白同標點
// 例：「孤獨探戈」= 4、「Lonely Christmas」= 2、「全民K歌」= 4、「明年今日」= 4、「U87」= 1
function countTitle(title) {
  if (!title) return 0
  let count = 0
  let inWord = false
  for (const ch of title) {
    const isCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch)
    const isAlphaNum = /[A-Za-z0-9]/.test(ch)
    if (isCJK) {
      count++
      inWord = false
    } else if (isAlphaNum) {
      if (!inWord) { count++; inWord = true }
    } else {
      inWord = false
    }
  }
  return count
}

// 30 題滿分；級別按比例分布
const GRADES_EASON = [
  { min: 30, max: 30, label: () => '陳奕迅耳裏條蟲' },
  { min: 24, max: 29, label: () => '只差一點點...' },
  { min: 16, max: 23, label: () => '繼續努力' },
  { min: 9,  max: 15, label: () => '要睇返多啲醫生' },
  { min: 0,  max: 8,  label: () => '我甚麼都沒有' },
]

const GRADES_GENERIC = [
  { min: 30, max: 30, label: () => '達人級樂迷' },
  { min: 24, max: 29, label: () => '專業級樂迷' },
  { min: 16, max: 23, label: () => '普通樂迷' },
  { min: 9,  max: 15, label: () => '普通人' },
  { min: 0,  max: 8,  label: () => '狠人' },
]

function getGrade(score, artistName) {
  const isEason = (artistName || '').includes('陳奕迅')
  const grades = isEason ? GRADES_EASON : GRADES_GENERIC
  const g = grades.find(g => score >= g.min && score <= g.max)
  return g ? g.label() : ''
}

// 依 level 順序建立隊列：由 startLevel 開始，每個 level 10 題
function buildQueueByLevel(songs, startLevel = 'easy') {
  const startIdx = LEVELS.findIndex(l => l.key === startLevel)
  const levelsToPlay = LEVELS.slice(startIdx >= 0 ? startIdx : 0)
  const queue = []
  for (const lv of levelsToPlay) {
    let pool = songs.filter(s => (s.level || 'easy') === lv.key)
    if (pool.length === 0) pool = songs
    const picked = []
    while (picked.length < QUESTIONS_PER_LEVEL) {
      picked.push(...shuffle(pool))
    }
    queue.push(...picked.slice(0, QUESTIONS_PER_LEVEL).map(s => ({ ...s, _level: lv.key })))
  }
  return queue
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
  const [hintsLeft, setHintsLeft] = useState(TOTAL_HINTS)
  const [levelTransition, setLevelTransition] = useState(null)
  const [startLevel, setStartLevel] = useState(null) // null = 未揀，開始畫面

  // 單題狀態
  const [answer, setAnswer] = useState(null)
  const [secondsRevealed, setSecondsRevealed] = useState(1)
  const [guessed, setGuessed] = useState(false)
  const [correct, setCorrect] = useState(null)
  const [userInput, setUserInput] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [hintUsed, setHintUsed] = useState(false) // 本題已用字數提示？

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
              // 從快取補充歌手名同相片
              const cacheParsed = JSON.parse(sc)
              setArtist(a => ({
                name: a?.name || cacheParsed.artistName || cachedSongs[0]?.artistName || '',
                photo: a?.photo || cacheParsed.artistPhoto || '',
              }))
              setLoading(false)
              return
            }
          }
        } catch {}

        // 只查 gameSongs（主要查詢）
        const songsSnap = await getDocs(query(collection(db, 'gameSongs'), where('artistId', '==', artistId)))
        const all = songsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.enabled !== false && s.youtubeUrl && extractYouTubeId(s.youtubeUrl))

        // 補充歌手名（sessionStorage 快取嘅名優先保留，唔覆蓋）
        setArtist(a => ({
          name: a?.name || all[0]?.artistName || '',
          photo: a?.photo || '',
        }))

        // 寫入 sessionStorage 快取
        try {
          sessionStorage.setItem(SONG_CACHE_KEY, JSON.stringify({ songs: all, ts: Date.now() }))
        } catch {}

        setSongs(all)

        // 並行背景查 gameArtists（取全名，例如「陳奕迅 Eason Chan」）+ artists（取相片）
        Promise.all([
          getDocs(query(collection(db, 'gameArtists'), where('artistId', '==', artistId))).catch(() => null),
          getArtistByIdOrSlug(artistId).catch(() => null),
        ]).then(([gaSnap, artistData]) => {
          const gameArtistDoc = gaSnap?.docs?.[0]?.data()
          const fullName = gameArtistDoc?.name // 「陳奕迅 Eason Chan」
          const photo = gameArtistDoc?.photo || artistData?.photo || ''
          setArtist(a => ({
            name: fullName || a?.name || '',
            photo: photo || a?.photo || '',
          }))
          // 存埋落 sessionStorage 快取
          try {
            const sc = sessionStorage.getItem(SONG_CACHE_KEY)
            if (sc) {
              const parsed = JSON.parse(sc)
              sessionStorage.setItem(SONG_CACHE_KEY, JSON.stringify({
                ...parsed,
                artistName: fullName || parsed.artistName,
                artistPhoto: photo || parsed.artistPhoto,
              }))
            }
          } catch {}
        }).catch(() => {})
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
  const startGame = useCallback((level = 'easy', songList) => {
    const list = songList || songs
    if (list.length < 1) return
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    const q = buildQueueByLevel(list, level)
    setStartLevel(level)
    setSongQueue(q)
    setCurrentQIdx(0)
    setScore(0)
    setGameOver(false)
    setLevelTransition(null)
    setHintsLeft(TOTAL_HINTS)
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
    if (nextIdx >= songQueue.length) {
      setGameOver(true)
      clearTimeout(stopTimerRef.current)
      try { playerRef.current?.pauseVideo() } catch {}
      return
    }
    // 檢查係咪過咗一個 level
    const currentLevel = songQueue[currentQIdx]?._level
    const nextLevel = songQueue[nextIdx]?._level
    if (currentLevel && nextLevel && currentLevel !== nextLevel) {
      // 顯示 level transition 畫面
      const finished = LEVELS.find(l => l.key === currentLevel)
      const next = LEVELS.find(l => l.key === nextLevel)
      setLevelTransition({ finished, next, nextIdx })
      clearTimeout(stopTimerRef.current)
      try { playerRef.current?.pauseVideo() } catch {}
      return
    }
    advanceTo(nextIdx)
  }, [currentQIdx, songQueue]) // eslint-disable-line react-hooks/exhaustive-deps

  const advanceTo = useCallback((idx) => {
    clearTimeout(stopTimerRef.current)
    try { playerRef.current?.pauseVideo() } catch {}
    setCurrentQIdx(idx)
    setAnswer(songQueue[idx])
    setSecondsRevealed(1)
    setGuessed(false)
    setCorrect(null)
    setUserInput('')
    setIsPlaying(false)
    setIsBuffering(false)
    setHintUsed(false)
    setLevelTransition(null)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [songQueue])

  // 注意：唔再自動開始遊戲，等用戶喺 level 選擇畫面揀

  // 4. 播放按鈕（直接喺 user gesture 裡面叫 loadVideoById，iOS 有聲）
  const handlePlay = useCallback(() => {
    if (!answer || isPlaying || isBuffering) return
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId) return

    setIsBuffering(true)
    clearTimeout(stopTimerRef.current)
    // 答題後播全首（300秒），答題前只播 secondsRevealed 秒
    currentDurRef.current = guessed ? 300 : secondsRevealed
    const startSecond = guessed ? 0 : (answer.gameStartSecond || 0)

    if (playerReadyRef.current && playerRef.current) {
      _doPlay(videoId, startSecond)
    } else {
      pendingPlayRef.current = { videoId, startSecond }
    }
  }, [answer, isPlaying, isBuffering, secondsRevealed, guessed]) // eslint-disable-line react-hooks/exhaustive-deps

  // 異體字對照（將不同寫法統一成同一個 canonical char）
  // 例：「活着」=「活著」、「甚麼」=「什麼」
  const VARIANT_MAP = {
    '着': '著', '甚': '什', '麽': '麼', '裏': '裡', '為': '为',
    '係': '系', '咁': '甘', '嘅': '的', '冇': '無',
    '喺': '在', '俾': '給', '佢': '他', '哋': '們',
    '裏': '裡', '羣': '群', '線': '綫',
  }

  // 正規化字串（比較用）：轉小寫 + 移除所有空白、標點、統一異體字
  // 例：「K歌之王」=「k歌之王」、「活着多好」=「活著多好」
  const normalize = (str) => {
    let s = (str || '').toLowerCase().normalize('NFKC')
    // 統一異體字
    s = s.split('').map(ch => VARIANT_MAP[ch] || ch).join('')
    return s
      .replace(/[\s\u3000\u00A0]/g, '')
      .replace(/[\p{P}\p{S}]/gu, '')
  }

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

  // 7. 再聽多 1 秒（扣 1 個總提示）
  const handleMoreSeconds = () => {
    if (guessed || hintsLeft <= 0) return
    const next = secondsRevealed + 1
    setSecondsRevealed(next)
    setHintsLeft(h => h - 1)
    const videoId = extractYouTubeId(answer.youtubeUrl)
    if (!videoId || !playerRef.current) return
    clearTimeout(stopTimerRef.current)
    currentDurRef.current = next
    const startSecond = answer.gameStartSecond || 0
    _doPlay(videoId, startSecond)
  }

  // 字數提示（扣 1 個總提示）
  const handleShowHint = () => {
    if (hintUsed || hintsLeft <= 0) return
    setHintUsed(true)
    setHintsLeft(h => h - 1)
  }

  // 由 startLevel 計算實際題數
  const startLevelIdx = startLevel ? LEVELS.findIndex(l => l.key === startLevel) : 0
  const totalQuestions = (LEVELS.length - Math.max(0, startLevelIdx)) * QUESTIONS_PER_LEVEL

  // 封面圖
  const getCover = (song) => {
    if (!song) return null
    if (song.albumImage) return song.albumImage
    if (song.thumbnail) return song.thumbnail
    const vid = extractYouTubeId(song.youtubeUrl)
    if (vid) return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`
    return null
  }


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
            {!gameOver && !loading && answer && !levelTransition && startLevel && (() => {
              const lv = LEVELS.find(l => l.key === answer._level)
              const currentLvIdx = LEVELS.findIndex(l => l.key === answer._level)
              const offsetIdx = currentLvIdx - startLevelIdx
              const qInLevel = currentQIdx - offsetIdx * QUESTIONS_PER_LEVEL + 1
              return (
                <span
                  className="text-xs font-bold rounded-lg px-2.5 py-1"
                  style={{
                    color: lv?.color || '#B3B3B3',
                    background: `${lv?.color || '#fff'}15`,
                    border: `1.5px solid ${lv?.color || '#B3B3B3'}`,
                  }}
                >
                  {lv?.label} {qInLevel}/{QUESTIONS_PER_LEVEL}
                </span>
              )
            })()}
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

        {/* 揀難度開始畫面 */}
        {!loading && !error && !gameOver && !levelTransition && !startLevel && songs.length > 0 && (
          <div className="w-full max-w-md flex flex-col items-center gap-5 mt-4">
            <p className="text-[#B3B3B3] text-sm">請選擇難度，每個難度設有10題</p>
            <div className="flex flex-col gap-3 items-center w-full">
              {LEVELS.map(lv => (
                <button
                  key={lv.key}
                  onClick={() => startGame(lv.key)}
                  className="px-5 py-3 rounded-xl font-bold text-center transition-all"
                  style={{
                    minWidth: 200,
                    background: `${lv.color}15`,
                    border: `2px solid ${lv.color}`,
                    color: lv.color,
                  }}
                >
                  <span className="text-lg">{lv.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Level 過渡畫面 */}
        {!loading && !error && !gameOver && levelTransition && (
          <div className="w-full max-w-md flex flex-col items-center gap-6 mt-6">
            <div className="text-center">
              <p className="text-[#B3B3B3] text-sm mb-2">恭喜過關</p>
              <p className="font-bold text-2xl" style={{ color: levelTransition.finished.color }}>
                {levelTransition.finished.label} ✓
              </p>
            </div>
            <div className="text-[#B3B3B3] text-2xl">↓</div>
            <div className="text-center">
              <p className="text-[#B3B3B3] text-sm mb-2">下一關</p>
              <p className="font-bold text-3xl" style={{ color: levelTransition.next.color }}>
                {levelTransition.next.label}
              </p>
            </div>
            <button
              onClick={() => advanceTo(levelTransition.nextIdx)}
              className="mt-4 w-full py-3 rounded-xl font-bold text-black"
              style={{ background: levelTransition.next.color }}
            >
              開始 →
            </button>
          </div>
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
                <span className="text-[#B3B3B3] text-sm">/ {totalQuestions}</span>
              </div>
            </div>

            {/* 級別（按比例計算） */}
            <div className="text-center">
              <p className="text-white font-bold text-xl">{getGrade(Math.round(score / totalQuestions * 30), artist?.name || '佢')}</p>
            </div>

            {/* 按鈕 */}
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => startGame(startLevel)}
                className="w-full py-3 rounded-xl font-bold text-black"
                style={{ background: '#FFD700' }}
              >
                再玩一次
              </button>
              <button
                onClick={() => { setStartLevel(null); setGameOver(false); setAnswer(null) }}
                className="w-full py-3 rounded-xl text-sm border border-[#282828] text-[#B3B3B3]"
              >
                揀其他難度
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

        {!loading && !error && !gameOver && !levelTransition && startLevel && answer && (
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
                  {artist?.photo ? (
                    <img
                      src={artist.photo}
                      alt={artist.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#121212] rounded-full flex items-center justify-center text-6xl">🎸</div>
                  )}
                </div>
              )}
            </div>

            {/* 3 條色條 = 整個遊戲剩餘提示次數 */}
            <div className="flex gap-1.5 justify-center">
              {Array.from({ length: TOTAL_HINTS }).map((_, i) => (
                <div
                  key={i}
                  className="h-1.5 rounded-full flex-1"
                  style={{
                    background: guessed
                      ? (correct ? '#22c55e' : '#ef4444')
                      : i < hintsLeft ? '#FFD700' : '#282828',
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
                  <>{guessed ? '▶ 播全首' : '▶ 播放'}</>
                )}
              </button>

              {/* 聽多1秒 + 字數提示（並排） */}
              {!guessed && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleMoreSeconds}
                    disabled={isPlaying || isBuffering || hintsLeft <= 0}
                    className="text-[#B3B3B3] text-sm underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
                  >
                    聽多1秒
                  </button>
                  {!hintUsed ? (
                    <button
                      onClick={handleShowHint}
                      disabled={hintsLeft <= 0}
                      className="text-[#B3B3B3] text-sm underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
                    >
                      字數提示
                    </button>
                  ) : (
                    <span className="text-[#FFD700] text-sm font-medium">
                      {countTitle(answer.title)} 個字
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
                  className="w-full px-4 py-3 rounded-xl border text-sm font-medium text-center"
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
