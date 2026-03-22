/**
 * Convert StaffCanvas snapshot (firstBeats + subdivisions + time signature)
 * into alphaTex for @coderline/alphatab.
 *
 * Fretted notes in alphaTex are fret.string (e.g. 3.2 = fret 3, string 2).
 * Editor stringIndex 0 = top line (high e) → alphaTex string 1.
 */

const DURATION_TO_AT = {
  whole: 1,
  half: 2,
  quarter: 4,
  eighth: 8,
  sixteenth: 16,
  thirtySecond: 32,
}

function parseTimeSignature(tsId) {
  const m = String(tsId || '4/4').match(/^(\d+)\/(\d+)$/)
  if (!m) return [4, 4]
  return [parseInt(m[1], 10), parseInt(m[2], 10)]
}

function normalizeBeats(sub) {
  return sub?.beats ?? [sub]
}

/** Escape user chord text for alphaTex `{ ch "..." }` strings. */
function escapeChordForAlphaTex(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * One tab note: fret.string, tie continuation `- . string`, or dead `x.string` (not used yet).
 * alphaTex: tied notes use `-` as the “fret” token, then `.` then 1-based string (high e = 1).
 */
function formatTabNote(n) {
  const strNum = (n.stringIndex ?? 0) + 1
  if (n.tiedFromPrevious) {
    return `- . ${strNum}`
  }
  return `${n.fret}.${strNum}`
}

/** One beat → alphaTex fragment (duration prefix + content + effects). */
function beatToTex(beat) {
  const durNum = DURATION_TO_AT[beat.duration] ?? 4
  let head = `:${durNum}`
  if (beat.tuplet) head += ' { tu 3 }'

  const raw = beat.notes ?? []
  const notes = raw.filter((n) => n.tiedFromPrevious || n.fret != null)

  let body
  if (notes.length === 0) {
    body = 'r'
  } else if (notes.length === 1) {
    body = formatTabNote(notes[0])
  } else {
    const ordered = [...notes].sort((a, b) => (a.stringIndex ?? 0) - (b.stringIndex ?? 0))
    body = `(${ordered.map(formatTabNote).join(' ')})`
  }

  const dotted = beat.dotted ? ' { d }' : ''
  const chord = (beat.chord ?? '').trim()
  const chordTex = chord ? ` { ch "${escapeChordForAlphaTex(chord)}" }` : ''
  return `${head} ${body}${dotted}${chordTex}`
}

function barToTex(beats) {
  const list = Array.isArray(beats) ? beats : []
  if (list.length === 0) return ':4 r |'
  return `${list.map(beatToTex).join(' ')} |`
}

/**
 * @param {{ timeSignatureId: string, firstBeats: object[], subdivisions: object[] }} snapshot
 * @returns {string} alphaTex document
 */
export function notationSnapshotToAlphaTex(snapshot) {
  const { timeSignatureId = '4/4', firstBeats = [], subdivisions = [], bpm: bpmRaw } = snapshot
  let tempo = 100
  if (bpmRaw != null && bpmRaw !== '') {
    const n = Number(bpmRaw)
    if (!Number.isNaN(n)) tempo = Math.round(Math.min(480, Math.max(1, n)))
  }
  const [num, den] = parseTimeSignature(timeSignatureId)

  const bars = []
  bars.push(barToTex(firstBeats))
  for (const sub of subdivisions) {
    bars.push(barToTex(normalizeBeats(sub)))
  }

  // Bars on one line after \ts — track body must NOT be wrapped in `{ ... }`
  // (braces after \track are only for properties like `{ instrument 25 }`).
  // \tuning uses a parenthesized pitch list per alphaTex staff metadata.
  const barsTex = bars.join(' ')

  return `\\title "Notation editor"
\\tempo ${tempo}
\\track { instrument 25 }
\\staff {tabs}
\\tuning (e4 b3 g3 d3 a2 e2)
\\ts (${num} ${den}) ${barsTex}
`
}
