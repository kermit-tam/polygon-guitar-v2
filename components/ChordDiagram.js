import { useState } from 'react';
import { getChordShape, isChordUiDark, extractChords } from '@/lib/chordUtils';
import { playChord } from '@/lib/chordPlayback';

// Re-export 供外部使用
export { isChordUiDark, getChordShape, extractChords };

// 單個和弦顯示（淨係名 + 播放掣，冇指法圖）
function ChordItem({ chord, theme = 'dark', size = 'normal', showPlayButton = false }) {
  const shape = getChordShape(chord);
  const canPlay = !!shape;
  const isDark = isChordUiDark(theme);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`font-medium ${isDark ? 'text-white' : 'text-neutral-900'}`} style={{ fontSize: size === 'compact' ? '0.75rem' : '0.875rem' }}>
        {chord}
      </span>
      {showPlayButton && canPlay && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            playChord(shape);
          }}
          className={`p-1.5 rounded-full transition ${isDark ? 'bg-neutral-800 hover:bg-[#FFD700] hover:text-black text-neutral-400' : 'bg-neutral-200 hover:bg-[#7C3AED] hover:text-white text-neutral-600'}`}
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

// 兼容：SingleChordDiagram 改為淨顯示名 + 播掣（冇指法圖）
export function SingleChordDiagram({ chord, size = 80, theme = 'dark', accentColor, showPlayButton = false }) {
  return <ChordItem chord={chord} theme={theme} showPlayButton={showPlayButton} size={size > 60 ? 'normal' : 'compact'} />;
}

// 所有和弦彈窗（淨名 + 播放掣）
export function ChordDiagramModal({ chords, isOpen, onClose, theme = 'dark' }) {
  if (!isOpen) return null;

  const isDark = isChordUiDark(theme);
  const uniqueChords = [...new Set(chords)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden ${isDark ? 'bg-[#121212]' : 'bg-white'}`}>
        <div className="flex items-center justify-between p-4 border-b border-neutral-700">
          <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
            本曲使用和弦 ({uniqueChords.length}個)
          </h2>
          <button onClick={onClose} className="p-2 text-neutral-400 hover:text-white transition" aria-label="關閉">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
            {uniqueChords.map((chord, index) => (
              <div key={index} className="flex flex-col items-center">
                <ChordItem chord={chord} theme={theme} showPlayButton />
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 border-t border-neutral-700 text-center">
          <button onClick={onClose} className="px-6 py-2 bg-[#FFD700] text-black rounded-lg font-light hover:opacity-90 transition">
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

// Hover 只顯示和弦名；預設撳掣播放 — 若傳 onChordPress 則改為自訂（例如樂譜頁彈出指法圖）
export function ChordWithHover({ chord, theme = 'dark', displayFont = 'mono', chordColor, onChordPress }) {
  const shape = getChordShape(chord);
  const isDark = isChordUiDark(theme);
  const accent = chordColor ?? (isDark ? '#FFD700' : '#7C3AED');
  const fontFamily = displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', monospace";

  /** 樂譜頁傳 onChordPress 時：即使 chords-db 無試聽 shape，仍要可撳開指法／和弦 sheet */
  if (!shape && !onChordPress) {
    return <span className="font-light" style={{ fontFamily, color: accent }}>{chord}</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (onChordPress) {
          onChordPress(chord);
        } else if (shape) {
          playChord(shape);
        }
      }}
      className="font-light hover:underline cursor-pointer text-left bg-transparent border-0 p-0"
      style={{ fontFamily, color: accent }}
      title={
        onChordPress
          ? '撳此顯示指法圖'
          : shape
            ? '撳此播放和弦'
            : undefined
      }
    >
      {chord}
    </button>
  );
}

// 可 hover 的和弦行組件
export function ChordLineWithHover({ chordLine, prefix, suffix, fontSize, theme = 'dark', displayFont = 'mono', chordColor, prefixSuffixColor, onChordPress }) {
  const isDark = isChordUiDark(theme);
  const colors = {
    chord: chordColor ?? (isDark ? '#FFD700' : '#7C3AED'),
    prefixSuffix: prefixSuffixColor ?? (isDark ? '#B3B3B3' : '#666'),
  };
  const fontFamily = displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', monospace";

  const parts = [];
  const chordPattern = /\b[A-G][#b]?(maj|mj|m|min|dim|aug|sus|add|m7|maj7|7|9|11|13)?(\/[A-G][#b]?)?(?=\s|$|\||\b)/g;
  let lastIndex = 0;
  let tempMatch;
  const tempLine = chordLine;
  while ((tempMatch = chordPattern.exec(tempLine)) !== null) {
    if (tempMatch.index > lastIndex) {
      parts.push({ type: 'text', content: tempLine.slice(lastIndex, tempMatch.index) });
    }
    parts.push({ type: 'chord', content: tempMatch[0] });
    lastIndex = tempMatch.index + tempMatch[0].length;
  }
  if (lastIndex < tempLine.length) {
    parts.push({ type: 'text', content: tempLine.slice(lastIndex) });
  }

  return (
    <div
      className="font-light"
      style={{ fontSize: `${fontSize}px`, whiteSpace: 'pre-wrap', marginBottom: '0.1em', lineHeight: '1.2', fontWeight: 300, fontFamily }}
    >
      {prefix && <span style={{ color: colors.prefixSuffix, fontStyle: 'italic', fontSize: `${fontSize * 0.85}px` }}>{prefix}</span>}
      {parts.map((part, index) =>
        part.type === 'chord' ? (
          <ChordWithHover key={index} chord={part.content} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} />
        ) : (
          <span key={index} style={{ color: colors.chord }}>{part.content}</span>
        )
      )}
      {suffix && <span style={{ color: colors.prefixSuffix, fontStyle: 'italic', fontSize: `${fontSize * 0.85}px` }}>{suffix}</span>}
    </div>
  );
}

export default ChordItem;
