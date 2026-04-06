import { useState, useRef, useEffect, useCallback } from 'react'
import { parsePolygonTabLink } from '@/lib/polygonTabLink'
import { auth } from '@/lib/firebase'

export default function ChaksaPasteTabLinkModal({ open, onClose, playlistId, entryId, onSuccess }) {
  const [pastedLink, setPastedLink] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  /** 避免 submit 依賴 submitting 導致失敗後 useEffect 重建、800ms debounce 無限重試 */
  const submitLockRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setPastedLink('')
    setMessage('')
    setSubmitting(false)
    submitLockRef.current = false
    const t = setTimeout(() => inputRef.current?.focus?.(), 100)
    return () => clearTimeout(t)
  }, [open])

  const submit = useCallback(async () => {
    if (!playlistId || !entryId) return
    if (submitLockRef.current) return
    const tabId = parsePolygonTabLink(pastedLink)
    if (!tabId) {
      setMessage('請貼上 POLYGON 結他譜連結，例如 https://polygon.guitars/tabs/...')
      setTimeout(() => setMessage(''), 4000)
      return
    }
    submitLockRef.current = true
    setSubmitting(true)
    setMessage('檢查中…')
    try {
      const user = auth.currentUser
      if (!user) {
        setMessage('請先登入')
        setTimeout(() => setMessage(''), 3000)
        return
      }
      const token = await user.getIdToken()
      const res = await fetch('/api/chaksa/link-external-to-tab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ playlistId, entryId, tabUrl: pastedLink })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error || '出譜失敗')
        setTimeout(() => setMessage(''), 4000)
        return
      }
      setPastedLink('')
      onSuccess?.()
      onClose()
    } catch (e) {
      console.error('[ChaksaPasteTabLinkModal]', e)
      setMessage('出譜失敗，請重試')
      setTimeout(() => setMessage(''), 4000)
    } finally {
      submitLockRef.current = false
      setSubmitting(false)
    }
  }, [playlistId, entryId, pastedLink, onClose, onSuccess])

  useEffect(() => {
    if (!open || !pastedLink.trim()) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!parsePolygonTabLink(pastedLink)) return
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      submit()
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [pastedLink, open, submit])

  if (!open) return null

  const handleClose = () => {
    if (submitting) return
    setPastedLink('')
    setMessage('')
    onClose()
  }

  const failStyle = message && (message.includes('失敗') || message === '請先登入')

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 pointer-events-auto"
      onClick={handleClose}
      role="button"
      tabIndex={0}
      aria-label="關閉"
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose() }}
    >
      <div
        className="bg-[#121212] rounded-3xl p-6 w-full max-w-sm shadow-xl border border-[#282828]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-white text-center mb-1">請貼上結他譜連結</p>
        <p className="text-neutral-500 text-xs text-center mb-4">必須為 POLYGON 結他譜連結</p>
        <input
          ref={inputRef}
          type="url"
          value={pastedLink}
          onChange={(e) => setPastedLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !submitting && submit()}
          placeholder="https://polygon.guitars/tabs/..."
          disabled={submitting}
          className="w-full bg-[#282828] border-0 rounded-full px-4 py-3 text-white placeholder-[#666] outline-none text-base mb-3 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); submit() }}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={submitting}
          className={`w-full rounded-full font-medium py-3 text-base hover:opacity-90 transition disabled:opacity-50 ${
            failStyle ? 'bg-[#282828] text-red-500' : 'bg-[#FFD700] text-black'
          }`}
        >
          {message || (submitting ? '檢查中…' : '確定')}
        </button>
      </div>
    </div>
  )
}
