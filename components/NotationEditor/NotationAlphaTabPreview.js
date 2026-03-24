import { useCallback, useEffect, useRef, useState } from 'react'

/** Giannini Trovador Classical Guitar — real recording, preset remapped to MIDI program 25; SF2 includes lowpass (~11kHz). */
const ALPHATAB_SOUNDFONT = '/soundfonts/giannini-classical.sf2?v=hf1'

function formatAlphaTabLoadError(e) {
  const out = []
  const walk = (err) => {
    if (!err || typeof err !== 'object') return
    if (err.message) out.push(err.message)
    for (const key of ['lexerDiagnostics', 'parserDiagnostics', 'semanticDiagnostics']) {
      const bag = err[key]
      if (bag && typeof bag[Symbol.iterator] === 'function') {
        for (const d of bag) {
          if (d?.message) out.push(d.message)
        }
      }
    }
    if (err.inner) walk(err.inner)
  }
  walk(e)
  const uniq = [...new Set(out.filter(Boolean))]
  return uniq.length ? uniq.join(' — ') : String(e)
}

/** Night: light glyphs on dark canvas (see display.resources in alphaTab docs). */
const COLORS_NIGHT = {
  backgroundColor: '#1a1a1a',
  mainGlyphColor: '#FFFFFF',
  scoreInfoColor: '#FFFFFF',
  secondaryGlyphColor: '#FFFFFF',
  staffLineColor: '#FFFFFF',
  barSeparatorColor: '#FFFFFF',
  barNumberColor: '#FFFFFF',
  fretNumberColor: '#FFFFFF',
  chordNameColor: '#FFFFFF',
  timeSignatureColor: '#FFFFFF',
  tabTuningTextColor: '#FFFFFF',
}

/** Day: dark glyphs on light canvas (match TabContent ASCII 六線譜區). */
const COLORS_DAY = {
  backgroundColor: '#f5f5f5',
  mainGlyphColor: '#171717',
  scoreInfoColor: '#171717',
  secondaryGlyphColor: '#262626',
  staffLineColor: '#404040',
  barSeparatorColor: '#525252',
  barNumberColor: '#404040',
  fretNumberColor: '#171717',
  chordNameColor: '#171717',
  timeSignatureColor: '#171717',
  tabTuningTextColor: '#171717',
}

/**
 * The “TAB” label at the start is the SMuFL tab-clef glyph — hide it per bar via stylesheet colors.
 * (alphaTab has no separate toggle for the label only; layout still reserves clef width.)
 */
function hideGuitarTabClefGlyph(score, AlphaTabModule) {
  const modelNs = AlphaTabModule?.model
  if (!score?.tracks || !modelNs?.BarStyle || !modelNs?.BarSubElement || !modelNs?.Color) return

  const transparent = new modelNs.Color(0, 0, 0, 0)
  const clefKey = modelNs.BarSubElement.GuitarTabsClef

  for (const track of score.tracks) {
    if (!track?.staves) continue
    for (const staff of track.staves) {
      if (!staff?.bars) continue
      for (const bar of staff.bars) {
        if (!bar.style) bar.style = new modelNs.BarStyle()
        bar.style.colors.set(clefKey, transparent)
      }
    }
  }
}

/** Reposition & style the built-in “rendered by alphaTab” credit (no API to disable). */
function styleAlphaTabWatermark(container) {
  if (!container) return

  const apply = () => {
    container.querySelectorAll('text').forEach((textEl) => {
      const raw = (textEl.textContent || '').trim().toLowerCase()
      if (!raw.includes('alphatab') && !raw.includes('rendered')) return

      textEl.style.font = 'normal 12px Arial, sans-serif'
      textEl.style.opacity = '0.5'
      textEl.setAttribute('font-weight', 'normal')

      const svg = textEl.closest('svg')
      if (!svg || !container.contains(svg)) return
      const wrapper = svg.parentElement
      if (!wrapper) return

      Object.assign(wrapper.style, {
        position: 'absolute',
        left: '0',
        top: 'auto',
        right: 'auto',
        bottom: '12px',
        width: 'auto',
        height: 'auto',
        zIndex: '10',
        display: 'inline-block',
        maxWidth: 'calc(100% - 24px)',
      })

      if (svg) {
        svg.style.overflow = 'visible'
        try {
          const bb = textEl.getBBox()
          const pad = 4
          const w = Math.ceil(bb.width + pad * 2)
          const h = Math.ceil(bb.height + pad * 2)
          svg.setAttribute('width', String(w))
          svg.setAttribute('height', String(h))
          textEl.setAttribute('x', String(pad))
          textEl.setAttribute('y', String(pad))
          textEl.setAttribute('text-anchor', 'start')
          textEl.setAttribute('dominant-baseline', 'hanging')
        } catch (_) {
          /* getBBox can fail if svg not laid out */
        }
      }
    })
  }

  apply()
  requestAnimationFrame(apply)
}

/**
 * Renders alphaTex with dynamically imported @coderline/alphatab (no SSR bundle bloat).
 */
export default function NotationAlphaTabPreview({
  alphaTex,
  onError,
  hideBorder = false,
  noTopMargin = false,
  /** No border or outer/inner chrome bg (e.g. tab read view) */
  transparent = false,
  /** Keep cursor overlay clipped inside preview bounds (prevents top-bar overlap on some browsers). */
  clipCursorOverflow = false,
  /** With transparent, still show outer border (e.g. 六線譜編輯器 modal preview). */
  outlined = false,
  /** Explicit BPM to display — only shown if non-null. */
  bpm = null,
  /** 'night' | 'day' — 樂譜頁日間模式要轉淺底深字 */
  theme = 'night',
}) {
  const COLORS = theme === 'day' ? COLORS_DAY : COLORS_NIGHT
  const containerRef = useRef(null)
  const apiRef = useRef(null)
  const [loadError, setLoadError] = useState(null)
  const [ready, setReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)

  useEffect(() => {
    if (!alphaTex?.trim() || !containerRef.current) return undefined

    let cancelled = false

    const run = async () => {
      setLoadError(null)
      setReady(false)
      setIsPlaying(false)
      setPlayerReady(false)
      try {
        const AlphaTab = await import('@coderline/alphatab')
        if (cancelled || !containerRef.current) return

        if (apiRef.current) {
          try {
            apiRef.current.destroy()
          } catch (_) {
            /* ignore */
          }
          apiRef.current = null
        }
        containerRef.current.innerHTML = ''

        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
        const width = containerRef.current.clientWidth || 800

        const api = new AlphaTab.AlphaTabApi(containerRef.current, {
          core: {
            engine: 'svg',
            useWorkers: false,
            fontDirectory: '/fonts/',
            logLevel: 'warning',
          },
          display: {
            staveProfile: 'Tab',
            scale: isMobile ? 0.75 : 1,
            width,
            // [left-right, top-bottom] — default is [35, 35]; remove horizontal inset around the score
            padding: [0, 35],
            resources: {
              mainGlyphColor: COLORS.mainGlyphColor,
              scoreInfoColor: COLORS.scoreInfoColor,
              secondaryGlyphColor: COLORS.secondaryGlyphColor,
              barNumberColor: COLORS.barNumberColor,
              staffLineColor: COLORS.staffLineColor,
              barSeparatorColor: COLORS.barSeparatorColor,
              fretNumberColor: COLORS.fretNumberColor,
              chordNameColor: COLORS.chordNameColor,
              timeSignatureColor: COLORS.timeSignatureColor,
              tabTuningTextColor: COLORS.tabTuningTextColor,
              tablatureFont: '14px Arial, sans-serif',
            },
          },
          notation: {
            elements: {
              scoreTitle: false,
              scoreSubTitle: false,
              scoreArtist: false,
              scoreAlbum: false,
              guitarTuning: false, // hide “Guitar Standard Tuning” (NotationElement.GuitarTuning)
              effectTempo: false,
              effectDynamics: false, // hide f (forte), p, mf, etc. (NotationElement.EffectDynamics)
              effectBeatTimer: false, // hide per-beat timer text on score
              trackNames: false,
            },
          },
          player: {
            enablePlayer: true,
            enableCursor: true,
            enableUserInteraction: true,
            enableElementHighlighting: true,
            scrollMode: 'Off',
            soundFont: ALPHATAB_SOUNDFONT,
          },
        })

        apiRef.current = api

        const onScoreErr = (e) => {
          setLoadError(formatAlphaTabLoadError(e))
          onError?.(e)
        }
        api.error.on(onScoreErr)
        api.playerStateChanged.on((arg) => {
          if (cancelled) return
          const state = typeof arg === 'string' ? arg : arg?.state
          setIsPlaying(state === 'playing')
        })
        api.playerReady.on(() => {
          if (!cancelled) setPlayerReady(true)
        })
        api.scoreLoaded.on((score) => {
          if (score?.stylesheet) {
            score.stylesheet.globalDisplayTuning = false
          }
          hideGuitarTabClefGlyph(score, AlphaTab)
          try {
            api.render()
          } catch (_) {
            /* ignore */
          }
          if (!cancelled) setReady(true)
        })
        api.renderFinished.on(() => {
          if (cancelled || !containerRef.current) return
          requestAnimationFrame(() => styleAlphaTabWatermark(containerRef.current))
        })

        try {
          api.tex(alphaTex)
        } catch (texErr) {
          if (!cancelled) setLoadError(formatAlphaTabLoadError(texErr))
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err?.message || String(err)
          setLoadError(msg)
          onError?.(err)
        }
      }
    }

    run()

    return () => {
      cancelled = true
      if (apiRef.current) {
        try {
          apiRef.current.stop?.()
        } catch (_) {
          /* ignore */
        }
        try {
          apiRef.current.destroy()
        } catch (_) {
          /* ignore */
        }
        apiRef.current = null
      }
    }
  }, [alphaTex, theme])

  /** Tab/embed transparent mode: re-apply watermark after layout (avoids clipped / missed credit). */
  useEffect(() => {
    if (!ready || !containerRef.current) return
    const el = containerRef.current
    const run = () => styleAlphaTabWatermark(el)
    run()
    const raf = requestAnimationFrame(run)
    const t = setTimeout(run, 120)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [ready, alphaTex, transparent, theme])

  const handlePlayPause = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    try {
      if (isPlaying) api.pause()
      else api.play()
    } catch (_) {
      /* ignore */
    }
  }, [isPlaying])

  const handleStop = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    try {
      api.stop()
    } catch (_) {
      /* ignore */
    }
  }, [])

  if (!alphaTex?.trim()) return null

  const showBorder = !hideBorder && (!transparent || outlined)
  const outerBg = transparent ? 'bg-transparent' : theme === 'day' ? 'bg-neutral-50' : 'bg-[#121212]'
  const borderCls = showBorder
    ? theme === 'day'
      ? 'border border-neutral-300'
      : 'border border-neutral-800'
    : ''

  return (
    <div
      data-theme={theme}
      className={`notation-alphatab-preview ${noTopMargin ? '' : 'mt-[25px]'} rounded-xl ${(transparent && !clipCursorOverflow) ? 'overflow-visible' : 'overflow-hidden'} ${outerBg} ${borderCls} ${outlined ? 'px-4 pt-4' : ''}`}
    >
      {loadError && (
        <div className="py-3 text-sm text-red-400 bg-red-950/40 px-0">{loadError}</div>
      )}
      <div
        className={`relative w-full ${transparent ? '' : 'min-h-[220px]'}`}
        style={{ backgroundColor: transparent ? 'transparent' : COLORS.backgroundColor }}
      >
        {ready && !loadError && (
          <div className="absolute top-0 left-0 z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!playerReady}
              className={`${playerReady ? 'bg-[#FFD700] hover:bg-yellow-400' : 'bg-neutral-600 cursor-wait'} rounded-full flex items-center justify-center text-black transition shrink-0`}
              style={{ width: '1.4rem', height: '1.4rem' }}
              aria-label={!playerReady ? 'Loading audio…' : isPlaying ? 'Pause' : 'Play'}
            >
              {!playerReady ? (
                <svg className="w-[0.75rem] h-[0.75rem] animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : isPlaying ? (
                <svg className="w-[1rem] h-[1rem]" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg className="w-[1rem] h-[1rem]" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={handleStop}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition shrink-0 ${theme === 'day' ? 'text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900' : 'text-neutral-200 hover:bg-neutral-700 hover:text-white'}`}
              aria-label="Stop"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            </button>
            {bpm != null && (
              <span
                className={`text-xs tabular-nums shrink-0 ${theme === 'day' ? 'text-neutral-800' : 'text-neutral-200'}`}
              >
                BPM {bpm}
              </span>
            )}
          </div>
        )}
        {!ready && !loadError && (
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center text-sm ${transparent ? 'bg-transparent' : theme === 'day' ? 'bg-white/90 text-neutral-500' : 'bg-[#121212]/90 text-[#B3B3B3]'}`}
          >
            Loading alphaTab…
          </div>
        )}
        <div ref={containerRef} className={`relative w-full ${transparent ? '' : 'min-h-[200px]'} notation-alphatab-host`} />
      </div>
    </div>
  )
}
