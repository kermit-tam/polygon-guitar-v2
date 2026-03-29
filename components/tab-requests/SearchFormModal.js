import { useState, useEffect } from 'react'
import MusicNoteIcon from '@/components/icons/MusicNoteIcon'

const SPOTIFY_ICON = (
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
)

const YOUTUBE_ICON = (
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
)

const SPOTIFY_BADGE = (
  <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full flex items-center gap-1">
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
    Spotify
  </span>
)

const YOUTUBE_BADGE = (
  <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-full flex items-center gap-1">
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
    YouTube
  </span>
)

export default function SearchFormModal({ onClose, onSubmit, submitting, initialSongTitle = '', initialArtistName = '' }) {
  const [formData, setFormData] = useState({ songTitle: '', artistName: '' })
  const [searchResults, setSearchResults] = useState(null)
  const [multipleResults, setMultipleResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchSource, setSearchSource] = useState(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  useEffect(() => {
    setFormData({
      songTitle: initialSongTitle || '',
      artistName: initialArtistName || ''
    })
    setSearchResults(null)
    setMultipleResults([])
    setSearchSource(null)
    setShowConfirmModal(false)
    setSearching(false)
  }, [initialSongTitle, initialArtistName])

  const buildQuery = () =>
    formData.songTitle && formData.artistName
      ? `${formData.songTitle} ${formData.artistName}`
      : formData.songTitle || formData.artistName

  const searchYouTube = async () => {
    if (!formData.songTitle) return
    setSearching(true)
    setSearchSource(null)
    setMultipleResults([])
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(buildQuery())}`)
      const data = await res.json()
      if (data.video) {
        setSearchResults({
          title: formData.songTitle || data.video.title,
          artist: formData.artistName || '',
          albumImage: data.video.thumbnail,
          albumName: null,
          youtubeUrl: `https://youtube.com/watch?v=${data.video.id}`,
        })
        setSearchSource('youtube')
      } else {
        setShowConfirmModal(true)
        setSearchResults({ title: formData.songTitle, artist: formData.artistName, albumImage: null, albumName: null, youtubeUrl: null })
        setSearchSource('manual')
      }
    } catch {
      setShowConfirmModal(true)
      setSearchResults({ title: formData.songTitle, artist: formData.artistName, albumImage: null, albumName: null, youtubeUrl: null })
      setSearchSource('manual')
    } finally {
      setSearching(false)
    }
  }

  const searchSong = async () => {
    if (!formData.songTitle) return
    setSearching(true)
    setSearchSource(null)
    setMultipleResults([])
    try {
      const spotifyRes = await fetch(`/api/spotify/search-track?q=${encodeURIComponent(buildQuery())}`)
      const spotifyData = await spotifyRes.json()

      if (spotifyData.results?.length > 0) {
        if (spotifyData.results.length === 1) {
          const track = spotifyData.results[0]
          setSearchResults({
            title: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            albumImage: track.albumImage,
            albumName: track.album,
            youtubeUrl: null,
            spotifyId: track.id,
          })
          setSearchSource('spotify')
        } else {
          setMultipleResults(spotifyData.results)
          setSearchSource('multiple')
        }
        setSearching(false)
        return
      }

      try {
        const ytRes = await fetch(`/api/youtube/search?q=${encodeURIComponent(buildQuery())}`)
        const ytData = await ytRes.json()
        if (ytData.error === 'quotaExceeded') {
          console.warn('YouTube API quota exceeded, falling back to manual')
        } else if (ytData.video) {
          setSearchResults({
            title: formData.songTitle || ytData.video.title,
            artist: formData.artistName || '',
            albumImage: ytData.video.thumbnail,
            albumName: null,
            youtubeUrl: `https://youtube.com/watch?v=${ytData.video.id}`,
          })
          setSearchSource('youtube')
          setSearching(false)
          return
        }
      } catch (e) {
        console.error('YouTube search error:', e)
      }

      setShowConfirmModal(true)
      setSearchResults({ title: formData.songTitle || '', artist: formData.artistName || '', albumImage: null, albumName: null, youtubeUrl: null })
      setSearchSource('manual')
    } catch {
      setShowConfirmModal(true)
      setSearchResults({ title: formData.songTitle || '', artist: formData.artistName || '', albumImage: null, albumName: null, youtubeUrl: null })
      setSearchSource('manual')
    } finally {
      setSearching(false)
    }
  }

  const handleConfirmSubmit = () => {
    if (!searchResults) return
    onSubmit({ searchResults, searchSource })
  }

  const selectTrack = (track) => {
    setSearchResults({
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      albumImage: track.albumImage,
      albumName: track.album,
      youtubeUrl: null,
      spotifyId: track.id,
    })
    setSearchSource('spotify')
    setMultipleResults([])
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4 pointer-events-auto">
      <div className="bg-[#121212] rounded-2xl w-full max-w-md overflow-hidden">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">提交求譜</h2>
          <button onClick={onClose} className="text-neutral-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-neutral-400 text-sm mb-2">歌名</label>
            <input
              type="text"
              value={formData.songTitle}
              onChange={(e) => setFormData({ ...formData, songTitle: e.target.value })}
              className="w-full bg-[#282828] border-0 rounded-full px-4 py-3 text-white placeholder-[#666] outline-none"
              placeholder="輸入歌名"
            />
          </div>

          <div>
            <label className="block text-neutral-400 text-sm mb-2">歌手（選填）</label>
            <input
              type="text"
              value={formData.artistName}
              onChange={(e) => setFormData({ ...formData, artistName: e.target.value })}
              className="w-full bg-[#282828] border-0 rounded-full px-4 py-3 text-white placeholder-[#666] outline-none"
              placeholder="輸入歌手名"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={searchSong}
              disabled={!formData.songTitle || searching}
              className="flex-1 py-3 px-4 bg-[#1DB954] text-white rounded-full font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {SPOTIFY_ICON}
              <span>{searching ? '搜尋中...' : '搜尋(推薦)'}</span>
            </button>
            <button
              onClick={searchYouTube}
              disabled={!formData.songTitle || searching}
              className="flex-1 py-3 px-4 bg-[#FF0000] text-white rounded-full font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {YOUTUBE_ICON}
              <span>{searching ? '搜尋中...' : '搜尋'}</span>
            </button>
          </div>

          {/* Multiple results */}
          {multipleResults.length > 0 && searchSource === 'multiple' && (
            <div className="bg-[#1a1a1a] rounded-xl p-4">
              <div className="space-y-2 max-h-64 overflow-y-auto overflow-x-hidden overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                {multipleResults.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => selectTrack(track)}
                    className="w-full flex items-center gap-2 py-3 px-2.5 bg-[#282828] hover:bg-[#333] rounded-lg transition text-left touch-manipulation min-h-[3.5rem]"
                  >
                    <div className="w-10 h-10 bg-[#1a1a1a] rounded overflow-hidden flex-shrink-0">
                      {track.albumImage ? (
                        <img src={track.albumImage} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600"><MusicNoteIcon className="w-5 h-5" /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-medium text-sm truncate">{track.name}</div>
                      <div className="text-neutral-500 text-xs truncate">{track.artists.map(a => a.name).join(', ')}</div>
                      <div className="text-neutral-600 text-xs truncate">{track.album} {track.releaseYear && `(${track.releaseYear})`}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search result preview */}
          {searchResults && !showConfirmModal && searchSource !== 'multiple' && (
            <div className="bg-[#1a1a1a] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                {searchSource === 'spotify' && SPOTIFY_BADGE}
                {searchSource === 'youtube' && YOUTUBE_BADGE}
              </div>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-[#282828] rounded-lg overflow-hidden flex-shrink-0">
                  {searchResults.albumImage ? (
                    <img src={searchResults.albumImage} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MusicNoteIcon className="w-8 h-8 text-neutral-600" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium truncate">{searchResults.title}</div>
                  <div className="text-neutral-500 text-sm truncate">{searchResults.artist}</div>
                  {searchResults.albumName && (
                    <div className="text-neutral-600 text-xs truncate">{searchResults.albumName}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Not-found confirmation */}
          {showConfirmModal && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-yellow-400 font-medium text-sm">找不到這首歌</p>
                  <p className="text-neutral-400 text-xs mt-1">
                    在 Spotify 和 YouTube 上都找不到「{formData.songTitle} - {formData.artistName}」。
                  </p>
                  <p className="text-neutral-500 text-xs mt-2">可能原因：</p>
                  <ul className="text-neutral-500 text-xs mt-1 list-disc list-inside">
                    <li>歌名或歌手名輸入錯誤</li>
                    <li>歌曲尚未在這些平台發布</li>
                    <li>YouTube 搜尋配額暫時用完</li>
                  </ul>
                  <p className="text-neutral-400 text-xs mt-3 font-medium">
                    你確定要使用這個歌名和歌手名提交求譜嗎？
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => { setShowConfirmModal(false); setSearchResults(null); setSearchSource(null); }}
                  className="flex-1 py-2 bg-[#282828] text-white rounded-lg text-sm"
                >
                  返回修改
                </button>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium"
                >
                  確定提交
                </button>
              </div>
            </div>
          )}

          {searchResults && !showConfirmModal && (
            <button
              onClick={handleConfirmSubmit}
              disabled={submitting}
              className="w-full py-3 bg-[#FFD700] text-black rounded-xl font-bold disabled:opacity-50"
            >
              {submitting ? '提交中...' : '確認求譜'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
