import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import NotationToolbar, { TOOL_IDS } from '@/components/NotationEditor/NotationToolbar'
import StaffCanvas from '@/components/NotationEditor/StaffCanvas'
import { notationSnapshotToAlphaTex } from '@/lib/notationToAlphaTex'
import {
  readNotationEditorState,
  writeNotationEditorState,
  clearNotationEditorState,
} from '@/lib/notationEditorStorage'
import {
  setPendingNotationTex,
  setPendingNotationStaffSnapshot,
  setPendingNotationBlockId,
  setNotationReturnHandoff,
  peekNotationTargetBlockId,
  clearNotationTargetBlockId,
  consumeNotationReturnPath,
  consumeNotationEditorInitialState,
} from '@/lib/notationEditorBridge'
import { Eraser, Save } from 'lucide-react'

const NotationAlphaTabPreview = dynamic(
  () => import('@/components/NotationEditor/NotationAlphaTabPreview'),
  { ssr: false }
)

function restoreWindowScroll(x, y) {
  window.scrollTo({ left: x, top: y, behavior: 'auto' })
}

const DEFAULT_STAFF_SNAPSHOT = Object.freeze({
  firstBeats: [{ duration: 'quarter' }],
  subdivisions: [],
})

function applyDraftPayload(setters, d) {
  const {
    setTimeSignatureId,
    setSelectedDuration,
    setSelectedDivision,
    setBpm,
    setCapo,
    setPreviewAlphaTex,
    setStaffBootstrap,
    setStaffCanvasKey,
    TOOL_IDS: T,
  } = setters
  setTimeSignatureId(d.timeSignatureId ?? '4/4')
  setSelectedDuration(d.selectedDuration ?? T.QUARTER)
  setSelectedDivision(d.selectedDivision ?? null)
  const bp = d.bpm
  if (typeof bp === 'number' && !Number.isNaN(bp)) {
    setBpm(Math.min(480, Math.max(1, Math.round(bp))))
  } else {
    setBpm(null)
  }
  const cp = d.capo
  if (typeof cp === 'number' && !Number.isNaN(cp)) {
    setCapo(Math.min(12, Math.max(0, Math.round(cp))))
  } else {
    setCapo(0)
  }
  setPreviewAlphaTex(d.savedAlphaTex ?? null)
  if (d.staff?.firstBeats?.length) {
    setStaffBootstrap({
      firstBeats: d.staff.firstBeats,
      subdivisions: Array.isArray(d.staff.subdivisions) ? d.staff.subdivisions : [],
    })
    setStaffCanvasKey((k) => k + 1)
  }
}

/**
 * @param {object} props
 * @param {string} [props.draftScopeId] — localStorage draft key (notation block id)
 * @param {object|null} [props.initialData] — seed from tab form; if null in embed, try readNotationEditorState(draftScopeId)
 * @param {'session'|'props'} [props.hydration] — session = standalone page (consume bridge + peek); props = modal (initialData + optional localStorage)
 * @param {boolean} [props.embedMode] — true: Save calls onSave(payload); false: router + session handoff
 * @param {(payload: { notationAlphaTex: string, notationStaffSnapshot: object, blockId: string|null }) => void} [props.onSave]
 * @param {string} [props.className] — wrapper class
 * @param {boolean} [props.compactChrome] — tighter padding when inside modal
 */
export default function NotationEditorWorkspace({
  draftScopeId,
  initialData = null,
  hydration = 'session',
  embedMode = false,
  onSave,
  className = '',
  compactChrome = false,
  label = '',
  onLabelChange,
}) {
  const router = useRouter()
  const staffRef = useRef(null)
  const draftScopeRef = useRef(null)
  const scrollAfterSaveRef = useRef(null)
  /** 避免 modal 父層每次 render 傳新 initialData 參考而重複 hydrate、覆寫 BPM */
  const initialDataRef = useRef(initialData)
  initialDataRef.current = initialData
  const [selectedDuration, setSelectedDuration] = useState(TOOL_IDS.QUARTER)
  const [selectedDivision, setSelectedDivision] = useState(null)
  const [timeSignatureId, setTimeSignatureId] = useState('4/4')
  /** number | null | '' — null = not set; '' = mid-input; effectiveBpm used for alphaTex generation */
  const [bpm, setBpm] = useState(null)
  const effectiveBpm = typeof bpm === 'number' && !Number.isNaN(bpm) ? bpm : 100
  const [capo, setCapo] = useState(0)
  const effectiveCapo =
    typeof capo === 'number' && !Number.isNaN(capo) ? Math.min(12, Math.max(0, Math.round(capo))) : 0
  const [previewAlphaTex, setPreviewAlphaTex] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [editorHydrated, setEditorHydrated] = useState(false)
  const [staffCanvasKey, setStaffCanvasKey] = useState(0)
  const [staffBootstrap, setStaffBootstrap] = useState(() => ({
    firstBeats: [...DEFAULT_STAFF_SNAPSHOT.firstBeats],
    subdivisions: [...DEFAULT_STAFF_SNAPSHOT.subdivisions],
  }))
  const [persistStaffRev, setPersistStaffRev] = useState(0)

  const staffBootstrapMemo = useMemo(
    () => ({
      firstBeats: JSON.parse(JSON.stringify(staffBootstrap.firstBeats)),
      subdivisions: JSON.parse(JSON.stringify(staffBootstrap.subdivisions)),
    }),
    [staffBootstrap]
  )

  useEffect(() => {
    const setters = {
      setTimeSignatureId,
      setSelectedDuration,
      setSelectedDivision,
      setBpm,
      setCapo,
      setPreviewAlphaTex,
      setStaffBootstrap,
      setStaffCanvasKey,
      TOOL_IDS,
    }

    if (hydration === 'props') {
      draftScopeRef.current = draftScopeId ?? null
      const d = initialDataRef.current ?? readNotationEditorState(draftScopeId ?? undefined)
      if (d) {
        applyDraftPayload(setters, d)
      }
      setEditorHydrated(true)
      return
    }

    const scope = peekNotationTargetBlockId()
    draftScopeRef.current = scope
    const handoff = consumeNotationEditorInitialState()
    const d = handoff ?? readNotationEditorState(scope ?? undefined)
    if (d) {
      applyDraftPayload(setters, d)
    }
    setEditorHydrated(true)
    // props 模式唔跟 initialData 參考變化重跑（見 initialDataRef）
  }, [hydration, draftScopeId])

  const bumpPersistStaff = useCallback(() => {
    setPersistStaffRev((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!editorHydrated) return undefined
    const t = setTimeout(() => {
      try {
        const snap = staffRef.current?.getSnapshot?.()
        if (!snap) return
        const tex = notationSnapshotToAlphaTex({
          ...snap,
          timeSignatureId,
          bpm: effectiveBpm,
          capo: effectiveCapo,
        })
        setPreviewAlphaTex(tex)
      } catch (_) {
        /* invalid snapshot */
      }
    }, 200)
    return () => clearTimeout(t)
  }, [editorHydrated, persistStaffRev, timeSignatureId, effectiveBpm, effectiveCapo])

  useEffect(() => {
    if (!editorHydrated) return undefined
    const t = setTimeout(() => {
      const staff = staffRef.current?.getSnapshot?.()
      if (!staff) return
      writeNotationEditorState(
        {
          timeSignatureId,
          selectedDuration,
          selectedDivision,
          bpm,
          capo: effectiveCapo,
          staff,
          savedAlphaTex: previewAlphaTex,
        },
        draftScopeRef.current ?? undefined
      )
    }, 450)
    return () => clearTimeout(t)
  }, [
    editorHydrated,
    timeSignatureId,
    selectedDuration,
    selectedDivision,
    bpm,
    effectiveCapo,
    previewAlphaTex,
    persistStaffRev,
  ])

  const divisionFlags = selectedDivision != null ? { [selectedDivision]: true } : {}

  const onToggleDivision = useCallback((id) => {
    setSelectedDivision((prev) => (prev === id ? null : id))
  }, [])

  const onBeatFocus = useCallback(({ duration, dotted, tuplet }) => {
    setSelectedDuration(duration)
    setSelectedDivision(tuplet ? 'tuplet' : dotted ? 'dotted' : null)
  }, [])

  const handleBpmChange = useCallback((raw) => {
    if (raw === '' || raw == null) {
      setBpm('')
      return
    }
    const n = parseInt(String(raw), 10)
    if (Number.isNaN(n)) return
    setBpm(Math.min(480, Math.max(1, n)))
  }, [])

  const handleBpmBlur = useCallback(() => {
    setBpm((prev) =>
      typeof prev === 'number' && !Number.isNaN(prev) ? prev : null
    )
  }, [])

  const handleClearDraft = () => {
    clearNotationEditorState(draftScopeRef.current ?? undefined)
    setTimeSignatureId('4/4')
    setBpm(100)
    setCapo(0)
    setSelectedDuration(TOOL_IDS.QUARTER)
    setSelectedDivision(null)
    setPreviewAlphaTex(null)
    setSaveError(null)
    setStaffBootstrap({
      firstBeats: [...DEFAULT_STAFF_SNAPSHOT.firstBeats.map((b) => ({ ...b }))],
      subdivisions: [],
    })
    setStaffCanvasKey((k) => k + 1)
  }

  const handleSave = () => {
    const sx = typeof window !== 'undefined' ? window.scrollX : 0
    const sy = typeof window !== 'undefined' ? window.scrollY : 0
    scrollAfterSaveRef.current = { x: sx, y: sy }

    setSaveError(null)
    try {
      const snap = staffRef.current?.getSnapshot?.()
      if (!snap) {
        setSaveError('Staff is not ready.')
        scrollAfterSaveRef.current = null
        return
      }
      const tex = notationSnapshotToAlphaTex({
        ...snap,
        timeSignatureId,
        bpm: effectiveBpm,
        capo: effectiveCapo,
      })
      setPreviewAlphaTex(tex)

      const staffSnapshot = {
        timeSignatureId,
        selectedDuration,
        selectedDivision,
        bpm,
        capo: effectiveCapo,
        staff: snap,
        savedAlphaTex: tex,
      }

      if (embedMode && typeof onSave === 'function') {
        const draftScope = draftScopeId ?? draftScopeRef.current
        queueMicrotask(() => {
          const staff = staffRef.current?.getSnapshot?.()
          if (staff) {
            writeNotationEditorState(
              {
                timeSignatureId,
                selectedDuration,
                selectedDivision,
                bpm,
                capo: effectiveCapo,
                staff,
                savedAlphaTex: tex,
              },
              draftScope ?? undefined
            )
          }
        })
        onSave({
          notationAlphaTex: tex,
          notationStaffSnapshot: staffSnapshot,
          blockId: draftScope != null && draftScope !== '' ? String(draftScope) : null,
        })
        scrollAfterSaveRef.current = null
        return
      }

      const returnPath = consumeNotationReturnPath()
      if (returnPath) {
        const targetBlockId = peekNotationTargetBlockId()
        const draftScope = targetBlockId ?? draftScopeRef.current
        setPendingNotationTex(tex)
        setPendingNotationStaffSnapshot(staffSnapshot)
        setPendingNotationBlockId(targetBlockId)
        setNotationReturnHandoff({
          alphaTex: tex,
          staffSnapshot,
          blockId: targetBlockId,
        })
        clearNotationTargetBlockId()
        queueMicrotask(() => {
          const staff = staffRef.current?.getSnapshot?.()
          if (staff) {
            writeNotationEditorState(
              {
                timeSignatureId,
                selectedDuration,
                selectedDivision,
                bpm,
                capo: effectiveCapo,
                staff,
                savedAlphaTex: tex,
              },
              draftScope ?? undefined
            )
          }
        })
        router.push(returnPath)
        scrollAfterSaveRef.current = null
        return
      }

      queueMicrotask(() => {
        const staff = staffRef.current?.getSnapshot?.()
        if (staff) {
          writeNotationEditorState(
            {
              timeSignatureId,
              selectedDuration,
              selectedDivision,
              bpm,
              capo: effectiveCapo,
              staff,
              savedAlphaTex: tex,
            },
            draftScopeRef.current ?? undefined
          )
        }
      })

      queueMicrotask(() => restoreWindowScroll(sx, sy))
      requestAnimationFrame(() => {
        restoreWindowScroll(sx, sy)
        requestAnimationFrame(() => restoreWindowScroll(sx, sy))
      })
      ;[0, 50, 150, 350, 600].forEach((ms) => {
        setTimeout(() => {
          const pos = scrollAfterSaveRef.current
          if (!pos) return
          restoreWindowScroll(pos.x, pos.y)
        }, ms)
      })
      setTimeout(() => {
        scrollAfterSaveRef.current = null
      }, 650)
    } catch (e) {
      setSaveError(e?.message || 'Failed to build alphaTex')
      scrollAfterSaveRef.current = null
    }
  }

  const pad = compactChrome ? 'px-3 py-2' : 'px-4 min-[920px]:px-0 py-2'
  const padEditorRow = compactChrome ? 'py-2' : 'px-4 min-[920px]:px-0 py-2'
  const maxW = 'max-w-4xl mx-auto'

  return (
    <div className={`bg-black ${className}`} style={{ overflowAnchor: 'none' }}>
      <div>
        <div className={`${maxW} ${padEditorRow}`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white">{compactChrome ? '' : 'Editor'}</h2>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleClearDraft}
                className="px-4 py-2 bg-[#282828] hover:bg-[#3E3E3E] text-white font-semibold rounded-lg flex items-center gap-2 text-sm border border-neutral-600"
                title={compactChrome ? '清除此裝置上的草稿' : 'Clear saved draft from this device'}
              >
                <Eraser className="w-4 h-4" />
                {compactChrome ? '清除' : 'Clear'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 bg-[#FFD700] hover:bg-yellow-400 text-black font-semibold rounded-lg flex items-center gap-2 text-sm"
              >
                <Save className="w-4 h-4" />
                {compactChrome ? '儲存' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {saveError && (
        <div className={`${maxW} ${pad} pt-2`}>
          <p className="text-sm text-red-400">{saveError}</p>
        </div>
      )}

      <div className={`${maxW} rounded-b-xl overflow-hidden shadow-lg`}>
        <NotationToolbar
          selectedDuration={selectedDuration}
          onSelectDuration={setSelectedDuration}
          divisionFlags={divisionFlags}
          onToggleDivision={onToggleDivision}
          timeSignatureId={timeSignatureId}
          onSelectTimeSignature={setTimeSignatureId}
          bpm={bpm}
          onBpmChange={handleBpmChange}
          onBpmBlur={handleBpmBlur}
          capo={effectiveCapo}
          onCapoChange={setCapo}
          label={label}
          onLabelChange={onLabelChange}
        />
        {editorHydrated ? (
          <StaffCanvas
            key={staffCanvasKey}
            ref={staffRef}
            initialStaffSnapshot={staffBootstrapMemo}
            timeSignatureId={timeSignatureId}
            selectedDuration={selectedDuration}
            onSelectDuration={setSelectedDuration}
            selectedDivision={selectedDivision}
            onTieApplied={() => setSelectedDivision(null)}
            onBeatFocus={onBeatFocus}
            onStaffStructureChange={bumpPersistStaff}
          />
        ) : (
          <div className="min-h-[200px] flex items-center justify-center text-neutral-500 text-sm">
            Loading editor…
          </div>
        )}
      </div>

      <div className={compactChrome ? maxW : `${maxW} pb-8`}>
        {previewAlphaTex && (
          <>
            {compactChrome && (
              <h2 className="text-sm font-bold text-white mt-[25px] mb-2">預覽</h2>
            )}
            <NotationAlphaTabPreview
              alphaTex={previewAlphaTex}
              noTopMargin={compactChrome}
              transparent={compactChrome}
              outlined={compactChrome}
              bpm={bpm}
            />
          </>
        )}
      </div>
    </div>
  )
}
