/**
 * Algorithmic chord voicing calculator.
 * Computes playable guitar voicings from music theory when chords-db has no entry.
 * Given root + quality + optional bass note → fretboard positions.
 */

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

/** Chord quality → semitone intervals from root (pitch classes mod 12) */
const QUALITY_INTERVALS = {
  'major':    [0, 4, 7],
  'minor':    [0, 3, 7],
  '7':        [0, 4, 7, 10],
  'maj7':     [0, 4, 7, 11],
  'm7':       [0, 3, 7, 10],
  'dim':      [0, 3, 6],
  'dim7':     [0, 3, 6, 9],
  'aug':      [0, 4, 8],
  'sus2':     [0, 2, 7],
  'sus4':     [0, 5, 7],
  '7sus4':    [0, 5, 7, 10],
  'add9':     [0, 2, 4, 7],
  'madd9':    [0, 2, 3, 7],
  '6':        [0, 4, 7, 9],
  'm6':       [0, 3, 7, 9],
  '69':       [0, 2, 4, 7, 9],
  '9':        [0, 2, 4, 7, 10],
  'm9':       [0, 2, 3, 7, 10],
  'maj9':     [0, 2, 4, 7, 11],
  '11':       [0, 4, 5, 7, 10],
  'm11':      [0, 3, 5, 7, 10],
  'maj11':    [0, 4, 5, 7, 11],
  '13':       [0, 4, 7, 9, 10],
  'maj13':    [0, 4, 7, 9, 11],
  '7b5':      [0, 4, 6, 10],
  '7b9':      [0, 1, 4, 7, 10],
  '7#9':      [0, 3, 4, 7, 10],
  'm7b5':     [0, 3, 6, 10],
  'mmaj7':    [0, 3, 7, 11],
  'aug7':     [0, 4, 8, 10],
  'alt':      [0, 4, 6, 10],
  '9b5':      [0, 2, 4, 6, 10],
  'aug9':     [0, 2, 4, 8, 10],
  'maj7b5':   [0, 4, 6, 11],
  'maj7#5':   [0, 4, 8, 11],
  'm69':      [0, 2, 3, 7, 9],
  'mmaj7b5':  [0, 3, 6, 11],
  'mmaj9':    [0, 2, 3, 7, 11],
  'mmaj11':   [0, 3, 5, 7, 11],
  '9#11':     [0, 2, 4, 6, 7, 10],
};

function noteNameToPc(name) {
  if (!name || typeof name !== 'string') return -1;
  const ch = name.trim();
  const baseIdx = NOTES.indexOf(ch.charAt(0).toUpperCase());
  if (baseIdx < 0) return -1;
  const acc = ch.slice(1);
  if (acc === '#') return (baseIdx + 1) % 12;
  if (acc === 'b') return (baseIdx + 11) % 12;
  return baseIdx;
}

/**
 * Compute the single best guitar voicing for a chord.
 * @param {string} rootName - e.g. 'C', 'F#', 'Bb'
 * @param {string} quality  - chords-db suffix, e.g. 'major', '7', 'm7'
 * @param {string|null} bassNoteName - bass note for slash chords, e.g. 'G#'
 * @returns {{ frets: number[], fingers: number[], baseFret: number, barres: number[] } | null}
 */
export function computeChordVoicing(rootName, quality, bassNoteName) {
  const results = computeAllVoicings(rootName, quality, bassNoteName, 1);
  return results.length > 0 ? results[0] : null;
}

/**
 * Compute multiple alternative voicings, sorted best-first.
 * @param {number} [maxResults=6]
 */
export function computeAllVoicings(rootName, quality, bassNoteName, maxResults = 6) {
  const rootPc = noteNameToPc(rootName);
  if (rootPc < 0) return [];

  const intervals = QUALITY_INTERVALS[quality];
  if (!intervals) return [];

  const chordPcSet = new Set(intervals.map(i => (rootPc + i) % 12));
  const bassPc = bassNoteName ? noteNameToPc(bassNoteName) : rootPc;
  if (bassPc < 0) return [];
  chordPcSet.add(bassPc);

  // Essential pitch classes that must appear in a valid voicing
  const essentialPcs = new Set();
  essentialPcs.add(rootPc);
  // The quality-defining interval (3rd / sus / dim)
  if (intervals.length > 1) essentialPcs.add((rootPc + intervals[1]) % 12);
  // 7th if present
  for (const iv of intervals) {
    if (iv === 10 || iv === 11) {
      essentialPcs.add((rootPc + iv) % 12);
      break;
    }
  }

  const scored = []; // { score, frets }

  for (let wStart = 0; wStart <= 9; wStart++) {
    const wEnd = wStart + 3;

    // Candidates per string: mute, open (if chord tone), frets in window (if chord tone)
    const strCands = [];
    for (let s = 0; s < 6; s++) {
      const sc = [{ fret: -1, pc: -1 }];
      for (let f = 0; f <= wEnd; f++) {
        if (f > 0 && f < wStart) continue;
        const pc = (OPEN_MIDI[s] + f) % 12;
        if (chordPcSet.has(pc)) sc.push({ fret: f, pc });
      }
      strCands.push(sc);
    }

    // Mutable scratch arrays for backtracking (avoid allocations)
    const tmpFrets = new Int8Array(6);
    const tmpPcs = new Int8Array(6);
    let windowBestScore = -Infinity;
    let windowBestFrets = null;

    const search = (sIdx, played) => {
      if (sIdx >= 6) {
        if (played < 3) return;

        // Bass check: first played string must be bassPc
        for (let i = 0; i < 6; i++) {
          if (tmpFrets[i] >= 0) {
            if ((OPEN_MIDI[i] + tmpFrets[i]) % 12 !== bassPc) return;
            break;
          }
        }

        // Essential coverage check
        const covered = new Set();
        for (let i = 0; i < 6; i++) {
          if (tmpPcs[i] >= 0) covered.add(tmpPcs[i]);
        }
        for (const ep of essentialPcs) {
          if (!covered.has(ep) && ep !== bassPc) return;
        }
        if (covered.size < 2) return;

        // Score
        let score = played * 5 + covered.size * 25 - wStart * 6;

        // Open strings: bonus in low positions, heavy penalty with high frets
        let openCount = 0;
        for (let i = 0; i < 6; i++) if (tmpFrets[i] === 0) openCount++;
        if (wStart <= 3) {
          score += openCount * 8;
        } else {
          score -= openCount * 20;
        }

        // Penalise internal gaps (muted strings between played strings)
        let fp = -1, lp = -1;
        for (let i = 0; i < 6; i++) if (tmpFrets[i] >= 0) { fp = i; break; }
        for (let i = 5; i >= 0; i--) if (tmpFrets[i] >= 0) { lp = i; break; }
        for (let i = fp; i <= lp; i++) if (tmpFrets[i] === -1) score -= 15;

        if (score > windowBestScore) {
          windowBestScore = score;
          windowBestFrets = Array.from(tmpFrets);
        }
        return;
      }

      // Pruning: can we still reach 3 played strings?
      if (played + (6 - sIdx) < 3) return;

      for (const c of strCands[sIdx]) {
        tmpFrets[sIdx] = c.fret;
        tmpPcs[sIdx] = c.pc;
        search(sIdx + 1, played + (c.fret >= 0 ? 1 : 0));
      }
    };

    search(0, 0);
    if (windowBestFrets) {
      scored.push({ score: windowBestScore, frets: windowBestFrets });
    }
  }

  if (!scored.length) return [];

  // Dedupe identical fret patterns, keep highest score
  const seen = new Set();
  const unique = [];
  scored.sort((a, b) => b.score - a.score);
  for (const item of scored) {
    const key = item.frets.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique.slice(0, maxResults).map(item => buildPosition(item.frets));
}

/** Convert raw absolute frets array → position object compatible with chordDb's buildChordResultFromPosition */
function buildPosition(frets) {
  const barres = [];
  const fretGroups = {};
  frets.forEach((f, i) => {
    if (f > 0) {
      if (!fretGroups[f]) fretGroups[f] = [];
      fretGroups[f].push(i);
    }
  });
  for (const [fretStr, strings] of Object.entries(fretGroups)) {
    const fret = parseInt(fretStr);
    if (strings.length < 2) continue;
    const minS = Math.min(...strings);
    const maxS = Math.max(...strings);
    let canBarre = true;
    for (let i = minS; i <= maxS; i++) {
      if (frets[i] > 0 && frets[i] < fret) { canBarre = false; break; }
    }
    if (canBarre) barres.push(fret);
  }

  return {
    frets: Array.from(frets),
    fingers: frets.map(() => 0),
    baseFret: 1,
    barres,
  };
}
