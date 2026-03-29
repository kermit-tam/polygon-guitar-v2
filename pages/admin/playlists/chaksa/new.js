import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'
import Link from '@/components/Link'
import { useAuth } from '@/contexts/AuthContext'
import { createPlaylist } from '@/lib/playlists'
import { CHAKSA_MANUAL_TYPE } from '@/lib/chaksaPlaylist'
import { ArrowLeft } from 'lucide-react'

function NewChaksaPlaylist() {
  const router = useRouter()
  const { isAdmin, user } = useAuth()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [curatedBy, setCuratedBy] = useState('')
  const [yearFrom, setYearFrom] = useState(2021)
  const [yearTo, setYearTo] = useState(2025)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (user?.displayName && !curatedBy) setCuratedBy(user.displayName)
  }, [user, curatedBy])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!title.trim()) {
      alert('請輸入歌單名稱')
      return
    }
    if (yearFrom > yearTo) {
      alert('起始年份不可大於結束年份')
      return
    }
    if (!user?.uid) {
      alert('請先登入')
      return
    }
    setSubmitting(true)
    try {
      const created = await createPlaylist(
        {
          title: title.trim(),
          description: description.trim(),
          curatedBy: curatedBy.trim(),
          source: 'manual',
          manualType: CHAKSA_MANUAL_TYPE,
          chaksaYearFrom: yearFrom,
          chaksaYearTo: yearTo,
          chartEntries: [],
          songIds: [],
          songCount: 0,
          isActive: true,
          displayOrder: 100,
          viewMode: 'list'
        },
        user.uid
      )
      router.push(`/admin/playlists/chaksa/${created.id}`)
    } catch (err) {
      console.error(err)
      alert('建立失敗：' + (err.message || String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto text-center py-16 text-neutral-500">無權訪問</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-xl mx-auto space-y-6 px-4 py-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/playlists" className="text-neutral-400 hover:text-white">
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-2xl font-bold text-white">新增叱咤十大歌單</h1>
        </div>
        <p className="text-sm text-neutral-500">
          建立後會前往編輯頁，按年份同第 1–10 位填入站內譜或無譜項目（Spotify 封面）。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 bg-[#121212] border border-neutral-800 rounded-xl p-6">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">歌單名稱</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-black border border-neutral-700 rounded-lg text-white"
              placeholder="例如：叱咤十大 2021–2025"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-black border border-neutral-700 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">策展人</label>
            <input
              value={curatedBy}
              onChange={(e) => setCuratedBy(e.target.value)}
              className="w-full px-3 py-2 bg-black border border-neutral-700 rounded-lg text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">起始樂壇年度</label>
              <input
                type="number"
                value={yearFrom}
                onChange={(e) => setYearFrom(Number(e.target.value))}
                className="w-full px-3 py-2 bg-black border border-neutral-700 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">結束樂壇年度</label>
              <input
                type="number"
                value={yearTo}
                onChange={(e) => setYearTo(Number(e.target.value))}
                className="w-full px-3 py-2 bg-black border border-neutral-700 rounded-lg text-white"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-[#FFD700] text-black font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '建立中…' : '建立並前往編輯'}
          </button>
        </form>
      </div>
    </Layout>
  )
}

export default function Page() {
  return (
    <AdminGuard>
      <NewChaksaPlaylist />
    </AdminGuard>
  )
}
