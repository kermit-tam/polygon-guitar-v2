/**
 * Build initial state for /notation-editor from tab form data (Firestore + alphaTex).
 * Used so the editor does not rely only on localStorage (incognito / new device).
 */
import { TOOL_IDS } from '@/components/NotationEditor/NotationToolbar'

const DEFAULT_STAFF = () => ({
  firstBeats: [{ duration: 'quarter' }],
  subdivisions: [],
})

/**
 * @param {{ notationStaffSnapshot?: object | null, notationAlphaTex?: string }} formSlice
 * @returns {object | null} payload for setNotationEditorInitialState (no version field)
 */
export function buildNotationEditorSeedFromForm({ notationStaffSnapshot, notationAlphaTex }) {
  const tex = (notationAlphaTex || '').trim()
  const snap = notationStaffSnapshot
  if (snap && typeof snap === 'object') {
    const staff = snap.staff
    const hasStaff = Array.isArray(staff?.firstBeats) && staff.firstBeats.length > 0
    const bp = snap.bpm
    const bpm =
      typeof bp === 'number' && !Number.isNaN(bp)
        ? Math.min(480, Math.max(1, Math.round(bp)))
        : null
    const capRaw = snap.capo
    const capo =
      typeof capRaw === 'number' && !Number.isNaN(capRaw)
        ? Math.min(12, Math.max(0, Math.round(capRaw)))
        : 0
    return {
      timeSignatureId: snap.timeSignatureId || '4/4',
      selectedDuration: snap.selectedDuration ?? TOOL_IDS.QUARTER,
      selectedDivision: snap.selectedDivision ?? null,
      bpm,
      capo,
      staff: hasStaff
        ? {
            firstBeats: JSON.parse(JSON.stringify(staff.firstBeats)),
            subdivisions: Array.isArray(staff.subdivisions)
              ? JSON.parse(JSON.stringify(staff.subdivisions))
              : [],
          }
        : DEFAULT_STAFF(),
      savedAlphaTex: (snap.savedAlphaTex && String(snap.savedAlphaTex).trim()) || tex || null,
    }
  }
  if (tex) {
    return {
      timeSignatureId: '4/4',
      selectedDuration: TOOL_IDS.QUARTER,
      selectedDivision: null,
      bpm: null,
      capo: 0,
      staff: DEFAULT_STAFF(),
      savedAlphaTex: tex,
    }
  }
  return null
}
