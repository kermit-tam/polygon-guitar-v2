import Link from '@/components/Link'
import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Music } from 'lucide-react'
import { checkIsLiked, toggleLikeSong } from '@/lib/playlistApi'

// 解析譜內容中的 keys
function parseKeys(content) {
  if (!content) return []
  
  const keys = new Set()
  const lines = content.split('\n')
  
  lines.forEach(line => {
    // 匹配 [Key: X] 或 Key: X 格式
    const match = line.match(/\[?Key:\s*([A-G][#b]?m?)\]?/i)
    if (match) {
      keys.add(match[1])
    }
  })
  
  return Array.from(keys)
}

// 提取 YouTube Video ID
function extractYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

// 取得歌曲縮圖 - 順序：YouTube > 歌手相片 > Fallback
function getSongThumbnail(tab) {
  // 1. 優先使用 YouTube 縮圖
  if (tab.youtubeUrl) {
    const videoId = extractYouTubeId(tab.youtubeUrl)
    if (videoId) {
      return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    }
  }
  
  // 2. 其次使用歌曲自己的縮圖
  if (tab.thumbnail) return tab.thumbnail
  if (tab.coverImage) return tab.coverImage
  
  // 3. 使用歌手圖片
  if (tab.artistPhoto) return tab.artistPhoto
  if (tab.artistPhotoURL) return tab.artistPhotoURL
  if (tab.wikiPhotoURL) return tab.wikiPhotoURL
  
  // 4. 預設 fallback
  return null
}

const LOGIN_MESSAGE = '請先登入後即可收藏喜愛的結他譜'

// 單首歌曲項目（包含收藏功能，會加入收藏頁「喜愛結他譜」）
function SongItem({ song, index, artistPhoto }) {
  const { user, isAuthenticated } = useAuth()
  const [isLiked, setIsLiked] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const likeCount = song.likes || 0

  useEffect(() => {
    if (!song?.id || !user?.uid) {
      setIsLiked(false)
      return
    }
    let cancelled = false
    checkIsLiked(user.uid, song.id).then((liked) => {
      if (!cancelled) setIsLiked(liked)
    })
    return () => { cancelled = true }
  }, [song?.id, user?.uid])

  const keys = parseKeys(song.content)
  const thumbnail = getSongThumbnail(song) || artistPhoto
  const rank = index + 1

  const handleLike = async (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (!isAuthenticated || !user) {
      alert(LOGIN_MESSAGE)
      return
    }

    if (isLoading) return

    setIsLoading(true)
    try {
      const result = await toggleLikeSong(user.uid, song.id)
      setIsLiked(result.isLiked)
    } catch (error) {
      console.error('Like error:', error)
      alert('收藏失敗，請重試')
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <Link
      href={`/tabs/${song.slug ?? song.id}`}
      className="flex items-center gap-3 p-3 hover:bg-neutral-800/50 transition group"
    >
      {/* 排名數字 - 縮細版 */}
      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
        <span className={`
          text-xs font-bold
          ${rank === 1 ? 'text-[#FFD700]' : 
            rank === 2 ? 'text-neutral-300' : 
            rank === 3 ? 'text-amber-600' : 'text-neutral-500'}
        `}>
          {rank}
        </span>
      </div>

      {/* 歌曲縮圖 */}
      <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-neutral-800">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={song.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#FFD700]/20 to-orange-500/20">
            <Music className="w-5 h-5 text-neutral-500" strokeWidth={1.5} />
          </div>
        )}
      </div>

      {/* 歌曲資訊 */}
      <div className="flex-1 min-w-0">
        <h4 className="text-white font-medium truncate group-hover:text-[#FFD700] transition">
          {song.title}
        </h4>
        <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
          <span>{(song.viewCount || 0).toLocaleString()} 瀏覽</span>
          {likeCount > 0 && (
            <>
              <span>•</span>
              <span className="flex items-center gap-0.5">
                <svg className="w-3 h-3 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                </svg>
                {likeCount}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Key 徽章 - 單行滾動 */}
      {keys.length > 0 && (
        <div className="flex-shrink-0 flex gap-1 overflow-x-auto scrollbar-hide max-w-[120px]">
          {keys.slice(0, 3).map((key, i) => (
            <span 
              key={i}
              className="flex-shrink-0 w-8 h-8 md:w-9 md:h-9 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-bold text-[#FFD700]"
            >
              {key}
            </span>
          ))}
          {keys.length > 3 && (
            <span className="flex-shrink-0 w-8 h-8 md:w-9 md:h-9 rounded-full bg-neutral-800 flex items-center justify-center text-xs text-neutral-400">
              +{keys.length - 3}
            </span>
          )}
        </div>
      )}

      {/* 加到最愛按鈕 */}
      <button
        onClick={handleLike}
        disabled={isLoading}
        className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition ${
          isLiked 
            ? 'bg-red-500/20 text-red-500' 
            : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-white'
        } ${isLoading ? 'opacity-50' : ''}`}
        title={isLiked ? '已收藏至喜愛結他譜' : '收藏至喜愛結他譜'}
      >
        <svg 
          className={`w-5 h-5 ${isLiked ? 'fill-current' : 'stroke-current fill-none'}`}
          viewBox="0 0 24 24"
          strokeWidth="2"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" 
          />
        </svg>
      </button>

      {/* 箭頭 */}
      <div className="flex-shrink-0 text-neutral-600 group-hover:text-[#FFD700] transition">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}

export default function ArtistSongsList({ songs, artistPhoto }) {
  if (!songs || songs.length === 0) return null

  return (
    <div className="bg-[#121212] rounded-xl border border-neutral-800 overflow-hidden">
      <div className="p-4 border-b border-neutral-800">
        <h3 className="text-lg font-bold text-white">熱門歌曲</h3>
      </div>
      
      <div className="divide-y divide-neutral-800">
        {songs.map((song, index) => (
          <SongItem 
            key={song.id}
            song={song}
            index={index}
            artistPhoto={artistPhoto}
          />
        ))}
      </div>
    </div>
  )
}
