/**
 * chords-db 查詢與格式轉換
 * @tombatossals/chords-db → @chordbook/charts / chordPlayback 格式
 */

import guitarDb from '@tombatossals/chords-db/lib/guitar.json';
import chordSlashFallbacks from './chordSlashFallbacks.json';
import chordThumbVoicings from './chordThumbVoicings.json';

// chords-db keys: C, Csharp, D, Eb, E, F, Fsharp, G, Ab, A, Bb, B
const DB_KEYS = guitarDb.keys;
const DB_CHORDS = guitarDb.chords;
const DB_SUFFIXES = guitarDb.suffixes;

// Chord name → chords-db key 對照（處理 #/b 寫法）
const KEY_ALIASES = {
  'C#': 'Csharp', 'Db': 'Eb', 'D#': 'Eb', 'F#': 'Fsharp', 'Gb': 'Fsharp',
  'G#': 'Ab', 'A#': 'Bb',
};

// Chord suffix 對照（樂譜常見寫法 → chords-db suffix）
const SUFFIX_MAP = {
  '': 'major',
  'm': 'minor', 'min': 'minor',
  '7': '7', 'maj7': 'maj7', 'mj7': 'maj7', 'm7': 'm7',
  'dim': 'dim', 'dim7': 'dim7',
  'sus2': 'sus2', 'sus4': 'sus4', '7sus4': '7sus4',
  'add9': 'add9', 'madd9': 'madd9',
  'aug': 'aug', '6': '6', '69': '69',
  '9': '9', '11': '11', '13': '13',
  'm6': 'm6', 'm9': 'm9', 'm11': 'm11',
  'maj9': 'maj9', 'maj11': 'maj11', 'maj13': 'maj13',
  '7b5': '7b5', '7b9': '7b9', '7#9': '7#9',
  'mmaj7': 'mmaj7',
};

/** 低音寫法變體（chords-db slash 後綴用 #/b 其中一種） */
const BASS_ENHARMONIC_ALT = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  'A#': 'Bb',
  Cb: 'B',
  'B#': 'C',
};

function bassCandidatesForSlash(bassRaw) {
  if (!bassRaw || typeof bassRaw !== 'string') return [];
  const t = bassRaw.trim();
  const m = t.match(/^([A-G])(#|b)?$/);
  if (!m) return [];
  const canonical = m[1] + (m[2] || '');
  const list = [canonical];
  const alt = BASS_ENHARMONIC_ALT[canonical];
  if (alt && !list.includes(alt)) list.push(alt);
  return list;
}

/**
 * 在 chords-db 嘅 suffixes 入面搵 slash 後綴：major→/X、minor→m/X
 */
function findSlashSuffixInDb(qualitySuffix, bassRaw) {
  for (const b of bassCandidatesForSlash(bassRaw)) {
    if (qualitySuffix === 'major') {
      const s = `/${b}`;
      if (DB_SUFFIXES.includes(s)) return s;
    }
    if (qualitySuffix === 'minor') {
      const s = `m/${b}`;
      if (DB_SUFFIXES.includes(s)) return s;
    }
  }
  return null;
}

function parseChordName(chord) {
  if (!chord || typeof chord !== 'string') return null;
  const clean = chord.trim();
  const slashIdx = clean.indexOf('/');
  const base = slashIdx > 0 ? clean.slice(0, slashIdx).trim() : clean;
  const bassNote = slashIdx > 0 ? clean.slice(slashIdx + 1).trim() : null;
  if (!base || base.length < 1) return null;

  const match = base.match(/^([A-G])(#|b)?(.*)$/);
  if (!match) return null;

  const root = match[1] + (match[2] || '');
  const suffixPart = match[3] || '';

  let suffix = SUFFIX_MAP[suffixPart];
  if (!suffix && suffixPart) {
    const normalized = suffixPart.toLowerCase()
      .replace(/^min$|^min\b/, 'minor')
      .replace(/^maj7$|^mj7$/, 'maj7')
      .replace(/^m7$/, 'm7');
    suffix = guitarDb.suffixes.includes(normalized) ? normalized : 'major';
  }
  if (!suffix) suffix = 'major';

  let dbKey = KEY_ALIASES[root] ?? root;
  if (!DB_CHORDS[dbKey]) {
    if (root.includes('#')) {
      const alt = root.replace('#', 'b');
      dbKey = KEY_ALIASES[alt] ?? alt;
      if (!DB_CHORDS[dbKey]) dbKey = root;
    } else if (root.includes('b') && root !== 'Bb' && root !== 'Eb' && root !== 'Ab') {
      const alt = root.replace('b', '#');
      dbKey = KEY_ALIASES[alt] ?? alt;
    }
  }

  return { dbKey, suffix, bassNote };
}

/** slash 和弦：優先 baseFret=1、再揀按弦品位總和較細（較開放） */
function pickSlashChordPosition(chordEntry) {
  const positions = chordEntry?.positions;
  if (!positions?.length) return null;
  const base1 = positions.filter((p) => (p.baseFret || 1) === 1);
  const pool = base1.length ? base1 : positions;
  const sumPos = (p) =>
    p.frets.reduce((s, f) => s + (f > 0 ? f : 0), 0);
  return [...pool].sort((a, b) => sumPos(a) - sumPos(b))[0];
}

function normalizeChordNameKey(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().replace(/\s*\/\s*/g, '/').toLowerCase();
}

/**
 * chords-db position → chordbook draw 格式
 * chords-db frets: [0]=string6..[5]=string1, -1=mute, 0=open
 * chordbook: fromString=低音弦(6), toString=高音弦(1)；chord 只包額外手指，唔包 barre 覆蓋嘅
 */
function dbPositionToChordbook(position) {
  if (!position || !position.frets) return null;

  const chord = [];
  const barres = [];
  const { frets, baseFret = 1, barres: barreFrets = [] } = position;

  // 先找出 barre 覆蓋嘅 string range（chordbook 要 fromString > toString，即 6→1）
  const barreRanges = [];
  for (const barreFret of barreFrets) {
    let maxS = 1;
    let minS = 6;
    for (let i = 0; i < 6; i++) {
      if (frets[i] === barreFret) {
        const s = 6 - i;
        maxS = Math.max(maxS, s);
        minS = Math.min(minS, s);
      }
    }
    if (minS <= maxS) {
      barres.push({ fromString: maxS, toString: minS, fret: barreFret });
      barreRanges.push({ fret: barreFret, from: minS, to: maxS });
    }
  }

  const isCoveredByBarre = (stringNum, fret) =>
    barreRanges.some((b) => fret === b.fret && stringNum >= b.from && stringNum <= b.to);

  // 收集需要顯示手指數字嘅位置（fret>0，唔包 barre 覆蓋），按 fret 升序、string 降序排序
  const fingerPositions = [];
  for (let i = 0; i < 6; i++) {
    const stringNum = 6 - i;
    const f = frets[i];
    if (f > 0 && !isCoveredByBarre(stringNum, f)) fingerPositions.push({ stringNum, fret: f });
  }
  fingerPositions.sort((a, b) => a.fret !== b.fret ? a.fret - b.fret : b.stringNum - a.stringNum);

  let fingerLabel = 1;
  const getLabel = (stringNum, fret) => {
    const idx = fingerPositions.findIndex(p => p.stringNum === stringNum && p.fret === fret);
    if (idx >= 0 && fingerLabel <= 4) return String(fingerLabel++);
    return undefined;
  };

  for (let i = 0; i < 6; i++) {
    const stringNum = 6 - i;
    const f = frets[i];
    if (f === -1) chord.push([stringNum, 'x']);
    else if (f === 0) chord.push([stringNum, 0]);
    else if (!isCoveredByBarre(stringNum, f)) {
      const label = getLabel(stringNum, f);
      chord.push(label ? [stringNum, f, label] : [stringNum, f]);
    }
  }

  const playedFrets = frets.filter((f) => f >= 0);
  const minFret = playedFrets.length ? Math.min(...playedFrets) : 1;
  const maxFret = playedFrets.length ? Math.max(...playedFrets) : 1;
  const pos = minFret > 0 ? minFret : (baseFret || 1);
  const numFrets = Math.max(4, maxFret - pos + 1);

  return {
    chord,
    barres,
    position: pos,
    positionText: pos === 1 ? 0 : pos,
    numFrets,
    tuning: [],
  };
}

/**
 * chords-db position → chordPlayback 格式（fingers, open, barre, mute）
 */
function dbPositionToPlaybackShape(position) {
  if (!position || !position.frets) return null;

  const fingers = [];
  const open = [];
  const mute = [];
  let barre = null;
  const { frets, barres: barreFrets = [] } = position;

  for (let i = 0; i < 6; i++) {
    const stringNum = 6 - i;
    const f = frets[i];

    if (f === -1) mute.push(stringNum);
    else if (f === 0) open.push(stringNum);
    else fingers.push([stringNum, f]);
  }

  if (barreFrets.length > 0) {
    const bf = barreFrets[0];
    let fromS = 6;
    let toS = 1;
    for (let i = 0; i < 6; i++) {
      if (frets[i] === bf) {
        const s = 6 - i;
        fromS = Math.min(fromS, s);
        toS = Math.max(toS, s);
      }
    }
    barre = { fret: bf, from: fromS, to: toS };
  }

  return { fingers, open, mute, barre };
}

/**
 * 覆蓋 chords-db 預設第一式，與常用教學圖一致（橫按圖 #282828 / 悶弦 / barre 範圍）
 * - B major：db 第一式為 6 弦全按第 2 格；改為悶第6弦嘅 A-shape（pic3）
 * - F# major：db 第一式已係 E-shape 244322，與 pic3 一致，無需覆蓋
 */
const POSITION_OVERRIDES = {
  'B:major': {
    frets: [-1, 2, 4, 4, 4, 2],
    fingers: [0, 1, 2, 3, 4, 1],
    baseFret: 1,
    barres: [2],
  },
  /** 與常用教學圖：開 6/3/2 弦；5→2、4→2、1→3，手指 2/3/4（chords-db 第一式將 3 品放在第2弦，唔同） */
  'E:m7': {
    frets: [0, 2, 2, 0, 0, 3],
    fingers: [0, 2, 3, 0, 0, 4],
    baseFret: 1,
    barres: [],
  },
};

/**
 * chords-db 未有嘅 slash（例如 m7/G）：用靜態 JSON 補位（非演算法計指板）。
 * Key：normalizeChordNameKey（如 am7/g）；格式同 chords-db position。
 */
const CHORD_SLASH_FALLBACKS = chordSlashFallbacks;

/**
 * 精選拇指／Hendrix／民謠式指法（合併入 getChordAlternatives）。
 * Key = normalizeChordNameKey（小寫、無空白），如 "d/f#"、"g"。
 * 每項 position：frets、fingers、baseFret、barres（同 chords-db）；
 * fingers[] 可用 0–4 或字串 "T" / "thumb" 表示拇指按低音弦。
 * 可選 label：人類可讀說明（build 時剝除，不寫入 Firestore）。
 * `THUMB_VOICINGS_PREPEND_FIRST`：該 key 嘅精選排喺 chords-db **之前**，且 defaultIndex=0（預揀 thumb）。
 */
const CHORD_THUMB_VOICINGS = chordThumbVoicings;

/** 拇指 wrap 等要當「第一式」顯示／預揀嘅和弦 key（normalizeChordNameKey） */
const THUMB_VOICINGS_PREPEND_FIRST = new Set(['d/f#']);

/**
 * 將 chordThumbVoicings 合併入 alternatives：預設 **append**；在 THUMB_VOICINGS_PREPEND_FIRST 則 **prepend**。
 * @returns {{ list: object[], prependCount: number }}
 */
function mergeThumbAlternativePositions(nameKey, chordName, list) {
  const raw = CHORD_THUMB_VOICINGS[nameKey];
  if (!raw?.length || !list?.length) return { list, prependCount: 0 };
  const more = raw
    .map((p) => {
      const pos = { ...p };
      delete pos.label;
      return buildChordResultFromPosition(pos, chordName);
    })
    .filter(Boolean);
  if (!more.length) return { list, prependCount: 0 };
  if (THUMB_VOICINGS_PREPEND_FIRST.has(nameKey)) {
    return { list: [...more, ...list], prependCount: more.length };
  }
  return { list: [...list, ...more], prependCount: 0 };
}

/**
 * @tombatossals/chords-db：當 baseFret &gt; 1 時，frets / barres 係「圖內相對品位」
 *（第 1 格 = 實際 baseFret），要轉成由 nut 計嘅絕對品位，SVG 同 playback 先啱。
 * baseFret === 1 時：b + f - 1 === f，與現有絕對數據一致。
 */
function normalizeChordsDbFretsToAbsolute(position) {
  if (!position?.frets) return position;
  const b = position.baseFret ?? 1;
  const frets = position.frets.map((f) => (f > 0 ? b + f - 1 : f));
  const barres = (position.barres || []).map((bf) => b + bf - 1);
  return { ...position, frets, barres };
}

function buildChordResultFromPosition(position, chordName) {
  const pos = normalizeChordsDbFretsToAbsolute(position);
  const chordbook = dbPositionToChordbook(pos);
  const playbackShape = dbPositionToPlaybackShape(pos);
  if (!chordbook) return null;
  return {
    chordbook,
    playbackShape: { ...playbackShape, originalName: chordName },
    originalName: chordName,
    svgData: {
      frets: pos.frets,
      fingers: pos.fingers ?? null,
      baseFret: pos.baseFret || 1,
      barres: pos.barres || [],
      chordName,
      chordbook,
    },
  };
}

/**
 * 從 chords-db 查詢和弦，回傳第一個 position
 * 回傳格式：{ chordbook, playbackShape, originalName }
 */
export function getChordFromDb(chordName) {
  if (!chordName || typeof chordName !== 'string') return null;

  const nameKey = normalizeChordNameKey(chordName);
  const parsed = parseChordName(chordName);
  if (!parsed) return null;

  const { dbKey, suffix, bassNote } = parsed;
  const chordList = DB_CHORDS[dbKey];
  if (!chordList) return null;

  /** 1) Slash：用 chords-db 內建 /X、 m/X（見 guitar.json suffixes） */
  if (bassNote) {
    const slashSuffix = findSlashSuffixInDb(suffix, bassNote);
    if (slashSuffix) {
      const slashEntry = chordList.find((c) => c.suffix === slashSuffix);
      if (slashEntry?.positions?.length) {
        const picked = pickSlashChordPosition(slashEntry);
        if (picked) {
          return buildChordResultFromPosition(picked, chordName);
        }
      }
    }
    /** 2) 庫無此 slash（如 m7/G）：讀 chordSlashFallbacks.json */
    const fb = nameKey && CHORD_SLASH_FALLBACKS[nameKey];
    if (fb?.frets) {
      const fromFb = buildChordResultFromPosition(fb, chordName);
      if (fromFb) return fromFb;
    }
  }

  const chordEntry = chordList.find((c) => c.suffix === suffix);
  if (!chordEntry || !chordEntry.positions?.length) return null;

  const override = POSITION_OVERRIDES[`${dbKey}:${suffix}`];
  const position = override
    ? { ...chordEntry.positions[0], ...override }
    : chordEntry.positions[0];

  return buildChordResultFromPosition(position, chordName);
}

/**
 * 兼容舊 getChordShape - 回傳 playback 格式，供 ChordDiagram / chordPlayback 使用
 */
export function getChordShape(chordName) {
  const result = getChordFromDb(chordName);
  return result?.playbackShape ?? null;
}

/**
 * 同一和弦嘅所有 alternative 指法（chords-db 多個 positions），邏輯與 getChordFromDb 一致。
 * @returns {{ list: object[], defaultIndex: number } | null} list 項同 getChordFromDb 回傳結構
 */
export function getChordAlternatives(chordName) {
  if (!chordName || typeof chordName !== 'string') return null;

  const nameKey = normalizeChordNameKey(chordName);
  const parsed = parseChordName(chordName);
  if (!parsed) return null;

  const { dbKey, suffix, bassNote } = parsed;
  const chordList = DB_CHORDS[dbKey];
  if (!chordList) return null;

  if (bassNote) {
    const slashSuffix = findSlashSuffixInDb(suffix, bassNote);
    if (slashSuffix) {
      const slashEntry = chordList.find((c) => c.suffix === slashSuffix);
      if (slashEntry?.positions?.length) {
        const picked = pickSlashChordPosition(slashEntry);
        const list = slashEntry.positions
          .map((p) => buildChordResultFromPosition(p, chordName))
          .filter(Boolean);
        if (!list.length) return null;
        let defaultIndex = slashEntry.positions.findIndex(
          (p) =>
            picked &&
            JSON.stringify(p.frets) === JSON.stringify(picked.frets) &&
            (p.baseFret || 1) === (picked.baseFret || 1),
        );
        if (defaultIndex < 0) defaultIndex = 0;
        const { list: merged, prependCount } = mergeThumbAlternativePositions(
          nameKey,
          chordName,
          list,
        );
        if (THUMB_VOICINGS_PREPEND_FIRST.has(nameKey) && prependCount > 0) {
          defaultIndex = 0;
        }
        return { list: merged, defaultIndex };
      }
    }
    const fb = nameKey && CHORD_SLASH_FALLBACKS[nameKey];
    if (fb?.frets) {
      const one = buildChordResultFromPosition(fb, chordName);
      if (!one) return null;
      const { list: merged } = mergeThumbAlternativePositions(nameKey, chordName, [one]);
      return { list: merged, defaultIndex: 0 };
    }
  }

  const chordEntry = chordList.find((c) => c.suffix === suffix);
  if (!chordEntry?.positions?.length) return null;

  const override = POSITION_OVERRIDES[`${dbKey}:${suffix}`];
  const list = chordEntry.positions
    .map((p, i) => {
      const pos = i === 0 && override ? { ...p, ...override } : p;
      return buildChordResultFromPosition(pos, chordName);
    })
    .filter(Boolean);

  if (!list.length) return null;
  const { list: merged } = mergeThumbAlternativePositions(nameKey, chordName, list);
  return { list: merged, defaultIndex: 0 };
}
