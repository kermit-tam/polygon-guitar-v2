/**
 * Toolbar for music notation editor.
 * Uses Noto Music font (https://fonts.google.com/noto/specimen/Noto+Music) for symbols.
 * Sections: Duration (whole→32nd), Division (dotted, tie, tuplet), Beats (2/4, 3/4, 4/4, 6/8) popup.
 */

import { useState, useRef, useEffect } from 'react'
import { NOTATION_BLOCK_LABELS } from '@/lib/notationBlocks'

const NOTO_MUSIC = '"Noto Music", sans-serif'

// Duration: one of these is selected at a time
export const TOOL_IDS = {
  WHOLE: 'whole',
  HALF: 'half',
  QUARTER: 'quarter',
  EIGHTH: 'eighth',
  SIXTEENTH: 'sixteenth',
  THIRTY_SECOND: 'thirtySecond',
}

// Division: additive toggles (can combine with duration)
export const DIVISION_IDS = {
  DOTTED: 'dotted',   // 0.5 note
  TIE: 'tie',
  TUPLET: 'tuplet',
}

// Unicode note values in Noto Music (U+1D15D–1D162)
const DURATION_SYMBOLS = {
  [TOOL_IDS.WHOLE]: '\u{1D15D}',      // 𝅗
  [TOOL_IDS.HALF]: '\u{1D15E}',       // 𝅗𝅥
  [TOOL_IDS.QUARTER]: '\u{1D15F}',    // 𝅘𝅥
  [TOOL_IDS.EIGHTH]: '\u{1D160}',     // 𝅘𝅥𝅮
  [TOOL_IDS.SIXTEENTH]: '\u{1D161}',  // 𝅘𝅥𝅯
  [TOOL_IDS.THIRTY_SECOND]: '\u{1D162}', // 𝅘𝅥𝅰
}

// Time signature options
export const TIME_SIGNATURES = [
  { id: '2/4', top: 2, bottom: 4 },
  { id: '3/4', top: 3, bottom: 4 },
  { id: '4/4', top: 4, bottom: 4 },
  { id: '6/8', top: 6, bottom: 8 },
]

const DURATION_ORDER = [
  TOOL_IDS.WHOLE,
  TOOL_IDS.HALF,
  TOOL_IDS.QUARTER,
  TOOL_IDS.EIGHTH,
  TOOL_IDS.SIXTEENTH,
  TOOL_IDS.THIRTY_SECOND,
]

const DIVISION_ORDER = [DIVISION_IDS.DOTTED, DIVISION_IDS.TIE, DIVISION_IDS.TUPLET]

const btnBase = 'flex items-center justify-center rounded transition-colors border border-transparent'
const btnSelected = 'bg-neutral-300 text-neutral-800 border-neutral-400'
const btnUnselected =
  'text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900'

/** 1px 分隔線；固定寬高避免同拍號掣之間視覺唔一致 */
function ToolbarDivider() {
  return (
    <div
      className="mr-2 h-10 w-[1px] min-w-[1px] max-w-[1px] shrink-0 self-center bg-neutral-300"
      aria-hidden
    />
  )
}

function ToolButton({ selected, onClick, label, children, className = '', size = 'md' }) {
  const dim = size === 'duration' ? 'w-[30px] min-w-[30px] max-w-[30px] h-10' : 'w-10 h-10'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${btnBase} ${dim} ${selected ? btnSelected : btnUnselected} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={selected}
    >
      {children}
    </button>
  )
}

export default function NotationToolbar({
  selectedDuration,
  onSelectDuration,
  divisionFlags = {},
  onToggleDivision,
  timeSignatureId,
  onSelectTimeSignature,
  bpm = null,
  onBpmChange,
  onBpmBlur,
  capo = 0,
  onCapoChange,
  label = '',
  onLabelChange,
}) {
  const [tupletImgFailed, setTupletImgFailed] = useState(false)
  const [beatsPopupOpen, setBeatsPopupOpen] = useState(false)
  const beatsButtonRef = useRef(null)
  const beatsPopupRef = useRef(null)

  useEffect(() => {
    if (!beatsPopupOpen) return
    const handleClickOutside = (e) => {
      if (
        beatsButtonRef.current?.contains(e.target) ||
        beatsPopupRef.current?.contains(e.target)
      ) return
      setBeatsPopupOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [beatsPopupOpen])

  const currentTs = TIME_SIGNATURES.find((t) => t.id === timeSignatureId) ?? TIME_SIGNATURES[2]

  return (
    <div
      className="bg-white py-3 px-4 rounded-t-xl border-x border-t border-neutral-300 border-b border-neutral-300"
      style={{ fontFamily: NOTO_MUSIC }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {onLabelChange && (
          <select
            value={NOTATION_BLOCK_LABELS.find((o) => label === o.value || label?.startsWith(o.value))?.value || ''}
            onChange={(e) => onLabelChange(e.target.value)}
            className="h-9 shrink-0 rounded-lg px-2 text-xs font-medium outline-none bg-neutral-100 text-neutral-700 border border-neutral-300"
            style={{ fontFamily: 'system-ui, sans-serif' }}
            aria-label="Section label"
          >
            {NOTATION_BLOCK_LABELS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-0 shrink-0">
          <ToolbarDivider />
          <div className="flex flex-wrap items-center gap-0 shrink-0">
            {DURATION_ORDER.map((id) => (
              <ToolButton
                key={id}
                size="duration"
                selected={selectedDuration === id}
                onClick={() => onSelectDuration(id)}
                label={id}
              >
                <span className="text-2xl" aria-hidden>{DURATION_SYMBOLS[id]}</span>
              </ToolButton>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-0 shrink-0">
          <ToolbarDivider />
          <div className="flex flex-wrap items-center gap-0 shrink-0">
            <ToolButton
              selected={divisionFlags[DIVISION_IDS.DOTTED]}
              onClick={() => onToggleDivision(DIVISION_IDS.DOTTED)}
              label="Dotted (0.5)"
            >
              <span className="inline-flex items-center justify-center h-8 text-2xl leading-none" aria-hidden>𝅘𝅥.</span>
            </ToolButton>
            <ToolButton
              selected={divisionFlags[DIVISION_IDS.TIE]}
              onClick={() => onToggleDivision(DIVISION_IDS.TIE)}
              label="Tie"
            >
              <span className="inline-flex items-center justify-center h-8 text-2xl leading-none" aria-hidden>𝅘𝅥𝆤</span>
            </ToolButton>
            <ToolButton
              selected={divisionFlags[DIVISION_IDS.TUPLET]}
              onClick={() => onToggleDivision(DIVISION_IDS.TUPLET)}
              label="Tuplet"
              className="overflow-hidden"
            >
              <span className="inline-flex items-center justify-center h-8 w-8">
                {tupletImgFailed ? (
                  <span className="text-xl font-bold text-current leading-none" aria-hidden>3</span>
                ) : (
                  <img
                    src="/tuplet.png"
                    alt="Tuplet"
                    className="w-6 h-6 object-contain object-center"
                    onError={() => setTupletImgFailed(true)}
                  />
                )}
              </span>
            </ToolButton>
          </div>
        </div>
        <div className="flex items-center gap-0 shrink-0">
          <ToolbarDivider />
          <div className="relative shrink-0" ref={beatsButtonRef}>
            <button
              type="button"
              onClick={() => setBeatsPopupOpen((o) => !o)}
              className={`${btnBase} w-10 h-10 ${beatsPopupOpen ? btnSelected : btnUnselected}`}
              title="Time signature"
              aria-label={`Time signature ${currentTs.top}/${currentTs.bottom}`}
              aria-expanded={beatsPopupOpen}
              aria-haspopup="listbox"
            >
              <span className="text-sm font-normal tabular-nums" style={{ fontFamily: 'system-ui, sans-serif' }}>
                {currentTs.top}
                <br />
                {currentTs.bottom}
              </span>
            </button>
            {beatsPopupOpen && (
              <div
                ref={beatsPopupRef}
                className="absolute left-0 top-full z-10 mt-1 rounded border border-neutral-300 bg-white text-black shadow-lg py-1 min-w-[2.5rem]"
                role="listbox"
                aria-label="Time signature options"
              >
                {TIME_SIGNATURES.map(({ id, top, bottom }) => (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={timeSignatureId === id}
                    onClick={() => {
                      onSelectTimeSignature(id)
                      setBeatsPopupOpen(false)
                    }}
                    className={`w-full flex items-center justify-center gap-1 px-3 py-2 text-sm tabular-nums text-black hover:bg-neutral-100 ${timeSignatureId === id ? 'bg-neutral-200 font-medium' : ''}`}
                    style={{ fontFamily: 'system-ui, sans-serif' }}
                  >
                    {top}/{bottom}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0 shrink-0">
          <ToolbarDivider />
          <select
            value={Math.min(12, Math.max(0, Number(capo) || 0))}
            onChange={(e) => onCapoChange?.(Number(e.target.value))}
            className="h-9 shrink-0 rounded-lg px-2 text-xs font-medium outline-none bg-neutral-100 text-neutral-700 border border-neutral-300"
            style={{ fontFamily: 'system-ui, sans-serif' }}
            aria-label="Capo"
          >
            <option value={0}>No Capo</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Capo {n}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-0 shrink-0">
          <ToolbarDivider />
          <label
            className="flex items-center gap-2 shrink-0 text-xs font-medium text-neutral-600 uppercase tracking-wide"
            style={{ fontFamily: 'system-ui, sans-serif' }}
          >
            BPM
            <input
              type="number"
              min={1}
              max={480}
              step={1}
              value={bpm === '' || bpm == null ? '' : bpm}
              placeholder="-"
              onChange={(e) => onBpmChange?.(e.target.value)}
              onBlur={() => onBpmBlur?.()}
              className="w-16 h-9 rounded border border-neutral-300 bg-white px-2 text-sm tabular-nums text-black [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-label="Beats per minute"
            />
          </label>
        </div>
      </div>
    </div>
  )
}

export { DURATION_ORDER, DIVISION_ORDER, DURATION_SYMBOLS }
