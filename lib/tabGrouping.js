/**
 * 歌手頁歌譜合併邏輯
 * 1. 「歌名 + 空格/符號後任何內容」都當同一首：取「歌名」= 第一個 token（以空格、-、–、— 分隔），唔用固定後綴表。
 * 2. 組合歌（如「耿耿於懷 X 念念不忘」）同時出現在兩個歌名 Menu。
 * 3. 忽略空格視為同一首：如「溝之口 沒有 藤井風」與「溝之口沒有藤井風」會合併。
 */

// 歌名與後綴之間的分隔：空格、連字號、en-dash、em-dash（避免 typo「歌名-」miscount）
const TITLE_SEP = /[\s\-–—]+/;

/**
 * 從一段文字取出「主歌名」= 第一個 token（分隔符前）。
 * 例：「幸福摩天輪 自彈自唱版」→「幸福摩天輪」；「幸福摩天輪-自彈自唱版」→「幸福摩天輪」
 * 英文歌名（無 CJK 字符）保留完整：「story that never ends」→「story that never ends」
 * @param {string} segment - 已 trim 嘅一段（可能係全個 title 或 X 拆開後嘅一部分）
 * @returns {string}
 */
const HAS_CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
export function normalizeTitleForGrouping(segment) {
  if (!segment || typeof segment !== 'string') return '';
  const s = segment.trim();
  if (!s) return '';
  const first = s.split(TITLE_SEP)[0];
  // 英文歌名冇 CJK 字符：唔按空格截斷，用完整標題（但仍按 dash 截斷）
  if (!HAS_CJK.test(first)) {
    const dashFirst = s.split(/[-–—]+/)[0].trim();
    return dashFirst || s;
  }
  return (first && first.trim()) || s;
}

/** 組合歌分隔符：X 兩邊可有可無空格，支援半形 xX、Unicode ×、全形 Ｘｘ */
const COMBINED_SEP = /\s*[xX×Ｘｘ]\s*/;

/**
 * 取得此歌名對應的「合併 key」列表。
 * - 單一歌名：回傳 [正規化歌名]，變體會與主歌名合併。
 * - 組合歌（A X B）：回傳 [正規化(A), 正規化(B)]，同一份譜會出現在兩個 Menu。
 * @param {string} title - 樂譜標題
 * @param {string} fallbackId - 無有效 key 時用的 fallback（如 tab.id）
 * @returns {string[]}
 */
export function getGroupKeys(title, fallbackId = '') {
  const raw = (title && typeof title === 'string' ? title : '').trim();
  if (!raw) return [fallbackId || 'unknown'];

  const noSpaceKey = raw.replace(/\s+/g, '');
  const parts = raw.split(COMBINED_SEP).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    // 組合歌／Medley：每邊各自一個 key，同一份譜會出現喺兩邊歌名 menu。
    // 唔好再加「全名去空格」— 否則歌手頁 groupByTitle 會把兩邊同整串 Medley merge 成一個「N 份譜」列。
    const keys = parts.map((p) => normalizeTitleForGrouping(p) || p).filter(Boolean);
    const set = new Set(keys.length ? keys : [normalizeTitleForGrouping(raw) || raw]);
    return [...set];
  }

  const normalized = normalizeTitleForGrouping(raw) || raw;
  const set = new Set([normalized]);
  if (noSpaceKey) set.add(noSpaceKey);
  return [...set];
}
