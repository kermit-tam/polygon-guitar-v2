import { useState, useContext } from 'react'
import Link from '@/components/Link'
import Skeleton from './Skeleton'
import { HomeSectionImageContext } from './HomeSectionImageContext'
import { Music, Mic, Crown } from 'lucide-react'

/**
 * LazyImage - 帶骨架屏的延遲載入圖片
 * 
 * @param {string} src - 圖片 URL
 * @param {string} alt - 圖片描述
 * @param {string} className - 圖片樣式
 * @param {string} containerClassName - 容器樣式
 * @param {function} onClick - 點擊事件
 * @param {ReactNode} fallback - 載入失敗或無圖片時的顯示內容
 * @param {ReactNode} skeleton - 自定義骨架屏
 * @param {boolean} priority - 是否優先載入（不使用 lazy）
 */
export default function LazyImage({
  src,
  alt = '',
  className = '',
  containerClassName = '',
  onClick,
  fallback,
  skeleton,
  priority = false
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  // 如果沒有圖片或載入失敗，顯示 fallback
  if (!src || error) {
    return (
      <div 
        className={`${containerClassName} flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900`}
        onClick={onClick}
      >
        {fallback || <Music className="w-10 h-10 text-neutral-500" strokeWidth={1.5} />}
      </div>
    )
  }

  return (
    <div 
      className={`${containerClassName} relative overflow-hidden bg-[#282828]`}
      onClick={onClick}
    >
      {/* 骨架屏 - 圖片載入前顯示 */}
      {!loaded && (
        <div className="absolute inset-0 z-10">
          {skeleton || <Skeleton className="w-full h-full" />}
        </div>
      )}
      
      <img
        src={src}
        alt={alt}
        className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  )
}

/**
 * SongCard - 帶骨架屏的歌曲卡片
 * Respects HomeSectionImageContext: when false (section not in viewport), shows placeholder only.
 * compact: use 32vw size to match 最近瀏覽 carousel.
 */
export function SongCard({ song, artistPhoto, onClick, href, compact, rank }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const loadImages = useContext(HomeSectionImageContext)

  // 獲取封面圖 — 同 tab 頁面統一優先順序
  const getCoverImage = () => {
    if (song.coverImage) return song.coverImage
    if (song.albumImage) return song.albumImage
    const videoId = song.youtubeVideoId || song.youtubeUrl?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1]
    if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    if (song.thumbnail) return song.thumbnail
    if (artistPhoto) return artistPhoto
    return null
  }

  const coverImage = getCoverImage()
  const showRealImage = loadImages && coverImage
  const sizeClass = compact ? 'w-[32vw] h-[32vw] md:w-36 md:h-36' : 'w-36 h-36'
  const roundedClass = compact ? 'rounded-[4px]' : 'rounded-lg'

  const Wrapper = href ? Link : 'button'
  const wrapperProps = href ? { href } : { onClick }

  return (
    <Wrapper
      {...wrapperProps}
      className={`flex-shrink-0 flex flex-col text-left group relative ${compact ? 'w-[32vw] md:w-36' : 'w-36'}`}
    >
      {/* 排名徽章 — 在 overflow-hidden 外層，可跨越封面邊界 */}
      {rank != null && (
        <div className={`absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 rounded-full flex items-center justify-center z-30 pointer-events-none shadow-md ${rank === 1 ? 'bg-[#FFD700]' : 'bg-black'}`}>
          {rank === 1
            ? <Crown className="text-black" strokeWidth={2.5} style={{ width: 13, height: 13, marginTop: -1.5 }} />
            : <span className="text-white font-medium leading-none" style={{ fontSize: 13, marginTop: -1.5 }}>{rank}</span>
          }
        </div>
      )}
      {/* 封面區域 */}
      <div className={`${sizeClass} ${roundedClass} overflow-hidden bg-[#282828] mb-2 shadow-lg relative transition-transform duration-200 active:scale-105 active:z-20`}>
        {showRealImage ? (
          <>
            {/* 骨架屏 */}
            {!imageLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#282828] z-10">
                <Music className="w-8 h-8 text-neutral-500 mb-1" strokeWidth={1.5} />
                <span className="text-[10px] text-neutral-500 text-center px-2 line-clamp-1">
                  {song.artist}
                </span>
              </div>
            )}
            <img
              src={coverImage}
              alt={song.title}
              className={`w-full h-full object-cover transition-all duration-300 pointer-events-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageLoaded(true)}
            />
          </>
        ) : coverImage ? (
          /* Section not in viewport yet: placeholder only (no img request) */
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#282828]">
            <Music className="w-8 h-8 text-neutral-500 mb-1" strokeWidth={1.5} />
            <span className="text-[10px] text-neutral-500 text-center px-2 line-clamp-1">
              {song.artist}
            </span>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
            <Music className="w-10 h-10 text-neutral-500 mb-1" strokeWidth={1.5} />
            <span className="text-[10px] text-neutral-500 text-center px-2 line-clamp-1">
              {song.artist}
            </span>
          </div>
        )}
      </div>
      
      <div className="text-white font-medium truncate text-[0.95rem] md:text-[15px] leading-[1.3] md:leading-[1.33] mb-[1px] md:mb-0">
        {song.title}
      </div>
      <div className="text-neutral-500 truncate text-[0.8rem] md:text-[13px] leading-[1.3]">{song.artist}</div>
    </Wrapper>
  )
}

/**
 * PlaylistCard - 帶骨架屏的歌單卡片
 * Respects HomeSectionImageContext: when false, shows placeholder only.
 * compact: use 32vw size to match 最近瀏覽 carousel.
 */
export function PlaylistCard({ playlist, onClick, href, compact, small }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const loadImages = useContext(HomeSectionImageContext)

  const coverImage = playlist.coverImage || null
  const showRealImage = loadImages && coverImage
  const sizeClass = compact
    ? (small ? 'w-[24vw] h-[24vw] md:w-28 md:h-28' : 'w-[32vw] h-[32vw] md:w-36 md:h-36')
    : 'w-36 h-36'
  const wrapperWidthClass = compact ? (small ? 'w-[24vw] md:w-28' : 'w-[32vw] md:w-36') : 'w-36'
  const roundedClass = compact ? 'rounded-[4px]' : 'rounded-lg'

  const Wrapper = href ? Link : 'button'
  const wrapperProps = href ? { href } : { onClick }

  return (
    <Wrapper
      {...wrapperProps}
      className={`flex-shrink-0 flex flex-col text-left group ${wrapperWidthClass}`}
    >
      {/* 封面區域 */}
      <div className={`${sizeClass} ${roundedClass} overflow-hidden bg-[#282828] mb-2 shadow-lg relative transition-transform duration-200 active:scale-105 active:z-20`}>
        {showRealImage ? (
          <>
            {/* 骨架屏 */}
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#282828] z-10">
                <Music className="w-8 h-8 text-neutral-500" strokeWidth={1.5} />
              </div>
            )}
            <img
              src={coverImage}
              alt={playlist.title}
              className={`w-full h-full object-cover transition-all duration-300 pointer-events-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageLoaded(true)}
            />
          </>
        ) : coverImage ? (
          <div className="w-full h-full flex items-center justify-center bg-[#282828]">
            <Music className="w-8 h-8 text-neutral-500" strokeWidth={1.5} />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
            <Music className="w-10 h-10 text-neutral-500" strokeWidth={1.5} />
          </div>
        )}
      </div>
      
      <div className="text-white font-medium truncate text-[0.95rem] md:text-[15px] leading-[1.3] md:leading-[1.33] mb-[1px] md:mb-0">
        {playlist.title}
      </div>
      {typeof playlist.description === 'string' && playlist.description.trim() && (
        <div className="text-neutral-500 line-clamp-2 text-[0.8rem] md:text-[13px] leading-[1.3]">{playlist.description.trim()}</div>
      )}
    </Wrapper>
  )
}

/**
 * ArtistAvatar - 帶骨架屏的歌手頭像
 * Respects HomeSectionImageContext: when false, shows placeholder only.
 * compact: use 32vw size to match 最近瀏覽 carousel.
 */
export function ArtistAvatar({ artist, onClick, href, compact }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const loadImages = useContext(HomeSectionImageContext)

  const photoUrl = artist.photo ?? artist.photoURL ?? artist.wikiPhotoURL
  const showRealImage = loadImages && photoUrl
  const sizeClass = compact ? 'w-[32vw] h-[32vw] md:w-36 md:h-36' : 'w-36 h-36'

  const Wrapper = href ? Link : 'button'
  const wrapperProps = href ? { href } : { onClick }

  return (
    <Wrapper
      {...wrapperProps}
      className={`flex-shrink-0 flex flex-col text-left group ${compact ? 'w-[32vw] md:w-36' : 'w-36'}`}
    >
      <div className={`${sizeClass} rounded-full overflow-hidden bg-[#282828] mb-2 shadow-lg relative transition-transform duration-200 active:scale-105 active:z-20`}>
        {showRealImage ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#282828] z-10">
                <Mic className="w-8 h-8 text-neutral-500 mb-1" strokeWidth={1.5} />
              </div>
            )}
            <img
              src={photoUrl}
              alt={artist.name}
              className={`w-full h-full object-cover transition-all duration-300 pointer-events-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageLoaded(true)}
            />
          </>
        ) : photoUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-[#282828]">
            <Mic className="w-8 h-8 text-neutral-500 mb-1" strokeWidth={1.5} />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
            <Mic className="w-10 h-10 text-neutral-500 mb-1" strokeWidth={1.5} />
          </div>
        )}
      </div>
      
      <div className="text-white font-medium truncate text-[0.95rem] md:text-[15px] leading-[1.3] md:leading-[1.33] mb-[1px] md:mb-0">
        {artist.name}
      </div>
    </Wrapper>
  )
}
