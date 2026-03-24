import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import Link from '@/components/Link'
import Layout from '@/components/Layout'
import { useAuth } from '@/contexts/AuthContext'
import { addSongToPlaylist } from '@/lib/playlistApi'
import { getSearchHistory, addSearchHistorySong, addSearchHistoryArtist, addSearchHistoryPlaylist, updateSongEntryThumbnail, clearSearchHistory, removeSearchHistoryEntry } from '@/lib/searchHistory'
import { getSongThumbnail } from '@/lib/getSongThumbnail'
import { getTab, getArtistSlug } from '@/lib/tabs'
import { ArrowLeft, Music, Mic, ListMusic, User } from 'lucide-react'

const STORAGE_KEY = 'searchPageData'
const CACHE_TTL = 45 * 1000 // 45s — changes visible within 1 min
const FRESH_TTL = 60 * 1000        // 1 min 內唔再 fetch

function readCache() {
  try {
    const raw = typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.ts > CACHE_TTL) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(data) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, ts: Date.now() }))
    }
  } catch {}
}

export default function Search() {
  const router = useRouter()
  const { user } = useAuth()
  const addToPlaylistId = router.query.addToPlaylist
  const [searchQuery, setSearchQuery] = useState('')
  const [addingToPlaylist, setAddingToPlaylist] = useState(null)
  const [songs, setSongs] = useState([])
  const [artists, setArtists] = useState([])
  const [playlists, setPlaylists] = useState([])
  const [users, setUsers] = useState([])
  const [filteredSongs, setFilteredSongs] = useState([])
  const [filteredArtists, setFilteredArtists] = useState([])
  const [filteredPlaylists, setFilteredPlaylists] = useState([])
  const [filteredUsers, setFilteredUsers] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchHistory, setSearchHistory] = useState([])
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const inputRef = useRef(null)
  const thumbnailBackfillRequested = useRef(new Set())

  const artistMapRef = useRef(new Map())

  const applyData = useCallback((data) => {
    const artistList = data.artists || []
    const map = new Map()
    artistList.forEach(a => { if (a.id && a.name) map.set(a.id, a.name) })
    artistMapRef.current = map
    setSongs(data.tabs || [])
    setArtists(artistList)
    setPlaylists(data.playlists || [])
    setUsers(data.users || [])
  }, [])

  useEffect(() => {
    let cancelled = false
    const cached = readCache()
    if (cached) {
      applyData(cached)
      setIsLoading(false)
      if (Date.now() - cached.ts < FRESH_TTL) return
    }
    fetch('/api/search-data')
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText || 'Search data failed')
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        if (data.error) throw new Error(data.message || data.error)
        applyData(data)
        writeCache(data)
      })
      .catch((err) => {
        if (!cancelled) console.error('Error loading search data:', err)
        try { if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY) } catch {}
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [applyData])

  const getArtistName = useCallback((song) => {
    if (song.artist) return song.artist
    return artistMapRef.current.get(song.artistId) || song.artistId || ''
  }, [])

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredSongs([])
      setFilteredArtists([])
      setFilteredPlaylists([])
      setFilteredUsers([])
      return
    }
    const q = searchQuery.trim().toLowerCase()
    const showAllPlaylists = q === '歌單'
    setFilteredSongs(
      showAllPlaylists ? [] : songs.filter(
        (song) => {
          const artistName = getArtistName(song)
          return song.title?.toLowerCase().includes(q) ||
          (artistName && artistName.toLowerCase().includes(q)) ||
          (song.composer && song.composer.toLowerCase().includes(q)) ||
          (song.lyricist && song.lyricist.toLowerCase().includes(q)) ||
          (song.arranger && song.arranger.toLowerCase().includes(q)) ||
          (song.uploaderPenName && song.uploaderPenName.toLowerCase().includes(q))
        }
      )
    )
    setFilteredArtists(showAllPlaylists ? [] : artists.filter((artist) => artist.name?.toLowerCase().includes(q)))
    setFilteredPlaylists(
      showAllPlaylists ? playlists : playlists.filter(
        (pl) =>
          pl.title?.toLowerCase().includes(q) ||
          (pl.description && pl.description.toLowerCase().includes(q))
      )
    )
    setFilteredUsers(
      showAllPlaylists ? [] : users.filter(
        (u) =>
          (u.displayName && u.displayName.toLowerCase().includes(q)) ||
          (u.penName && u.penName.toLowerCase().includes(q))
      )
    )
  }, [searchQuery, songs, artists, playlists, users])

  // 載入時自動 focus 搜尋欄；iPhone Safari 除外（避免 zoom/自動點擊問題）
  const isIOSSafari = typeof navigator !== 'undefined' &&
    /iPhone|iPod/.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try { sessionStorage.removeItem('pg_focus_search') } catch (_) {}
    const isIOSSafari = /iPhone|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
    if (isIOSSafari) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchHistory(getSearchHistory())
    }
  }, [searchQuery])

  // 冇圖嘅記錄：向 Firebase 取一次，寫入 localStorage，之後都從 localStorage 讀
  useEffect(() => {
    if (searchQuery.trim() !== '') return
    const list = searchHistory
    list.forEach((entry) => {
      if (entry.type !== 'song' || entry.thumbnail) return
      if (thumbnailBackfillRequested.current.has(entry.id)) return
      thumbnailBackfillRequested.current.add(entry.id)
      ;(async () => {
        try {
          const tab = await getTab(entry.id)
          const url = tab ? getSongThumbnail(tab) : null
          if (url) {
            updateSongEntryThumbnail(entry.id, url)
            setSearchHistory(getSearchHistory())
          }
        } catch (_) {}
      })()
    })
  }, [searchQuery, searchHistory])

  const handleSongClick = async (song) => {
    const songId = song?.id ?? song
    if (addToPlaylistId && user?.uid) {
      setAddingToPlaylist(songId)
      try {
        await addSongToPlaylist(addToPlaylistId, songId)
        router.push(`/library/playlist/${addToPlaylistId}`)
      } catch (e) {
        console.error(e)
        alert('加入失敗，請重試')
      } finally {
        setAddingToPlaylist(null)
      }
      return
    }
    if (typeof song === 'object' && song?.id) {
      addSearchHistorySong({
        id: song.id,
        title: song.title,
        artistId: song.artistId,
        thumbnail: getSongThumbnail(song),
        uploaderPenName: song.uploaderPenName,
      })
    }
    router.push(`/tabs/${songId}`)
  }

  const handleArtistClick = (artist) => {
    addSearchHistoryArtist(artist)
    router.push(`/artists/${encodeURIComponent(getArtistSlug(artist) || artist.id)}`)
  }

  const handlePlaylistClick = (pl) => {
    addSearchHistoryPlaylist(pl)
    router.push(`/playlist/${pl.id}`)
  }

  const getArtistPhoto = (artist) => {
    return artist?.photoURL || artist?.wikiPhotoURL || artist?.photo || null
  }

  const hasResults = searchQuery.trim() !== ''

  return (
    <Layout hideHeader>
      <div
        className={`bg-black pb-24 ${!(hasResults || searchHistory.length > 0) ? 'h-screen overflow-hidden' : ''}`}
      >
        {/* 搜尋欄固定喺頂部 */}
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-black"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="max-w-[1050px] mx-auto">
          <div className="flex items-center gap-2 pt-4 pb-2" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <div className="relative flex-1 min-w-0">
              <input
                ref={inputRef}
                type="text"
                placeholder="有咩想彈？"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                className="w-full pl-11 pr-10 py-2 bg-[#282828] border-0 rounded-full text-white placeholder-[#666] outline-none transition text-base"
                autoFocus={!isIOSSafari}
              />
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#FFD700]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#666] hover:text-white p-1"
                  aria-label="清除"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-shrink-0 inline-flex items-center justify-center text-white hover:text-white/90 transition p-1.5 rounded-full md:hover:bg-white/10"
              aria-label="返回"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          </div>
          {isSearchFocused && (
            <div className="flex gap-2 pb-1" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
              <p className="flex-1 min-w-0 pl-11 text-left text-xs text-[#FFD700]">
                可輸入 歌名／歌手／歌單名／出譜者／作曲／作詞／編曲 搜尋
              </p>
              <div className="flex-shrink-0 w-8" aria-hidden="true" />
            </div>
          )}
          {addToPlaylistId && (
            <p className="px-4 py-2 text-sm text-[#FFD700] bg-[#282828] rounded-lg mx-4 mb-2">
              為歌單加歌：揀一首會加入歌單並返回
            </p>
          )}
          </div>
        </div>

        {/* 搜尋記錄（無輸入時顯示，統一列表） */}
        {!hasResults && searchHistory.length > 0 && (
          <div
            className="pl-4 pr-4"
            style={{ paddingTop: 'calc(5.5rem + env(safe-area-inset-top, 0px))' }}
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="font-bold text-white truncate text-[1.3rem] md:text-[1.375rem]">
                搜尋記錄
              </h2>
              <button
                type="button"
                onClick={() => { clearSearchHistory(); setSearchHistory([]) }}
                className="text-[12px] md:text-[14px] text-neutral-500 hover:text-white whitespace-nowrap flex-shrink-0 transition"
              >
                清除記錄
              </button>
            </div>
            <div className="space-y-0">
              {searchHistory.map((entry) => {
                const handleRemove = (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  removeSearchHistoryEntry(entry.type, entry.id)
                  setSearchHistory(getSearchHistory())
                }
                if (entry.type === 'song') {
                  const songFromCatalog = songs.find((s) => s.id === entry.id)
                  const uploaderDisplay = entry.uploaderName || (songFromCatalog && songFromCatalog.uploaderPenName) || ''
                  const thumbnailDisplay = entry.thumbnail || (songFromCatalog && getSongThumbnail(songFromCatalog)) || null
                  return (
                    <div key={`song-${entry.id}`} className="group flex items-center rounded-lg md:hover:bg-white/5 md:transition">
                      <Link
                        href={`/tabs/${entry.id}`}
                        className="flex-1 min-w-0 flex items-center gap-3 py-2 pl-0 text-left"
                      >
                        <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
                          {thumbnailDisplay ? (
                            <img src={thumbnailDisplay} alt={entry.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <span className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-medium truncate md:group-hover:text-[#FFD700] md:transition">{entry.title}</h3>
                          <p className="text-sm text-neutral-500 truncate">{entry.artist || getArtistName(entry)}</p>
                        </div>
                        {uploaderDisplay ? (
                          <span className="flex-shrink-0 text-xs text-[#999] truncate max-w-[80px] text-right">{uploaderDisplay}</span>
                        ) : null}
                      </Link>
                      <button type="button" onClick={handleRemove} className="flex-shrink-0 p-2 text-neutral-600 hover:text-white transition" aria-label="刪除">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  )
                }
                if (entry.type === 'artist') {
                  return (
                    <div key={`artist-${entry.id}`} className="group flex items-center rounded-lg md:hover:bg-white/5 md:transition">
                      <Link
                        href={`/artists/${encodeURIComponent(getArtistSlug(entry) || entry.id)}`}
                        className="flex-1 min-w-0 flex items-center gap-3 py-2 pl-0 text-left"
                      >
                        <div className="w-[49px] h-[49px] rounded-full bg-neutral-800 flex-shrink-0 overflow-hidden">
                          {entry.photo ? (
                            <img src={entry.photo} alt={entry.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <span className="w-full h-full flex items-center justify-center text-neutral-500"><Mic className="w-6 h-6" strokeWidth={1.5} /></span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-medium truncate md:group-hover:text-[#FFD700] md:transition">{entry.name}</h3>
                          <p className="text-sm text-neutral-500 truncate">歌手</p>
                        </div>
                      </Link>
                      <button type="button" onClick={handleRemove} className="flex-shrink-0 p-2 text-neutral-600 hover:text-white transition" aria-label="刪除">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  )
                }
                if (entry.type === 'playlist') {
                  return (
                    <div key={`playlist-${entry.id}`} className="group flex items-center rounded-lg md:hover:bg-white/5 md:transition">
                      <Link
                        href={`/playlist/${entry.id}`}
                        className="flex-1 min-w-0 flex items-center gap-3 py-2 pl-0 text-left"
                      >
                        <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
                          {entry.coverImage ? (
                            <img src={entry.coverImage} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                          ) : (
                            <span className="w-full h-full flex items-center justify-center text-neutral-500"><ListMusic className="w-6 h-6" strokeWidth={1.5} /></span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-medium truncate md:group-hover:text-[#FFD700] md:transition">{entry.title}</h3>
                          <p className="text-sm text-neutral-500 truncate">歌單</p>
                        </div>
                      </Link>
                      <button type="button" onClick={handleRemove} className="flex-shrink-0 p-2 text-neutral-600 hover:text-white transition" aria-label="刪除">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  )
                }
                return null
              })}
            </div>
          </div>
        )}

        {/* 結果區域：留位俾固定搜尋欄 */}
        {hasResults && (
          <div
            className="space-y-5 pl-4 pr-4"
            style={{ paddingTop: 'calc(5.5rem + env(safe-area-inset-top, 0px))' }}
          >
            {filteredPlaylists.length > 0 && (
              <section>
                <h2 className="font-bold text-white mb-2 text-[1.3rem]">歌單</h2>
                <div className="-mx-4">
                  <div className="flex overflow-x-auto scrollbar-hide gap-3 px-4">
                    {filteredPlaylists.map((pl) => (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => handlePlaylistClick(pl)}
                        className="flex-shrink-0 flex flex-col items-center cursor-pointer"
                      >
                        <div className="w-20 h-20 rounded-[4px] overflow-hidden bg-neutral-800 mb-2">
                          {pl.coverImage ? (
                            <img src={pl.coverImage} alt="" className="w-full h-full object-cover pointer-events-none" loading="lazy" decoding="async" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-500"><ListMusic className="w-6 h-6" strokeWidth={1.5} /></div>
                          )}
                        </div>
                        <span className="text-sm text-neutral-300 truncate max-w-[80px] text-center">{pl.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {filteredArtists.length > 0 && (
              <section>
                <h2 className="font-bold text-white mb-2 text-[1.3rem]">歌手</h2>
                <div className="-mx-4">
                  <div className="flex overflow-x-auto scrollbar-hide gap-3 px-4">
                  {filteredArtists.map((artist) => (
                    <button
                      key={artist.id}
                      type="button"
                      onClick={() => handleArtistClick(artist)}
                      className="flex-shrink-0 flex flex-col items-center cursor-pointer"
                    >
                      <div className="w-20 h-20 rounded-full overflow-hidden bg-neutral-800 mb-2">
                        {getArtistPhoto(artist) ? (
                          <img
                            src={getArtistPhoto(artist)}
                            alt={artist.name}
                            className="w-full h-full object-cover pointer-events-none"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-500"><Mic className="w-6 h-6" strokeWidth={1.5} /></div>
                        )}
                      </div>
                      <span className="text-sm text-neutral-300 truncate max-w-[80px]">{artist.name}</span>
                    </button>
                  ))}
                  </div>
                </div>
              </section>
            )}

            {filteredUsers.length > 0 && (
              <section>
                <h2 className="font-bold text-white mb-2 text-[1.3rem]">用戶</h2>
                <div className="-mx-4">
                  <div className="flex overflow-x-auto scrollbar-hide gap-3 px-4">
                    {filteredUsers.map((u) => (
                      <Link
                        key={u.id}
                        href={`/profile/${u.id}`}
                        className="flex-shrink-0 flex flex-col items-center"
                      >
                        <div className="w-20 h-20 rounded-full overflow-hidden bg-neutral-800 mb-2">
                          {u.photoURL ? (
                            <img
                              src={u.photoURL}
                              alt={u.displayName || u.penName || '用戶'}
                              className="w-full h-full object-cover pointer-events-none"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-500"><User className="w-8 h-8" strokeWidth={1.5} /></div>
                          )}
                        </div>
                        <span className="text-sm text-neutral-300 truncate max-w-[80px] text-center">
                          {u.penName || u.displayName || '未命名用戶'}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {filteredSongs.length > 0 && (
              <section>
                <h2 className="font-bold text-white mb-0 text-[1.3rem]">歌曲</h2>
                <div className="space-y-0">
                  {filteredSongs.map((song) => {
                  const isAdding = addingToPlaylist === song.id
                  return (
                    <button
                      key={song.id}
                      type="button"
                      onClick={() => handleSongClick(song)}
                      disabled={isAdding}
                      className="w-full flex items-center gap-3 py-2 pr-3 pl-0 hover:bg-white/10 rounded-lg transition text-left disabled:opacity-70"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-medium truncate">{song.title}</h3>
                        <p className="text-sm text-neutral-500 truncate">{getArtistName(song)}</p>
                        {(song.composer || song.lyricist || song.arranger) && (
                          <p className="text-xs text-neutral-600 mt-0.5 truncate">
                            {song.composer && <span>曲：{song.composer} </span>}
                            {song.lyricist && <span>詞：{song.lyricist} </span>}
                            {song.arranger && <span>編：{song.arranger}</span>}
                          </p>
                        )}
                      </div>
                      <span className="flex-shrink-0 text-right">
                        {isAdding ? (
                          <span className="w-5 h-5 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin inline-block" />
                        ) : song.uploaderPenName ? (
                          <span className="text-xs text-[#999] truncate max-w-[80px] block">
                            {song.uploaderPenName}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
                </div>
              </section>
            )}

            {!isLoading && filteredSongs.length === 0 && filteredArtists.length === 0 && filteredPlaylists.length === 0 && filteredUsers.length === 0 && (
              <div className="text-center py-12">
                <span className="text-4xl mb-4 block">🔍</span>
                <p className="text-neutral-500">找不到「{searchQuery}」的結果</p>
              </div>
            )}
          </div>
        )}

        <style jsx global>{`
          .scrollbar-hide {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          .scrollbar-hide::-webkit-scrollbar {
            display: none;
          }
        `}</style>
      </div>
    </Layout>
  )
}
