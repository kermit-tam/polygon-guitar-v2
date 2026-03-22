import { useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import NotationEditorWorkspace from '@/components/NotationEditor/NotationEditorWorkspace'

/**
 * In-page notation editor: keeps tab form mounted; onSave updates parent state (no session handoff).
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} draftScopeId — localStorage draft key (notation block id or fixed id for new tab)
 * @param {object|null} initialSeed — from buildNotationEditorSeedFromForm
 * @param {(payload: { notationAlphaTex: string, notationStaffSnapshot: object, blockId: string|null }) => void} onSave
 */
export default function NotationEditorModal({
  open,
  onClose,
  draftScopeId,
  initialSeed,
  onSave,
}) {
  const handleWorkspaceSave = useCallback(
    (payload) => {
      if (typeof onSave === 'function') onSave(payload)
      onClose()
    },
    [onSave, onClose]
  )

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[10050] flex flex-col bg-black md:items-center md:justify-center md:p-4 isolate"
      role="dialog"
      aria-modal="true"
      aria-label="記譜器"
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-default bg-black/80"
        aria-label="關閉"
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full min-h-0 w-full max-h-full flex-col overflow-hidden bg-black md:max-h-[92vh] md:max-w-4xl md:rounded-xl md:border md:border-neutral-700 md:shadow-2xl">
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-neutral-800 bg-black px-3 py-2.5 md:px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[#B3B3B3] hover:bg-neutral-900 hover:text-white"
          >
            <X className="h-4 w-4 shrink-0" aria-hidden />
            關閉
          </button>
          <span className="text-sm font-semibold text-white">記譜器</span>
          <span aria-hidden className="justify-self-end" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <NotationEditorWorkspace
            key={draftScopeId}
            hydration="props"
            embedMode
            draftScopeId={draftScopeId}
            initialData={initialSeed}
            compactChrome
            onSave={handleWorkspaceSave}
            className="min-h-full pb-4"
          />
        </div>
      </div>
    </div>
  )
}
