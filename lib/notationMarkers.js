/**
 * 譜內容中整行錨點，用於決定每段 AlphaTab 顯示位置。
 * 格式：!label（如 !intro、!intro2、!solo）— 無空格
 */

/** @returns {{ label: string } | null} */
export function parseNotationMarkerLine(line) {
  if (typeof line !== 'string') return null
  const m = line.match(/^\s*!(\S+)\s*$/)
  if (!m) return null
  return { label: m[1].trim() }
}

export function contentHasNotationAnchors(content) {
  if (!content || typeof content !== 'string') return false
  const lines = content.split(/\r?\n/)
  return lines.some((l) => parseNotationMarkerLine(l) !== null)
}
