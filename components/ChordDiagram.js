import { getChordShape, isChordUiDark, extractChords } from '@/lib/chordUtils';
import { playChord } from '@/lib/chordPlayback';

// Re-export 供外部使用
export { isChordUiDark, getChordShape, extractChords };

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
  const chordPattern = /(?<!\/)(?<![A-Ga-g#b])\b[A-G][#b]?(maj|mj|m|min|dim|aug|sus|add|m7|maj7|7|9|11|13)?\d*((b|#)\d*)?(\/[A-G][#b]?)?(?=[\s—\-|｜\u2502]|$)/g;
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
