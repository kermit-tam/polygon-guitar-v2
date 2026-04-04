import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'
import Link from '@/components/Link'
import { useAuth } from '@/contexts/AuthContext'
import { getPlaylist, updatePlaylist } from '@/lib/playlists'
import { getTabsByIds } from '@/lib/tabs'
import { CHAKSA_MANUAL_TYPE, isChaksaPlaylist, songIdsFromChartEntries } from '@/lib/chaksaPlaylist'
import { auth } from '@/lib/firebase'
import SpotifyTrackSearch from '@/components/SpotifyTrackSearch'
import { ArrowLeft, Music, Search, Trash2 } from 'lucide-react'

function cellKey(year, position) {
  return `${year}-${position}`
}

function buildChartEntriesFromCells(cells, yearFrom, yearTo) {
  const list = []
  for (let y = yearTo; y >= yearFrom; y--) {
    for (let p = 1; p <= 10; p++) {
      const c = cells[cellKey(y, p)]
      if (!c) continue
      const entryId = c.entryId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${y}-${p}-${Date.now()}`)
      if (c.source === 'tab' && c.tabId && String(c.tabId).trim()) {
        list.push({
          entryId,
          year: y,
          position: p,
          source: 'tab',
          tabId: String(c.tabId).trim()
        })
      } else if (c.source === 'external' && (c.title || '').trim()) {
        list.push({
          entryId,
          year: y,
          position: p,
          source: 'external',
          title: String(c.title).trim(),
          artistName: String(c.artistName || '').trim() || '—',
          coverUrl: c.coverUrl || c.albumImage || '',
          spotifyTrackId: c.spotifyTrackId || null,
          spotifyUrl: c.spotifyUrl || null
        })
      }
    }
  }
  return list
}

function EditChaksaPlaylist() {
  const router = useRouter()
  const { id } = router.query
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [playlist, setPlaylist] = useState(null)
  const [yearFrom, setYearFrom] = useState(2021)
  const [yearTo, setYearTo] = useState(2025)
  /** @type {Record<string, object>} */
  const [cells, setCells] = useState({})
  const [tabLabels, setTabLabels] = useState({})
  const artistMapRef = useRef(new Map())
  const [catalog, setCatalog] = useState([])
  const [pickYear, setPickYear] = useState(null)
  const [pickPosition, setPickPosition] = useState(null)
  const [pickQuery, setPickQuery] = useState('')
  const [externalOpen, setExternalOpen] = useState(false)
  const [extYear, setExtYear] = useState(null)
  const [extPosition, setExtPosition] = useState(null)
  const [extTitle, setExtTitle] = useState('')
  const [extArtist, setExtArtist] = useState('')
  const [spotifyOpen, setSpotifyOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') return
    setLoading(true)
    try {
      const p = await getPlaylist(id)
      if (!p || !isChaksaPlaylist(p)) {
        setPlaylist(null)
        return
      }
      setPlaylist(p)
      const yf = typeof p.chaksaYearFrom === 'number' ? p.chaksaYearFrom : 2021
      const yt = typeof p.chaksaYearTo === 'number' ? p.chaksaYearTo : 2025
      setYearFrom(yf)
      setYearTo(yt)
      const next = {}
      for (const e of p.chartEntries || []) {
        if (!e || typeof e.year !== 'number' || typeof e.position !== 'number') continue
        next[cellKey(e.year, e.position)] = { ...e }
      }
      setCells(next)
      const tabIds = [...new Set((p.chartEntries || []).filter((e) => e?.source === 'tab' && e.tabId).map((e) => e.tabId))]
      if (tabIds.length) {
        const tabs = await getTabsByIds(tabIds)
        const map = {}
        tabs.forEach((t) => {
          const pen = (t.uploaderPenName || '').trim()
          const artist = t.artistName || t.artist || ''
          map[t.id] = pen ? `${t.title} — ${artist} · 出譜：${pen}` : `${t.title} — ${artist}`
        })
        setTabLabels(map)
      } else {
        setTabLabels({})
      }
    } catch (e) {
      console.error(e)
      alert('載入失敗')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (isAdmin && id) load()
  }, [isAdmin, id, load])

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/search-data')
      .then((r) => r.json())
      .then((data) => {
        const map = new Map()
        ;(data.artists || []).forEach((a) => {
          if (a.id && a.name) map.set(a.id, a.name)
        })
        artistMapRef.current = map
        setCatalog(data.tabs || [])
      })
      .catch(() => setCatalog([]))
  }, [isAdmin])

  const bustCache = async () => {
    try {
      const token = await auth.currentUser?.getIdToken?.()
      if (token) {
        await fetch('/api/admin/bust-playlist-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ playlistId: id })
        })
      }
    } catch (_) {}
  }

  const save = async () => {
    if (!playlist) return
    setSaving(true)
    try {
      const chartEntries = buildChartEntriesFromCells(cells, yearFrom, yearTo)
      const songIds = songIdsFromChartEntries(chartEntries)
      await updatePlaylist(playlist.id, {
        chaksaYearFrom: yearFrom,
        chaksaYearTo: yearTo,
        chartEntries,
        songIds,
        songCount: chartEntries.length,
        manualType: CHAKSA_MANUAL_TYPE
      })
      await bustCache()
      alert('已儲存')
      await load()
    } catch (e) {
      console.error(e)
      alert('儲存失敗：' + (e.message || String(e)))
    } finally {
      setSaving(false)
    }
  }

  const openPickTab = (year, position) => {
    setPickYear(year)
    setPickPosition(position)
    setPickQuery('')
  }

  const applyTabPick = (tab) => {
    if (pickYear == null || pickPosition == null) return
    const k = cellKey(pickYear, pickPosition)
    setCells((prev) => ({
      ...prev,
      [k]: {
        ...prev[k],
        entryId: prev[k]?.entryId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : k),
        year: pickYear,
        position: pickPosition,
        source: 'tab',
        tabId: tab.id
      }
    }))
    const artistLine = tab.artistName || tab.artist || artistMapRef.current.get(tab.artistId) || ''
    const pen = (tab.uploaderPenName || '').trim()
    setTabLabels((prev) => ({
      ...prev,
      [tab.id]: pen ? `${tab.title} — ${artistLine} · 出譜：${pen}` : `${tab.title} — ${artistLine}`
    }))
    setPickYear(null)
    setPickPosition(null)
  }

  const openExternal = (year, position) => {
    const k = cellKey(year, position)
    const c = cells[k]
    setExtYear(year)
    setExtPosition(position)
    setExtTitle(c?.title || '')
    setExtArtist(c?.artistName || c?.artist || '')
    setExternalOpen(true)
  }

  const commitExternalFields = (openSpotifyAfter) => {
    if (extYear == null || extPosition == null) return
    if (!extTitle.trim()) return
    const k = cellKey(extYear, extPosition)
    setCells((prev) => ({
      ...prev,
      [k]: {
        ...prev[k],
        entryId: prev[k]?.entryId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : k),
        year: extYear,
        position: extPosition,
        source: 'external',
        title: extTitle.trim(),
        artistName: extArtist.trim(),
        coverUrl: prev[k]?.coverUrl || '',
        spotifyTrackId: prev[k]?.spotifyTrackId || null,
        spotifyUrl: prev[k]?.spotifyUrl || null
      }
    }))
    setExternalOpen(false)
    if (openSpotifyAfter) setSpotifyOpen(true)
  }

  const clearCell = (year, position) => {
    const k = cellKey(year, position)
    setCells((prev) => {
      const next = { ...prev }
      delete next[k]
      return next
    })
  }

  const pickListResults = useMemo(() => {
    const q = pickQuery.trim().toLowerCase()
    if (!q) return catalog.slice(0, 40)
    return catalog
      .filter((t) => {
        const an = (t.artistName || t.artist || artistMapRef.current.get(t.artistId) || '').toLowerCase()
        const pen = (t.uploaderPenName || '').toLowerCase()
        return (t.title || '').toLowerCase().includes(q) || an.includes(q) || pen.includes(q)
      })
      .slice(0, 80)
  }, [pickQuery, catalog])

  const yearsList = []
  for (let y = yearTo; y >= yearFrom; y--) yearsList.push(y)

  if (!isAdmin) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto py-16 text-center text-neutral-500">無權訪問</div>
      </Layout>
    )
  }

  if (loading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto py-16 text-center text-neutral-500">載入中…</div>
      </Layout>
    )
  }

  if (!playlist) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto py-16 text-center text-neutral-500">找不到叱咤歌單</div>
        <Link href="/admin/playlists" className="block text-center text-[#FFD700]">
          返回
        </Link>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/playlists" className="text-neutral-400 hover:text-white">
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-xl font-bold text-white truncate flex-1 min-w-0">{playlist.title}</h1>
          <Link href={`/playlist/${playlist.slug ?? playlist.id}`} className="text-sm text-[#FFD700] hover:underline shrink-0">
            預覽
          </Link>
        </div>

        <div className="flex flex-wrap gap-2 items-end bg-[#121212] border border-neutral-800 rounded-xl p-4">
          <div>
            <label className="text-xs text-neutral-500">起始年</label>
            <input
              type="number"
              value={yearFrom}
              onChange={(e) => setYearFrom(Number(e.target.value))}
              className="block w-28 px-2 py-1 bg-black border border-neutral-700 rounded text-white text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500">結束年</label>
            <input
              type="number"
              value={yearTo}
              onChange={(e) => setYearTo(Number(e.target.value))}
              className="block w-28 px-2 py-1 bg-black border border-neutral-700 rounded text-white text-sm"
            />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="ml-auto px-4 py-2 rounded-lg bg-[#FFD700] text-black text-sm font-medium disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          第 1 位 = 該年至尊歌曲；公開頁會單獨展示各年第 1 位。無站內譜請用「無譜」填歌名歌手並揀 Spotify 封面。
        </p>

        <div className="space-y-8">
          {yearsList.map((year) => (
            <section key={year} className="border border-neutral-800 rounded-xl overflow-hidden bg-[#121212]">
              <h2 className="text-lg font-bold text-[#FFD700] px-4 py-3 bg-black/40 border-b border-neutral-800">{year} 年度</h2>
              <ul className="divide-y divide-neutral-800">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pos) => {
                  const c = cells[cellKey(year, pos)]
                  let label = '— 未填'
                  if (c?.source === 'tab' && c.tabId) {
                    label = tabLabels[c.tabId] || `譜 ID: ${c.tabId}`
                  } else if (c?.source === 'external') {
                    label = `${c.title || '（無標題）'} · ${c.artistName || ''}${c.spotifyUrl ? ' · Spotify' : ''}`
                  }
                  const posLabel = pos === 1 ? `第 ${pos} 位（至尊）` : `第 ${pos} 位`
                  return (
                    <li key={pos} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3">
                      <span className="text-neutral-500 text-sm w-28 shrink-0">{posLabel}</span>
                      <span className="text-white text-sm flex-1 min-w-0 truncate">{label}</span>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openPickTab(year, pos)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#282828] text-white text-xs hover:bg-[#3E3E3E]"
                        >
                          <Music className="w-3.5 h-3.5" /> 揀站內譜
                        </button>
                        <button
                          type="button"
                          onClick={() => openExternal(year, pos)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#282828] text-white text-xs hover:bg-[#3E3E3E]"
                        >
                          無譜
                        </button>
                        {c && (
                          <button
                            type="button"
                            onClick={() => clearCell(year, pos)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-900/40 text-red-300 text-xs"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> 清除
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {/* 揀站內譜 */}
      {pickYear != null && pickPosition != null && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70" onClick={() => { setPickYear(null); setPickPosition(null) }}>
          <div className="bg-[#121212] w-full sm:max-w-lg sm:rounded-xl border border-neutral-700 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-neutral-800 flex items-center gap-2">
              <Search className="w-5 h-5 text-neutral-500" />
              <input
                value={pickQuery}
                onChange={(e) => setPickQuery(e.target.value)}
                placeholder="搜尋歌名／歌手…"
                className="flex-1 bg-black border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm"
              />
              <button type="button" className="text-neutral-400 text-sm" onClick={() => { setPickYear(null); setPickPosition(null) }}>
                關閉
              </button>
            </div>
            <ul className="overflow-y-auto flex-1 p-2">
              {pickListResults.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => applyTabPick(tab)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm text-white"
                  >
                    <span className="break-words">
                      {tab.title}
                      <span className="text-neutral-500">
                        {' '}
                        — {tab.artistName || tab.artist || artistMapRef.current.get(tab.artistId) || ''}
                      </span>
                      {(tab.uploaderPenName || '').trim() ? (
                        <span className="text-neutral-600"> · 出譜：{(tab.uploaderPenName || '').trim()}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 無譜：歌名歌手 → Spotify */}
      {externalOpen && extYear != null && extPosition != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setExternalOpen(false)}>
          <div className="bg-[#121212] w-full max-w-md rounded-xl border border-neutral-700 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium">
              無站內譜 · {extYear} 年第 {extPosition} 位
            </h3>
            <div>
              <label className="text-xs text-neutral-500">歌名</label>
              <input value={extTitle} onChange={(e) => setExtTitle(e.target.value)} className="w-full mt-1 px-3 py-2 bg-black border border-neutral-700 rounded-lg text-white" />
            </div>
            <div>
              <label className="text-xs text-neutral-500">歌手</label>
              <input value={extArtist} onChange={(e) => setExtArtist(e.target.value)} className="w-full mt-1 px-3 py-2 bg-black border border-neutral-700 rounded-lg text-white" />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-end">
              <button type="button" onClick={() => setExternalOpen(false)} className="px-4 py-2 text-neutral-400 order-3 sm:order-1">
                取消
              </button>
              <button
                type="button"
                onClick={() => commitExternalFields(false)}
                disabled={!extTitle.trim()}
                className="px-4 py-2 rounded-lg bg-[#282828] text-white text-sm disabled:opacity-50 order-2"
              >
                僅存歌名（無封面）
              </button>
              <button
                type="button"
                onClick={() => commitExternalFields(true)}
                disabled={!extTitle.trim()}
                className="px-4 py-2 rounded-lg bg-[#1DB954] text-white text-sm disabled:opacity-50 order-1 sm:order-3"
              >
                揀 Spotify 封面
              </button>
            </div>
          </div>
        </div>
      )}

      <SpotifyTrackSearch
        isOpen={spotifyOpen}
        onClose={() => setSpotifyOpen(false)}
        artistName={extArtist}
        songTitle={extTitle}
        onSelect={(data) => {
          if (extYear == null || extPosition == null) return
          const k = cellKey(extYear, extPosition)
          setCells((prev) => ({
            ...prev,
            [k]: {
              ...prev[k],
              entryId: prev[k]?.entryId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : k),
              year: extYear,
              position: extPosition,
              source: 'external',
              title: data.title || extTitle,
              artistName: data.artist || extArtist,
              coverUrl: data.albumImage || data.thumbnail || '',
              spotifyTrackId: data.spotifyTrackId || null,
              spotifyUrl: data.spotifyUrl || null
            }
          }))
          setSpotifyOpen(false)
        }}
      />
    </Layout>
  )
}

export default function Page() {
  return (
    <AdminGuard>
      <EditChaksaPlaylist />
    </AdminGuard>
  )
}
