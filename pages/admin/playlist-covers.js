import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'
import CoverGenerator from '@/components/CoverGenerator'
import { getAllPlaylists, updatePlaylist } from '@/lib/playlists'
import { isChaksaPlaylist } from '@/lib/chaksaPlaylist'
import { getTabsByIds } from '@/lib/tabs'
import { uploadToCloudinary } from '@/lib/cloudinary'
import { BarChart2, Sparkles } from 'lucide-react'

function PlaylistCovers() {
  const router = useRouter()
  const [playlists, setPlaylists] = useState([])
  const [selectedPlaylist, setSelectedPlaylist] = useState(null)
  const [songs, setSongs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    getAllPlaylists()
      .then(data => {
        setPlaylists(data.sort((a, b) => {
          if (a.source === 'auto' && b.source !== 'auto') return -1
          if (a.source !== 'auto' && b.source === 'auto') return 1
          return (a.displayOrder ?? 99) - (b.displayOrder ?? 99)
        }))
        const qid = router.query.id
        if (qid) {
          const found = data.find(p => p.id === qid)
          if (found) setSelectedPlaylist(found)
        }
      })
      .catch(err => showMsg('載入歌單失敗：' + err.message, 'error'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedPlaylist?.songIds?.length) {
      setSongs([])
      return
    }
    setLoadingSongs(true)
    getTabsByIds(selectedPlaylist.songIds)
      .then(setSongs)
      .catch(err => console.error('Load songs error:', err))
      .finally(() => setLoadingSongs(false))
  }, [selectedPlaylist?.id])

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 5000)
  }

  const handleGenerated = async (file) => {
    if (!selectedPlaylist) return
    setUploading(true)
    try {
      const imageUrl = await uploadToCloudinary(file, selectedPlaylist.title, 'playlist_covers')
      await updatePlaylist(selectedPlaylist.id, {
        coverImage: imageUrl,
        customCover: true,
        updatedAt: new Date().toISOString()
      })
      setPlaylists(prev =>
        prev.map(p => p.id === selectedPlaylist.id ? { ...p, coverImage: imageUrl, customCover: true } : p)
      )
      setSelectedPlaylist(prev => ({ ...prev, coverImage: imageUrl, customCover: true }))
      showMsg('封面已上傳並更新')
    } catch (err) {
      showMsg('上傳失敗：' + err.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">歌單封面生成器</h1>
            <p className="text-neutral-500 text-sm mt-1">用歌單入面嘅歌嚟生成封面</p>
          </div>
          <button onClick={() => router.push('/admin/playlists')} className="text-[#FFD700] hover:opacity-80 text-sm">
            返回歌單管理
          </button>
        </div>

        {message && (
          <div className={`p-3 rounded-lg text-sm ${
            message.type === 'error'
              ? 'bg-red-900/30 border border-red-700 text-red-400'
              : 'bg-green-900/30 border border-green-700 text-green-400'
          }`}>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: playlist picker */}
          <div className="space-y-3">
            <h2 className="text-white font-medium">揀歌單</h2>
            {loading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-neutral-800 rounded-lg animate-pulse" />)}
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto space-y-1 bg-[#0A0A0A] rounded-lg p-2 border border-neutral-800">
                {playlists.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlaylist(p)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition ${
                      selectedPlaylist?.id === p.id
                        ? 'bg-[#FFD700]/20 border border-[#FFD700]/50'
                        : 'hover:bg-[#1A1A1A] border border-transparent'
                    }`}
                  >
                    <div className="w-10 h-10 rounded bg-neutral-800 overflow-hidden flex-shrink-0">
                      {p.coverImage ? (
                        <img src={p.coverImage} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500 text-lg">
                          {p.source === 'auto' ? <BarChart2 className="w-5 h-5" strokeWidth={1.5} /> : <Sparkles className="w-5 h-5" strokeWidth={1.5} />}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm truncate">{p.title}</p>
                      <p className="text-neutral-500 text-xs">{p.songIds?.length || 0} 首 · {p.source === 'auto' ? '自動' : '手動'}</p>
                    </div>
                    {p.customCover && (
                      <span className="text-xs text-green-500 flex-shrink-0">自訂</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: cover generator */}
          <div className="space-y-3">
            <h2 className="text-white font-medium">
              {selectedPlaylist ? `生成封面：${selectedPlaylist.title}` : '請先揀歌單'}
            </h2>
            {selectedPlaylist && isChaksaPlaylist(selectedPlaylist) && (
              <p className="text-xs text-amber-200/90 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                叱咤歌單嘅「封面生成器」只會用有站內譜嘅歌曲（<code className="text-amber-100">songIds</code>）。無譜項目唔會出現；可改用歌單管理上傳自訂封面。
              </p>
            )}
            {uploading && (
              <div className="p-3 bg-blue-900/30 border border-blue-700 rounded-lg text-blue-400 text-sm">
                上傳中...
              </div>
            )}
            {selectedPlaylist ? (
              loadingSongs ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <CoverGenerator
                  key={selectedPlaylist.id}
                  songs={songs}
                  playlistTitle={selectedPlaylist.title}
                  onGenerated={handleGenerated}
                  showTitleTextColorPicker
                />
              )
            ) : (
              <div className="flex items-center justify-center py-16 bg-[#121212] rounded-lg border border-neutral-800">
                <p className="text-neutral-600">← 先揀一個歌單</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default function PlaylistCoversPage() {
  return (
    <AdminGuard>
      <PlaylistCovers />
    </AdminGuard>
  )
}
