import { db } from '@/lib/firebase'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '@/lib/firestore-tracked'

const TAB_DRAFTS_KEY = 'pg_tab_drafts_v1'
const MAX_DRAFTS = 50

function safeNowIso() {
  return new Date().toISOString()
}

function parseDrafts(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function sanitizePreviewText(v) {
  return String(v || '').trim().slice(0, 120)
}

function normalizeDraft(input) {
  if (!input || typeof input !== 'object') return null
  const mode = input.mode === 'edit' ? 'edit' : 'new'
  const id = String(input.id || '')
  if (!id) return null
  return {
    id,
    mode,
    tabId: input.tabId ? String(input.tabId) : null,
    title: sanitizePreviewText(input.title),
    artist: sanitizePreviewText(input.artist),
    updatedAt: input.updatedAt || safeNowIso(),
    data: input.data && typeof input.data === 'object' ? input.data : {},
  }
}

function setLocalDrafts(list) {
  if (typeof window === 'undefined') return
  const normalized = (list || [])
    .map(normalizeDraft)
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_DRAFTS)
  localStorage.setItem(TAB_DRAFTS_KEY, JSON.stringify(normalized))
}

function upsertLocalDraft({ id, mode = 'new', tabId = null, data = {} }) {
  const draftId = String(id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft_${Date.now()}`))
  const nextDraft = normalizeDraft({
    id: draftId,
    mode,
    tabId: tabId || null,
    title: data?.title,
    artist: data?.artist,
    updatedAt: safeNowIso(),
    data,
  })
  if (!nextDraft) return null
  const prev = getLocalDrafts().filter((d) => d.id !== nextDraft.id)
  setLocalDrafts([nextDraft, ...prev])
  return nextDraft
}

function getLocalDrafts() {
  if (typeof window === 'undefined') return []
  try {
    const list = parseDrafts(localStorage.getItem(TAB_DRAFTS_KEY))
      .map(normalizeDraft)
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return list
  } catch (_) {
    return []
  }
}

function removeLocalDraft(draftId) {
  if (typeof window === 'undefined') return
  const id = String(draftId || '')
  if (!id) return
  setLocalDrafts(getLocalDrafts().filter((d) => d.id !== id))
}

function toIso(v) {
  if (!v) return safeNowIso()
  if (typeof v === 'string') return v
  if (typeof v?.toDate === 'function') return v.toDate().toISOString()
  return safeNowIso()
}

export async function getTabDrafts(userId) {
  if (!userId) return getLocalDrafts()
  try {
    const q = query(
      collection(db, 'tabDrafts'),
      where('userId', '==', userId),
      orderBy('updatedAt', 'desc'),
      limit(MAX_DRAFTS)
    )
    const snap = await getDocs(q)
    const list = snap.docs.map((d) => normalizeDraft({
      id: d.id,
      ...d.data(),
      updatedAt: toIso(d.data()?.updatedAt),
    })).filter(Boolean)
    return list
  } catch (e) {
    console.warn('[tabDrafts] cloud list failed, fallback local:', e)
    return getLocalDrafts()
  }
}

export async function getTabDraftById(userId, draftId) {
  if (!draftId) return null
  const id = String(draftId)
  if (!userId) return getLocalDrafts().find((d) => d.id === id) || null
  try {
    const ref = doc(db, 'tabDrafts', id)
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const data = snap.data()
    if (data?.userId !== userId) return null
    return normalizeDraft({
      id: snap.id,
      ...data,
      updatedAt: toIso(data?.updatedAt),
    })
  } catch (e) {
    console.warn('[tabDrafts] cloud get failed, fallback local:', e)
    return getLocalDrafts().find((d) => d.id === id) || null
  }
}

export async function upsertTabDraft(userId, { id, mode = 'new', tabId = null, data = {} }) {
  if (typeof window === 'undefined') return null
  if (!userId) return upsertLocalDraft({ id, mode, tabId, data })

  const draftId = String(id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft_${Date.now()}`))
  const nextDraft = normalizeDraft({
    id: draftId,
    mode,
    tabId,
    title: data?.title,
    artist: data?.artist,
    data,
    updatedAt: safeNowIso(),
  })
  if (!nextDraft) return null
  try {
    await setDoc(doc(db, 'tabDrafts', draftId), {
      userId,
      mode: nextDraft.mode,
      tabId: nextDraft.tabId || null,
      title: nextDraft.title,
      artist: nextDraft.artist,
      data: nextDraft.data,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true })
    return nextDraft
  } catch (e) {
    console.warn('[tabDrafts] cloud upsert failed, fallback local:', e)
    return upsertLocalDraft({ id: draftId, mode, tabId, data })
  }
}

export async function removeTabDraft(userId, draftId) {
  if (typeof window === 'undefined') return
  const id = String(draftId || '')
  if (!id) return
  if (!userId) {
    removeLocalDraft(id)
    return
  }
  try {
    await deleteDoc(doc(db, 'tabDrafts', id))
  } catch (e) {
    console.warn('[tabDrafts] cloud delete failed, fallback local:', e)
    removeLocalDraft(id)
  }
}
