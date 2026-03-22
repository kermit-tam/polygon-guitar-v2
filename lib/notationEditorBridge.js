/**
 * Handoff between tab new/edit forms and /notation-editor (sessionStorage).
 * Return path: where to go after Save on the notation editor.
 * Pending tex: alphaTex string to merge into form after returning.
 * Initial state: one-shot seed when opening the editor (so it works without localStorage).
 * Pending staff: full editor snapshot to persist on the tab document (Firestore).
 */

import { NOTATION_EDITOR_SCHEMA_VERSION } from '@/lib/notationEditorStorage'

const RETURN_KEY = 'polygon-notation-return-path'
const PENDING_TEX_KEY = 'polygon-notation-pending-tex'
const INITIAL_STATE_KEY = 'polygon-notation-initial-state'
const PENDING_STAFF_KEY = 'polygon-notation-pending-staff'
/** Which notation block is being edited in /notation-editor (set before navigate). */
export const NOTATION_TARGET_BLOCK_ID_SESSION_KEY = 'polygon-notation-target-block-id'
/** After Save in editor, merge pending tex/staff into this block id on the tab form. */
export const NOTATION_PENDING_BLOCK_ID_SESSION_KEY = 'polygon-notation-pending-block-id'

const TARGET_BLOCK_ID_KEY = NOTATION_TARGET_BLOCK_ID_SESSION_KEY
const PENDING_BLOCK_ID_KEY = NOTATION_PENDING_BLOCK_ID_SESSION_KEY

/** Single JSON blob so edit page never loses tex/staff/block id between Save and loadTab (avoids split-key races). */
const RETURN_HANDOFF_KEY = 'polygon-notation-return-handoff-v1'

/**
 * @param {{ alphaTex: string, staffSnapshot: object | null, blockId: string | null }} payload
 */
export function setNotationReturnHandoff(payload) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      RETURN_HANDOFF_KEY,
      JSON.stringify({
        v: 1,
        alphaTex: payload.alphaTex ?? '',
        staffSnapshot: payload.staffSnapshot ?? null,
        blockId: payload.blockId != null && payload.blockId !== '' ? String(payload.blockId) : null,
      })
    )
  } catch (_) {
    /* quota */
  }
}

/** @returns {{ v: number, alphaTex: string, staffSnapshot: object | null, blockId: string | null } | null} */
export function consumeNotationReturnHandoff() {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(RETURN_HANDOFF_KEY)
    if (raw) sessionStorage.removeItem(RETURN_HANDOFF_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || data.v !== 1) return null
    return data
  } catch {
    return null
  }
}

export function setNotationEditorReturnPath(path) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(RETURN_KEY, path)
  } catch (_) {}
}

/** Read return path without removing (e.g. Back link on notation editor). */
export function getNotationEditorReturnPath() {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(RETURN_KEY)
  } catch (_) {
    return null
  }
}

/** Read and clear return path (call when navigating away after Save). */
export function consumeNotationReturnPath() {
  if (typeof window === 'undefined') return null
  try {
    const p = sessionStorage.getItem(RETURN_KEY)
    if (p) sessionStorage.removeItem(RETURN_KEY)
    return p
  } catch (_) {
    return null
  }
}

export function setPendingNotationTex(tex) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(PENDING_TEX_KEY, tex)
  } catch (_) {}
}

/** Read pending tex without removing (use when applying to React state; see clearPendingNotationTex). */
export function peekPendingNotationTex() {
  if (typeof window === 'undefined') return null
  try {
    const tex = sessionStorage.getItem(PENDING_TEX_KEY)
    return tex != null && tex !== '' ? tex : null
  } catch (_) {
    return null
  }
}

export function clearPendingNotationTex() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(PENDING_TEX_KEY)
  } catch (_) {}
}

/** @deprecated Use peekPendingNotationTex — does not clear storage (call clearPendingNotationTex after merge). */
export function consumePendingNotationTex() {
  return peekPendingNotationTex()
}

/**
 * One-shot editor seed (consumed on /notation-editor mount). Same shape as localStorage draft minus redundant fields.
 * @param {object} payload — timeSignatureId, selectedDuration, selectedDivision, staff, savedAlphaTex
 */
export function setNotationEditorInitialState(payload) {
  if (typeof window === 'undefined') return
  try {
    const data = {
      version: NOTATION_EDITOR_SCHEMA_VERSION,
      ...payload,
    }
    sessionStorage.setItem(INITIAL_STATE_KEY, JSON.stringify(data))
  } catch (_) {}
}

export function clearNotationEditorInitialState() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(INITIAL_STATE_KEY)
  } catch (_) {}
}

/** @returns {object | null} */
export function consumeNotationEditorInitialState() {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(INITIAL_STATE_KEY)
    if (raw) sessionStorage.removeItem(INITIAL_STATE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || data.version !== NOTATION_EDITOR_SCHEMA_VERSION) return null
    return data
  } catch {
    return null
  }
}

/** Staff snapshot for Firestore + form merge after Save (sessionStorage). */
export function setPendingNotationStaffSnapshot(snapshot) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(PENDING_STAFF_KEY, JSON.stringify(snapshot))
  } catch (_) {}
}

/** @returns {object | null} */
export function peekPendingNotationStaffSnapshot() {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PENDING_STAFF_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearPendingNotationStaffSnapshot() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(PENDING_STAFF_KEY)
  } catch (_) {}
}

export function setNotationTargetBlockId(id) {
  if (typeof window === 'undefined') return
  try {
    if (id != null && id !== '') sessionStorage.setItem(TARGET_BLOCK_ID_KEY, String(id))
    else sessionStorage.removeItem(TARGET_BLOCK_ID_KEY)
  } catch (_) {}
}

export function peekNotationTargetBlockId() {
  if (typeof window === 'undefined') return null
  try {
    const v = sessionStorage.getItem(TARGET_BLOCK_ID_KEY)
    return v != null && v !== '' ? v : null
  } catch (_) {
    return null
  }
}

export function clearNotationTargetBlockId() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(TARGET_BLOCK_ID_KEY)
  } catch (_) {}
}

export function setPendingNotationBlockId(id) {
  if (typeof window === 'undefined') return
  try {
    if (id != null && id !== '') sessionStorage.setItem(PENDING_BLOCK_ID_KEY, String(id))
    else sessionStorage.removeItem(PENDING_BLOCK_ID_KEY)
  } catch (_) {}
}

export function peekPendingNotationBlockId() {
  if (typeof window === 'undefined') return null
  try {
    const v = sessionStorage.getItem(PENDING_BLOCK_ID_KEY)
    return v != null && v !== '' ? v : null
  } catch (_) {
    return null
  }
}

export function clearPendingNotationBlockId() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(PENDING_BLOCK_ID_KEY)
  } catch (_) {}
}
