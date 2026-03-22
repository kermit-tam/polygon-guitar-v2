'use client';

import { useEffect, useRef } from 'react';
import { ChordBox } from '@chordbook/charts';
import { getChordFromDb, getChordShape } from '@/lib/chordDb';
import { isChordUiDark } from '@/lib/chordUtils';
import { playChord } from '@/lib/chordPlayback';

/**
 * 指板和弦圖 - 完全跟 C chord SVG 設計
 * 弦線 #ccc、fret 線 #4d4d4d、黃點 #ffd807、黑字
 */
const DESIGN = {
  stringColor: '#ccc',
  fretColor: '#4d4d4d',
  fingerFill: '#ffd807',
  labelColor: '#000000',
  muteOpenStroke: '#ccc',
};

export default function ChordDiagramChordbook({ chord, size = 80, theme = 'dark', accentColor, showPlayButton = true, onCloseIconClick }) {
  const containerRef = useRef(null);
  const boxRef = useRef(null);
  const result = getChordFromDb(chord);
  const shape = getChordShape(chord);
  const isDark = isChordUiDark(theme);
  const strokeColor = accentColor ?? DESIGN.fingerFill;

  useEffect(() => {
    if (!containerRef.current) return;
    if (!result) {
      containerRef.current.innerHTML = '';
      return;
    }

    const { chordbook } = result;
    containerRef.current.innerHTML = '';

    try {
      const box = new ChordBox(containerRef.current, {
        width: size,
        height: size * 1.2,
        numFrets: chordbook.numFrets ?? 5,
        showTuning: false,
        defaultColor: strokeColor,
        strokeColor: strokeColor,
        stringColor: DESIGN.stringColor,
        fretColor: DESIGN.fretColor,
        bgColor: isDark ? '#1a1a1a' : '#ffffff',
        bridgeColor: DESIGN.stringColor,
        textColor: DESIGN.labelColor,
        labelColor: DESIGN.labelColor,
        circleRadius: size / 14,
      });

      boxRef.current = box;
      box.draw({
        chord: chordbook.chord,
        position: chordbook.position,
        positionText: chordbook.positionText,
        barres: chordbook.barres ?? [],
        tuning: chordbook.tuning ?? [],
      });

      // 移走 ChordBox 內建 position 數字，保留自訂 2fr
      if (chordbook.position > 1) {
        requestAnimationFrame(() => {
          const svg = containerRef.current?.querySelector('svg');
          const posStr = String(chordbook.position);
          svg?.querySelectorAll('text').forEach((el) => {
            if ((el.textContent || '').trim() === posStr) el.remove();
          });
        });
      }

      // Barre 改藥丸型 + 設計稿顏色修補
      requestAnimationFrame(() => {
        const svg = containerRef.current?.querySelector('svg');
        if (!svg) return;
        if (chordbook.barres?.length > 0) {
          svg.querySelectorAll('rect').forEach((rect) => {
            const w = parseFloat(rect.getAttribute('width')) || 0;
            const h = parseFloat(rect.getAttribute('height')) || 0;
            if (w > h && h > 0) {
              rect.setAttribute('rx', String(h / 2));
              rect.setAttribute('ry', String(h / 2));
            }
          });
        }
        // Mute (X) 改為 #ccc：短嘅 line 係 X，長嘅係 grid
        svg.querySelectorAll('line').forEach((line) => {
          const x1 = parseFloat(line.getAttribute('x1') || 0);
          const y1 = parseFloat(line.getAttribute('y1') || 0);
          const x2 = parseFloat(line.getAttribute('x2') || 0);
          const y2 = parseFloat(line.getAttribute('y2') || 0);
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len < 15) line.setAttribute('stroke', DESIGN.muteOpenStroke);
        });
        // Open (O) 弦：fill=bgColor 嘅圓，stroke 改 #ccc
        const bg = isDark ? '#1a1a1a' : '#ffffff';
        svg.querySelectorAll('circle').forEach((c) => {
          const f = (c.getAttribute('fill') || '').toLowerCase();
          if (f === bg || f === 'none') {
            c.setAttribute('stroke', DESIGN.muteOpenStroke);
          }
        });
      });
    } catch (err) {
      console.warn('ChordDiagramChordbook render error:', err);
    }

    return () => { boxRef.current = null; };
  }, [chord, result, size, theme, strokeColor, isDark]);

  if (!result) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-lg ${isDark ? 'bg-neutral-800' : 'bg-neutral-200'}`} style={{ width: size, height: size * 1.2 }}>
        <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>{chord}</span>
      </div>
    );
  }

  const handlePlay = (e) => {
    e.stopPropagation();
    if (shape) playChord(shape);
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center" style={{ width: size, height: size * 1.2 }}>
      {/* 左上角灰色 X（符合設計） */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCloseIconClick?.(); }}
        className="absolute left-0 top-0 z-10 flex items-center justify-center w-6 h-6 text-neutral-500 hover:text-neutral-400 transition"
        aria-label="關閉"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* 自訂 fret 標籤 */}
      {(result.chordbook.position > 1 || (result.chordbook.barres?.length > 0 && result.chordbook.position >= 1)) && (
        <span
          className="absolute left-0.5 top-[45%] -translate-y-1/2 text-[6px] font-medium z-10"
          style={{ color: strokeColor }}
        >
          {result.chordbook.position}fr
        </span>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {showPlayButton && shape && (
        <button
          type="button"
          onClick={handlePlay}
          className="absolute bottom-0 right-0 p-1 rounded-full bg-[#FFD700]/90 hover:bg-[#FFD700] text-black transition"
          title="播放和弦"
          aria-label="播放和弦"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </div>
  );
}
