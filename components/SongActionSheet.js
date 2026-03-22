/**
 * 歌曲「更多」底部彈出 Menu（統一規格）
 *
 * 規格：內容左對齊 1rem (px-4) / 把手 px-12 -mx-4 / 拖曳關閉 / 鎖 body 滾動 / 封面縮圖
 * 以後加「更多」掣請直接用此元件，唔好再複製貼上。
 *
 * @see AGENTS.md - 更多掣標準
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from '@/components/Link';
import { Copy, Heart, User, Pencil, Music } from 'lucide-react';
import { CONTENT_MAX_WIDTH_CLASS } from '@/lib/layoutConstants';

const InstagramIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" />
  </svg>
);

const DRAG_CLOSE_THRESHOLD = 80;
const getClientY = (e) => e.touches?.[0]?.clientY ?? e.clientY;

export default function SongActionSheet({
  open,
  onClose,
  title = '',
  artist = '',
  thumbnailUrl = null,
  liked = false,
  likeLabel = '加到我最喜愛',
  onCopyShareLink,
  onSelectLyricsShare,
  onAddToLiked,
  onAddToPlaylist,
  onEdit,
  artistHref,
  paddingBottom = 'calc(6rem + env(safe-area-inset-bottom, 0))'
}) {
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef(0);

  useEffect(() => {
    if (typeof document === 'undefined' || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleDragStart = (e) => {
    if (e.pointerType === 'mouse') return;
    touchStartY.current = getClientY(e);
    try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const handleDragMove = (e) => {
    if (e.pointerType === 'mouse') return;
    const delta = getClientY(e) - touchStartY.current;
    if (delta > 0) setDragY(Math.min(delta, 200));
  };
  const handleDragEnd = () => {
    if (dragY >= DRAG_CLOSE_THRESHOLD) {
      onClose?.();
      setDragY(0);
    } else setDragY(0);
  };

  const close = () => { onClose?.(); setDragY(0); };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/60 z-[9999]" onClick={close} aria-hidden />
      {/* 與 Layout 主欄同寬；兩側撳遮罩仍可關閉 */}
      <div className="fixed bottom-0 left-0 right-0 z-[9999] flex justify-center pointer-events-none">
        <div
          className={`pointer-events-auto w-full ${CONTENT_MAX_WIDTH_CLASS} bg-[#121212] rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden animate-slide-up`}
          style={{
            paddingBottom,
            transform: `translateY(${dragY}px)`,
            transition: dragY === 0 ? 'transform 0.2s ease-out' : 'none'
          }}
        >
        <div
          className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
          onTouchCancel={handleDragEnd}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          role="button"
          tabIndex={0}
          aria-label="向下拖曳關閉"
          onKeyDown={(e) => e.key === 'Enter' && close()}
        >
          <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
            <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
          </div>
        </div>
        <div className="pb-4 px-4 text-left">
          <div className="mb-4 pb-4 border-b border-[#3E3E3E] flex items-center gap-3">
            <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
              {thumbnailUrl ? (
                <img src={thumbnailUrl} alt={title} className="w-full h-full object-cover pointer-events-none" loading="lazy" decoding="async" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-medium truncate">{title}</p>
              <p className="text-neutral-400 text-sm truncate">{artist}</p>
            </div>
          </div>
          {onEdit && (
            <button type="button" onClick={onEdit} className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white">
              <span className="flex items-center gap-3">
                <Pencil className="w-5 h-5 text-[#B3B3B3]" />
                編輯結他譜
              </span>
            </button>
          )}
          <button type="button" onClick={onCopyShareLink} className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white">
            <span className="flex items-center gap-3">
              <Copy className="w-5 h-5 text-[#B3B3B3]" />
              複製分享連結
            </span>
          </button>
          <button type="button" onClick={onSelectLyricsShare} className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white">
            <span className="flex items-center gap-3">
              <InstagramIcon className="w-5 h-5 text-[#B3B3B3] shrink-0" />
              選取歌詞分享
            </span>
          </button>
          <button type="button" onClick={onAddToLiked} className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white">
            <span className="flex items-center gap-3">
              <Heart className={`w-5 h-5 text-[#FFD700] ${liked ? 'fill-[#FFD700]' : 'fill-none'}`} strokeWidth={1.5} />
              {likeLabel}
            </span>
          </button>
          <button type="button" onClick={onAddToPlaylist} className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white">
            <span className="flex items-center gap-3">
              <svg className="w-5 h-5 text-[#B3B3B3] shrink-0" viewBox="0 0 8.7 8.7" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" strokeMiterlimit={10} aria-hidden>
                <circle cx="4.4" cy="4.4" r="4" />
                <line x1="2.2" y1="4.4" x2="6.5" y2="4.4" />
                <line x1="4.4" y1="2.2" x2="4.4" y2="6.5" />
              </svg>
              加入歌單
            </span>
          </button>
          {artistHref && (
            <Link href={artistHref} onClick={close} className="w-full flex items-center justify-between py-3.5 rounded-2xl text-left pl-0 pr-4 md:hover:bg-white/5 transition text-white">
              <span className="flex items-center gap-3">
                <User className="w-5 h-5 text-[#B3B3B3]" />
                瀏覽歌手
              </span>
            </Link>
          )}
        </div>
        </div>
      </div>
    </>,
    document.body
  );
}
