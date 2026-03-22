/**
 * 譜內容中整行錨點：[六線譜 N]（N 為 1-based），用於決定每段 AlphaTab 顯示位置。
 */

/** @returns {{ slot: number } | null} slot 為 1-based */
export function parseNotationMarkerLine(line) {
  if (typeof line !== 'string') return null
  const m = line.match(/^\s*\[\s*六線譜\s*(\d+)\s*\]\s*$/)
  if (!m) return null
  const slot = parseInt(m[1], 10)
  if (!Number.isFinite(slot) || slot < 1) return null
  return { slot }
}

export function contentHasNotationAnchors(content) {
  if (!content || typeof content !== 'string') return false
  const lines = content.split(/\r?\n/)
  return lines.some((l) => parseNotationMarkerLine(l) !== null)
}
