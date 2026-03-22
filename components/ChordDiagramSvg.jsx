'use client';

/**
 * 完全跟設計 SVG 嘅自訂和弦圖
 * 使用所有設計元素：st1/st2/st3/st4、rect、line、circle、path、text
 */
import { getChordFromDb, getChordShape } from '@/lib/chordDb';
import { isChordUiDark } from '@/lib/chordUtils';
import { playChord } from '@/lib/chordPlayback';

// 設計稿：深灰底（bottom sheet 可傳 surfaceColor 再深一級；預設同舊 #282828）
const DESIGN = {
  bg: '#282828',
  st1: '#4d4d4d',   // fret 線 (較暗)
  st2: '#e0e0e0',   // 弦線、nut（較亮白）
  st3: '#999',      // mute X、open O（中灰）
  st4: '#FFD700',   // 手指黃點
  label: '#000000',  // 手指數字
};

// 設計稿 viewBox（minY=-8 預留頂部空間避免 X/O 裁切）
const VB_W_BARRE = 62.69;  // 內容右緣（右側留位 barre 和弦 fret 數字）
/** 左側加空間（viewBox 單位），平衡右側品位字，令白色網格喺框內視覺置中 */
const VB_LEFT_PAD = 4;
const VB_MIN_X = -VB_LEFT_PAD;
/** 實際 viewBox 寬度 = 左留白 + 原設計寬度（右緣仍係 VB_W_BARRE） */
const VB_W_VIEW = VB_W_BARRE + VB_LEFT_PAD;
const VB_CONTENT_H = 100.27;
const VB_TOP_PAD = 8;
const VB_H = VB_CONTENT_H + VB_TOP_PAD;
/** 一般模式：頂部預留 X/O（minY=-8） */
const VB_MIN_Y = -VB_TOP_PAD;
/**
 * compactVertical：收緊頂部留白（仍夠位畫 X/O），縮短 viewBox 高度，框內上下更緊湊
 * -5 + 99 = 94，與舊 -8 + 102 底邊相同，唔會裁手指點
 */
const VB_MIN_Y_TIGHT = -5;
const VB_H_TIGHT = 99;

// Barre 設計稿尺寸（長條兩邊伸出弦線外，跟 Illustrator path）
const BARRE_H = 4.79;
const BARRE_PAD_X = 2.5;  // 左右超出最外弦線

// 設計稿：弦 x=左緣, width；手指點、X/O 一律用弦心（垂直線中心）
const STRING_LAYOUT = [
  { x: 5.06, w: 0.65 },   // 6 (bass)
  { x: 14.76, w: 0.65 },  // 5
  { x: 24.45, w: 0.65 },  // 4
  { x: 34.34, w: 0.26 },  // 3 (treble, thinner)
  { x: 44.04, w: 0.26 },  // 2
  { x: 53.73, w: 0.26 },  // 1
];

function stringCenterX(stringIndex) {
  const s = STRING_LAYOUT[stringIndex];
  return s.x + s.w / 2;
}

// Fret y positions（nut 9.86、fret 線 29.89, 48.6, 67.3, 86.01）
const NUT_TOP = 9.86;
const NUT_H = 1.81;
const FRET_LINES = [9.86, 29.89, 48.6, 67.3, 86.01];
const OPEN_Y = 3.6;

// 每格 fret 嘅中心 y（space 0 = fret 1，space 1 = fret 2...）
const FRET_CENTERS = [];
const nutBottom = NUT_TOP + NUT_H;  // 11.67
for (let i = 0; i < FRET_LINES.length - 1; i++) {
  const top = i === 0 ? nutBottom : FRET_LINES[i];
  const bot = FRET_LINES[i + 1];
  FRET_CENTERS.push((top + bot) / 2);
}
FRET_CENTERS.push((FRET_LINES[FRET_LINES.length - 1] + VB_CONTENT_H - 14) / 2);  // fret 5

const DOT_R = 5.22;  // 設計稿 r=5.22，圓形可貼住／重疊
const TOP_MARKER_SIZE = 5;  // Mute X 同 Open O 同大

// 手指數字 path（簡化版，用 text 代替複雜 path）
/** 手指數字 1、2、4：`FINGER_TEXT_DY_FOR_1234`；「3」：`FINGER_TEXT_DY_FOR_3`（viewBox 單位，負值＝向上） */
const FINGER_TEXT_DY_FOR_1234 = -0.5;
const FINGER_TEXT_DY_FOR_3 = -0.4;

/** chords-db 數字 1–4；精選 thumb voicing 用 "T" / "thumb" */
function rawFingerToDotLabel(v) {
  if (v == null || v === '' || v === 0) return null;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 't' || t === 'thumb') return 'T';
  }
  if (typeof v === 'number' && v >= 1 && v <= 4) return String(v);
  return null;
}

function FingerDot({ cx, cy, label }) {
  const s = String(label);
  const isThumb = s === 'T';
  const dy = isThumb
    ? -0.35
    : /^[1-4]$/.test(s)
      ? (s === '3' ? FINGER_TEXT_DY_FOR_3 : FINGER_TEXT_DY_FOR_1234)
      : 0;
  return (
    <g>
      <circle cx={cx} cy={cy} r={DOT_R} fill={DESIGN.st4} stroke="none" />
      <text
        x={cx}
        y={cy}
        dy={dy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={DESIGN.label}
        fontFamily="Helvetica Neue, Helvetica, Arial, sans-serif"
        fontWeight="500"
        fontSize={isThumb ? 8 : 9}
      >
        {label}
      </text>
    </g>
  );
}

const TOP_MARKER_STROKE = 0.5;

function MuteX({ x, y }) {
  const s = TOP_MARKER_SIZE / 2;
  return (
    <path d={`M ${x - s} ${y - s} L ${x + s} ${y + s} M ${x + s} ${y - s} L ${x - s} ${y + s}`} stroke={DESIGN.st3} strokeWidth={TOP_MARKER_STROKE} fill="none" strokeLinecap="round" />
  );
}

function OpenO({ x, y }) {
  return (
    <circle cx={x} cy={y} r={TOP_MARKER_SIZE / 2} fill="none" stroke={DESIGN.st3} strokeWidth={TOP_MARKER_STROKE} />
  );
}

export default function ChordDiagramSvg({
  chord,
  size = 80,
  theme = 'dark',
  accentColor,
  showPlayButton = true,
  /** true：底部 sheet 用較矮 viewBox，減少圖示同下方白膠囊之間視覺空隙 */
  compactVertical = false,
  /** 自訂指板底紋色（例如 bottom sheet 用較深面板色）；唔傳則用 DESIGN.bg */
  surfaceColor,
  /** 覆寫 getChordFromDb（例如 alternative 指法） */
  chordResult: chordResultProp,
}) {
  const result = chordResultProp ?? getChordFromDb(chord);
  const shape = chordResultProp?.playbackShape ?? getChordShape(chord);
  const isDark = isChordUiDark(theme);

  const vbH = compactVertical ? VB_H_TIGHT : VB_H;
  const vbMinY = compactVertical ? VB_MIN_Y_TIGHT : VB_MIN_Y;
  const fillBg = surfaceColor ?? DESIGN.bg;

  if (!result?.svgData) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg ${!isDark ? 'bg-neutral-200' : ''}`}
        style={{
          width: size,
          height: size * (vbH / VB_W_VIEW),
          ...(isDark ? { backgroundColor: fillBg } : {}),
        }}
      >
        <span className={`text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>{chord}</span>
      </div>
    );
  }

  const { frets, fingers: dbFingers, baseFret, barres: barreFrets } = result.svgData;

  /** 指板頂行對應嘅絕對品位（chordDb 已將 chords-db 相對品位轉絕對）；fretRowIndex 最大 = FRET_CENTERS.length-1 */
  const positiveFrets = frets.filter((f) => f > 0);
  const minPlayedFret = positiveFrets.length ? Math.min(...positiveFrets) : null;
  const maxPlayedFret = positiveFrets.length ? Math.max(...positiveFrets) : null;
  const hasOpenString = frets.some((f) => f === 0);
  const dbBase = baseFret ?? 1;
  const maxFretRowIndex = FRET_CENTERS.length - 1;

  let layoutBaseFret = dbBase;
  /**
   * 舊：baseFret=1、無開放弦、最低按弦≥2 → 一律用 minPlayedFret「裁切」指板。
   * 新：若由 dbBase=1 起格數已夠顯示最高按弦（maxPlayedFret - 1 ≤ maxFretRowIndex），維持 1，
   *     唔為對齊最低按弦而裁到 minPlayedFret；只有超出可見 5 格時先上移。
   */
  if (
    dbBase === 1 &&
    minPlayedFret != null &&
    minPlayedFret > 1 &&
    !hasOpenString &&
    maxPlayedFret != null
  ) {
    if (maxPlayedFret - 1 > maxFretRowIndex) {
      layoutBaseFret = minPlayedFret;
    }
  }

  const fretRowIndex = (f) =>
    Math.min(Math.max(f - layoutBaseFret, 0), FRET_CENTERS.length - 1);

  /** 手指數字：優先 chords-db / thumb JSON `fingers[]`（1–4 或 T／thumb） */
  const fingerLabels = {};
  let fallbackNum = 1;
  for (let i = 0; i < 6; i++) {
    const f = frets[i];
    if (f <= 0) continue;
    if ((barreFrets || []).some((bf) => frets[i] === bf)) continue;
    const fn = Array.isArray(dbFingers) ? dbFingers[i] : null;
    const explicit = rawFingerToDotLabel(fn);
    if (explicit) {
      fingerLabels[`${i}-${f}`] = explicit;
    } else {
      fingerLabels[`${i}-${f}`] = String(fallbackNum++);
    }
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size * (vbH / VB_W_VIEW) }}>
      <svg viewBox={`${VB_MIN_X} ${vbMinY} ${VB_W_VIEW} ${vbH}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ maxWidth: size, maxHeight: size * (vbH / VB_W_VIEW) }}>
        <defs>
          <style>{`
            .st0 { font-family: Helvetica Neue, Helvetica, Arial, sans-serif; font-size: 9.13px; font-weight: 500; }
          `}</style>
        </defs>

        {/* 背景（覆蓋含左留白嘅成個 viewBox） */}
        <rect x={VB_MIN_X} y={vbMinY} width={VB_W_VIEW} height={vbH} fill={fillBg} />

        {/* st1: Fret 線 (橫) */}
        <g fill={DESIGN.st1}>
          {[1, 2, 3].map((i) => (
            <rect key={i} x="5.06" y={FRET_LINES[i]} width="48.93" height="0.65" />
          ))}
        </g>

        {/* st2: 弦線 (直) + Nut（設計稿：nut 較粗較白） */}
        <g fill={DESIGN.st2}>
          {STRING_LAYOUT.map((s, i) => (
            <rect key={i} x={s.x} y="9.86" width={s.w} height="76.8" />
          ))}
          {/* Nut：layoutBaseFret=1 先畫粗 nut；>1 時頂線當第一條 fret（唔留空 open 第1格） */}
          <rect x="5.06" y="9.86" width="48.93" height={layoutBaseFret === 1 ? 1.81 : 0.65} />
          {/* 底線 */}
          <rect x="5.06" y="86.01" width="48.93" height="0.65" />
        </g>

        {/* Barre（先畫，手指點在上層） */}
        {(barreFrets || []).map((bf, bi) => {
          let fromIdx = 6, toIdx = 0;
          for (let i = 0; i < 6; i++) {
            if (frets[i] === bf) {
              fromIdx = Math.min(fromIdx, i);
              toIdx = Math.max(toIdx, i);
            }
          }
          const x1 = STRING_LAYOUT[fromIdx].x - BARRE_PAD_X;
          const x2 = STRING_LAYOUT[toIdx].x + STRING_LAYOUT[toIdx].w + BARRE_PAD_X;
          const cy = FRET_CENTERS[fretRowIndex(bf)];
          const y = cy - BARRE_H / 2;
          const w = x2 - x1;
          return (
            <rect
              key={bi}
              x={x1}
              y={y}
              width={w}
              height={BARRE_H}
              rx={BARRE_H / 2}
              ry={BARRE_H / 2}
              fill={DESIGN.st4}
              stroke={fillBg}
              strokeWidth="1.2"
            />
          );
        })}

        {/* Mute X / Open O / Finger 點 — 頂部 X/O 列永遠預留同一高度（透明佔位），指板垂直對齊 */}
        <g>
          {frets.map((f, i) => {
            const sx = stringCenterX(i);
            const cy = f === -1 || f === 0 ? OPEN_Y : FRET_CENTERS[fretRowIndex(f)];
            const label = fingerLabels[`${i}-${f}`];
            const topRow = f === -1 ? (
              <MuteX x={sx} y={OPEN_Y} />
            ) : f === 0 ? (
              <OpenO x={sx} y={OPEN_Y} />
            ) : (
              <circle
                cx={sx}
                cy={OPEN_Y}
                r={TOP_MARKER_SIZE / 2}
                fill="none"
                opacity={0}
                pointerEvents="none"
                aria-hidden
              />
            );
            return (
              <g key={i}>
                {topRow}
                {f > 0 && label ? <FingerDot cx={sx} cy={cy} label={label} /> : null}
              </g>
            );
          })}
        </g>

        {/* 和弦名由 ChordDiagramBottomSheet 白膠囊顯示，SVG 唔再畫灰膠囊避免重複／淺灰框 */}

        {/* 高把位／從第2格起：右側黃字 = 指板頂行實際品位 */}
        {layoutBaseFret > 1 && (
          <text
            className="st0"
            fill={accentColor ?? DESIGN.st4}
            x={57.61}
            y={FRET_CENTERS[0]}
            textAnchor="start"
            dominantBaseline="middle"
            fontWeight="300"
            fontSize="9.13"
          >
            {layoutBaseFret}
          </text>
        )}
      </svg>

      {showPlayButton && shape && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); playChord(shape); }}
          className="absolute bottom-0 right-0 p-1 rounded-full bg-[#ffd807]/90 hover:bg-[#ffd807] text-black"
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
