// components/RecentItems.js
import Link from '@/components/Link';
import { useAuth } from '@/contexts/AuthContext';
import { useArtistMap, resolveHomeSongArtistLine } from '@/lib/useArtistMap';
import { User, Music, BookmarkPlus, Heart } from 'lucide-react';

function getItemHref(item) {
  if (item.type === 'tab') return `/tabs/${item.id}`;
  if (item.type === 'artist') return `/artists/${item.id}`;
  if (item.type === 'playlist') return `/playlist/${item.id}`;
  if (item.type === 'liked-songs') return '/library/liked';
  return '#';
}

export default function RecentItems({ items = [], title = '最近瀏覽' }) {
  const { user } = useAuth();
  const { getArtistName, artistMap } = useArtistMap();

  // 過濾：如果用戶未登入，過濾掉 liked-songs
  const displayItems = user 
    ? items 
    : items.filter(item => item.type !== 'liked-songs');

  return (
    <div className="mb-[23px] md:mb-[25px] mt-2.5">
      <div className="flex justify-between items-end mb-2 pr-6" style={{ paddingLeft: '1rem' }}>
        <h2 className="text-white font-bold text-[1.3rem] md:text-[1.375rem]">{title}</h2>
        <Link 
          href="/library/recent-tabs?from=home"
          className="text-[#B3B3B3] text-sm hover:text-white"
        >
          瀏覽全部
        </Link>
      </div>
      
      <div className="overflow-x-auto scrollbar-hide" data-drag-scroll>
        <div className="flex gap-3 md:gap-4 pr-6" style={{ paddingLeft: '1rem' }}>
          {displayItems.length === 0 ? (
            <p className="text-[#B3B3B3] text-sm py-2">暫無瀏覽記錄</p>
          ) : displayItems.map((item, index) => (
            <Link 
              key={index}
              href={getItemHref(item)}
              className="flex-shrink-0 cursor-pointer w-[26vw] md:w-32"
            >
              {/* 圖片區域 */}
              <div className={`
                relative overflow-hidden mb-2 bg-[#121212]
                ${item.type === 'artist' ? 'rounded-full aspect-square' : 'rounded-[4px] aspect-square'}
              `}>
                {(item.thumbnail || item.image) ? (
                  <img 
                    src={item.thumbnail || item.image} 
                    alt={item.title}
                    className="w-full h-full object-cover pointer-events-none"
                  />
                ) : item.type === 'liked-songs' ? (
                  // 我的喜愛特殊樣式
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#FFD700] to-[#FFA500]">
                    <Heart className="w-10 h-10 text-white fill-white" />
                  </div>
                ) : item.type === 'artist' ? (
                  <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
                    <User className="w-8 h-8 text-[#3E3E3E]" />
                  </div>
                ) : item.type === 'playlist' ? (
                  <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
                    <BookmarkPlus className="w-8 h-8 text-[#3E3E3E]" />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
                    <Music className="w-8 h-8 text-[#3E3E3E]" />
                  </div>
                )}
                
                {/* 歌單2x2預覽（如果有 covers） */}
                {item.type === 'playlist' && item.covers && item.covers.length > 0 && (
                  <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-0.5 bg-[#121212]">
                    {item.covers.map((cover, i) => (
                      <img key={i} src={cover} className="w-full h-full object-cover" alt="" />
                    ))}
                    {Array(4 - item.covers.length).fill(0).map((_, i) => (
                      <div key={`empty-${i}`} className="bg-[#282828] w-full h-full" />
                    ))}
                  </div>
                )}
              </div>
              
              {/* 文字資訊 */}
              <div className="text-left">
                <div className="text-white font-medium truncate text-[0.95rem] md:text-[15px] leading-[1.3] md:leading-[1.33] mb-[1px] md:mb-0">
                  {item.type === 'artist'
                    ? (getArtistName({ artistId: item.id }) || item.title || '')
                    : item.title}
                </div>
                <div className="text-[#B3B3B3] truncate text-[0.8rem] md:text-[13px] leading-[1.3]">
                  {item.type === 'tab'
                    ? resolveHomeSongArtistLine(item, artistMap)
                    : item.type === 'artist'
                      ? '歌手'
                      : (item.subtitle || item.artistName || '')}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
