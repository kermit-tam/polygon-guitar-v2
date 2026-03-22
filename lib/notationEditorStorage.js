/**
 * Persist notation editor draft (staff + toolbar + last preview tex) in localStorage.
 * Optional `scopeId` (e.g. tab notation block uuid) isolates drafts so blocks don't share one canvas.
 */
export const NOTATION_EDITOR_STORAGE_KEY = 'polygon-notation-editor-v1'

export const NOTATION_EDITOR_SCHEMA_VERSION = 1

function resolveStorageKey(scopeId) {
  if (scopeId != null && String(scopeId).trim() !== '') {
    return `${NOTATION_EDITOR_STORAGE_KEY}-block-${String(scopeId)}`
  }
  return NOTATION_EDITOR_STORAGE_KEY
}

/**
 * @param {string | null | undefined} [scopeId] - notation block id from tab edit; omit for default global draft
 * @returns {object | null}
 */
export function readNotationEditorState(scopeId) {
  if (typeof window === 'undefined') return null
  const key = resolveStorageKey(scopeId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || data.version !== NOTATION_EDITOR_SCHEMA_VERSION) return null
    return data
  } catch {
    return null
  }
}

/**
 * @param {object} payload
 * @param {string | null | undefined} [scopeId]
 */
export function writeNotationEditorState(payload, scopeId) {
  if (typeof window === 'undefined') return
  const key = resolveStorageKey(scopeId)
  try {
    const data = {
      version: NOTATION_EDITOR_SCHEMA_VERSION,
      ...payload,
    }
    window.localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* quota / private mode */
  }
}

/**
 * @param {string | null | undefined} [scopeId]
 */
export function clearNotationEditorState(scopeId) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(resolveStorageKey(scopeId))
  } catch {
    /* ignore */
  }
}
