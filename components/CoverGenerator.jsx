import { useState, useRef, useEffect, useCallback } from 'react'
import { useArtistMap } from '@/lib/useArtistMap'

const CANVAS_SIZE = 400

const PRESET_COLORS = [
  { label: '橙紅', value: '#F15A24' },
  { label: '紅', value: '#ED1C24' },
  { label: '黃', value: '#FED702' },
  { label: '螢光綠', value: '#D0FF00' },
  { label: '粉紫', value: '#FF69FF' },
  { label: '青', value: '#00FFFF' },
  { label: '綠', value: '#00FF00' },
  { label: '灰', value: '#CCCCCC' },
  { label: '湖水', value: '#65C8D0' },
]

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load: ' + src))
    img.src = src
  })
}

function proxiedUrl(url) {
  if (!url) return null
  if (url.startsWith('/') || url.includes('cloudinary') || url.includes('blob:')) return url
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}

function getSongCover(song) {
  if (song.coverImage) return song.coverImage
  if (song.albumImage) return song.albumImage
  const vid = song.youtubeVideoId || song.youtubeUrl?.match(/(?:v=|\/)([\w-]{11})/)?.[1]
  if (vid) return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`
  if (song.thumbnail) return song.thumbnail
  return null
}

export default function CoverGenerator({ songs = [], playlistTitle = '', onGenerated, showTitleTextColorPicker = false }) {
  const { getArtistName } = useArtistMap()
  const [mode, setMode] = useState('single')
  const [selectedSongs, setSelectedSongs] = useState(() => songs.length > 0 ? [songs[0]] : [])
  const [frameColor, setFrameColor] = useState('#F15A24')
  const [titleText, setTitleText] = useState(playlistTitle.slice(0, 6))
  const [titleTextColor, setTitleTextColor] = useState('#000000')
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [svgTemplate, setSvgTemplate] = useState(null)
  const [eyedropperMode, setEyedropperMode] = useState(false)
  const canvasRef = useRef(null)
  const previewRef = useRef(null)
  const TITLE_TEXT_COLORS = [
    { label: '淺灰字', value: '#f2f2f2' },
    { label: '黑色字', value: '#000000' },
  ]

  useEffect(() => {
    fetch('/templates/playlist-cover.svg')
      .then(r => r.text())
      .then(setSvgTemplate)
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (songs.length > 0 && selectedSongs.length === 0) {
      setSelectedSongs([songs[0]])
    }
  }, [songs, selectedSongs.length])

  const maxSongs = mode === 'single' ? 1 : 4

  const switchMode = (newMode) => {
    if (newMode === mode) return
    setMode(newMode)
    setSelectedSongs([])
    setPreviewUrl(null)
  }

  const toggleSong = (song) => {
    setSelectedSongs(prev => {
      const exists = prev.find(s => s.id === song.id)
      if (exists) return prev.filter(s => s.id !== song.id)
      if (mode === 'single') return [song]
      if (prev.length >= maxSongs) return prev
      return [...prev, song]
    })
  }

  const pickColorFromPreview = (e) => {
    if (!eyedropperMode || !canvasRef.current) return
    const rect = e.target.getBoundingClientRect()
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    const x = Math.floor((e.clientX - rect.left) * scaleX)
    const y = Math.floor((e.clientY - rect.top) * scaleY)
    const ctx = canvasRef.current.getContext('2d')
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    setFrameColor(hex)
    setEyedropperMode(false)
  }

  const genRef = useRef(0)

  const generate = useCallback(async () => {
    if (selectedSongs.length === 0) {
      setPreviewUrl(null)
      return
    }
    const id = ++genRef.current
    setGenerating(true)
    try {
      const canvas = canvasRef.current
      canvas.width = CANVAS_SIZE
      canvas.height = CANVAS_SIZE
      const ctx = canvas.getContext('2d')

      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

      if (mode === 'single') {
        const coverUrl = getSongCover(selectedSongs[0])
        if (coverUrl) {
          const img = await loadImage(proxiedUrl(coverUrl))
          drawCover(ctx, img, 0, 0, CANVAS_SIZE, CANVAS_SIZE)
        } else {
          drawFallback(ctx, selectedSongs[0], 0, 0, CANVAS_SIZE, CANVAS_SIZE)
        }
      } else {
        const cols = 2, rows = 2
        const cellW = CANVAS_SIZE / cols
        const cellH = CANVAS_SIZE / rows
        for (let i = 0; i < 4; i++) {
          const song = selectedSongs[i]
          const col = i % cols
          const row = Math.floor(i / cols)
          const x = col * cellW
          const y = row * cellH
          if (song) {
            const coverUrl = getSongCover(song)
            if (coverUrl) {
              try {
                const img = await loadImage(proxiedUrl(coverUrl))
                drawCover(ctx, img, x, y, cellW, cellH)
              } catch {
                drawFallback(ctx, song, x, y, cellW, cellH)
              }
            } else {
              drawFallback(ctx, song, x, y, cellW, cellH)
            }
          } else {
            ctx.fillStyle = '#282828'
            ctx.fillRect(x, y, cellW, cellH)
          }
        }
      }

      if (mode === 'single') {
        if (svgTemplate) {
          try {
            const coloredSvg = svgTemplate.replace(/#d0ff00/gi, frameColor)
            const svgBlob = new Blob([coloredSvg], { type: 'image/svg+xml;charset=utf-8' })
            const svgUrl = URL.createObjectURL(svgBlob)
            const svgImg = await loadImage(svgUrl)
            URL.revokeObjectURL(svgUrl)
            ctx.drawImage(svgImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE)
          } catch (e) {
            console.warn('SVG frame overlay failed:', e)
          }
        }

        const title = titleText || ''
        if (title) {
          ctx.fillStyle = titleTextColor
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          ctx.letterSpacing = '1px'
          const textX = CANVAS_SIZE / 2
          const bottomBarY = 320.9
          const textY = bottomBarY + (CANVAS_SIZE - bottomBarY) / 2 - 2
          const maxWidth = CANVAS_SIZE - 32

          let fontSize = 52.9
          ctx.font = `800 ${fontSize}px "Noto Sans TC", sans-serif`
          while (ctx.measureText(title).width > maxWidth && fontSize > 14) {
            fontSize -= 0.5
            ctx.font = `800 ${fontSize}px "Noto Sans TC", sans-serif`
          }
          ctx.fillText(title, textX, textY, maxWidth)
        }
      }

      if (id !== genRef.current) return
      const dataUrl = canvas.toDataURL('image/png')
      setPreviewUrl(dataUrl)
    } catch (err) {
      console.error('Cover generation failed:', err)
    } finally {
      if (id === genRef.current) setGenerating(false)
    }
  }, [selectedSongs, mode, svgTemplate, titleText, frameColor, titleTextColor])

  useEffect(() => {
    generate()
  }, [generate])

  const handleConfirm = async () => {
    if (!previewUrl || !onGenerated) return
    const res = await fetch(previewUrl)
    const blob = await res.blob()
    const file = new File([blob], `playlist-cover-${Date.now()}.png`, { type: 'image/png' })
    onGenerated(file, previewUrl)
  }

  return (
    <div className="space-y-3">
      {/* Preview + buttons side by side */}
      <div className="flex items-start gap-3 pt-2">
        <div
          ref={previewRef}
          onClick={pickColorFromPreview}
          className={`w-[200px] h-[200px] rounded-lg border overflow-hidden bg-[#0A0A0A] flex items-center justify-center flex-shrink-0 ${
            eyedropperMode ? 'border-[#FFD700] cursor-crosshair' : 'border-neutral-700'
          }`}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="Cover preview" className="w-full h-full object-cover" />
          ) : (
            <p className="text-neutral-600 text-xs text-center px-2">揀歌後自動預覽</p>
          )}
        </div>
        <div className="flex-1 flex flex-col gap-2 h-[200px]">
          <button
            onClick={() => switchMode('single')}
            className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition ${
              mode === 'single' ? 'bg-[#FFD700] text-black' : 'bg-[#282828] text-neutral-300 hover:bg-[#3E3E3E]'
            }`}
          >
            單圖
          </button>
          <button
            onClick={() => switchMode('collage')}
            className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition ${
              mode === 'collage' ? 'bg-[#FFD700] text-black' : 'bg-[#282828] text-neutral-300 hover:bg-[#3E3E3E]'
            }`}
          >
            2x2
          </button>
          <div className="flex-1" />
          {onGenerated && previewUrl && (
            <button
              onClick={handleConfirm}
              className="w-full py-2 bg-green-700 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition"
            >
              確認
            </button>
          )}
          {eyedropperMode && <p className="text-xs text-[#FFD700]">點擊封面揀顏色</p>}
          {generating && <p className="text-xs text-neutral-500">生成中...</p>}
        </div>
      </div>

      {/* Color picker - one row, no label */}
      <div>
        <div className="flex items-center gap-1.5">
          {PRESET_COLORS.map(c => (
            <button
              key={c.value}
              onClick={() => { setFrameColor(c.value); setEyedropperMode(false) }}
              className={`w-7 h-7 rounded-md border-2 transition flex-shrink-0 ${
                frameColor === c.value ? 'border-white scale-110' : 'border-neutral-600 hover:border-neutral-400'
              }`}
              style={{ backgroundColor: c.value }}
              title={c.label}
            />
          ))}
          <button
            onClick={() => setEyedropperMode(!eyedropperMode)}
            className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition ${
              eyedropperMode ? 'border-[#FFD700] bg-[#FFD700]/20' : 'border-neutral-600 bg-[#282828] hover:border-neutral-400'
            }`}
            title="從封面揀色"
          >
            <svg width="14" height="14" viewBox="0 0 326.9 393.2" fill="currentColor" className="text-white">
              <path d="M310.2,97.1l-5.7-4.5,12.1-15.6c16.1-20.6,13-50.5-6.9-66.4-9.9-8-22.3-11.7-35-10.2-12.7,1.4-23.9,7.8-31.8,17.9l-12.6,16.1c-.2.2-.4.3-.6,0l-5.4-4.2c-6.1-4.7-13.6-6.8-21.2-5.8-7.6,1-14.4,4.8-19.1,10.8l-10.6,13.7c-4.7,6.1-6.8,13.6-5.8,21.2s4.8,14.4,10.8,19.1h0c0,0-.2.3-.2.3l.4.3L28.3,276.9c-6.3,7.9-8.2,18.8-4.9,28.4-6.7,3.8-12.3,9.4-16.4,16-11.5,18.6-8.6,43.1,7.1,58.4,8.8,8.7,20.8,13.5,33,13.5s2.1,0,3.2-.1c13.4-.9,25.7-7.5,34-18,3.7-4.6,6.3-9.8,7.9-15.4,10.3.6,20-3.7,26.1-11.7l145.2-191.8c.2-.2.4-.2.6-.1,12.5,9.7,30.5,7.5,40.3-5l10.7-13.8c4.7-6.1,6.8-13.6,5.8-21.2-.8-7.5-4.6-14.3-10.7-19ZM95.9,330.9c-.4.5-1.3.6-2,.5-13.9-1.4-25.7,6.3-28.2,18.6-.6,2.8-1.8,5.4-3.6,7.7-3.3,4.3-8.3,6.9-13.7,7.2-5.4.4-10.6-1.5-14.6-5.4-6.2-6-7.4-16.1-2.9-23.3,2-3.1,4.7-5.6,8-7.2,11.4-5.4,16.2-19.2,11.2-32.7-.3-.6-.2-1.3.2-1.7L200.7,107.2c.1,0,.1-.2.2-.3l40.8,31.4c-.1.2-.3.3-.4.4l-145.4,192.2Z"/>
            </svg>
          </button>
        </div>

        {/* Title text color picker - under frame colors（chip 底色隨 frameColor 改變） */}
        {showTitleTextColorPicker && mode === 'single' && (
          <div className="mt-2">
            <p className="text-xs text-neutral-500 mb-1">文字顏色</p>
            <div className="flex items-center gap-1.5">
            {TITLE_TEXT_COLORS.map((c) => {
              const isSelected = titleTextColor === c.value
              const chipBg = frameColor || (c.value === '#000000' ? '#f2f2f2' : '#000000')
              const chipText = c.value
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setTitleTextColor(c.value)}
                  className={`w-7 h-7 rounded-md border-2 transition flex-shrink-0 flex items-center justify-center font-extrabold ${
                    isSelected ? 'border-white scale-110' : 'border-neutral-600 hover:border-neutral-400'
                  }`}
                  style={{ backgroundColor: chipBg, color: chipText }}
                  title={c.label}
                  aria-label={`封面文字顏色 ${c.label}`}
                >
                  A
                </button>
              )
            })}
            </div>
          </div>
        )}
      </div>

      {/* Title text (single mode only) */}
      {mode === 'single' && (
        <div>
          <p className="text-sm text-neutral-500 mb-1">封面文字 <span className="text-neutral-600">({titleText.length}/6)</span></p>
          <input
            type="text"
            value={titleText}
            onChange={e => setTitleText(e.target.value.slice(0, 6))}
            maxLength={6}
            placeholder="歌單名稱（最多6字）"
            className="w-full px-3 py-2 bg-[#1A1A1A] border border-neutral-700 rounded-lg text-white text-sm outline-none"
          />
        </div>
      )}

      {/* Song picker */}
      <div className="max-h-60 overflow-y-auto space-y-1 bg-[#0A0A0A] rounded-lg p-2 border border-neutral-800">
        {songs.length === 0 ? (
          <p className="text-neutral-600 text-sm text-center py-4">歌單冇歌曲</p>
        ) : (
          songs.map(song => {
            const isSelected = selectedSongs.find(s => s.id === song.id)
            const cover = getSongCover(song)
            return (
              <button
                key={song.id}
                onClick={() => toggleSong(song)}
                disabled={mode !== 'single' && !isSelected && selectedSongs.length >= maxSongs}
                className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition ${
                  isSelected
                    ? 'bg-[#FFD700]/20 border border-[#FFD700]/50'
                    : 'hover:bg-[#1A1A1A] border border-transparent disabled:opacity-40'
                }`}
              >
                <div className="w-10 h-10 rounded bg-neutral-800 overflow-hidden flex-shrink-0">
                  {cover ? (
                    <img src={cover} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">N/A</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm truncate">{song.title}</p>
                  <p className="text-neutral-500 text-xs truncate">{getArtistName(song)}</p>
                </div>
                {isSelected && (
                  <span className="text-[#FFD700] text-xs font-bold flex-shrink-0">
                    {selectedSongs.findIndex(s => s.id === song.id) + 1}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>

      {/* Hidden canvas */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}

function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height)
  const sw = w / scale
  const sh = h / scale
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

function drawFallback(ctx, song, x, y, w, h) {
  ctx.fillStyle = '#282828'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#666'
  ctx.font = '14px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const label = song?.title?.substring(0, 6) || '?'
  ctx.fillText(label, x + w / 2, y + h / 2)
  ctx.textAlign = 'start'
}

function isLightColor(hex) {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}
