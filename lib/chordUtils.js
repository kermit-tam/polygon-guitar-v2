/**
 * 和弦工具函數 - 供 ChordDiagram 與 chordPlayback 共用
 * 指法數據改用 @tombatossals/chords-db
 */

import { calculateTransposeSemitones } from './keyUtils';

export { getChordShape, getChordFromDb } from './chordDb';

/** TabContent 用 'night' | 'day'；舊碼用 'dark' */
export function isChordUiDark(theme) {
  return theme === 'dark' || theme === 'night';
}

export function extractChords(content) {
  if (!content) return [];
  /**
   * 必須一次過食晒 slash chord（如 D/F#、Am7/G），否則 \b 會拆成 D + F# 兩個 token。
   * 結尾 (?:\/[A-G][#b]?)? ＝可選低音部。
   * (?<!\/) 排除獨立 bass 指示（如 /B、/G）— 呢啲唔係完整和弦，唔入 bottom sheet。
   */
  /** 7／9 等後可再接 sus2、sus4（如 F7sus2）；單一 optional 唔夠食晒成串 */
  /** m7-5（半減七）、7-9 等：減號延伸 */
  const chordPattern =
    /(?<!\/)(?<![A-Ga-g#b])\b[A-G][#b]?(?:maj|mj|maj7|m7|m|min|dim|aug|sus\d*|add\d*|7|9|11|13)?\d*(?:-\d+)*(?:sus\d*)?(?:\/[A-G][#b]?)?(?=\s|$|\||\b)/g;
  const matches = content.match(chordPattern) || [];
  /** 驗證主和弦部分（剝 slash 低音）；sus2/sus4、add9 等用 sus\d*、add\d* */
  const validChordPattern = /^[A-G][#b]?(maj|mj|m|min|dim|aug|sus\d*|add\d*|m7|maj7|7|9|11|13)*(?:-\d+)*$/;
  const validChords = matches.filter((c) => validChordPattern.test(c.replace(/\/.*/, '')));
  return [...new Set(validChords)];
}

/** 用戶揀嘅顯示調係「降號調」時，轉調後和弦名用 Bb/Eb 等（唔用 A#/D#） */
export function preferFlatsForDisplayKey(key) {
  if (key == null || key === '') return false;
  const k = String(key).trim();
  if (!k) return false;
  const flatMajors = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']);
  const flatMinors = new Set(['Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);
  if (/m$/i.test(k)) return flatMinors.has(k);
  return flatMajors.has(k);
}

const CHORDS_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORDS_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** 轉調單個和弦（支援 slash chord，如 C/E） */
export function transposeChord(chord, semitones, preferFlats = false) {
  const names = preferFlats ? CHORDS_FLAT : CHORDS_SHARP;
  const slashMatch = chord.match(/^([A-G][#b]?[^\/]*)(?:\/([A-G][#b]?))?$/);
  if (!slashMatch) return chord;

  const [, mainChord, bassNote] = slashMatch;

  const mainMatch = mainChord.match(/^([A-G][#b]?)(.*)$/);
  if (!mainMatch) return chord;

  const [, root, suffix] = mainMatch;
  let index = CHORDS_SHARP.indexOf(root);
  if (index === -1) index = CHORDS_FLAT.indexOf(root);
  if (index === -1) return chord;

  const newIndex = (index + semitones + 12) % 12;
  const newRoot = names[newIndex];

  let newBass = '';
  if (bassNote) {
    let bassIndex = CHORDS_SHARP.indexOf(bassNote);
    if (bassIndex === -1) bassIndex = CHORDS_FLAT.indexOf(bassNote);
    if (bassIndex !== -1) {
      const newBassIndex = (bassIndex + semitones + 12) % 12;
      newBass = '/' + names[newBassIndex];
    }
  }

  return newRoot + suffix + newBass;
}

/** 延續低音寫法：空格後嘅「/B」「/G」等同 slash chord 嘅低音部 */
export function transposeSlashBassOnly(token, semitones, preferFlats = false) {
  if (!semitones || semitones === 0) return token;
  const names = preferFlats ? CHORDS_FLAT : CHORDS_SHARP;
  const m = token.match(/^\/([A-G][#b]?)$/);
  if (!m) return token;
  const bassNote = m[1];
  let bassIndex = CHORDS_SHARP.indexOf(bassNote);
  if (bassIndex === -1) bassIndex = CHORDS_FLAT.indexOf(bassNote);
  if (bassIndex === -1) return token;
  const newBassIndex = (bassIndex + semitones + 12) % 12;
  return '/' + names[newBassIndex];
}

/**
 * 依目前 Key 從樂譜內容抽出嘅和弦名單轉成顯示用（與 TabContent 譜面一致）
 */
export function getTransposedUniqueChordsFromContent(content, baseKey, selectedKey) {
  const raw = extractChords(content);
  if (!raw.length) return [];
  const semitones = calculateTransposeSemitones(baseKey, selectedKey);
  if (semitones === 0) return raw;
  const preferFlats = preferFlatsForDisplayKey(selectedKey);
  const seen = new Set();
  const out = [];
  for (const c of raw) {
    const t = transposeChord(c, semitones, preferFlats);
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
