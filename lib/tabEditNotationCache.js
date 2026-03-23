/**
 * Persist edit-page notationBlocks in sessionStorage so a full reload before save
 * doesn't drop blocks that aren't on Firestore yet. (六線譜編輯器已用頁內 Modal，唔再靠導航 remount。)
 */
const PREFIX = 'polygon-tab-edit-notation-blocks-'

export function readTabEditNotationCache(tabId) {
  if (typeof window === 'undefined' || !tabId) return null
  try {
    const raw = sessionStorage.getItem(PREFIX + tabId)
    if (!raw) return null
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

export function writeTabEditNotationCache(tabId, blocks) {
  if (typeof window === 'undefined' || !tabId) return
  try {
    sessionStorage.setItem(PREFIX + tabId, JSON.stringify(blocks || []))
  } catch (_) {
    /* quota */
  }
}

export function clearTabEditNotationCache(tabId) {
  if (typeof window === 'undefined' || !tabId) return
  try {
    sessionStorage.removeItem(PREFIX + tabId)
  } catch (_) {}
}
