import Link from '@/components/Link'
import { useState } from 'react'
import Skeleton from './Skeleton'
import { Music } from 'lucide-react'

export default function TabCard({ tab, compact = false, artistPhoto = null }) {
  // 計算歌手的 normalizedName 用于链接
  const artistNormalizedName = tab.artistId || tab.artist?.toLowerCase().replace(/\s+/g, '-')
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  
  // 獲取封面圖 - 優先順序：Spotify > YouTube > 歌手相 > fallback
  const getCoverImage = () => {
    if (tab.albumImage && !imageError) return tab.albumImage
    if (tab.youtubeVideoId && !imageError) return `https://img.youtube.com/vi/${tab.youtubeVideoId}/mqdefault.jpg`
    if (tab.youtubeUrl && !imageError) {
      const match = tab.youtubeUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)
      if (match) return `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`
    }
    if (tab.thumbnail && !imageError) return tab.thumbnail
    if (artistPhoto && !imageError) return artistPhoto
    return null
  }
  
  const coverImage = getCoverImage()

  if (compact) {
    // 簡潔模式 - 用於個人主頁列表
    return (
      <Link href={`/tabs/${tab.slug ?? tab.id}`}>
        <div className="flex items-center gap-3 p-3 bg-neutral-900 rounded-lg hover:bg-neutral-800 transition cursor-pointer">
          {/* 縮圖區域 - 骨架屏或圖片 */}
          <div className="w-14 h-10 rounded bg-[#282828] overflow-hidden flex-shrink-0">
            {tab.thumbnail && (
              <>
                {!imageLoaded && <Skeleton className="w-full h-full" />}
                <img
                  src={tab.thumbnail}
                  alt={tab.title}
                  loading="lazy"
                  decoding="async"
                  className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                />
              </>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-medium truncate">{tab.title}</h3>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[#FFD700]">{tab.artist}</span>
              {tab.originalKey && (
                <span className="text-neutral-500">· Key: {tab.originalKey}</span>
              )}
            </div>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="bg-[#121212] rounded-lg shadow-md overflow-hidden border border-neutral-800">
      {/* 封面圖片 */}
      <Link href={`/tabs/${tab.slug ?? tab.id}`}>
        <div className="w-full aspect-square bg-[#282828] overflow-hidden cursor-pointer relative">
          {coverImage ? (
            <>
              {/* 骨架屏 - 圖片載入前顯示 */}
              {!imageLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Skeleton className="w-full h-full absolute inset-0" />
                  <Music className="w-10 h-10 text-neutral-500 mb-2 relative z-10" strokeWidth={1.5} />
                  <span className="text-xs text-neutral-500 text-center px-4 relative z-10">{tab.artist}</span>
                </div>
              )}
              <img
                src={coverImage}
                alt={tab.title}
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-cover hover:scale-105 transition-all duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
              <Music className="w-10 h-10 text-neutral-500 mb-2" strokeWidth={1.5} />
              <span className="text-xs text-neutral-500 text-center px-4">{tab.artist}</span>
            </div>
          )}
        </div>
      </Link>
      
      <div className="p-4">
      {/* 歌名 */}
      <Link href={`/tabs/${tab.slug ?? tab.id}`}>
        <h3 className="text-lg font-bold text-white mb-2 line-clamp-1 cursor-pointer hover:text-[#FFD700] transition">
          {tab.title}
        </h3>
      </Link>
      
      {/* 歌手 Badge */}
      <p className="mb-3">
        <Link href={`/artists/${artistNormalizedName}`}>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFD700] text-black hover:opacity-80 cursor-pointer transition">
            {tab.artist}
          </span>
        </Link>
      </p>
      
      {/* 分隔線 */}
      <div className="border-t border-neutral-800 my-3"></div>
      
      {/* 譜資料 - 瀏覽次數 & Key */}
      <div className="flex items-center gap-3 mb-3 text-sm">
        {/* 瀏覽次數 */}
        <span className="flex items-center gap-1 text-[#B3B3B3]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>{(tab.viewCount || 0).toLocaleString()}</span>
        </span>
        
        <span className="text-neutral-600">|</span>
        
        {/* Key */}
        <span className="flex items-center gap-1 text-[#B3B3B3]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
          </svg>
          <span className="text-[#FFD700] font-medium">{tab.originalKey || 'C'}</span>
        </span>
        
        {/* 讚數 (如果有的話) */}
        {tab.likes > 0 && (
          <>
            <span className="text-neutral-600">|</span>
            <span className="flex items-center gap-1 text-[#B3B3B3]">
              <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
              </svg>
              <span>{tab.likes}</span>
            </span>
          </>
        )}
      </div>
      
      {/* 底部 - 日期 */}
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {new Date(tab.createdAt).toLocaleDateString('zh-HK')}
        </span>
      </div>
      </div>{/* 關閉 p-4 */}
    </div>
  )
}
