/**
 * 判斷樂譜內容是否包含「數字簡譜」顯示邏輯會用到嘅材料（與 TabContent 內判斷對齊）。
 * 用於樂譜頁：浮動「隱藏簡譜」掣、設定 panel 內按鈕 disabled。
 */

function lineHasChordMarker(line) {
  if (!line) return false
  if (/[\|｜\u2502][\s]*[A-G]/.test(line)) return true
  return /(?:^|[\s|｜\u2502])\/[A-G][#b]?(?=[\s|｜\u2502]|$)/.test(line)
}

function isNumericNotationLine(line) {
  if (!line) return false

  const notationPattern = /[#b]?\d[#b]?(?:'{1,2}|"{1,2}|,{1,2})?\.{0,2}/g
  const notationMatches = line.match(notationPattern) || []
  const notationCount = notationMatches.length
  const digits = (line.match(/\d/g) || []).length
  const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length
  const hasChordBar = /\|[\s]*[A-G]/.test(line)
  const allLetters = line.match(/[a-zA-Z]/g) || []
  const otherLetters = allLetters.filter((c) => !/[b#]/i.test(c))

  if (otherLetters.length > digits) return false

  if ((notationCount > 3 || digits > 3) && chineseChars < 3 && !hasChordBar) {
    return true
  }

  if (line.includes('(') || line.includes('（')) {
    const numericBracketPattern = /[\(（][#b]?\d+[#b]?(?:'{1,2}|"{1,2}|,{1,2})?\.{0,2}[\)）]/g
    const numericBrackets = line.match(numericBracketPattern) || []
    if (numericBrackets.length >= 1 && (notationCount > 3 || digits > 3) && chineseChars < 3 && otherLetters.length <= digits) {
      return true
    }
  }

  return false
}

function isBracketsOnlyNumberedNotationLine(line) {
  if (!line || !/[\(（]/.test(line) || /[\|｜\u2502][\s]*[A-G]/.test(line)) return false
  const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length
  if (chineseChars >= 2) return false
  const bracketContentRegex = /[\(（]([^\)）]*)[\)）]/g
  let match
  let hasNotation = false
  let allNotationOrEmpty = true
  while ((match = bracketContentRegex.exec(line)) !== null) {
    const inner = match[1].trim()
    if (inner.length > 0) {
      if (/^[#b]?\d+[#b]?(?:'{1,2}|"{1,2}|,{1,2})?\.{0,2}$/.test(inner)) hasNotation = true
      else allNotationOrEmpty = false
    }
  }
  if (!hasNotation || !allNotationOrEmpty) return false
  const outsideBrackets = line.replace(/[\(（][^\)）]*[\)）]/g, '')
  if (/[a-zA-Z\u4e00-\u9fff]/.test(outsideBrackets)) return false
  return true
}

/** 和弦行內有數字簡譜括號，如 12(3)|Em、(1')|Em7、|C 7(3)D| */
function chordLineHasNumberedNotationBrackets(line) {
  if (!line || !lineHasChordMarker(line)) return false
  const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length
  if (chineseChars >= 2) return false
  return /[\(（]\s*[#b']?\d/.test(line)
}

/**
 * @param {string} content
 * @returns {boolean}
 */
export function tabContentHasNumericNotation(content) {
  if (!content || typeof content !== 'string') return false
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue

    const hasChordBar = lineHasChordMarker(line)
    const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length
    const digits = (line.match(/\d/g) || []).length
    const hasBrackets = /[\(（]/.test(line)
    const otherLetters = (line.match(/[a-zA-Z]/g) || []).filter((c) => !/[b#]/i.test(c)).length

    if (chordLineHasNumberedNotationBrackets(line)) return true

    const targetLooksNumericNotation =
      digits > 0 &&
      chineseChars < 3 &&
      !hasChordBar &&
      otherLetters === 0 &&
      /^[\s0-9#b'",.()（）]+$/.test(line)
    if (targetLooksNumericNotation) return true

    if (hasBrackets && !hasChordBar && isBracketsOnlyNumberedNotationLine(line)) return true

    if (digits > 3 && chineseChars < 3 && !hasChordBar && !hasBrackets && otherLetters === 0) return true

    const strictChordPattern = /\b[A-G](#|b)?(maj|mj|m|min|sus|dim|aug)?(add|m7|maj7|7|9|11|13)?\d*((b|#)\d*)?(\/[A-G][#b]?)?(?=\s|$|\||\b)/g
    const chordMatches = line.match(strictChordPattern) || []
    const validChordMatches = chordMatches.filter((m) => /^[A-G]/.test(m.trim()))
    const hasBarLineStart = /^[\s]*[\|｜\u2502]/.test(line)
    const isMetadataLine = /\b(Key|Capo|制譜|編譜|原調|調性|調)\b/i.test(line)
    const NC_PATTERN = /^N\.?C\.?$/i
    const isChordOnlyLine =
      validChordMatches.length > 0 &&
      line
        .trim()
        .split(/\s+/)
        .every((part) => {
          if (!part || part === '|' || part === '｜' || part === '\u2502') return true
          if (NC_PATTERN.test(part)) return true
          if (/^\/[A-G][#b]?$/.test(part)) return true
          if (part === '-' || part === '－' || part === '–' || part === '—' || part === '*') return true
          const chordWithSlash = part.match(
            /^[A-G][#b]?(maj|mj|m|min|sus|dim|aug)?(add|m7|maj7|7|9|11|13)?\d*((b|#)\d*)?(\/[A-G][#b]?)?$/,
          )
          if (chordWithSlash) return true
          const cleanPart = part.replace(/[\|｜\u2502\/\s]/g, '')
          return !cleanPart || cleanPart.match(/^[A-G](#|b)?(maj|mj|m|min|sus|dim|aug)?(add|m7|maj7|7|9|11|13)?\d*((b|#)\d*)?$/)
        })
    const hasSlashBassInLine = /(?:^|[\s|｜\u2502])\/[A-G][#b]?(?=[\s|｜\u2502]|$)/.test(line)
    const hasChordPattern = hasBarLineStart
      ? validChordMatches.length >= 1 || hasSlashBassInLine
      : validChordMatches.length >= 2 || isChordOnlyLine
    const isChord = hasChordPattern && chineseChars < 3 && !isMetadataLine

    if (isNumericNotationLine(line) && !hasChordBar && !isChord) return true
  }
  return false
}
