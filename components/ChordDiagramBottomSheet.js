/**
 * 從底 nav bar 向上彈出嘅和弦 Menu
 * 完全跟設計：白線指板、黃色手指圈+黑字、和弦名白膠囊
 * 撳指法圖可開 pop up：置中標題 + 2 欄網格揀 alternative；單擊＝預覽（黃框），**雙擊**＝選定並關閉
 */
import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, Volume2, X } from 'lucide-react';
import { getChordShape, getChordAlternatives } from '@/lib/chordDb';
import { playChord } from '@/lib/chordPlayback';
import { CONTENT_MAX_WIDTH_CLASS, CHORD_SHEET_SURFACE_BG } from '@/lib/layoutConstants';

const ChordDiagramSvg = dynamic(() => import('./ChordDiagramSvg'), { ssr: false });

/** 與 Layout 底部 nav 對齊：h-16 + nav 嘅 paddingBottom(safe-area)；樂譜頁 FAB 對位用 */
export const BOTTOM_NAV_OFFSET =
  'calc(4rem + min(env(safe-area-inset-bottom, 0px), 30px))';

/** 手機：面板最高比例；桌面見 CHORD_SHEET_MAX_HEIGHT */
export const CHORD_SHEET_MAX_HEIGHT_MOBILE = '30vh';
/** md 及以上：面板最高比例；亦作樂譜頁 FAB fallback（未量度 px 時） */
export const CHORD_SHEET_MAX_HEIGHT = '35vh';

/** bottom sheet 內指法圖闊度（px）— 整體縮細時一齊改 */
const CHORD_DIAGRAM_SIZE = 84;
/** 揀指法 pop up：2×2（或 2 欄換行）網格內每格指法圖 */
const ALT_PICKER_GRID_DIAGRAM_SIZE = 102;
/** 與 modal 內底、ChordDiagramSvg surfaceColor 必須一致，避免 hover/選中時出現「兩種灰」 */
const ALT_PICKER_PANEL_BG = '#1a1a1a';

/** 若 lead 唔在本曲列表（抽出規則與譜面顯示唔一致時），插入最前 */
function ensureLeadInChordList(uniq, lead) {
  if (!lead) return uniq;
  const t = lead.trim();
  if (!t) return uniq;
  const lower = t.toLowerCase();
  const has = uniq.some((c) => c === t || c.toLowerCase() === lower);
  if (has) return uniq;
  return [t, ...uniq];
}

/** 將 lead 排到第一（仍顯示全部 unique 和弦） */
function orderChordsWithLeadFirst(uniq, lead) {
  if (!lead || !uniq.length) return uniq;
  const t = lead.trim();
  const idx = uniq.findIndex((c) => c === t || c.toLowerCase() === t.toLowerCase());
  if (idx <= 0) return uniq;
  const next = [...uniq];
  const [picked] = next.splice(idx, 1);
  return [picked, ...next];
}

function resolveChordResultForSheet(chord, alternatives, altSelection) {
  if (!alternatives?.list?.length) return null;
  const idx = altSelection[chord] ?? alternatives.defaultIndex ?? 0;
  return alternatives.list[idx] ?? alternatives.list[alternatives.defaultIndex] ?? null;
}

function resolvePlaybackShapeForSheet(chord, alternatives, altSelection) {
  const r = resolveChordResultForSheet(chord, alternatives, altSelection);
  return r?.playbackShape ?? getChordShape(chord);
}

export default function ChordDiagramBottomSheet({
  chords,
  isOpen,
  onClose,
  theme = 'dark',
  onSheetHeightChange,
  /** 由譜內點字傳入：該和弦排第一，膠囊改黃色；FAB 開啟時唔傳 */
  leadChord = null,
}) {
  const sheetRef = useRef(null);
  const carouselRef = useRef(null);
  /** 邊個和弦開緊「揀指法」pop up */
  const [pickerChord, setPickerChord] = useState(null);
  /** chord 字串 → 已揀 alternative index */
  const [altSelection, setAltSelection] = useState({});
  /** pop up 內目前睇緊第幾式（0-based） */
  const [pickerSlideIndex, setPickerSlideIndex] = useState(0);
  /** 橫向 carousel 是否仍可向左／右捲（控制兩旁箭嘴） */
  const [scrollEdges, setScrollEdges] = useState({ canLeft: false, canRight: false });

  const uniqueChords = useMemo(() => {
    let u = [...new Set(chords || [])];
    u = ensureLeadInChordList(u, leadChord);
    return orderChordsWithLeadFirst(u, leadChord);
  }, [chords, leadChord]);

  const alternativesByChord = useMemo(() => {
    const m = {};
    for (const c of uniqueChords) {
      m[c] = getChordAlternatives(c);
    }
    return m;
  }, [uniqueChords]);

  /** 開 pop up 時：游標對齊已揀／預設指法 */
  useEffect(() => {
    if (!pickerChord) return;
    const d = alternativesByChord[pickerChord];
    if (!d?.list?.length) return;
    const start = altSelection[pickerChord] ?? d.defaultIndex;
    const idx = Math.min(Math.max(0, start), d.list.length - 1);
    setPickerSlideIndex(idx);
  }, [pickerChord, alternativesByChord, altSelection]);

  const leadTrim = leadChord?.trim() ?? '';

  /** 開啟時由譜內點入：carousel 回到最左睇第一個（lead） */
  useEffect(() => {
    if (!isOpen || !leadTrim) return;
    const id = requestAnimationFrame(() => {
      if (carouselRef.current) carouselRef.current.scrollLeft = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, leadTrim, uniqueChords]);

  const updateScrollEdges = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = Math.max(0, scrollWidth - clientWidth);
    const eps = 2;
    setScrollEdges({
      canLeft: scrollLeft > eps,
      canRight: scrollLeft < maxScroll - eps,
    });
  }, []);

  /** 內容闊度／捲動變化時更新箭嘴顯示 */
  useEffect(() => {
    if (!isOpen) return;
    const el = carouselRef.current;
    if (!el) return;
    updateScrollEdges();
    el.addEventListener('scroll', updateScrollEdges, { passive: true });
    const ro = new ResizeObserver(() => {
      updateScrollEdges();
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollEdges);
      ro.disconnect();
    };
  }, [isOpen, uniqueChords.join(','), updateScrollEdges]);

  const scrollCarouselBy = useCallback((dir) => {
    const el = carouselRef.current;
    if (!el) return;
    const delta = Math.min(Math.round(el.clientWidth * 0.65), 280) * dir;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  const reportHeight = useCallback(() => {
    const el = sheetRef.current;
    if (!el || !onSheetHeightChange) return;
    const h = el.getBoundingClientRect().height;
    if (h > 0) onSheetHeightChange(h);
  }, [onSheetHeightChange]);

  /** DOM 掛載後量度實際高度（maxHeight 唔等於實際高度，避免 FAB 同面板頂部空隙過大） */
  useEffect(() => {
    if (!isOpen || !onSheetHeightChange) return;
    const el = sheetRef.current;
    if (!el) return;
    reportHeight();
    const ro = new ResizeObserver(() => {
      reportHeight();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [isOpen, onSheetHeightChange, uniqueChords.join(','), theme, reportHeight]);

  // Intentionally not locking body scroll — overflow:hidden on body breaks position:sticky on the tab page top nav.
  // overscroll-behavior:contain on the chord list container prevents scroll from escaping the sheet.

  /** 必須喺 `if (!isOpen) return` 之前：Rules of Hooks 要每次 render 呼叫數量一致 */
  const pickerData = pickerChord ? alternativesByChord[pickerChord] : null;
  const showAltPicker =
    pickerChord && pickerData && pickerData.list.length > 1;

  const selectPickerAlt = useCallback((idx) => {
    if (!pickerChord || !pickerData?.list?.length) return;
    const n = pickerData.list.length;
    const next = Math.min(Math.max(0, idx), n - 1);
    setPickerSlideIndex(next);
    setAltSelection((prev) => ({ ...prev, [pickerChord]: next }));
  }, [pickerChord, pickerData]);

  const pickerLen = pickerData?.list?.length ?? 0;
  const safeSlide =
    pickerLen > 0
      ? Math.min(Math.max(0, pickerSlideIndex), pickerLen - 1)
      : 0;

  if (!isOpen) return null;

  return (
    <>
      {/* 揀 alternative：置中大和弦名 + 2 欄網格（常見 2×2）+ 黃框表示已揀 */}
      {showAltPicker && pickerData?.list?.length > 0 && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-4 bg-black/55 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chord-alt-picker-title"
          onClick={() => setPickerChord(null)}
        >
          <div
            className="relative w-full max-w-[min(300px,88vw)] rounded-xl px-3 pt-3 pb-3 shadow-xl border border-neutral-700/90"
            style={{ backgroundColor: ALT_PICKER_PANEL_BG }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 標題同 X 同一行：左右等寬，標題視覺置中 */}
            <div className="flex items-center gap-1.5 pb-2">
              <div className="w-8 shrink-0" aria-hidden />
              <h2
                id="chord-alt-picker-title"
                className="min-w-0 flex-1 text-center text-base sm:text-lg font-medium tracking-tight text-white"
              >
                {pickerChord}
              </h2>
              <button
                type="button"
                onClick={() => setPickerChord(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/10 hover:text-white"
                aria-label="關閉"
              >
                <X className="w-[18px] h-[18px]" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
              {pickerData.list.map((entry, idx) => {
                const isSelected = safeSlide === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => selectPickerAlt(idx)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      selectPickerAlt(idx);
                      setPickerChord(null);
                    }}
                    className={[
                      'touch-manipulation flex flex-col items-center justify-center rounded-xl px-1.5 py-0.5 transition-[border-color,box-shadow]',
                      'border focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FFD700]/60',
                      // 同面板同色：唔好用 hover:bg-* / 選中 bg-*，否則同 SVG # 底疊出兩種灰；預覽黃框用 1px，唔用 border-2
                      isSelected
                        ? 'border-[#FFD700]/90'
                        : 'border-transparent hover:border-white/20',
                    ].join(' ')}
                    style={{ backgroundColor: ALT_PICKER_PANEL_BG }}
                    aria-label={`指法 ${idx + 1}，共 ${pickerData.list.length} 種；按兩下確定並關閉`}
                    aria-pressed={isSelected}
                  >
                    <ChordDiagramSvg
                      chord={pickerChord}
                      chordResult={entry}
                      size={ALT_PICKER_GRID_DIAGRAM_SIZE}
                      theme={theme}
                      accentColor="#ffd807"
                      showPlayButton={false}
                      compactVertical
                      surfaceColor={ALT_PICKER_PANEL_BG}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 唔加全螢幕遮罩：否則 z-[105] 會擋晒後面（樂譜、FAB 等）；收合用本曲和弦 FAB */}
      <div
        className="fixed left-0 right-0 z-[1100] flex justify-center pointer-events-none"
        style={{ bottom: BOTTOM_NAV_OFFSET }}
      >
        <div
          ref={sheetRef}
          className={`pointer-events-auto max-h-[30vh] md:max-h-[35vh] w-full ${CONTENT_MAX_WIDTH_CLASS} flex flex-col overflow-hidden animate-slide-up`}
          style={{
            backgroundColor: CHORD_SHEET_SURFACE_BG,
            paddingBottom: '0.5rem',
          }}
        >
        {/* Carousel：橫向滾動；箭嘴僅 md+ 桌面（hover／focus-within）。觸控／手機照舊唔顯示箭嘴，用橫滑即可 */}
        <div className="relative group/chordCarousel z-0">
          {scrollEdges.canLeft && (
            <button
              type="button"
              onClick={() => scrollCarouselBy(-1)}
              className="hidden md:flex absolute left-0 top-0 bottom-0 z-10 w-10 items-center justify-center rounded-none border-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent pl-0.5 text-white opacity-0 pointer-events-none transition-opacity duration-200 group-hover/chordCarousel:opacity-100 group-hover/chordCarousel:pointer-events-auto group-focus-within/chordCarousel:opacity-100 group-focus-within/chordCarousel:pointer-events-auto hover:from-black/70"
              style={{ paddingTop: '0.25rem', paddingBottom: '0.375rem' }}
              aria-label="和弦列表向左捲"
            >
              <ChevronLeft className="h-7 w-7 shrink-0 drop-shadow-md" strokeWidth={2.25} aria-hidden />
            </button>
          )}
          {scrollEdges.canRight && (
            <button
              type="button"
              onClick={() => scrollCarouselBy(1)}
              className="hidden md:flex absolute right-0 top-0 bottom-0 z-10 w-10 items-center justify-center rounded-none border-0 bg-gradient-to-l from-black/55 via-black/25 to-transparent pr-0.5 text-white opacity-0 pointer-events-none transition-opacity duration-200 group-hover/chordCarousel:opacity-100 group-hover/chordCarousel:pointer-events-auto group-focus-within/chordCarousel:opacity-100 group-focus-within/chordCarousel:pointer-events-auto hover:from-black/70"
              style={{ paddingTop: '0.25rem', paddingBottom: '0.375rem' }}
              aria-label="和弦列表向右捲"
            >
              <ChevronRight className="h-7 w-7 shrink-0 drop-shadow-md" strokeWidth={2.25} aria-hidden />
            </button>
          )}
        <div
          ref={carouselRef}
          className="flex overflow-x-auto gap-3 px-3 pt-1 pb-1.5 scroll-smooth scrollbar-hide snap-x snap-mandatory"
          style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        >
          {uniqueChords.map((chord, index) => {
            const alts = alternativesByChord[chord];
            const resolved = resolveChordResultForSheet(chord, alts, altSelection);
            const canPickAlt = alts && alts.list.length > 1;
            return (
            <div
              key={index}
              className="flex-shrink-0 snap-center flex flex-col items-center gap-0"
              style={{ minWidth: `min(${Math.round(CHORD_DIAGRAM_SIZE * 1.2)}px, 32vw)` }}
            >
              {/* 指法圖：有 alternative 時撳開揀指法 pop up */}
              <button
                type="button"
                className={`relative border-0 bg-transparent p-0 ${canPickAlt ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => {
                  if (canPickAlt) setPickerChord(chord);
                }}
                disabled={!canPickAlt}
                aria-label={
                  canPickAlt
                    ? `${chord}：揀其他指法`
                    : `${chord} 指法圖`
                }
              >
                <ChordDiagramSvg
                  chord={chord}
                  chordResult={resolved ?? undefined}
                  size={CHORD_DIAGRAM_SIZE}
                  theme={theme}
                  accentColor="#ffd807"
                  showPlayButton={false}
                  compactVertical
                  surfaceColor={CHORD_SHEET_SURFACE_BG}
                />
              </button>
              {/* 和弦名 - 白膠囊（撳聽結他和弦聲）；lead 和弦黃底 */}
              <button
                type="button"
                onClick={() => {
                  const shape = resolvePlaybackShapeForSheet(chord, alts, altSelection);
                  if (shape) void playChord(shape);
                }}
                className={`inline-flex h-4 w-[4.5rem] max-w-[4.5rem] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-0 px-1 text-center text-xs font-medium leading-none transition active:scale-[0.97] active:opacity-90 ${
                  leadTrim && (chord === leadTrim || chord.toLowerCase() === leadTrim.toLowerCase())
                    ? 'bg-[#FFD700] text-black'
                    : 'bg-white text-black'
                }`}
                title={`${chord} — 撳聽聲`}
                aria-label={`播放 ${chord} 和弦`}
              >
                {/* 固定膠囊闊度；內層貼住「和弦字+喇叭」再整組置中 */}
                <span className="inline-flex min-w-0 max-w-full items-center gap-0.5">
                  <span className="min-w-0 truncate">{chord}</span>
                  <Volume2 className="h-2.5 w-2.5 shrink-0 opacity-75" strokeWidth={2.5} aria-hidden />
                </span>
              </button>
            </div>
            );
          })}
        </div>
        </div>
        </div>
      </div>
    </>
  );
}
