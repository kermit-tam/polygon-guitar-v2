/**
 * 判斷樂譜是否包含「六線譜」相關內容（與 TabContent 隱藏六線譜所影響嘅區塊一致）：
 * - 記譜編輯器 AlphaTex（單一或 notationBlocks）
 * - GP 段落（有檔案 URL）
 * - 內文 ASCII 六線譜段落（detectGuitarTabSection）
 */

function isGuitarTabLine(line) {
  const trimmed = line.trim()
  const standardTab = /^(?:e|b|g|d|a|E|B|G|D|A|\d)[\|\-~\/\\bp\(\)\[\]x\d\s]+$/i
  const numberTab = /^[\|\-~\/\\\s]*\d+[\|\-~\/\\\s\dx]*$/
  const hasTabCharacteristics =
    ((trimmed.match(/-/g) || []).length >= 3 || (trimmed.match(/\d/g) || []).length >= 2) && trimmed.length >= 5
  return standardTab.test(trimmed) || (numberTab.test(trimmed) && hasTabCharacteristics)
}

function detectGuitarTabSection(lines, startIndex) {
  const tabLines = []
  let i = startIndex
  while (i < lines.length && tabLines.length < 10) {
    const line = lines[i].trim()
    if (isGuitarTabLine(line)) {
      tabLines.push({ line, index: i })
      i++
    } else if (line === '' && tabLines.length > 0) {
      break
    } else if (tabLines.length > 0) {
      break
    } else {
      i++
    }
  }
  if (tabLines.length >= 3) {
    return { isTabSection: true, endIndex: tabLines[tabLines.length - 1].index + 1 }
  }
  return { isTabSection: false }
}

function contentHasAsciiGuitarTab(content) {
  if (!content || typeof content !== 'string') return false
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const { isTabSection } = detectGuitarTabSection(lines, i)
    if (isTabSection) return true
  }
  return false
}

function gpSegmentsHaveStaff(gpSegments) {
  if (!Array.isArray(gpSegments) || gpSegments.length === 0) return false
  return gpSegments.some((s) => {
    const u = (s?.fileUrl || s?.cloudinaryUrl || '').trim()
    return Boolean(u)
  })
}

/**
 * @param {{ content?: string, notationAlphaTex?: string, notationBlocks?: Array<{ notationAlphaTex?: string }>|null, gpSegments?: Array<{ fileUrl?: string, cloudinaryUrl?: string }>|null }} tabLike
 * @returns {boolean}
 */
export function tabDocumentHasTabStaff(tabLike) {
  if (!tabLike || typeof tabLike !== 'object') return false
  const { content, notationAlphaTex, notationBlocks, gpSegments } = tabLike
  if ((notationAlphaTex || '').trim()) return true
  if (Array.isArray(notationBlocks) && notationBlocks.some((b) => (b?.notationAlphaTex || '').trim())) {
    return true
  }
  if (gpSegmentsHaveStaff(gpSegments)) return true
  if (contentHasAsciiGuitarTab(content || '')) return true
  return false
}
