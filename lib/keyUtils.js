// Key / Capo 共用工具，供樂譜頁頂部 Key 選擇器使用

export const MAJOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

const KEY_TO_SEMITONE = {
  'C': 0, 'Db': 1, 'C#': 1, 'D': 2, 'Eb': 3, 'D#': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'Ab': 8, 'G#': 8,
  'A': 9, 'Bb': 10, 'A#': 10, 'B': 11,
  'Cm': 0, 'C#m': 1, 'Dm': 2, 'D#m': 3, 'Ebm': 3, 'Em': 4,
  'Fm': 5, 'F#m': 6, 'Gm': 7, 'G#m': 8, 'Am': 9, 'Bbm': 10, 'Bm': 11
};

function getSemitoneFromKey(key) {
  return KEY_TO_SEMITONE[key] ?? 0;
}

/** 計算 Capo 格數（原調 → 選中彈奏調） */
export function calculateCapo(originalKey, selectedKey) {
  const originalSemitone = getSemitoneFromKey(originalKey);
  const selectedSemitone = getSemitoneFromKey(selectedKey);
  let capo = (originalSemitone - selectedSemitone) % 12;
  if (capo < 0) capo += 12;
  return capo;
}

/** 內容轉調 semitone 數（baseKey → selectedKey），與 TabContent 顯示一致 */
export function calculateTransposeSemitones(baseKey, selectedKey) {
  const originalSemitone = getSemitoneFromKey(baseKey);
  const selectedSemitone = getSemitoneFromKey(selectedKey);
  return (selectedSemitone - originalSemitone + 12) % 12;
}

/** 依 baseKey 回傳要顯示的 Key 選項列表 */
export function getKeyOptions(baseKey) {
  if (baseKey?.endsWith('m')) {
    return MINOR_KEYS.filter(k => !['Ebm', 'G#m', 'A#m'].includes(k));
  }
  return MAJOR_KEYS;
}

/**
 * 匯入／舊數據常見錯誤：有 Capo（1–11）但彈奏 Key 留空或等於原調（UI「同原調」），
 * 實際和弦譜係用 (原調音高 − Capo) 嘅形狀。此函數回填應有嘅彈奏 Key 字串。
 * @returns 彈奏 Key；若應維持「只有原調、無獨立彈奏調」則回傳 ''
 */
export function normalizePlayKeyForTab(originalKey, capo, playKey) {
  const o = originalKey || 'C';
  const pTrim = playKey == null || playKey === '' ? '' : String(playKey).trim();
  const capoNum = capo !== '' && capo != null && capo !== undefined ? parseInt(String(capo), 10) : NaN;
  const validCapo = !Number.isNaN(capoNum) && capoNum >= 1 && capoNum <= 11;
  if (KEY_TO_SEMITONE[o] === undefined) {
    if (!pTrim) return '';
    if (o.endsWith('m') !== pTrim.endsWith('m')) return '';
    return pTrim;
  }
  const oi = KEY_TO_SEMITONE[o];
  if (validCapo) {
    const pi = pTrim ? KEY_TO_SEMITONE[pTrim] : undefined;
    const treatAsSameAsOriginal = !pTrim || (pi !== undefined && pi === oi);
    if (treatAsSameAsOriginal) {
      const isMinor = o.endsWith('m');
      const computedPlayIndex = (oi - capoNum + 12) % 12;
      return isMinor ? MINOR_KEYS[computedPlayIndex] : MAJOR_KEYS[computedPlayIndex];
    }
  }
  if (!pTrim) return '';
  if (o.endsWith('m') !== pTrim.endsWith('m')) return '';
  return pTrim;
}

/** 譜面和弦轉調用嘅「形狀基準調」：normalize 後非空用 normalize，否則用原調 */
export function getChordShapeBaseKey(tab) {
  if (!tab) return 'C';
  const o = tab.originalKey || 'C';
  const n = normalizePlayKeyForTab(o, tab.capo, tab.playKey);
  return n !== '' ? n : o;
}
