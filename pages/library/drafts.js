import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from '@/components/Link'
import Layout from '@/components/Layout'
import { useAuth } from '@/contexts/AuthContext'
import { getTabDrafts, removeTabDraft } from '@/lib/tabDrafts'
import { FileText, ArrowLeft, Clock, PenSquare, Trash2 } from 'lucide-react'

function formatDraftTime(updatedAt) {
  try {
    return new Date(updatedAt).toLocaleString('zh-HK', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch (_) {
    return ''
  }
}

export default function DraftTabsPage() {
  const router = useRouter()
  const { user, isAuthenticated, loading } = useAuth()
  const [drafts, setDrafts] = useState([])

  useEffect(() => {
    if (loading) return
    if (!isAuthenticated) {
      router.push('/login')
      return
    }
    getTabDrafts(user?.uid).then(setDrafts).catch(() => setDrafts([]))
  }, [isAuthenticated, loading, router, user?.uid])

  const draftCount = useMemo(() => drafts.length, [drafts])

  const handleDeleteDraft = async (e, draftId) => {
    e.preventDefault()
    e.stopPropagation()
    await removeTabDraft(user?.uid, draftId)
    const next = await getTabDrafts(user?.uid)
    setDrafts(next)
  }

  const getContinueHref = (draft) => {
    if (draft.mode === 'edit' && draft.tabId) {
      return `/tabs/${draft.tabId}/edit?draft=${draft.id}`
    }
    return `/tabs/new?draft=${draft.id}`
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout fullWidth hideHeader>
      <Head>
        <title>草稿 | Polygon Guitar</title>
        <meta name="theme-color" content="#000000" />
      </Head>
      <div className="relative z-10 min-h-screen pb-24 bg-black" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="relative pt-4 pb-1" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <Link
            href="/library"
            className="inline-flex items-center text-white hover:text-white/90 transition p-1.5 -ml-1.5"
            aria-label="返回收藏"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </div>

        <div className="pb-1" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-bold text-white truncate" style={{ fontSize: '1.5rem' }}>
              草稿
            </h1>
            <span className="text-[12px] md:text-[14px] text-neutral-500 whitespace-nowrap flex-shrink-0">
              共 {draftCount} 份
            </span>
          </div>
        </div>

        {drafts.length > 0 ? (
          <div style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            {drafts.map((draft) => (
              <Link
                key={draft.id}
                href={getContinueHref(draft)}
                className="group flex items-center gap-3 py-2 pl-0 pr-0 rounded-[7px] md:hover:bg-white/5 md:transition"
              >
                <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  <PenSquare className="w-5 h-5 text-neutral-400" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <h3 className="text-[1rem] font-medium text-[#e6e6e6] truncate md:group-hover:text-[#FFD700] md:transition">
                    {draft.title || '未命名草稿'}
                  </h3>
                  <p className="text-[0.85rem] text-[#999] truncate">
                    {draft.artist || '未填歌手'}
                    <span className="mx-1">·</span>
                    {draft.mode === 'edit' ? '編輯現有譜' : '出譜草稿'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[11px] text-neutral-500 flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3" />
                    {formatDraftTime(draft.updatedAt)}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteDraft(e, draft.id)}
                    className="mt-1 text-neutral-500 hover:text-red-400 transition"
                    aria-label="刪除草稿"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-16" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <FileText className="w-16 h-16 text-[#3E3E3E] mx-auto mb-4" />
            <h3 className="text-xl text-white mb-2">未有草稿</h3>
            <Link
              href="/tabs/new"
              className="inline-flex items-center px-6 py-3 bg-[#FFD700] text-black rounded-full font-medium hover:opacity-90 transition"
            >
              去出譜
            </Link>
          </div>
        )}
      </div>
    </Layout>
  )
}
