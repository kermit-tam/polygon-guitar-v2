import { useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import NotationEditorModal from '@/components/NotationEditor/NotationEditorModal'
import { buildNotationEditorSeedFromForm } from '@/lib/notationEditorSeed'
import { newNotationBlockId, NOTATION_BLOCK_LABELS } from '@/lib/notationBlocks'

const NotationAlphaTabPreview = dynamic(
  () => import('@/components/NotationEditor/NotationAlphaTabPreview'),
  { ssr: false }
)

function getNextLabel(blocks, baseLabel) {
  const existing = (blocks || []).map((b) => b.label).filter(Boolean)
  if (!existing.includes(baseLabel)) return baseLabel
  for (let i = 2; ; i++) {
    const candidate = `${baseLabel} ${i}`
    if (!existing.includes(candidate)) return candidate
  }
}

function sortBlocks(arr) {
  return [...arr].sort((a, b) => {
    const isIntro = (l) => l?.startsWith('Intro')
    const isOutro = (l) => l?.startsWith('Outro')
    if (isIntro(a.label) && !isIntro(b.label)) return -1
    if (!isIntro(a.label) && isIntro(b.label)) return 1
    if (isOutro(a.label) && !isOutro(b.label)) return 1
    if (!isOutro(a.label) && isOutro(b.label)) return -1
    const numOf = (l) => { const m = l?.match(/(\d+)$/); return m ? parseInt(m[1], 10) : 1 }
    return numOf(a.label) - numOf(b.label)
  })
}

function getLabelMeta(label) {
  if (!label) return null
  return NOTATION_BLOCK_LABELS.find((l) => label === l.value || label?.startsWith(l.value)) || null
}

function copyToClipboard(text, onSuccess) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess)
  } else {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    onSuccess()
  }
}

/**
 * Self-contained notation block manager used in both new-tab and edit-tab pages.
 *
 * @param {{ blocks: Array, onChange: (blocks: Array) => void }} props
 */
export default function NotationBlocksManager({ blocks = [], onChange }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorBlockId, setEditorBlockId] = useState(null)
  const [copiedToast, setCopiedToast] = useState('')

  const showCopiedToast = useCallback((text) => {
    setCopiedToast(text)
    setTimeout(() => setCopiedToast(''), 1500)
  }, [])

  const editorSeed = useMemo(() => {
    if (!editorOpen || !editorBlockId) return null
    const block = blocks.find((b) => b.id === editorBlockId)
    return buildNotationEditorSeedFromForm({
      notationStaffSnapshot: block?.notationStaffSnapshot,
      notationAlphaTex: block?.notationAlphaTex,
    })
  }, [editorOpen, editorBlockId, blocks])

  const openEditor = (blockId) => {
    setEditorBlockId(blockId)
    setEditorOpen(true)
  }

  const closeEditor = () => {
    setEditorOpen(false)
    setEditorBlockId(null)
  }

  const handleEditorSave = ({ notationAlphaTex, notationStaffSnapshot, blockId }) => {
    const bid = blockId || editorBlockId
    if (!bid) return
    onChange(
      blocks.map((b) => (b.id === bid ? { ...b, notationAlphaTex, notationStaffSnapshot } : b))
    )
  }

  const handleAdd = () => {
    const nid = newNotationBlockId()
    const label = getNextLabel(blocks, 'Intro')
    onChange([...blocks, { id: nid, notationAlphaTex: '', notationStaffSnapshot: null, label }])
  }

  const handleRemove = (blockId) => {
    onChange(blocks.filter((b) => b.id !== blockId))
  }

  const handleLabelChange = (val) => {
    const others = blocks.filter((b) => b.id !== editorBlockId)
    const label = getNextLabel(others, val)
    onChange(
      blocks.map((b) => (b.id === editorBlockId ? { ...b, label } : b))
    )
  }

  const copyAnchor = (anchor) => {
    copyToClipboard(anchor, () => showCopiedToast(anchor))
  }

  const sortedTagBlocks = sortBlocks(blocks.filter((b) => b.label))
  const sortedCardBlocks = sortBlocks(blocks)

  return (
    <div className="space-y-4">
      <p className="pl-1 text-xs text-[#B3B3B3] leading-relaxed">
        撳掣複製六線譜 ID 如{' '}
        <span className="text-[#FFD700] font-mono text-[12px]">!intro</span>{' '}
        <span className="text-[#FFD700] font-mono text-[12px]">!outro</span>
        ，需自行於譜中貼上。
      </p>

      {/* Label tags */}
      {sortedTagBlocks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sortedTagBlocks.map((block) => {
            const meta = getLabelMeta(block.label)
            const anchor = `!${block.label.toLowerCase().replace(/\s+/g, '')}`
            return (
              <button
                type="button"
                key={block.id}
                onClick={() => copyAnchor(anchor)}
                className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold border cursor-pointer active:scale-95 transition"
                style={{ color: meta?.color || '#fff', backgroundColor: meta?.bg || '#ffffff10', borderColor: meta?.color || '#555' }}
                title={`複製 ${anchor}`}
              >
                {block.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Add button */}
      <div className="flex justify-start w-full">
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center justify-center h-9 gap-1.5 px-4 bg-[#FFD700] text-black rounded-full hover:bg-yellow-400 transition disabled:opacity-50 font-medium text-sm"
        >
          <span className="text-base leading-none" aria-hidden>+</span>
          加入六線譜
        </button>
      </div>

      {/* Block cards */}
      {sortedCardBlocks.length > 0 && (
        <div className="space-y-3 w-full">
          {sortedCardBlocks.map((block, index) => {
            const lbl = block.label || `六線譜 ${index + 1}`
            const anchor = block.label ? `!${block.label.toLowerCase().replace(/\s+/g, '')}` : ''
            const meta = getLabelMeta(block.label)

            return (
              <div
                key={`${block.id}-${index}`}
                className="w-full rounded-lg border border-neutral-700 bg-black shadow-lg overflow-hidden"
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pl-3 pr-[0.5rem] py-2 border-b border-neutral-800 bg-neutral-900/40">
                  <div className="flex items-center gap-1.5">
                    {meta ? (
                      <button type="button" onClick={() => copyAnchor(anchor)} className="inline-flex items-center px-3 py-1 rounded-md text-sm font-semibold border cursor-pointer active:scale-95 transition" style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.color }} title={`複製 ${anchor}`}>
                        {lbl}
                      </button>
                    ) : (
                      <button type="button" onClick={() => anchor && copyAnchor(anchor)} className="text-md font-medium text-[#B3B3B3] cursor-pointer active:scale-95 transition" title={anchor ? `複製 ${anchor}` : ''}>
                        {lbl}
                      </button>
                    )}
                    {anchor && (
                      <button type="button" onClick={() => copyAnchor(anchor)} className="text-[#B3B3B3] hover:text-[#FFD700] transition active:scale-90" title={`複製 ${anchor}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditor(block.id)}
                      className="px-[0.6rem] py-2 rounded-lg bg-[#FFD700] text-black text-sm font-semibold leading-4 hover:bg-yellow-400 shadow-md"
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(block.id)}
                      className="px-[0.6rem] py-2 rounded-lg bg-[#282828] text-white text-sm font-medium leading-4 border border-neutral-600 hover:bg-[#3E3E3E]"
                    >
                      移除
                    </button>
                  </div>
                </div>

                {/* Body */}
                {(block.notationAlphaTex || '').trim() ? (
                  <div className="px-4">
                    <NotationAlphaTabPreview
                      alphaTex={block.notationAlphaTex}
                      transparent
                      noTopMargin
                      bpm={block.notationStaffSnapshot?.bpm ?? null}
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <img
                      src="/notation-editor.png"
                      alt=""
                      className="h-[80px] w-auto object-contain block shrink-0"
                      draggable={false}
                    />
                    <p className="text-sm text-[#737373]">尚未編輯 — 按「編輯」開啟六線譜編輯器</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Notation Editor Modal */}
      {editorOpen && editorBlockId && (
        <NotationEditorModal
          open
          onClose={closeEditor}
          draftScopeId={editorBlockId}
          initialSeed={editorSeed}
          onSave={handleEditorSave}
          label={blocks.find((b) => b.id === editorBlockId)?.label || ''}
          onLabelChange={handleLabelChange}
        />
      )}

      {/* Copied toast */}
      {copiedToast && (
        <div className="fixed inset-x-0 top-14 z-[9999] flex justify-center pointer-events-none">
          <div className="px-4 py-2 rounded-full bg-white text-black text-sm font-medium shadow-lg">
            已複製 {copiedToast}
          </div>
        </div>
      )}
    </div>
  )
}
