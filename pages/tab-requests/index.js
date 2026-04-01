import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/contexts/AuthContext'
import { db } from '@/lib/firebase'
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, doc,
  arrayUnion, arrayRemove, serverTimestamp, where, deleteDoc
} from 'firebase/firestore'
import HandRaiseIcon from '@/components/icons/HandRaiseIcon'
import RequestCard from '@/components/tab-requests/RequestCard'
import SearchFormModal from '@/components/tab-requests/SearchFormModal'
import LoginPromptModal from '@/components/tab-requests/LoginPromptModal'
import DeleteConfirmModal from '@/components/tab-requests/DeleteConfirmModal'
import PasteLinkModal from '@/components/tab-requests/PasteLinkModal'
import RequestFulfillersModal from '@/components/tab-requests/RequestFulfillersModal'

// 求譜列表排序：fulfilled 最底；其餘 自己嘅求譜（新至舊）最頂 → 我投過 → voteCount、createdAt
function compareTabRequests(a, b, uid) {
  const aDone = a.status === 'fulfilled'
  const bDone = b.status === 'fulfilled'
  if (aDone && !bDone) return 1
  if (!aDone && bDone) return -1
  if (aDone && bDone) {
    const tA = a.fulfilledAt?.getTime?.() ?? a.fulfilledAt ?? 0
    const tB = b.fulfilledAt?.getTime?.() ?? b.fulfilledAt ?? 0
    return tB - tA
  }
  const aOwn = uid && a.requestedBy === uid
  const bOwn = uid && b.requestedBy === uid
  if (aOwn && !bOwn) return -1
  if (bOwn && !aOwn) return 1
  if (aOwn && bOwn) {
    const tA = a.createdAt?.getTime?.() ?? a.createdAt ?? 0
    const tB = b.createdAt?.getTime?.() ?? b.createdAt ?? 0
    return tB - tA
  }
  const aMine = uid && a.voters?.includes(uid)
  const bMine = uid && b.voters?.includes(uid)
  if (aMine && !bMine) return -1
  if (bMine && !aMine) return 1
  if ((b.voteCount || 0) !== (a.voteCount || 0)) return (b.voteCount || 0) - (a.voteCount || 0)
  const tA = a.createdAt?.getTime?.() ?? a.createdAt ?? 0
  const tB = b.createdAt?.getTime?.() ?? b.createdAt ?? 0
  return tA - tB
}

export default function TabRequestsPage() {
  const router = useRouter()
  const { user, isAdmin, signInWithGoogle } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [formPrefill, setFormPrefill] = useState({ song: '', artist: '' })

  // Modal visibility
  const [showForm, setShowForm] = useState(false)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [pasteLinkModalRequest, setPasteLinkModalRequest] = useState(null)
  const [requestFulfillersModalRequest, setRequestFulfillersModalRequest] = useState(null)

  // Admin edit
  const [editingRequest, setEditingRequest] = useState(null)
  const [editFormData, setEditFormData] = useState({ songTitle: '', artistName: '' })

  // Vote/cancel animation state
  const [justVotedId, setJustVotedId] = useState(null)
  const justVotedTimerRef = useRef(null)
  const [pendingVoteId, setPendingVoteId] = useState(null)
  const pendingVoteIdRef = useRef(null)
  const [justCancelledId, setJustCancelledId] = useState(null)
  const justCancelledTimerRef = useRef(null)
  const [displayAsUnvotedId, setDisplayAsUnvotedId] = useState(null)
  const displayAsUnvotedTimerRef = useRef(null)

  const scrollPositionRef = useRef(0)
  const modalOpen = showForm || showLoginPrompt || deleteConfirmId || pasteLinkModalRequest || requestFulfillersModalRequest

  // --- Effects ---

  useEffect(() => { loadRequests() }, [])

  useEffect(() => {
    if (!router.isReady) return
    const ps = router.query.prefillSong
    const pa = router.query.prefillArtist
    if (typeof ps !== 'string' && typeof pa !== 'string') return
    setFormPrefill({
      song: typeof ps === 'string' ? ps : '',
      artist: typeof pa === 'string' ? pa : ''
    })
    setShowForm(true)
    router.replace('/tab-requests', undefined, { shallow: true })
  }, [router.isReady, router.query.prefillSong, router.query.prefillArtist])

  // Lock body scroll when any modal is open
  useEffect(() => {
    if (modalOpen) {
      scrollPositionRef.current = typeof window !== 'undefined' ? window.scrollY : 0
      document.body.setAttribute('data-modal-open', 'true')
      document.body.style.overflow = 'hidden'
      if (typeof document.documentElement !== 'undefined') document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.removeAttribute('data-modal-open')
      document.body.style.overflow = ''
      if (typeof document.documentElement !== 'undefined') document.documentElement.style.overflow = ''
      if (typeof window !== 'undefined') window.scrollTo(0, scrollPositionRef.current)
    }
    return () => {
      document.body.removeAttribute('data-modal-open')
      document.body.style.overflow = ''
      if (typeof document.documentElement !== 'undefined') document.documentElement.style.overflow = ''
      if (typeof window !== 'undefined') window.scrollTo(0, scrollPositionRef.current)
    }
  }, [modalOpen])

  useEffect(() => {
    return () => {
      if (justVotedTimerRef.current) clearTimeout(justVotedTimerRef.current)
      if (justCancelledTimerRef.current) clearTimeout(justCancelledTimerRef.current)
      if (displayAsUnvotedTimerRef.current) clearTimeout(displayAsUnvotedTimerRef.current)
    }
  }, [])

  // --- Data loading ---

  const loadRequests = async () => {
    try {
      const res = await fetch('/api/tab-requests')
      if (!res.ok) throw new Error('Failed to load requests')
      const { tabRequests: raw } = await res.json()
      const list = Array.isArray(raw) ? raw : []
      const data = list.map((r) => ({
        ...r,
        createdAt: r.createdAt != null ? new Date(r.createdAt) : new Date(),
      }))
      data.sort((a, b) => compareTabRequests(a, b, user?.uid))
      setRequests(data)
      if (data.length === 0) {
        const q = query(collection(db, 'tabRequests'), orderBy('voteCount', 'desc'))
        const snapshot = await getDocs(q)
        const fallback = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
          createdAt: docSnap.data().createdAt?.toDate?.() || new Date(),
        }))
        fallback.sort((a, b) => compareTabRequests(a, b, user?.uid))
        if (fallback.length > 0) setRequests(fallback)
      }
    } catch (error) {
      console.error('Error loading requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const refreshCache = (payload) => {
    fetch('/api/tab-requests/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }

  const compareRequests = (a, b) => compareTabRequests(a, b, user?.uid)

  // --- Submit new request ---

  const handleSearchSubmit = async ({ searchResults, searchSource }) => {
    if (!user) { alert('請先登入'); return }
    if (!searchResults) return
    setSubmitting(true)
    try {
      const existingQuery = query(
        collection(db, 'tabRequests'),
        where('songTitle', '==', searchResults.title),
        where('artistName', '==', searchResults.artist)
      )
      const existingSnap = await getDocs(existingQuery)

      if (!existingSnap.empty) {
        const existing = existingSnap.docs[0]
        const requestId = existing.id
        const requestData = existing.data()
        const alreadyVoted = requestData.voters?.includes(user.uid)
        const newVoteCount = alreadyVoted ? (requestData.voteCount || 1) - 1 : (requestData.voteCount || 0) + 1
        const newVoters = alreadyVoted
          ? (requestData.voters || []).filter((id) => id !== user.uid)
          : [...(requestData.voters || []), user.uid]

        const requestRef = doc(db, 'tabRequests', requestId)
        await updateDoc(requestRef, {
          voteCount: newVoteCount,
          voters: alreadyVoted ? arrayRemove(user.uid) : arrayUnion(user.uid),
        })
        setRequests((prev) => {
          const next = prev.map((r) => r.id === requestId ? { ...r, voteCount: newVoteCount, voters: newVoters } : r)
          next.sort(compareRequests)
          return next
        })
        refreshCache({ action: 'vote', id: requestId, voteCount: newVoteCount, voters: newVoters })
      } else {
        const payload = {
          songTitle: searchResults.title,
          artistName: searchResults.artist,
          albumImage: searchResults.albumImage || null,
          albumName: searchResults.albumName || null,
          youtubeUrl: searchResults.youtubeUrl || null,
          searchSource: searchSource || 'manual',
          requestedBy: user.uid,
          requesterName: user.displayName || '匿名用戶',
          requesterPhoto: user.photoURL,
          createdAt: serverTimestamp(),
          voteCount: 1,
          voters: [user.uid],
          status: 'pending',
          fulfilledBy: null,
          fulfilledAt: null,
        }
        const ref = await addDoc(collection(db, 'tabRequests'), payload)
        const newRequest = {
          id: ref.id,
          songTitle: searchResults.title,
          artistName: searchResults.artist,
          albumImage: searchResults.albumImage || null,
          albumName: searchResults.albumName || null,
          youtubeUrl: searchResults.youtubeUrl || null,
          searchSource: searchSource || null,
          requestedBy: user.uid,
          requesterName: user.displayName || '匿名用戶',
          requesterPhoto: user.photoURL || null,
          createdAt: new Date(),
          voteCount: 1,
          voters: [user.uid],
          status: 'pending',
          fulfilledBy: null,
          fulfilledByName: null,
          fulfilledAt: null,
          tabId: null,
        }
        setRequests((prev) => {
          const next = [newRequest, ...prev]
          next.sort(compareRequests)
          return next
        })
        refreshCache({
          action: 'add',
          doc: { ...newRequest, createdAt: Date.now() },
        })
      }
      setShowForm(false)
    } catch (error) {
      console.error('Error submitting request:', error)
      alert('提交失敗，請重試')
    } finally {
      setSubmitting(false)
    }
  }

  // --- Vote / cancel vote ---

  const voteForRequest = async (requestId) => {
    if (!user) { setShowLoginPrompt(true); return }
    if (justCancelledId === requestId || displayAsUnvotedId === requestId || justVotedId === requestId || pendingVoteId === requestId) return

    const request = requests.find(r => r.id === requestId)
    const hasUserVoted = request?.voters?.includes(user.uid)

    if (hasUserVoted) {
      if (justCancelledTimerRef.current) clearTimeout(justCancelledTimerRef.current)
      if (displayAsUnvotedTimerRef.current) clearTimeout(displayAsUnvotedTimerRef.current)
      setJustCancelledId(requestId)
      justCancelledTimerRef.current = setTimeout(async () => {
        justCancelledTimerRef.current = null
        setJustCancelledId(null)
        try {
          await updateDoc(doc(db, 'tabRequests', requestId), {
            voteCount: (request.voteCount || 1) - 1,
            voters: arrayRemove(user.uid),
          })
          const newVoters = (request.voters || []).filter((id) => id !== user.uid)
          const newCount = (request.voteCount || 1) - 1
          setDisplayAsUnvotedId(requestId)
          displayAsUnvotedTimerRef.current = setTimeout(() => {
            displayAsUnvotedTimerRef.current = null
            setDisplayAsUnvotedId(null)
            setRequests((prev) => {
              const next = prev.map((r) => r.id === requestId ? { ...r, voteCount: newCount, voters: newVoters } : r)
              next.sort(compareRequests)
              return next
            })
            refreshCache({ action: 'vote', id: requestId, voteCount: newCount, voters: newVoters })
          }, 1000)
        } catch (error) {
          console.error('Error cancelling vote:', error)
          setDisplayAsUnvotedId(null)
          loadRequests()
        }
      }, 1500)
      return
    }

    try {
      if (justVotedTimerRef.current) clearTimeout(justVotedTimerRef.current)
      const newCount = (request.voteCount || 0) + 1
      const newVoters = [...(request.voters || []), user.uid]
      pendingVoteIdRef.current = requestId
      setPendingVoteId(requestId)
      setJustVotedId(requestId)
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, voteCount: newCount, voters: newVoters } : r))
      )
      justVotedTimerRef.current = setTimeout(async () => {
        justVotedTimerRef.current = null
        pendingVoteIdRef.current = null
        setJustVotedId(null)
        setPendingVoteId(null)
        try {
          await updateDoc(doc(db, 'tabRequests', requestId), {
            voteCount: newCount,
            voters: arrayUnion(user.uid),
          })
          refreshCache({ action: 'vote', id: requestId, voteCount: newCount, voters: newVoters })
        } catch (err) {
          console.error('Error voting:', err)
          loadRequests()
        }
      }, 1000)
    } catch (error) {
      console.error('Error voting:', error)
      loadRequests()
    }
  }

  const hasVoted = (request) => request.voters?.includes(user?.uid)

  // --- Delete ---

  const executeDeleteRequest = async (requestId) => {
    if (!requestId) return
    const req = requests.find((r) => r.id === requestId)
    const canDelete = isAdmin || (user?.uid && req?.requestedBy === user.uid && (req?.voteCount || 0) <= 1)
    if (!canDelete) {
      setDeleteConfirmId(null)
      if (req?.voteCount > 1) alert('已有其他人求譜，無法刪除')
      return
    }
    try {
      await deleteDoc(doc(db, 'tabRequests', requestId))
      setRequests((prev) => prev.filter((r) => r.id !== requestId))
      refreshCache({ action: 'delete', id: requestId })
      setDeleteConfirmId(null)
    } catch (error) {
      console.error('Error deleting request:', error)
      alert('刪除失敗，請重試')
    }
  }

  // --- Admin edit ---

  const saveEdit = async () => {
    if (!isAdmin || !editingRequest) return
    try {
      await updateDoc(doc(db, 'tabRequests', editingRequest.id), {
        songTitle: editFormData.songTitle,
        artistName: editFormData.artistName,
      })
      setRequests(requests.map(r =>
        r.id === editingRequest.id
          ? { ...r, songTitle: editFormData.songTitle, artistName: editFormData.artistName }
          : r
      ))
      refreshCache({ action: 'edit', id: editingRequest.id, songTitle: editFormData.songTitle, artistName: editFormData.artistName })
      setEditingRequest(null)
    } catch (error) {
      console.error('Error updating request:', error)
      alert('更新失敗，請重試')
    }
  }

  const cancelEdit = () => {
    setEditingRequest(null)
    setEditFormData({ songTitle: '', artistName: '' })
  }

  // --- Grouping: "你的求譜" vs "其他" ---

  const { myRequests, otherRequests } = useMemo(() => {
    const uid = user?.uid
    const pending = pendingVoteIdRef.current ?? pendingVoteId
    const isMine = (r) => r.id !== pending && uid && (r.requestedBy === uid || r.voters?.includes(uid))
    const mine = requests.filter(isMine)
    const other = requests.filter((r) => !isMine(r))
    const sortMine = [...mine].sort((a, b) => {
      const aDone = a.status === 'fulfilled'
      const bDone = b.status === 'fulfilled'
      if (aDone && !bDone) return 1
      if (!aDone && bDone) return -1
      if (aDone && bDone) {
        const tA = a.fulfilledAt?.getTime?.() ?? a.fulfilledAt ?? 0
        const tB = b.fulfilledAt?.getTime?.() ?? b.fulfilledAt ?? 0
        return tB - tA
      }
      const aOwn = uid && a.requestedBy === uid
      const bOwn = uid && b.requestedBy === uid
      if (aOwn && !bOwn) return -1
      if (!aOwn && bOwn) return 1
      const tA = a.createdAt?.getTime?.() ?? a.createdAt ?? 0
      const tB = b.createdAt?.getTime?.() ?? b.createdAt ?? 0
      return tB - tA
    })
    const sortOther = [...other].sort((a, b) => compareTabRequests(a, b, uid))
    return { myRequests: sortMine, otherRequests: sortOther }
  }, [requests, user?.uid, pendingVoteId])

  // --- Shared card props ---

  const cardProps = {
    isAdmin,
    user,
    editingRequest,
    editFormData,
    setEditFormData,
    saveEdit,
    cancelEdit,
    justCancelledId,
    displayAsUnvotedId,
    hasVoted,
    onVote: voteForRequest,
    onFulfill: (request) => setPasteLinkModalRequest(request),
    onDelete: (id) => setDeleteConfirmId(id),
    onShowRequestFulfillers: (request) => setRequestFulfillersModalRequest(request),
  }

  // --- Render ---

  return (
    <Layout>
      <div
        className={`px-4 pt-6 ${modalOpen ? 'pointer-events-none' : ''}`}
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">求譜區</h1>
            <p className="text-neutral-500 text-sm mt-1">搵人求譜．幫人出譜</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-[#FFD700] text-black rounded-full font-medium flex items-center gap-0.5"
          >
            <HandRaiseIcon />
            求譜
          </button>
        </div>

        {/* Modals */}
        {showForm && (
          <SearchFormModal
            onClose={() => {
              setShowForm(false)
              setFormPrefill({ song: '', artist: '' })
            }}
            onSubmit={handleSearchSubmit}
            submitting={submitting}
            initialSongTitle={formPrefill.song}
            initialArtistName={formPrefill.artist}
          />
        )}

        {showLoginPrompt && (
          <LoginPromptModal
            onClose={() => setShowLoginPrompt(false)}
            signInWithGoogle={signInWithGoogle}
          />
        )}

        {deleteConfirmId && (
          <DeleteConfirmModal
            onClose={() => setDeleteConfirmId(null)}
            onConfirm={() => executeDeleteRequest(deleteConfirmId)}
          />
        )}

        {pasteLinkModalRequest && (
          <PasteLinkModal
            request={pasteLinkModalRequest}
            user={user}
            onClose={() => setPasteLinkModalRequest(null)}
            setRequests={setRequests}
            refreshCache={refreshCache}
          />
        )}

        {requestFulfillersModalRequest && (
          <RequestFulfillersModal
            request={requestFulfillersModalRequest}
            onClose={() => setRequestFulfillersModalRequest(null)}
          />
        )}

        {/* Request list */}
        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-[#1a1a1a] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
              </svg>
            </div>
            <p className="text-neutral-500">暫時未有求譜</p>
            <p className="text-neutral-600 text-sm mt-1">成為第一個求譜的人吧！</p>
          </div>
        ) : (
          <div className="space-y-4">
            {user && (
              <section>
                <h2 className="text-[#FFD700] font-medium text-sm mb-3 px-0.5">你的求譜</h2>
                {myRequests.length === 0 ? (
                  <p className="text-neutral-500 text-sm py-2">你尚未發起求譜</p>
                ) : (
                  <div className="space-y-3">
                    {myRequests.map((request) => (
                      <RequestCard key={request.id} request={request} {...cardProps} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {user && myRequests.length > 0 && otherRequests.length > 0 && (
              <hr className="border-[#282828]" />
            )}

            {otherRequests.length === 0 && !user ? (
              <p className="text-neutral-500 text-sm py-2">暫時未有求譜</p>
            ) : otherRequests.length === 0 ? (
              <p className="text-neutral-500 text-sm py-2">暫無其他求譜</p>
            ) : (
              <div className="space-y-3">
                {otherRequests.map((request) => (
                  <RequestCard key={request.id} request={request} {...cardProps} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
