import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { db } from '@/lib/firebase'
import { collection, query, where, getDocs, documentId } from 'firebase/firestore'

export default function RequestFulfillersModal({ request, onClose }) {
  const [voterProfiles, setVoterProfiles] = useState(null) // Array<{ id: string, name: string }>
  const [loadingProfiles, setLoadingProfiles] = useState(false)

  const voterIds = useMemo(() => {
    if (!request) return []
    const requestedBy = request.requestedBy || request.userId || null
    const voters = Array.isArray(request.voters) ? request.voters : []
    const ids = [...voters, requestedBy].filter(Boolean)
    // De-dupe while keeping order
    const seen = new Set()
    const unique = []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      unique.push(id)
    }
    return unique
  }, [request])

  useEffect(() => {
    let cancelled = false

    async function loadProfiles() {
      if (!request) return
      if (voterIds.length === 0) {
        setVoterProfiles([])
        return
      }

      setLoadingProfiles(true)
      try {
        const chunks = []
        for (let i = 0; i < voterIds.length; i += 10) chunks.push(voterIds.slice(i, i + 10))

        const profilesById = new Map()
        await Promise.all(
          chunks.map(async (chunk) => {
            const q = query(collection(db, 'users'), where(documentId(), 'in', chunk))
            const snap = await getDocs(q)
            snap.docs.forEach((d) => {
              const data = d.data() || {}
              const rawName = data.penName || data.displayName || '未命名用戶'
              profilesById.set(d.id, {
                id: d.id,
                name: typeof rawName === 'string' ? rawName.trim() : '未命名用戶',
              })
            })
          })
        )

        const resolved = voterIds.map((id) => profilesById.get(id) || { id, name: '未命名用戶' })
        if (!cancelled) setVoterProfiles(resolved)
      } catch (e) {
        console.error('[RequestFulfillersModal] load voter profiles error:', e?.message)
        if (!cancelled) {
          setVoterProfiles(voterIds.map((id) => ({ id, name: '未命名用戶' })))
        }
      } finally {
        if (!cancelled) setLoadingProfiles(false)
      }
    }

    loadProfiles()
    return () => { cancelled = true }
  }, [request, voterIds])

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 pointer-events-auto"
      onClick={onClose}
      role="button"
      tabIndex={0}
      aria-label="關閉"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div
        className="bg-[#121212] rounded-3xl p-6 w-full max-w-sm shadow-xl border border-[#282828]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-bold">求譜用戶詳情</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-white touch-manipulation"
            aria-label="關閉"
            title="關閉"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div className="bg-[#1a1a1a] rounded-xl p-3 border border-[#282828]/60">
            <p className="text-neutral-500 text-xs mb-1">求譜用戶</p>
            {loadingProfiles ? (
              <p className="text-neutral-400 text-sm">載入中...</p>
            ) : voterProfiles && voterProfiles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {voterProfiles.map((p) => (
                  <Link
                    key={p.id}
                    href={`/profile/${p.id}`}
                    className="text-[#FFD700] text-sm hover:underline max-w-full truncate"
                    title={p.name}
                  >
                    {p.name}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-neutral-400 text-sm">暫時冇求譜用戶資料</p>
            )}
          </div>
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-full bg-[#282828] text-neutral-300 font-medium touch-manipulation hover:opacity-90 transition"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}

