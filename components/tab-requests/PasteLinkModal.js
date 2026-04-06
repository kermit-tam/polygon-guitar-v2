import { useState, useRef, useEffect, useCallback } from 'react'
import { parsePolygonTabLink } from '@/lib/polygonTabLink'

export default function PasteLinkModal({ request, user, onClose, setRequests, refreshCache }) {
  const [pastedLink, setPastedLink] = useState('')
  const [message, setMessage] = useState('')
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const checkAndFulfillRef = useRef(null)

  const checkAndFulfill = useCallback(async (linkOverride) => {
    if (!request) return
    const link = linkOverride !== undefined ? linkOverride : pastedLink
    const tabPathSegment = parsePolygonTabLink(link)
    if (!tabPathSegment) {
      setMessage('請貼上 POLYGON 結他譜連結，例如 https://polygon.guitars/tabs/...')
      setTimeout(() => setMessage(''), 3000)
      return
    }
    setMessage('檢查中…')
    try {
      const { getTab } = await import('@/lib/tabs')
      const { getSongThumbnail } = await import('@/lib/getSongThumbnail')
      const { getGroupKeys, normalizeTitleForGrouping } = await import('@/lib/tabGrouping')

      const tab = await getTab(tabPathSegment)
      if (!tab) {
        setMessage('出譜失敗，找不到該結他譜')
        setTimeout(() => setMessage(''), 3000)
        return
      }

      const resolvedTabId = String(tab.id || '').trim()
      if (!resolvedTabId) {
        setMessage('出譜失敗，無法驗證連結')
        setTimeout(() => setMessage(''), 3000)
        return
      }

      const cardTitle = (request.songTitle || '').trim()
      const tabTitleRaw = (tab.title || '').trim()
      const cardKey = normalizeTitleForGrouping(cardTitle) || cardTitle
      const tabKeys = getGroupKeys(tabTitleRaw, tab.id)
      const matchByGrouping = cardKey && tabKeys.includes(cardKey)
      const matchByNoSpace = (cardTitle.replace(/\s+/g, '') === tabTitleRaw.replace(/\s+/g, ''))

      if (!matchByGrouping && !matchByNoSpace) {
        setMessage('出譜失敗，歌名與求譜不一致')
        setTimeout(() => setMessage(''), 3000)
        return
      }

      const { updateDoc, doc, serverTimestamp } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')

      const fulfilledByName = (tab.uploaderPenName || '').trim() || '結他友'
      const albumImage = getSongThumbnail(tab) || null
      const requestId = request.id

      await updateDoc(doc(db, 'tabRequests', requestId), {
        status: 'fulfilled',
        fulfilledBy: user?.uid || null,
        fulfilledByName,
        fulfilledAt: serverTimestamp(),
        tabId: resolvedTabId,
        ...(albumImage && { albumImage }),
      })

      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? {
                ...r,
                status: 'fulfilled',
                fulfilledBy: user?.uid ?? null,
                fulfilledByName,
                fulfilledAt: new Date(),
                tabId: resolvedTabId,
                ...(albumImage && { albumImage }),
              }
            : r
        )
      )
      refreshCache({
        action: 'fulfill',
        id: requestId,
        status: 'fulfilled',
        fulfilledBy: user?.uid ?? null,
        fulfilledByName,
        fulfilledAt: Date.now(),
        tabId: resolvedTabId,
        ...(albumImage && { albumImage }),
      })

      setMessage('成功，感謝幫手出譜')
      setTimeout(() => onClose(), 1500)
    } catch (err) {
      console.error('Check tab link failed:', err)
      setMessage('出譜失敗，無法驗證連結')
      setTimeout(() => setMessage(''), 3000)
    }
  }, [request, pastedLink, user, onClose, setRequests, refreshCache])

  checkAndFulfillRef.current = checkAndFulfill

  /** 唔好依賴 checkAndFulfill reference（parent 傳入嘅 callback 變會令 debounce 重排、甚至重試） */
  useEffect(() => {
    if (!request || !pastedLink.trim()) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!parsePolygonTabLink(pastedLink)) return
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      checkAndFulfillRef.current?.()
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [pastedLink, request?.id])

  const handleClose = () => {
    setPastedLink('')
    setMessage('')
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 pointer-events-auto"
      onClick={handleClose}
      role="button"
      tabIndex={0}
      aria-label="關閉"
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
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
          onKeyDown={(e) => e.key === 'Enter' && checkAndFulfill()}
          placeholder="https://polygon.guitars/tabs/..."
          className="w-full bg-[#282828] border-0 rounded-full px-4 py-3 text-white placeholder-[#666] outline-none text-base mb-3"
        />
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); checkAndFulfill(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`w-full rounded-full font-medium py-3 text-base hover:opacity-90 transition ${message && message.includes('失敗') ? 'bg-[#282828] text-red-500' : 'bg-[#FFD700] text-black'}`}
        >
          {message || '確定'}
        </button>
      </div>
    </div>
  )
}
