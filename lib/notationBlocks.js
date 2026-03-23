/**
 * Multi-block AlphaTab notation on a tab document (Firestore).
 * `notationAlphaTex` / `notationStaffSnapshot` on the tab doc mirror the first block for search / older readers.
 */

export const NOTATION_BLOCK_LABELS = [
  { value: 'Intro', label: 'Intro', color: '#22c55e', bg: '#22c55e20' },
  { value: 'Bridge', label: 'Bridge', color: '#f59e0b', bg: '#f59e0b20' },
  { value: 'Solo', label: 'Solo', color: '#a78bfa', bg: '#a78bfa20' },
  { value: 'Interlude', label: 'Interlude', color: '#38bdf8', bg: '#38bdf820' },
  { value: 'Outro', label: 'Outro', color: '#fb7185', bg: '#fb718520' },
]

export function newNotationBlockId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `nb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * @param {object} data - tab document fields
 * @returns {Array<{ id: string, notationAlphaTex: string, notationStaffSnapshot: object | null }>}
 */
export function blocksFromTabDoc(data) {
  if (!Array.isArray(data?.notationBlocks) || data.notationBlocks.length === 0) {
    return []
  }
  return data.notationBlocks.map((b, i) => ({
    id: typeof b?.id === 'string' && b.id ? b.id : `block_${i}`,
    notationAlphaTex: b?.notationAlphaTex ?? '',
    notationStaffSnapshot: b?.notationStaffSnapshot ?? null,
    label: b?.label ?? '',
  }))
}

/** First block — denormalized onto tab doc as notationAlphaTex / notationStaffSnapshot. */
export function firstNotationFromBlocks(blocks) {
  const first = Array.isArray(blocks) && blocks.length > 0 ? blocks[0] : null
  return {
    notationAlphaTex: first?.notationAlphaTex || '',
    notationStaffSnapshot: first?.notationStaffSnapshot ?? null,
  }
}

export function hasAnyNotationTex(blocks) {
  return (blocks || []).some((b) => (b?.notationAlphaTex || '').trim().length > 0)
}

/**
 * Firestore snapshot + blocks only in React (未按「更新樂譜」寫入前).
 */
export function mergeServerNotationWithClientOnly(serverBlocks, prevBlocks) {
  const fromServer = serverBlocks || []
  const ids = new Set(fromServer.map((b) => b?.id).filter(Boolean))
  const extras = (prevBlocks || []).filter((b) => b?.id && !ids.has(b.id))
  return [...fromServer, ...extras]
}

/** Merge session cache (older) + React prev (newer); same id → prev wins. Order: prev first, then cache-only ids. */
export function mergeCachedAndPrevNotationBlocks(cachedBlocks, prevBlocks) {
  const p = prevBlocks || []
  const c = cachedBlocks || []
  const prevIds = new Set(p.map((b) => b.id).filter(Boolean))
  return [...p, ...c.filter((b) => b?.id && !prevIds.has(b.id))]
}

/**
 * Handoff from /notation-editor Save (sessionStorage pending tex/staff/block id).
 */
export function mergePendingNotationIntoBlocks(blocks, pendingTex, pendingStaff, pendingBlockId) {
  const next = [...(blocks || [])]
  const nextTex = pendingTex || ''
  const nextStaff = pendingStaff || null
  if (pendingBlockId) {
    const idx = next.findIndex((b) => b.id === pendingBlockId)
    if (idx >= 0) {
      next[idx] = { ...next[idx], notationAlphaTex: nextTex, notationStaffSnapshot: nextStaff }
    } else {
      next.push({ id: pendingBlockId, notationAlphaTex: nextTex, notationStaffSnapshot: nextStaff })
    }
  } else if (next.length === 0) {
    next.push({
      id: newNotationBlockId(),
      notationAlphaTex: nextTex,
      notationStaffSnapshot: nextStaff,
    })
  } else {
    next[0] = { ...next[0], notationAlphaTex: nextTex, notationStaffSnapshot: nextStaff }
  }
  return next
}
