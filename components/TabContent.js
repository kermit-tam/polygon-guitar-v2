import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { extractChords, ChordWithHover, ChordLineWithHover } from './ChordDiagram';
import ChordDiagramBottomSheet from './ChordDiagramBottomSheet';
import GpSegmentPlayer from './GpSegmentPlayer';
import { calculateTransposeSemitones } from '@/lib/keyUtils';
import { transposeChord, transposeSlashBassOnly, preferFlatsForDisplayKey } from '@/lib/chordUtils';

const NotationAlphaTabPreview = dynamic(
  () => import('@/components/NotationEditor/NotationAlphaTabPreview'),
  { ssr: false }
);

// ============ 智能字體大小計算 ============
// 根據內容長度計算合適的字體大小
function calculateFontSize(text, containerWidth = 800) {
  if (!text) return 16;
  
  const length = text.length;
  
  // 計算基礎字體大小
  let baseSize = 16;
  
  // 窄屏幕（手機）
  if (containerWidth < 400) {
    if (length > 50) baseSize = 11;
    else if (length > 35) baseSize = 12;
    else if (length > 20) baseSize = 13;
    else baseSize = 14;
  }
  // 中等屏幕（平板）
  else if (containerWidth < 768) {
    if (length > 60) baseSize = 12;
    else if (length > 40) baseSize = 13;
    else if (length > 25) baseSize = 14;
    else baseSize = 15;
  }
  // 寬屏幕（桌面）
  else {
    if (length > 80) baseSize = 13;
    else if (length > 50) baseSize = 14;
    else if (length > 30) baseSize = 15;
    else baseSize = 16;
  }
  
  return baseSize;
}

// ============ 常數定義 ============
// 根據原調類型顯示對應的 Key 選項（Major 只顯示 Major，Minor 只顯示 Minor）
// 顯示用 Key 列表（優先使用 sharp，避免重複）
const MAJOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
// 兼容舊代碼
const KEYS = [...MAJOR_KEYS, ...MINOR_KEYS];

// Key 對應的 semitone 位置 (C = 0)
const KEY_TO_SEMITONE = {
  // Major
  'C': 0, 'Db': 1, 'C#': 1, 'D': 2, 'Eb': 3, 'D#': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'Ab': 8, 'G#': 8,
  'A': 9, 'Bb': 10, 'A#': 10, 'B': 11,
  // Minor（同 Major 音高相同，用嚟識別相對小調）
  'Cm': 0, 'C#m': 1, 'Dm': 2, 'D#m': 3, 'Ebm': 3, 'Em': 4,
  'Fm': 5, 'F#m': 6, 'Gm': 7, 'G#m': 8, 'Am': 9, 'Bbm': 10, 'Bm': 11
};

// Semitone 對應的 Key (優先使用 flat)
const SEMITONE_TO_KEY = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** 是否為「延續低音」token：/ 後跟根音，常見於「C /B」表示 C over B */
function isSlashBassContinuationToken(tokenName) {
  return /^\/[A-G][#b]?$/.test(tokenName || '')
}

/** 行內有和弦標記：| 後根音，或（行首/空白/小節線後）嘅 /根音（唔會誤判 E7/G#） */
function lineHasChordMarker(line) {
  if (!line) return false
  if (/[\|｜\u2502][\s]*[A-G]/.test(line)) return true
  return /(?:^|[\s|｜\u2502])\/[A-G][#b]?(?=[\s|｜\u2502]|$)/.test(line)
}

function transposeChordLine(line, semitones, preserveBarSpacing = false, preferFlats = false) {
  if (!semitones || semitones === 0) {
    if (preserveBarSpacing) {
      return line.replace(/｜/g, '|').replace(/\u2502/g, '|');
    }
    return normalizeChordSpacing(line);
  }
  
  const normalizedLine = normalizeChordSpacing(line, preserveBarSpacing);
  const barOut = preserveBarSpacing ? '|' : ' |';
  let out = normalizedLine.replace(/([\|｜]\s*|\s+)([A-G][#b]?[^\s|｜]*|-)|([\|｜])/g, (match, separator, chord, barOnly) => {
    if (barOnly === '|' || barOnly === '｜') return barOut;
    const hasBar = separator && (/[\|｜]/.test(separator));
    const leadingSpace = separator && separator.match(/\s*$/)?.[0] || '';
    if (chord === '-') {
      return (hasBar ? barOut : leadingSpace || ' ') + '-';
    }
    const hasDash = chord.endsWith('-');
    const cleanChord = hasDash ? chord.slice(0, -1) : chord;
    const transposed = transposeChord(cleanChord, semitones, preferFlats);
    const result = hasDash ? transposed + '-' : transposed;
    return (hasBar ? barOut : leadingSpace || ' ') + result;
  })
  // 「C /B」「Am /G」：空格或 | 後嘅 /根音（唔係 E7/G# 嗰種，因前面唔係空白）
  out = out.replace(/(^|[\s|])(\/[A-G][#b]?)(?=[\s|]|$)/g, (m, pre, slashBass) => pre + transposeSlashBassOnly(slashBass, semitones, preferFlats))
  return out
}

// 確保和弦之間至少有一個空格
// preserveBarSpacing: 等寬/人手空格對位時為 true，唔在 | 後加空格，保持用戶輸入
function normalizeChordSpacing(line, preserveBarSpacing = false) {
  if (!line) return line;
  
  // 將全角豎線、Unicode 豎線（│ U+2502）轉為半角 |
  let result = line.replace(/｜/g, '|').replace(/\u2502/g, '|');
  // 確保 | 後面至少有一個空格（等寬/人手空格對位時唔加，保持原樣）
  if (!preserveBarSpacing) {
    result = result.replace(/\|([^\s])/g, '| $1');
  }
  
  // 確保和弦之間至少有一個空格
  // 方法：遍歷字符串，當發現 A-G 開頭嘅新和弦，而且前面係和弦字符（但不是 /），就加空格
  let output = '';
  for (let i = 0; i < result.length; i++) {
    const char = result[i];
    const prevChar = result[i - 1];
    
    // 檢查是否係 A-G 開頭（可能係新和弦）
    if (/[A-G]/.test(char)) {
      // 檢查前面係咪和弦字符（# b m M 數字等）
      // 排除：空格、|、/（slash chord 如 G/B 唔應該分開）
      if (prevChar && /[a-zA-Z0-9#b+\-]/.test(prevChar)) {
        // 唔好拆開 NC（No Chord）
        const isNC = prevChar === 'N' && char === 'C' && (i + 1 >= result.length || /[\s|]/.test(result[i + 1]));
        if (!isNC) {
          output += ' ';
        }
      }
      // 注意：如果前面係 /，代表係 slash chord，唔加空格
    }
    output += char;
  }
  
  return output;
}

// ============ 字寬計算工具 ============
function isCJK(char) {
  const code = char.charCodeAt(0);
  return (code >= 0x4E00 && code <= 0x9FFF) || 
         (code >= 0x3400 && code <= 0x4DBF) || 
         (code >= 0xF900 && code <= 0xFAFF);
}

function getCharWidth(char) {
  if (char === '\u3000') return 2;
  if (isCJK(char)) return 2;
  // 全形標點符號（如 （））寬度為 2
  const code = char.charCodeAt(0);
  if (code >= 0xFF01 && code <= 0xFF5E) return 2; // 全形 ASCII 變體
  if (code >= 0xFFE0 && code <= 0xFFE6) return 2; // 全形符號
  return 1;
}

function getTextWidth(text) {
  let width = 0;
  for (let char of text) width += getCharWidth(char);
  return width;
}

// 計算開括號位置（左對齊）
function findBracketPositions(lyricLine) {
  const positions = [];
  let currentWidth = 0;
  for (let char of lyricLine) {
    if (char === '(' || char === '（') positions.push(currentWidth);
    currentWidth += getCharWidth(char);
  }
  return positions;
}

// 計算隱藏括號後嘅調整位置（左對齊）
function findAdjustedBracketPositions(lyricLine) {
  const positions = [];
  let visibleWidth = 0;
  let inBracket = false;
  
  for (let char of lyricLine) {
    if (char === '(' || char === '（') {
      // 開括號位置 = 當前可視寬度（括號本身隱藏，唔佔位）
      positions.push(visibleWidth);
      inBracket = true;
    } else if (char === ')' || char === '）') {
      // 閉合括號唔佔位
      inBracket = false;
    } else {
      // 非括號字符正常計算寬度
      visibleWidth += getCharWidth(char);
    }
  }
  return positions;
}

function normalizeInput(text) {
  return text.replace(/｜/g, '|').replace(/\u2502/g, '|').replace(/　/g, ' ').replace(/\r?\n/g, '');
}

function splitLyricAtBrackets(lyricLine) {
  const chars = [...lyricLine];
  const bracketIndices = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '(' || chars[i] === '（') bracketIndices.push(i);
  }
  if (bracketIndices.length === 0) return null;

  const preBracket = chars.slice(0, bracketIndices[0]).join('');
  const segments = [];
  for (let i = 0; i < bracketIndices.length; i++) {
    const start = bracketIndices[i];
    const end = i + 1 < bracketIndices.length ? bracketIndices[i + 1] : chars.length;
    segments.push(chars.slice(start, end).join(''));
  }
  return { preBracket, segments };
}

function splitSegmentAtBracketClose(segment) {
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === ')' || segment[i] === '）') {
      const raw = segment.substring(0, i + 1);
      const openIdx = raw.search(/[\(（]/);
      // Match lyric rendering: spaces inside brackets become full-width \u3000
      const bracketPart = openIdx !== -1
        ? raw.substring(0, openIdx + 1) + raw.substring(openIdx + 1, i).replace(/ /g, '\u3000') + raw[i]
        : raw;
      return { bracketPart, remainder: segment.substring(i + 1) };
    }
  }
  return { bracketPart: segment, remainder: '' };
}

// Section marker 列表
// Section Marker 縮寫映射（用戶可以用 /v 代替 Verse）
const SECTION_SHORTCUTS = {
  '/i': 'Intro',
  '/o': 'Outro',
  '/v': 'Verse',
  '/v1': 'Verse 1',
  '/v2': 'Verse 2',
  '/v3': 'Verse 3',
  '/v4': 'Verse 4',
  '/c': 'Chorus',
  '/c1': 'Chorus 1',
  '/c2': 'Chorus 2',
  '/c3': 'Chorus 3',
  '/p': 'Pre-chorus',
  '/p1': 'Pre-chorus 1',
  '/p2': 'Pre-chorus 2',
  '/b': 'Bridge',
  '/in': 'Interlude',
  '/s': 'Solo',
  '/gs': 'Guitar Solo',
  '/mb': 'Music Break',
  '/h': 'Hook',
  '/r': 'Rap',
  '/rap': 'Rap',
  '/k': 'Key Change',
  '/key': 'Key Change',
  '/fo': 'Fade out'
};

const SECTION_MARKERS = [
  'Intro', 'Outro', 
  'Verse', 'Verse 1', 'Verse 2', 'Verse 3', 'Verse 4',
  'Chorus', 'Chorus 1', 'Chorus 2', 'Chorus 3',
  'Prechorus', 'Pre-chorus', 'Pre chorus', 'Pre Chorus', 'Pre Chorus 1', 'Pre Chorus 2',
  'Bridge', 
  'Interlude', 
  'Solo', 'Guitar Solo',
  'Break', 'Music Break', ' instrumental',
  'Hook', 'Refrain',
  'Rap', 'Key Change',
  'Fade out'
];

// 檢查是否為 Section Marker 行
function isSectionMarkerLine(line) {
  const trimmed = line.trim();
  return SECTION_MARKERS.some(marker => 
    trimmed.toLowerCase().startsWith(marker.toLowerCase())
  );
}

// ========== 六線譜識別 ==========

// 檢查是否為六線譜行
function isGuitarTabLine(line) {
  const trimmed = line.trim();
  
  // 標準六線譜格式: e|-----| B|-----|
  const standardTab = /^(?:e|b|g|d|a|E|B|G|D|A|\d)[\|\-~\/\\bp\(\)\[\]x\d\s]+$/i;
  
  // 數字格式: -0--1--2--3--
  const numberTab = /^[\|\-~\/\\\s]*\d+[\|\-~\/\\\s\dx]*$/;
  
  // 檢查是否包含大量連字符或數字（六線譜特徵）
  const hasTabCharacteristics = (
    (trimmed.match(/-/g) || []).length >= 3 ||
    (trimmed.match(/\d/g) || []).length >= 2
  ) && trimmed.length >= 5;
  
  return standardTab.test(trimmed) || (numberTab.test(trimmed) && hasTabCharacteristics);
}

// 識別六線譜段落
function detectGuitarTabSection(lines, startIndex) {
  const tabLines = [];
  let i = startIndex;
  
  while (i < lines.length && tabLines.length < 10) {
    const line = lines[i].trim();
    
    // 如果是六線譜行，加入
    if (isGuitarTabLine(line)) {
      tabLines.push({ line, index: i });
      i++;
    } else if (line === '' && tabLines.length > 0) {
      // 空行結束段落
      break;
    } else if (tabLines.length > 0) {
      // 已經開始收集六線譜，但遇到非六線譜行
      break;
    } else {
      // 還沒開始收集，跳過這行
      i++;
    }
  }
  
  // 需要至少 3 行才認為是有效的六線譜
  if (tabLines.length >= 3) {
    return {
      isTabSection: true,
      lines: tabLines.map(l => l.line),
      endIndex: tabLines[tabLines.length - 1].index + 1
    };
  }
  
  return { isTabSection: false };
}

// 渲染六線譜為視覺化格式
function renderGuitarTab(tabLines, chordColor = '#FFD700') {
  // 確保最多 6 行
  const lines = tabLines.slice(0, 6);
  
  return lines.map((line, index) => {
    const stringNames = ['e', 'B', 'G', 'D', 'A', 'E'];
    const stringName = stringNames[index] || '?';
    
    return (
      <div key={index} className="font-mono text-sm whitespace-pre leading-tight" style={{ color: chordColor }}>
        <span className="text-neutral-500 w-4 inline-block">{stringName}</span>
        <span className="text-neutral-500">|</span>
        <span>{line.replace(/^[eEbBgGdDaA]\|/, '').replace(/^\d+\|/, '')}</span>
        <span className="text-neutral-500">|</span>
      </div>
    );
  });
}

// 提取 Section Marker 和其後的內容
function extractSectionMarker(line) {
  const trimmed = line.trim();
  const trimmedLower = trimmed.toLowerCase();
  
  // 先檢查是否為縮寫（如 /v, /c, /b 等）
  // 匹配 / 開頭，後面跟 1-3 個字母/數字
  const shortcutMatch = trimmed.match(/^\/([a-z0-9]{1,4})(\s|$)/i);
  if (shortcutMatch) {
    const shortcut = '/' + shortcutMatch[1].toLowerCase();
    if (SECTION_SHORTCUTS[shortcut]) {
      const fullMarker = SECTION_SHORTCUTS[shortcut];
      const afterMarker = trimmed.substring(shortcutMatch[0].length).trim();
      return { 
        hasMarker: true, 
        marker: fullMarker,
        rest: afterMarker 
      };
    }
  }
  
  // 按長度排序，先匹配長的（避免 "Verse" 搶先匹配 "Verse 1"）
  const sortedMarkers = [...SECTION_MARKERS].sort((a, b) => b.length - a.length);
  
  for (const marker of sortedMarkers) {
    const markerLower = marker.toLowerCase();
    
    if (trimmedLower.startsWith(markerLower)) {
      // 檢查後面是否緊跟著冒號（可選）
      let afterMarker = trimmed.substring(marker.length);
      // 如果後面是冒號，跳過它
      if (afterMarker.startsWith(':')) {
        afterMarker = afterMarker.substring(1).trim();
      } else {
        afterMarker = afterMarker.trim();
      }
      return { 
        hasMarker: true, 
        marker: marker,  // 返回的 marker 不包含冒號
        rest: afterMarker 
      };
    }
  }
  return { hasMarker: false, marker: '', rest: line };
}

function extractSectionMarkers(line, preserveSpacing = false) {
  const prefixMatch = line.match(/^(\s*[#*]\s*)/);
  const suffixMatch = line.match(/(?<![A-Ga-g])(\s*[#*]\s*)$/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const suffix = suffixMatch ? suffixMatch[1] : '';
  let cleanLine = line;
  if (prefix) cleanLine = cleanLine.substring(prefix.length);
  if (suffix) cleanLine = cleanLine.substring(0, cleanLine.length - suffix.length);
  return { prefix, suffix, cleanLine: preserveSpacing ? cleanLine : cleanLine.trim() };
}

function getSemitoneFromKey(key) {
  return KEY_TO_SEMITONE[key] ?? 0;
}

function calculateCapo(originalKey, selectedKey) {
  const originalSemitone = getSemitoneFromKey(originalKey);
  const selectedSemitone = getSemitoneFromKey(selectedKey);
  let capo = (originalSemitone - selectedSemitone) % 12;
  if (capo < 0) capo += 12;
  return capo;
}

function getCapoSuggestion(capo) {
  if (capo === 0) {
    return { capo: 0, status: 'none', message: '無需變調夾', alternative: null };
  }
  if (capo >= 1 && capo <= 8) {
    return { capo: capo, status: 'ok', message: `建議 Capo: ${capo}`, alternative: null };
  }
  // Capo 9-11: 建議 Drop Tuning 替代方案
  if (capo === 11) {
    return { 
      capo: capo, 
      status: 'high',
      message: `Capo ${capo} 位置過高`,
      alternative: { 
        type: 'dropTuning', 
        tuning: 'Eb Tuning',
        tuningDesc: '降半音調音 (Eb Ab Db Gb Bb Eb)',
        newCapo: 1,
        message: '改用 Eb Tuning，Capo 1'
      }
    };
  }
  if (capo === 10) {
    return { 
      capo: capo, 
      status: 'high',
      message: `Capo ${capo} 位置過高`,
      alternative: { 
        type: 'dropTuning', 
        tuning: 'D Tuning',
        tuningDesc: '降全音調音 (D G C F A D)',
        newCapo: 0,
        message: '改用 D Tuning，免 Capo'
      }
    };
  }
  if (capo === 9) {
    return { 
      capo: capo, 
      status: 'high',
      message: `Capo ${capo} 位置過高`,
      alternative: { 
        type: 'dropTuning', 
        tuning: 'Db Tuning',
        tuningDesc: '降一個半音調音 (Db Gb B E Ab Db)',
        newCapo: 0,
        message: '改用 Db Tuning，免 Capo'
      }
    };
  }
  return { capo: null, status: 'invalid', message: '', alternative: null };
}

// 檢查是否為簡譜行（數字譜，如 5 5 6 6 或 (6.)6.13312）
function isNumericNotationLine(line) {
  if (!line) return false;
  
  // 簡譜特徵：
  // 1. 大量數字（多於 3 個）- 支持 1' 高音, 5# 升號, 5, 低音
  // 2. 可以包含括號內的數字 (6.)、(2) 等
  // 3. 很少或沒有中文字符（少於 3 個）
  // 4. 冇和弦豎線 |
  // 5. 英文字母要少（簡譜只有 b, # 是合法的）
  
  // 匹配完整簡譜音符：數字 + 可選的一個修飾符 ' 或 # 或 ,（如 1', 5#, 6, 7,）
  // 使用 ? 而不是 *，避免 2'1' 被當作一個音符
  const notationPattern = /\d['#,b]?/g;
  const notationMatches = line.match(notationPattern) || [];
  const notationCount = notationMatches.length;
  
  // 也計算純數字（向後兼容）
  const digits = (line.match(/\d/g) || []).length;
  const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length;
  const hasChordBar = /\|[\s]*[A-G]/.test(line);
  
  // 檢查英文字母（簡譜只應有 b, # 或少量其他字母，英文歌詞上方也可能有簡譜）
  const allLetters = (line.match(/[a-zA-Z]/g) || []);
  const otherLetters = allLetters.filter(c => !/[b#]/i.test(c));
  
  // 放寛限制：如果有很多數字，即使有英文字母也可能是簡譜（如英文歌詞上方的簡譜）
  // 但如果英文字母比數字還多，就不是簡譜
  if (otherLetters.length > digits) {
    return false;
  }
  
  // 簡譜音符多（>3）、中文字少（<3）、冇和弦 = 簡譜
  if ((notationCount > 3 || digits > 3) && chineseChars < 3 && !hasChordBar) {
    return true;
  }
  
  // 舊版兼容：有括號數字模式（半形或全形），支援 (7,) 低音等
  if (line.includes('(') || line.includes('（')) {
    const numericBracketPattern = /[\(（]\d+['#,.b]?[\)）]/g;
    const numericBrackets = line.match(numericBracketPattern) || [];
    if (numericBrackets.length >= 1 && (notationCount > 3 || digits > 3) && chineseChars < 3 && otherLetters.length <= digits) {
      return true;
    }
  }
  
  return false;
}

// 是否為「僅括號內數字簡譜」行，如 (3) (2) (7,) (1) — 唔好當成歌詞行
function isBracketsOnlyNumberedNotationLine(line) {
  if (!line || !/[\(（]/.test(line) || /[\|｜\u2502][\s]*[A-G]/.test(line)) return false;
  const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseChars >= 2) return false;
  const bracketContentRegex = /[\(（]([^\)）]*)[\)）]/g;
  let match;
  let hasNotation = false;
  let allNotationOrEmpty = true;
  while ((match = bracketContentRegex.exec(line)) !== null) {
    const inner = match[1].trim();
    if (inner.length > 0) {
      if (/^\d+['#,.b]?$/.test(inner)) hasNotation = true;
      else allNotationOrEmpty = false;
    }
  }
  if (!hasNotation || !allNotationOrEmpty) return false;
  // 括號外若有英文／中文，即係歌詞行（如 See you (5) 45(3)），唔好當簡譜
  const outsideBrackets = line.replace(/[\(（][^\)）]*[\)）]/g, '');
  if (/[a-zA-Z\u4e00-\u9fff]/.test(outsideBrackets)) return false;
  return true;
}

// 從簡譜行提取所有音符（支持 1', 5#, 6, 7, 等格式，逗號表示低音）
function extractNotationNumbers(line) {
  const numbers = [];
  // 匹配完整簡譜音符：數字 + 可選的一個修飾符 ' 或 # 或 ,（高音/升號/低音）
  // 使用 ? 而不是 *，避免 2'1' 被當作一個音符
  const regex = /\d['#,b]?/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    numbers.push({
      value: match[0],
      index: match.index
    });
  }
  return numbers;
}

// 從歌詞行提取字符（中文每個字算一個，英文每個單詞算一個，[~]算一個，空格和括號不計）
function extractLyricChars(line) {
  const chars = [];
  // 先移除括號（半形 + 全形），再匹配中文字、英文單詞或 [~]
  const lineWithoutBrackets = line.replace(/[()（）]/g, '');
  // 支援 [~] 作為佔位符（一個字對應多個音時使用）
  const charRegex = /[\u4e00-\u9fff]|[a-zA-Z]+|\[~\]/g;
  let match;
  while ((match = charRegex.exec(lineWithoutBrackets)) !== null) {
    chars.push({
      char: match[0],
      index: match.index
    });
  }
  return chars;
}

// 從歌詞行提取顯示單元（括號組 + 非括號文字）
function extractLyricUnits(line) {
  const units = [];
  let i = 0;
  
  while (i < line.length) {
    if (line[i] === '(' || line[i] === '（') {
      // 找到完整的括號對（半形或全形）
      const openBracket = line[i];
      const closeBracket = openBracket === '(' ? ')' : '）';
      let bracketContent = openBracket;
      let j = i + 1;
      while (j < line.length && line[j] !== closeBracket) {
        bracketContent += line[j];
        j++;
      }
      if (j < line.length && line[j] === closeBracket) {
        bracketContent += closeBracket;
        j++;
      }
      units.push({
        type: 'bracket',
        content: bracketContent,
        startIndex: i,
        endIndex: j,
        hasChinese: /[\u4e00-\u9fff]/.test(bracketContent)
      });
      i = j;
    } else {
      // 非括號文字
      let text = '';
      let startIndex = i;
      while (i < line.length && line[i] !== '(' && line[i] !== '（') {
        text += line[i];
        i++;
      }
      if (text) {
        // 計算字符數：中文每個字算一個，英文每個單詞算一個，[~]算一個（空格不計）
        const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
        const tildeCount = (text.match(/\[~\]/g) || []).length;
        units.push({
          type: 'text',
          content: text,
          startIndex: startIndex,
          endIndex: i,
          chineseChars: chineseCount + englishWords + tildeCount
        });
      }
    }
  }
  
  return units;
}

// 將簡譜數字與歌詞字對齊
function alignNotationWithLyrics(notationLine, lyricLine) {
  const numbers = extractNotationNumbers(notationLine);
  const lyricChars = extractLyricChars(lyricLine);
  const lyricUnits = extractLyricUnits(lyricLine);
  
  // 如果數量不匹配，返回 null（使用普通渲染）
  if (numbers.length !== lyricChars.length || numbers.length === 0) {
    return null;
  }
  
  // 為每個中文字分配一個簡譜數字
  const result = [];
  let charIndex = 0;
  
  for (const unit of lyricUnits) {
    if (unit.type === 'bracket') {
      // 括號單元 - 只計算中文、英文單詞和 [~]（括號本身不計）
      const innerContent = unit.content.slice(1, -1); // 去掉首尾括號
      const chineseCount = (innerContent.match(/[\u4e00-\u9fff]/g) || []).length;
      const englishWords = (innerContent.match(/[a-zA-Z]+/g) || []).length;
      const tildeCount = (innerContent.match(/\[~\]/g) || []).length;
      const unitCharCount = chineseCount + englishWords + tildeCount;
      
      if (unitCharCount === 0) {
        // 空括號或無字符 - 白色
        result.push({
          type: 'bracket',
          content: unit.content,
          notation: null,
          isInside: true
        });
      } else if (unitCharCount === 1) {
        // 單個字符在括號內 - 只取括號內的字符（去掉括號）用於寬度計算
        const innerContent = unit.content.slice(1, -1); // 去掉首尾括號
        result.push({
          type: 'pair',
          notation: numbers[charIndex]?.value || '',
          lyric: innerContent, // 存括號內的純文字，不包括括號
          isInside: true
        });
        charIndex++;
      } else {
        // 多個字符在括號內 - 為每個字符創建獨立的 pair
        const innerContent = unit.content.slice(1, -1);
        // 匹配中文字、英文單詞或 [~]
        const charMatches = [...innerContent.matchAll(/[\u4e00-\u9fff]|[a-zA-Z]+|\[~\]/g)];
        
        for (let i = 0; i < charMatches.length; i++) {
          const char = charMatches[i][0];
          const isLast = i === charMatches.length - 1;
          
          result.push({
            type: 'pair',
            notation: numbers[charIndex]?.value || '',
            lyric: char, // 每個字符獨立
            isInside: true
          });
          charIndex++;
        }
      }
    } else {
      // 純文字單元
      const text = unit.content;
      // 匹配中文字、英文單詞或 [~]
      const charMatches = [...text.matchAll(/[\u4e00-\u9fff]|[a-zA-Z]+|\[~\]/g)];
      
      if (charMatches.length === 0) {
        // 無字符
        result.push({
          type: 'text',
          content: text
        });
      } else {
        // 有需要對齊的字符
        let lastIndex = 0;
        for (const match of charMatches) {
          const charPos = match.index;
          // 字前的其他文字
          if (charPos > lastIndex) {
            result.push({
              type: 'text',
              content: text.substring(lastIndex, charPos)
            });
          }
          // 這個字符
          result.push({
            type: 'pair',
            notation: numbers[charIndex]?.value || '',
            lyric: match[0],
            isInside: false
          });
          charIndex++;
          lastIndex = charPos + match[0].length;
        }
        // 剩餘的非中文字
        if (lastIndex < text.length) {
          result.push({
            type: 'text',
            content: text.substring(lastIndex)
          });
        }
      }
    }
  }
  
  return result;
}

// 處理簡譜行（數字旋律譜）- 括號內所有內容（數字+歌詞）標記為白色
function processNumericNotationLine(line) {
  // 如果冇括號，成行都係簡譜數字（粉紅色）
  if (!line.includes('(') && !line.includes('（')) {
    return [{ type: 'outside', content: line }];
  }
  
  // 解析括號內容：(內容) 或 （內容）- 包括數字簡譜和歌詞
  const parts = [];
  let buffer = '';
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '(' || char === '（') {
      // 保存括號前的內容（簡譜數字）
      if (buffer) {
        parts.push({ type: 'outside', content: buffer });
        buffer = '';
      }
      
      // 確定對應的閉合括號
      const closeBracket = char === '(' ? ')' : '）';
      
      // 讀取括號內容（包括數字和歌詞）
      let bracketContent = char;
      i++;
      while (i < line.length && line[i] !== closeBracket) {
        bracketContent += line[i];
        i++;
      }
      if (i < line.length && line[i] === closeBracket) {
        bracketContent += closeBracket;
        i++;
      }
      
      // 括號內所有內容（數字+歌詞）都標記為 inside（白色）
      parts.push({ type: 'inside', content: bracketContent });
    } else {
      buffer += char;
      i++;
    }
  }
  
  // 保存剩餘內容
  if (buffer) {
    parts.push({ type: 'outside', content: buffer });
  }
  
  return parts;
}

// 將簡譜文字中的 1'（高音）/ 5,（低音）/ 6b（降）/ 5#（升）渲染為視覺化符號
function renderNotationToken(text, color, keyPrefix = '') {
  if (!text) return null;
  // 匹配：數字+高音' / 數字+低音, / 數字+降b / 數字+升#
  const tokenRegex = /(\d)([',b#])/g;
  const result = [];
  let lastIndex = 0;
  let match;
  let idx = 0;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(<span key={`${keyPrefix}p${idx++}`} style={{ color }}>{text.slice(lastIndex, match.index)}</span>);
    }
    const digit = match[1];
    const modifier = match[2];
    if (modifier === "'") {
      result.push(
        <span key={`${keyPrefix}h${idx++}`} style={{ position: 'relative', display: 'inline-block', textAlign: 'center', color, width: '0.6em' }}>
          <span style={{ position: 'absolute', top: '-0.6em', left: 0, right: 0, textAlign: 'center', lineHeight: 1, fontSize: '0.5em' }}>{'\u2022'}</span>
          {digit}
        </span>
      );
    } else if (modifier === ',') {
      result.push(
        <span key={`${keyPrefix}l${idx++}`} style={{ position: 'relative', display: 'inline-block', textAlign: 'center', color, width: '0.6em' }}>
          {digit}
          <span style={{ position: 'absolute', bottom: '-0.55em', left: 0, right: 0, textAlign: 'center', lineHeight: 1, fontSize: '0.5em' }}>{'\u2022'}</span>
        </span>
      );
    } else if (modifier === 'b') {
      result.push(
        <span key={`${keyPrefix}f${idx++}`} style={{ color }}>
          {digit}<span style={{ fontSize: '0.75em' }}>{'\u266D'}</span>
        </span>
      );
    } else if (modifier === '#') {
      result.push(
        <span key={`${keyPrefix}s${idx++}`} style={{ color }}>
          {digit}<span style={{ fontSize: '0.75em' }}>{'\u266F'}</span>
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex === 0) {
    return <span style={{ color }}>{text}</span>;
  }
  if (lastIndex < text.length) {
    result.push(<span key={`${keyPrefix}p${idx++}`} style={{ color }}>{text.slice(lastIndex)}</span>);
  }
  return result;
}

// 從簡譜行提取和弦、數字簡譜、歌詞
function extractNumericNotationComponents(line) {
  const components = {
    chords: [],      // 和弦數組，帶位置
    notations: [],   // 數字簡譜數組
    lyrics: []       // 歌詞數組
  };
  
  // 先處理 | 小節線
  const segments = line.split('|').map(s => s.trim()).filter(s => s);
  
  segments.forEach((segment, segIdx) => {
    // 在segment中找括號
    const regex = /(\([^)]*\))/g;
    let match;
    let lastIndex = 0;
    
    while ((match = regex.exec(segment)) !== null) {
      const bracketPos = match.index;
      const bracketContent = match[1]; // (內容)
      
      // 括號前的是和弦（如果有）
      const beforeBracket = segment.substring(lastIndex, bracketPos).trim();
      if (beforeBracket) {
        // 檢查是否為和弦
        const chordMatch = beforeBracket.match(/[A-G][#b]?(?:maj|mj|m|min|dim|aug|sus|add|m7|7|9|11|13)?$/);
        if (chordMatch) {
          components.chords.push({
            chord: chordMatch[0],
            position: segIdx,
            notation: bracketContent
          });
        }
      }
      
      // 括號內的是數字簡譜
      components.notations.push({
        notation: bracketContent,
        position: segIdx
      });
      
      lastIndex = regex.lastIndex;
    }
  });
  
  return components;
}

// 檢查是否為混合行（同時包含和弦和歌詞）
function isMixedLine(line) {
  // 必須包含括號（歌詞標記）- 半形或全形
  if (!line.includes('(') && !line.includes('（')) return false;
  
  // 排除數字譜行（大量數字、少中文字）
  const digits = (line.match(/\d/g) || []).length;
  const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length;
  if (digits > 5 && chineseChars < 3) {
    return false; // 這是數字譜行，不是混合行
  }
  
  // 檢查是否有 Section Marker
  const sectionInfo = extractSectionMarker(line);
  if (sectionInfo.hasMarker) {
    // 有 Section Marker 的行，檢查剩餘部分是否包含 |
    const rest = sectionInfo.rest;
    return /\|/.test(rest) && (/\(/.test(rest) || /\（/.test(rest));
  }
  
  // 沒有 Section Marker，檢查是否包含 | 開頭的和弦 + 括號歌詞（含延續低音 /B）
  // 但排除純歌詞行（只有中文字和括號）
  const hasChordBar = lineHasChordMarker(line);
  const hasLyricBracket = /[\(（][^A-G]/.test(line); // 括號內不是和弦（避免誤判）
  
  // 如果中文字比例高，視為歌詞行而非混合行
  const chineseRatio = chineseChars.length / line.length;
  if (chineseRatio > 0.3) {
    return false;
  }
  
  return hasChordBar && hasLyricBracket;
}

// 嚴格檢查字符串是否只包含和弦相關字符（不包含中文字）
function isChordOnly(str) {
  // 移除空格後檢查
  const trimmed = str.trim();
  if (!trimmed) return true;
  
  // 如果係純數字（指法譜），唔係和弦
  if (/^[\d\s\.]+$/.test(trimmed)) {
    return false;
  }
  
  // 檢查係咪數字譜格式（如 (1)351' 或 6.7.1' 等）
  // 數字譜特徵：大量數字、點、括號、撇號，少於2個和弦
  const digits = (trimmed.match(/\d/g) || []).length;
  const chordRoots = (trimmed.match(/[A-G][#b]?/g) || []).length;
  
  // 如果數字多過和弦根音超過3倍，可能係數字譜
  if (digits > 6 && chordRoots < 2) {
    return false;
  }
  
  // 只允許：A-G, #, b, m, a, j, s, u, d, i, M, n, 0-9, /, -, +, *, (, ), |
  return /^[A-Ga-g#b0-9mMsSjJuUaAdDiInN\/\+\-\*\(\)\|\s]+$/.test(trimmed);
}

// 從 segment 提取和弦（到第一個中文字或 ( 為止）
function extractChordPart(segment) {
  let chordPart = '';
  let lyricPart = '';
  let foundLyric = false;
  
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    const charCode = char.charCodeAt(0);
    
    // 檢查是否為中文字或已經開始歌詞部分
    if (!foundLyric) {
      // 如果是中文字，開始歌詞部分
      if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
        foundLyric = true;
        lyricPart += char;
      } else if (char === '(' || char === '（') {
        // 遇到 ( 或 （ 也開始歌詞部分
        foundLyric = true;
        lyricPart += char;
      } else {
        chordPart += char;
      }
    } else {
      lyricPart += char;
    }
  }
  
  return { chord: chordPart.trim(), lyric: lyricPart.trim() };
}

// 處理混合行 - 將交替出現的和弦與歌詞分開
function processMixedLine(line, transposeSemitones = 0, preferFlats = false) {
  // 先確保和弦之間有空格
  const lineWithSpacing = normalizeChordSpacing(line);
  const normalizedLine = normalizeInput(lineWithSpacing);
  
  // 先檢查是否有 Section Marker
  const sectionInfo = extractSectionMarker(normalizedLine);
  const sectionPrefix = sectionInfo.hasMarker ? sectionInfo.marker : '';
  let remaining = sectionInfo.rest;
  
  // 用 | 分割行
  const segments = [];
  const parts = remaining.split('|').filter(p => p.trim());
  
  for (const part of parts) {
    // 提取和弦部分和歌詞部分
    const { chord, lyric } = extractChordPart(part);
    if (chord || lyric) {
      segments.push({ chord: chord || '', lyric: lyric || '' });
    }
  }
  
  if (segments.length === 0) {
    return { 
      sectionMarker: sectionPrefix,
      chordPart: remaining, 
      lyricParts: [{ text: remaining, isInside: false }], 
      error: true 
    };
  }
  
  // 組合所有和弦段落
  let chordLine = '';
  segments.forEach((seg, idx) => {
    if (idx > 0) chordLine += ' |';
    if (seg.chord) chordLine += ' ' + seg.chord;
  });
  
  // 處理轉調
  if (transposeSemitones !== 0) {
    chordLine = transposeChordLine(chordLine, transposeSemitones, false, preferFlats);
  }
  
  // 組合所有歌詞段落
  const lyricParts = [];
  segments.forEach((seg, idx) => {
    if (seg.lyric) {
      // 解析括號，將括號與內容分開處理（支持隱藏括號功能）
      let buffer = '';
      let inBracket = false;
      for (let char of seg.lyric) {
        if (char === '(' || char === '（') {
          if (buffer) lyricParts.push({ text: buffer, isInside: false, type: 'text' });
          lyricParts.push({ text: char, isInside: false, type: 'bracket-open' });
          buffer = '';
          inBracket = true;
        } else if (char === ')' || char === '）') {
          if (buffer) lyricParts.push({ text: buffer, isInside: true, type: 'inside' });
          lyricParts.push({ text: char, isInside: false, type: 'bracket-close' });
          buffer = '';
          inBracket = false;
        } else {
          buffer += char;
        }
      }
      if (buffer) lyricParts.push({ text: buffer, isInside: inBracket, type: inBracket ? 'inside' : 'text' });
    }
    // 段落之間加空格
    if (idx < segments.length - 1) {
      lyricParts.push({ text: '  ', isInside: false, type: 'text' });
    }
  });
  
  return { 
    sectionMarker: sectionPrefix,
    chordPart: chordLine || '|', 
    lyricParts, 
    error: false 
  };
}

function processPair(chordLine, lyricLine, transposeSemitones = 0, hideBrackets = false, displayFont = 'mono', preferFlats = false) {
  // Arial 模式下，唔好做複雜對齊，直接返回原始行
  if (displayFont === 'arial') {
    return {
      chordLine: transposeSemitones !== 0 ? transposeChordLine(chordLine, transposeSemitones, false, preferFlats) : chordLine,
      lyricParts: [{ text: lyricLine, isInside: false, type: 'text' }],
      error: false
    };
  }
  // 人手空格對位：唔做 chord 對括號對齊，保留用戶輸入嘅空格
  if (displayFont === 'manual') {
    const barOnly = chordLine.replace(/｜/g, '|').replace(/\u2502/g, '|');
    return {
      chordLine: transposeSemitones !== 0 ? transposeChordLine(barOnly, transposeSemitones, true, preferFlats) : barOnly,
      lyricParts: [{ text: lyricLine, isInside: false, type: 'text' }],
      error: false
    };
  }

  const preserveBarSpacing = displayFont === 'mono' || displayFont === 'manual';
  const chordWithSpacing = normalizeChordSpacing(chordLine, preserveBarSpacing);
  const normalizedChord = normalizeInput(chordWithSpacing);
  const normalizedLyric = normalizeInput(lyricLine);
  // 計算開括號位置（統一使用原位置，無論顯示/隱藏括號都保持相同寬度）
  const bracketPositions = findBracketPositions(normalizedLyric);
  
  // 解析和弦行，記錄每個 token 及其位置
  const tokens = [];
  let i = 0;
  const chars = Array.from(normalizedChord);
  
  while (i < chars.length) {
    while (i < chars.length && chars[i] === ' ') i++;
    if (i >= chars.length) break;
    
    let hasBar = false;
    if (chars[i] === '|') {
      hasBar = true;
      i++;
      while (i < chars.length && chars[i] === ' ') i++;
    }
    
    let tokenName = '';
    while (i < chars.length && chars[i] !== ' ' && chars[i] !== '\u3000' && chars[i] !== '|') {
      tokenName += chars[i];
      i++;
    }
    
    // 處理和弦（A-G 開頭）、延續低音 /B /G、NC（No Chord）、或延長符號/節奏記號（-、*、2/4 等）
    if (tokenName) {
      let displayName = tokenName;
      const isSlashBassOnly = isSlashBassContinuationToken(tokenName)
      let isChord = /^[A-G]/.test(tokenName) || isSlashBassOnly;
      let isDash = tokenName === '-' || tokenName === '*' || /^\d+\/\d+$/.test(tokenName) || /^N\.?C\.?$/i.test(tokenName);
      
      // 如果是和弦，處理轉調
      if (isChord && transposeSemitones !== 0) {
        displayName = isSlashBassOnly
          ? transposeSlashBassOnly(tokenName, transposeSemitones, preferFlats)
          : transposeChord(tokenName, transposeSemitones, preferFlats);
      }
      
      tokens.push({
        name: displayName,
        fullToken: hasBar ? '|' + displayName : displayName,
        isBarStart: hasBar,
        isChord: isChord,
        isDash: isDash,
        width: getTextWidth(hasBar ? '|' + displayName : displayName),
        nameWidth: getTextWidth(displayName)
      });
    } else if (hasBar) {
      // Standalone trailing bar marker (e.g. the final | in "|C - Am|")
      tokens.push({
        name: '|',
        fullToken: '|',
        isBarStart: false,
        isChord: false,
        isDash: false,
        isBarEnd: true,
        width: getTextWidth('|'),
        nameWidth: getTextWidth('|')
      });
    }
  }
  
  // 分離和弦（需要對齊）同延長符號（按位置顯示）
  const chordTokens = tokens.filter(t => t.isChord);
  
  // 檢查和弦數量是否匹配括號數量
  const mismatch = chordTokens.length !== bracketPositions.length;
  
  // 即使不匹配，也嘗試對齊（取最小值）
  const minCount = Math.min(chordTokens.length, bracketPositions.length);
  const extraChordCount = chordTokens.length - minCount;
  const totalLyricWidth = getTextWidth(normalizedLyric);

  // 計算每個 token 應該對齊嘅位置
  // 和弦對齊括號，延長符號平均分布在前後和弦之間
  const tokenPositions = [];
  let chordIdx = 0;
  
  // 先收集所有延長符號，按它們在前後和弦之間的位置分組
  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    
    if (token.isChord) {
      // 如果還有括號位置，對齊；否則在剩餘歌詞寬度內自然攤開
      if (chordIdx < minCount) {
        tokenPositions.push(bracketPositions[chordIdx]);
      } else {
        // 冇括號時：第一個和弦由 0 開始，唔加開頭空格；其餘在 totalLyricWidth 內均分
        const lastPos = bracketPositions.length > 0 ? bracketPositions[bracketPositions.length - 1] : 0;
        const remainingWidth = Math.max(0, totalLyricWidth - lastPos);
        const numExtra = chordIdx - minCount; // 0-based index among extra chords
        const totalExtra = extraChordCount;
        const pos = bracketPositions.length > 0
          ? lastPos + Math.round(remainingWidth * (numExtra + 1) / (totalExtra + 1))
          : (totalExtra <= 1 ? 0 : Math.round(totalLyricWidth * numExtra / (totalExtra - 1)));
        tokenPositions.push(pos);
      }
      chordIdx++;
    } else {
      // 延長符號：找前後和弦，然後平均分布
      let prevChordIdx = -1;  // 在 tokens 中的索引
      let nextChordIdx = -1;  // 在 tokens 中的索引
      let prevChordBracketIdx = -1;  // 在 bracketPositions 中的索引
      let nextChordBracketIdx = -1;  // 在 bracketPositions 中的索引
      
      // 找前一個和弦
      let chordCount = 0;
      for (let j = idx - 1; j >= 0; j--) {
        if (tokens[j].isChord) {
          prevChordIdx = j;
          prevChordBracketIdx = chordCount;
          break;
        }
        if (tokens[j].isChord) chordCount++;
      }
      
      // 重新計算前一個和弦的 bracket 索引
      chordCount = 0;
      for (let j = 0; j < idx; j++) {
        if (tokens[j].isChord) {
          prevChordBracketIdx = chordCount;
          chordCount++;
        }
      }
      prevChordBracketIdx = chordCount - 1;
      
      // 找後一個和弦
      chordCount = 0;
      for (let j = 0; j < tokens.length; j++) {
        if (tokens[j].isChord) {
          if (j > idx) {
            nextChordIdx = j;
            nextChordBracketIdx = chordCount;
            break;
          }
          chordCount++;
        }
      }
      
      if (prevChordBracketIdx >= 0 && nextChordBracketIdx >= 0) {
        // 計算這個延長符號是第幾個在這對和弦之間的
        let dashIndexInGap = 0;
        let totalDashesInGap = 0;
        for (let j = prevChordIdx + 1; j < nextChordIdx; j++) {
          if (tokens[j].isDash) {
            if (j < idx) dashIndexInGap++;
            totalDashesInGap++;
          }
        }
        
        const prevPos = bracketPositions[prevChordBracketIdx];
        const nextPos = bracketPositions[nextChordBracketIdx];
        const gap = nextPos - prevPos;
        
        // 平均分布：把 gap 分成 (totalDashesInGap + 1) 份
        const step = gap / (totalDashesInGap + 1);
        const pos = Math.round(prevPos + step * (dashIndexInGap + 1));
        tokenPositions.push(pos);
      } else if (prevChordBracketIdx >= 0) {
        tokenPositions.push(bracketPositions[prevChordBracketIdx] + 4);
      } else if (nextChordBracketIdx >= 0) {
        tokenPositions.push(Math.max(0, bracketPositions[nextChordBracketIdx] - 4));
      } else {
        tokenPositions.push(0);
      }
    }
  }

  // 重建和弦行 - 使用半形空格對齊（避免全形空格字體 fallback 不一致）
  let newChordLine = '';
  let currentVisualWidth = 0;
  
  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    const targetPos = tokenPositions[idx];
    
    // 直接定位到 targetPos
    let startCol = targetPos;
    if (token.isBarStart) startCol -= 0.5;
    startCol = Math.round(startCol);
    if (startCol < 0) startCol = 0;
    
    // 計算需要填充嘅視覺寬度
    const spacesNeeded = startCol - currentVisualWidth;
    if (spacesNeeded > 0) {
      newChordLine += ' '.repeat(spacesNeeded);
      currentVisualWidth += spacesNeeded;
    } else if (idx > 0) {
      newChordLine += ' ';
      currentVisualWidth += 1;
    }
    
    newChordLine += token.fullToken;
    currentVisualWidth += token.width;
  }

  const parts = [];
  let buffer = '';
  let inBracket = false;
  
  for (let char of normalizedLyric) {
    // 跳過換行符
    if (char === '\n' || char === '\r') {
      continue;
    }
    if (char === '(' || char === '（') {
      // 括號前的內容
      if (buffer) parts.push({ text: buffer, isInside: false, type: 'text' });
      // 開括號獨立記錄（保留原始字符）
      parts.push({ text: char, isInside: false, type: 'bracket-open' });
      buffer = '';
      inBracket = true;
    } else if (char === ')' || char === '）') {
      // 括號內容
      if (buffer) {
        const normalizedBuffer = buffer.replace(/ /g, '\u3000');
        parts.push({ text: normalizedBuffer, isInside: true, type: 'inside' });
      }
      // 閉括號獨立記錄（保留原始字符）
      parts.push({ text: char, isInside: false, type: 'bracket-close' });
      buffer = '';
      inBracket = false;
    } else {
      buffer += char;
    }
  }
  if (buffer) {
    // 處理剩餘內容
    const normalizedBuffer = inBracket ? buffer.replace(/ /g, '\u3000') : buffer;
    parts.push({ text: normalizedBuffer, isInside: inBracket, type: inBracket ? 'inside' : 'text' });
  }

  const lyricSplit = splitLyricAtBrackets(normalizedLyric);
  const alignedChords = lyricSplit
    ? (() => {
        const groups = [];
        for (let idx = 0; idx < tokens.length; idx++) {
          const t = tokens[idx];
          if (t.isChord) {
            const trailing = [];
            for (let j = idx + 1; j < tokens.length && !tokens[j].isChord; j++) {
              trailing.push(tokens[j]);
            }
            // Attach trailing bar-end to the chord itself (e.g. Am| not Am ... |)
            let barEnd = false;
            if (trailing.length > 0 && trailing[trailing.length - 1].isBarEnd) {
              trailing.pop();
              barEnd = true;
            }
            groups.push({
              displayName: t.name + (barEnd ? '|' : ''),
              fullToken: t.fullToken + (barEnd ? '|' : ''),
              isBarStart: t.isBarStart,
              trailing,
            });
          }
        }
        return groups;
      })()
    : null;

  // Build positioned chord data for absolute positioning
  const positionedChords = tokens.map((t, idx) => ({
    ...t,
    position: tokenPositions[idx],
  }));

  return { chordLine: newChordLine, lyricParts: parts, error: mismatch, lyricSplit, alignedChords, positionedChords };
}

// ============ 自動拆分長歌詞行 ============
// 將長的和弦行和歌詞行拆分成多對，保持每對不換行
// 只在手機版（屏幕寬度 < 768px）時啟用
function splitLongPair(chordLine, lyricLine, maxChars = 28, isMobile = false) {
  // 暫時禁用自動拆分功能，避免文字丟失和對齊問題
  // 直接返回原樣，讓歌詞自然換行
  return [{ chordLine, lyricLine }];
}

// Find index of space character closest to the middle of the lyric line (for post-render split).
// Only considers spaces outside parentheses so we never split inside e.g. (　) and break bracket pairing.
function findSpaceIndexNearestMiddle(lyricLine) {
  if (!lyricLine || typeof lyricLine !== 'string') return -1;
  const len = lyricLine.length;
  const mid = len / 2;
  const spaceIndices = [];
  let depth = 0;
  for (let i = 0; i < len; i++) {
    const c = lyricLine[i];
    if (c === '(' || c === '（') depth++;
    else if (c === ')' || c === '）') depth--;
    else if (depth === 0 && (c === ' ' || c === '\u3000')) spaceIndices.push(i);
  }
  if (spaceIndices.length === 0) return -1;
  let best = spaceIndices[0];
  let bestDist = Math.abs(best - mid);
  for (let i = 1; i < spaceIndices.length; i++) {
    const d = Math.abs(spaceIndices[i] - mid);
    if (d < bestDist) {
      bestDist = d;
      best = spaceIndices[i];
    }
  }
  return best;
}

// Build chord line string from a slice of alignedChords (from processPair result)
function buildChordLineFromAlignedChords(alignedChords) {
  if (!alignedChords || alignedChords.length === 0) return '|';
  let s = '';
  for (const c of alignedChords) {
    s += (c.isBarStart ? ' |' : ' ');
    s += c.displayName;
    if (c.trailing && c.trailing.length > 0) {
      for (const t of c.trailing) {
        s += (t.isBarStart ? ' |' : ' ') + t.name;
      }
    }
  }
  return s.trimStart() || '|';
}

// Split one pair into two at space nearest middle; uses result.lyricSplit and result.alignedChords to split chords
function splitPairAtSpaceNearestMiddle(pair, result) {
  const { chordLine, lyricLine } = pair;
  if (!lyricLine || !result?.lyricSplit?.segments?.length || !result?.alignedChords?.length) return null;
  const splitIdx = findSpaceIndexNearestMiddle(lyricLine);
  if (splitIdx <= 0 || splitIdx >= lyricLine.length - 1) return null;
  const lyric1 = lyricLine.slice(0, splitIdx).trimEnd();
  const lyric2 = lyricLine.slice(splitIdx).trimStart();
  if (!lyric1 || !lyric2) return null;
  const { preBracket = '', segments } = result.lyricSplit;
  let cumulative = (preBracket || '').length;
  let segIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    const endOfSeg = cumulative + segments[i].length;
    if (splitIdx <= endOfSeg) {
      segIdx = i;
      break;
    }
    cumulative = endOfSeg;
  }
  if (segIdx < 0) segIdx = segments.length - 1;
  const chordLine1 = buildChordLineFromAlignedChords(result.alignedChords.slice(0, segIdx + 1));
  const chordLine2 = buildChordLineFromAlignedChords(result.alignedChords.slice(segIdx + 1));
  if (!chordLine1 || !chordLine2) return null;
  return [
    { chordLine: chordLine1, lyricLine: lyric1 },
    { chordLine: chordLine2, lyricLine: lyric2 },
  ];
}

// Wrapper: after render, if chord/lyric line wraps to two lines, split at space nearest middle and re-render as two lines
// notationContent: optional React node rendered between chord line and lyric line (簡譜)
function ChordLyricBlockWithWrap({ pair, result, processPair, renderBlock, pairMarginBottom, notationContent }) {
  const containerRef = useRef(null);
  const firstLineRef = useRef(null);
  const [splitPairs, setSplitPairs] = useState(null);

  // Use useEffect (not useLayoutEffect) so SSR and client initial render match; wrap-split runs after paint on client.
  useEffect(() => {
    if (splitPairs) return;
    if (!containerRef.current || !firstLineRef.current) return;
    const containerHeight = containerRef.current.offsetHeight;
    const lineHeight = firstLineRef.current.offsetHeight;
    if (containerHeight > lineHeight * 1.3) {
      const split = splitPairAtSpaceNearestMiddle(pair, result);
      if (split) setSplitPairs(split);
    }
  }, [pair, result, splitPairs]);

  if (splitPairs && splitPairs.length === 2) {
    return (
      <>
        {splitPairs.map((p, idx) => (
          <div
            key={idx}
            style={{
              marginBottom: idx === 0 ? (pairMarginBottom ?? '0.05em') : 0,
            }}
          >
            {renderBlock(processPair(p), null, idx === 0 ? notationContent : null)}
          </div>
        ))}
      </>
    );
  }
  return renderBlock(result, { chordLineContainerRef: containerRef, firstChordSpanRef: firstLineRef }, notationContent);
}

// ============ 主組件 ============
const TabContent = ({ 
  content, 
  originalKey = 'C',
  playKey, // 實際內容的調（Capo後彈奏的調）
  editable = false,
  onContentChange,
  onKeyChange,
  showControls = true,
  className = '',
  initialKey,
  fullWidth = false,
  theme: externalTheme,
  setTheme: externalSetTheme,
  hideKeySelector = false,
  // 外部控制的字體大小和自動滾動
  externalFontSize,
  externalIsAutoScroll,
  externalScrollSpeed,
  onFontSizeChange,
  onAutoScrollChange,
  onScrollSpeedChange,
  // YouTube 和歌曲資訊
  youtubeVideoId,
  songInfo = {},
  // 編譜者名稱
  arrangedBy = '',
  // 上傳者ID（用於跳轉到Profile）
  uploaderId = '',
  // 顯示字體設定
  displayFont = 'mono',
  // GP 段落
  gpSegments = [],
  // GP 顯示主題
  gpTheme = 'dark',
  // 記譜編輯器匯出之六線譜（alphaTex）
  notationAlphaTex = '',
  // 外部控制的 showInfo（由父組件傳入，確保轉調時 YouTube 唔會閂）
  showInfo: externalShowInfo,
  setShowInfo: externalSetShowInfo,
  // 樂譜頁 layout：隱藏 ControlBar 內的 Key 行與底部控制行（由頁面自己渲染）
  hideKeyRowAndBottomBar = false,
  // 外部控制隱藏簡譜 / 括號（供底部黃 bar 用）
  externalHideNotation,
  externalHideBrackets,
  onHideNotationChange,
  onHideBracketsChange,
  scrollSmoothRef,
  /** 樂譜頁：撳和弦字時彈出指法圖（唔再播放試聽） */
  onChordPress
}) => {
  // 緩存 YouTube src，防止轉調時重新渲染 iframe
  const youtubeSrc = useMemo(() => {
    return youtubeVideoId ? `https://www.youtube.com/embed/${youtubeVideoId}?enablejsapi=1` : null;
  }, [youtubeVideoId]);
  // 使用 playKey 作為基準調（如果有的話）
  const baseKey = playKey || originalKey;
  const [currentKey, setCurrentKey] = useState(initialKey || baseKey);
  const [internalFontSize, setInternalFontSize] = useState(17);
  const [internalIsAutoScroll, setInternalIsAutoScroll] = useState(false);
  const [internalScrollSpeed, setInternalScrollSpeed] = useState(1);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content || '');
  const [internalTheme, setInternalTheme] = useState('night'); // 'night' | 'day'
  const [internalHideNotation, setInternalHideNotation] = useState(true);
  const [internalHideBrackets, setInternalHideBrackets] = useState(false);
  const hideNotation = externalHideNotation !== undefined ? externalHideNotation : internalHideNotation;
  const setHideNotation = onHideNotationChange !== undefined ? onHideNotationChange : setInternalHideNotation;
  const hideBrackets = externalHideBrackets !== undefined ? externalHideBrackets : internalHideBrackets;
  const setHideBrackets = onHideBracketsChange !== undefined ? onHideBracketsChange : setInternalHideBrackets;
  const [isMobile, setIsMobile] = useState(false); // 手機版檢測
  
  // 檢測是否為手機版
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 優先使用外部傳入的值，否則使用內部 state
  const theme = externalTheme !== undefined ? externalTheme : internalTheme;
  const setTheme = externalSetTheme !== undefined ? externalSetTheme : setInternalTheme;
  const fontSize = externalFontSize !== undefined ? externalFontSize : internalFontSize;
  const setFontSize = onFontSizeChange !== undefined ? (v) => onFontSizeChange(v) : setInternalFontSize;
  const isAutoScroll = externalIsAutoScroll !== undefined ? externalIsAutoScroll : internalIsAutoScroll;
  const setIsAutoScroll = onAutoScrollChange !== undefined ? (v) => onAutoScrollChange(v) : setInternalIsAutoScroll;
  const scrollSpeed = externalScrollSpeed !== undefined ? externalScrollSpeed : internalScrollSpeed;
  const setScrollSpeed = onScrollSpeedChange !== undefined ? (v) => onScrollSpeedChange(v) : setInternalScrollSpeed;
  
  const autoScrollRef = useRef(null);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // 主題顏色配置
  const themeColors = {
    night: {
      bg: '#121212',
      text: '#FFFFFF',
      lyricNormal: '#FFFFFF',
      lyricInside: '#FFFFFF',
      chord: '#FFD700',
      sectionMarker: '#FFFFFF',
      numericNotation: '#CCCCCC', // 淺灰色
      prefixSuffix: '#808080',
      comment: '#B3B3B3' // 旁白/註釋 - 白色偏灰
    },
    day: {
      bg: '#FFFFFF',
      text: '#000000',
      lyricNormal: '#000000',
      lyricInside: '#000000',
      chord: '#7C3AED', // 紫色（日間模式，比 violet-500 深一級）
      sectionMarker: '#000000',
      numericNotation: '#CCCCCC', // 淺灰色
      prefixSuffix: '#666666',
      comment: '#666666' // 旁白/註釋 - 灰色
    }
  };

  const colors = themeColors[theme];

  // 轉調計算：內容轉調以 baseKey 為準
  const transposeSemitones = calculateTransposeSemitones(baseKey, currentKey);
  const preferFlats = preferFlatsForDisplayKey(currentKey);
  // 但 Capo 顯示要以原調計算（顯示實際要夾幾多格）
  const displayCapo = calculateCapo(originalKey, currentKey);
  const capoSuggestion = getCapoSuggestion(displayCapo);

  // 強制使用 initialKey 作為初始值
  useEffect(() => {
    if (initialKey) {
      setCurrentKey(initialKey);
    }
  }, [initialKey]);

  // 監聽容器寬度變化
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    
    updateWidth();
    
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(containerRef.current);
    
    window.addEventListener('resize', updateWidth);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  // 自動滾動 - rAF + sub-pixel transform 實現真正平滑滾動
  useEffect(() => {
    const el = (scrollSmoothRef && scrollSmoothRef.current) || containerRef.current;
    if (isAutoScroll) {
      const pxPerSec = [0, 5, 9, 14, 19, 25][Math.max(1, Math.min(5, scrollSpeed))] || 9;
      const pxPerMs = pxPerSec / 1000;
      let lastTime = 0;
      let accum = 0;

      if (el) el.style.willChange = 'transform';

      let atBottom = false;
      const tick = (now) => {
        if (lastTime) {
          const maxY = document.documentElement.scrollHeight - window.innerHeight;
          if (window.scrollY >= maxY - 1) {
            if (!atBottom) {
              atBottom = true;
              accum = 0;
              if (el) el.style.transform = '';
            }
          } else {
            atBottom = false;
            accum += (now - lastTime) * pxPerMs;
            const steps = Math.floor(accum);
            if (steps > 0) {
              window.scrollBy(0, steps);
              accum -= steps;
            }
            if (el) el.style.transform = accum > 0 ? `translateY(${-accum}px)` : '';
          }
        }
        lastTime = now;
        autoScrollRef.current = requestAnimationFrame(tick);
      };
      autoScrollRef.current = requestAnimationFrame(tick);
    } else {
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }
      if (el) { el.style.willChange = ''; el.style.transform = ''; }
    }
    return () => {
      if (autoScrollRef.current) cancelAnimationFrame(autoScrollRef.current);
      if (el) { el.style.willChange = ''; el.style.transform = ''; }
    };
  }, [isAutoScroll, scrollSpeed, scrollSmoothRef]);

  const handleFontSize = (delta) => {
    const newSize = Math.max(12, Math.min(28, fontSize + delta));
    if (onFontSizeChange) {
      onFontSizeChange(newSize);
    } else {
      setInternalFontSize(newSize);
    }
  };

  const handleCopy = useCallback(() => {
    if (content) {
      navigator.clipboard.writeText(content);
    }
  }, [content]);

  const handleSave = () => {
    if (onContentChange) {
      onContentChange(editContent);
    }
    setIsEditing(false);
  };

  // 計算單行字體大小 - 統一所有行使用相同字體大小
  const getLineFontSize = (lineText, isChordLine = false) => {
    return Math.max(10, Math.min(28, Math.round(fontSize)));
  };

  // 處理歌詞行：括號外灰色，括號內白色
  const processLyricLine = (line) => {
    const parts = [];
    let buffer = '';
    let inBracket = false;
    
    for (let char of line) {
      // 跳过换行符，避免产生空行
      if (char === '\n' || char === '\r') {
        continue;
      }
      if (char === '(' || char === '（') {
        // 括號前的內容
        if (buffer) {
          parts.push({ type: inBracket ? 'inside' : 'outside', text: buffer });
          buffer = '';
        }
        // 將開括號作為獨立部分（保留原始字符）
        parts.push({ type: 'bracket-open', text: char });
        inBracket = true;
      } else if (char === ')' || char === '）') {
        // 括號內的內容（包括空字符串）
        // 等寬字體模式下，將半形空格轉為全形空格，確保對齊
        const normalizedBuffer = displayFont === 'mono' ? buffer.replace(/ /g, '\u3000') : buffer;
        parts.push({ type: 'inside', text: normalizedBuffer }); // buffer 可能為空，但空括號也要顯示
        buffer = '';
        // 將閉括號作為獨立部分（保留原始字符）
        parts.push({ type: 'bracket-close', text: char });
        inBracket = false;
      } else {
        buffer += char;
      }
    }
    
    // 剩餘內容
    if (buffer) {
      parts.push({ type: inBracket ? 'inside' : 'outside', text: buffer });
    }
    
    return parts;
  };

  const renderContent = () => {
    if (!content) return null;

    const lines = content.split('\n');
    
    // Arial 模式：簡化處理，但仍需支援轉調，並保持和弦行與歌詞行緊貼
    if (displayFont === 'arial') {
      // 輔助函數：檢查是否為和弦行（支援 slash chord 如 E/G#）
      const checkIsChordLine = (line) => {
        if (!line) return false;
        // 排除元數據行：包含 Key/Capo/制譜/編譜/原調/調性 關鍵詞的行
        const metadataPattern = /\b(Key|Capo|制譜|編譜|原調|調性|調)\b/i;
        if (metadataPattern.test(line)) {
          return false;
        }
        // 排除調性標記行（如 "F# - G (CAPO 1 Play F - F#)" 或 "Eb (Capo 1)"）
        // 特徵：開頭是調性，中間有 Capo/Play 等字
        if (/^\s*[A-G][#b]?\s*[-–]/.test(line) && /capo|play/i.test(line)) {
          return false;
        }
        // 排除純粹的調性標記行
        if (/^\s*[A-G][#b]?\s*\(?.{0,30}capo.{0,30}\)?$/i.test(line)) {
          return false;
        }
        const hasChordPattern = /\b[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*((b|#)\d*)?(\/[A-G][#b]?)?(?=\s|$|\||\b)/.test(line);
        const hasChinese = /[\u4e00-\u9fff]/.test(line);
        return hasChordPattern && !hasChinese;
      };
      
      // 輔助函數：檢查是否為歌詞行（有中文字或純英文單詞，且沒有和弦特徵）
      const checkIsLyricLine = (line) => {
        if (!line) return false;
        const hasChinese = /[\u4e00-\u9fff]/.test(line);
        const hasChordPattern = /\b[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*((b|#)\d*)?(\/[A-G][#b]?)?(?=\s|$|\||\b)/.test(line);
        // 有英文單詞（至少2個字母）
        const hasEnglishWords = /[a-zA-Z]{2,}/.test(line);
        // 歌詞行：有中文字或純英文單詞，且沒有和弦模式
        return (hasChinese || hasEnglishWords) && !hasChordPattern;
      };
      
      return (
        <div style={{ fontFamily: "Arial, Helvetica, sans-serif", lineHeight: '1' }}>
          {lines.map((line, idx) => {
            // 檢查是否為 Section Marker
            const sectionCheck = extractSectionMarker(line);
            if (sectionCheck.hasMarker) {
              return (
                <div key={idx} style={{ 
                  fontSize: `${fontSize}px`, 
                  marginTop: '0.5em',
                  marginBottom: '0.3em',
                  textDecoration: 'underline',
                  textUnderlineOffset: '4px',
                  color: colors.lyricInside,
                  fontFamily: "'Source Code Pro', 'Noto Sans Mono CJK TC', Consolas, 'Courier New', monospace",
                  fontWeight: 300
                }}>
                  {sectionCheck.marker}
                  {sectionCheck.rest && (
                    <span style={{ color: colors.chord }}> {sectionCheck.rest}</span>
                  )}
                </div>
              );
            }
            
            // 檢查是否為旁白/註釋行（以 // 開頭）
            const commentMatch = line.match(/^\s*\/\/(.+)$/);
            if (commentMatch) {
              return (
                <div key={idx} style={{ 
                  color: colors.comment,
                  fontSize: `${fontSize * 0.85}px`,
                  fontStyle: 'italic',
                  marginBottom: '0.3em',
                  opacity: 0.9
                }}>
                  {commentMatch[1].trim()}
                </div>
              );
            }
            
            // 檢查是否為和弦行
            const isChordLine = checkIsChordLine(line);
            const isLyricLine = checkIsLyricLine(line);
            // 檢查是否為簡譜行（數字譜）
            const isNumericNotation = isNumericNotationLine(line);
            
            // 如果是和弦行且有轉調，處理轉調
            let displayLine = line;
            if (isChordLine && transposeSemitones !== 0) {
              displayLine = transposeChordLine(line, transposeSemitones, false, preferFlats);
            }
            
            // 如果是簡譜行，顯示為粉紅色
            if (isNumericNotation) {
              return (
                <div key={idx} style={{ 
                  fontSize: `${fontSize}px`, 
                  marginBottom: '0.3em',
                  whiteSpace: 'pre-wrap',
                  color: colors.numericNotation
                }}>
                  {renderNotationToken(line, colors.numericNotation, `ar-${idx}-`)}
                </div>
              );
            }
            
            // 檢查下一行是否為歌詞行（如果當前是和弦行）
            const nextLine = lines[idx + 1];
            const isFollowedByLyric = isChordLine && checkIsLyricLine(nextLine);
            
            // 檢查上一行是否為和弦行（如果當前是歌詞行）
            const prevLine = lines[idx - 1];
            const isPrecededByChord = isLyricLine && checkIsChordLine(prevLine);
            
            // 設定行距：和弦行同歌詞行之間完全緊貼，lineHeight 設為 1 消除額外空隙
            const lineHeight = (isFollowedByLyric || isPrecededByChord) ? '1.3' : '1';
            const marginBottom = isFollowedByLyric ? '0em' : '0.3em';
            const marginTop = isPrecededByChord ? '0em' : '0';
            
            // Arial：和弦行要用可撳嘅 ChordLineWithHover（之前淨係純文字，撳落無反應）
            if (isChordLine) {
              const { prefix, suffix, cleanLine } = extractSectionMarkers(line, false);
              const chordLineDisplay =
                transposeSemitones !== 0
                  ? transposeChordLine(cleanLine, transposeSemitones, false, preferFlats)
                  : cleanLine;
              return (
                <div key={idx} style={{ marginTop, marginBottom, lineHeight, whiteSpace: 'pre-wrap' }}>
                  <ChordLineWithHover
                    chordLine={chordLineDisplay}
                    prefix={prefix}
                    suffix={suffix}
                    fontSize={fontSize}
                    theme={theme}
                    displayFont="arial"
                    chordColor={colors.chord}
                    prefixSuffixColor={colors.prefixSuffix}
                    onChordPress={onChordPress}
                  />
                </div>
              );
            }
            
            // 判斷顏色：歌詞行用白色，和弦行用黃色
            const lineColor = isLyricLine ? colors.lyricInside : colors.chord;
            
            return (
              <div key={idx} style={{
                fontSize: `${fontSize}px`,
                marginTop,
                marginBottom,
                lineHeight,
                whiteSpace: 'pre',
                color: lineColor
              }}>
                {displayLine || ' '}
              </div>
            );
          })}
        </div>
      );
    }
    
    // 等寬字體模式：原有複雜處理
    const elements = [];
    const NC_PATTERN = /^N\.?C\.?$/i;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      
      if (!line.trim()) {
        // 跳過連續空行，只保留一個
        if (i > 0 && !lines[i - 1].trim()) {
          i++;
          continue;
        }
        // 若下一行非空係 section marker，唔好插空 div，等 section 用 marginTop 做間距
        let nextNonEmpty = i + 1;
        while (nextNonEmpty < lines.length && !lines[nextNonEmpty]?.trim()) nextNonEmpty++;
        const nextLineIsSection = nextNonEmpty < lines.length && extractSectionMarker(lines[nextNonEmpty]).hasMarker;
        if (!nextLineIsSection) {
          elements.push(<div key={i} style={{ height: `${fontSize * 1.2}px` }} />);
        }
        i++;
        continue;
      }
      
      // 計算當前行的字體大小
      const lineFontSize = getLineFontSize(line);
      
      // ========== 優先檢查 Section Marker ==========
      const sectionCheck = extractSectionMarker(line);
      if (sectionCheck.hasMarker) {
        elements.push(
          <div key={`${i}-marker`} style={{ marginTop: i > 0 ? '20px' : undefined, marginBottom: `${lineFontSize * 0.6}px` }}>
            <span style={{ 
              color: colors.lyricInside, 
              fontSize: `${lineFontSize}px`, 
              textDecoration: 'underline', 
              textUnderlineOffset: '4px',
              fontFamily: "'Source Code Pro', 'Noto Sans Mono CJK TC', Consolas, 'Courier New', monospace",
              fontWeight: 300
            }}>
              {sectionCheck.marker}
            </span>
          </div>
        );
        
        // 如果是 Intro，在其後插入 GP 段落
        if (sectionCheck.marker.toLowerCase().includes('intro') && gpSegments && gpSegments.length > 0) {
          const introSegment = gpSegments.find(seg => seg.type === 'intro');
          if (introSegment) {
            elements.push(
              <div key={`${i}-gp-intro`} style={{ marginBottom: `${lineFontSize * 0.6}px` }}>
                <GpSegmentPlayer segment={introSegment} theme={gpTheme} />
              </div>
            );
          }
        }
        
        const restLine = sectionCheck.rest.trim();
        if (restLine) {
          const transposedRest = transposeChordLine(restLine, transposeSemitones, displayFont === 'mono' || displayFont === 'manual', preferFlats);
          elements.push(
            <div key={i} style={{
              color: colors.chord,
              fontWeight: displayFont === 'arial' ? 'normal' : 300,
              fontSize: `${lineFontSize}px`,
              fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
              whiteSpace: 'pre-wrap', 
              overflowWrap: 'break-word', 
              marginBottom: `${lineFontSize * 0.6}px` 
            }}>
              <ChordLineWithHover
                chordLine={transposedRest}
                fontSize={lineFontSize}
                theme={theme}
                displayFont={displayFont}
                chordColor={colors.chord}
                prefixSuffixColor={colors.prefixSuffix}
                onChordPress={onChordPress}
              />
            </div>
          );
        }
        i++;
        continue;
      }
      
      // ========== 檢查是否為旁白/註釋行（以 // 開頭）==========
      const commentMatch = line.match(/^\s*\/\/(.+)$/);
      if (commentMatch) {
        const commentText = commentMatch[1].trim();
        elements.push(
          <div key={i} style={{ 
            color: colors.comment, 
            fontSize: `${lineFontSize * 0.85}px`, // 細少少
            fontStyle: 'italic', // 斜體
            whiteSpace: 'pre-wrap', 
            overflowWrap: 'break-word',
            marginBottom: `${lineFontSize * 0.6}px`,
            opacity: 0.9 // 輕微透明
          }}>
            {commentText}
          </div>
        );
        i++;
        continue;
      }
      
      // ========== 檢查是否為六線譜段落 ==========
      const tabSectionCheck = detectGuitarTabSection(lines, i);
      if (tabSectionCheck.isTabSection) {
        elements.push(
          <div key={`${i}-tab`} style={{ 
            marginBottom: `${lineFontSize * 0.8}px`,
            padding: '12px 16px',
            backgroundColor: theme === 'night' ? '#1a1a1a' : '#f5f5f5',
            borderRadius: '8px',
            border: `1px solid ${theme === 'night' ? '#333' : '#ddd'}`,
            overflowX: 'auto'
          }}>
            {renderGuitarTab(tabSectionCheck.lines)}
          </div>
        );
        i = tabSectionCheck.endIndex;
        continue;
      }
      
      // 檢查是否為歌詞行或和弦行
      const chineseChars = line.match(/[\u4e00-\u9fff]/g) || [];
      const englishWords = line.match(/[a-zA-Z]+/g) || [];
      // 檢查是否有 | 開頭的和弦標記
      const hasChordBar = lineHasChordMarker(line);
      
      // 檢查是否為和弦行（支持組合後綴如 madd9, maj7, add9、以及 b5/b9/#9 等延伸）
      // 和弦格式：[根音][升降]([m/maj/min/sus/dim/aug])([add/7/9/11/13]數字)?((b|#)數字)?(斜線根音)?
      const strictChordPattern = /\b[A-G](#|b)?(maj|mj|m|min|sus|dim|aug)?(add|m7|maj7|7|9|11|13)?\d*((b|#)\d*)?(\/[A-G][#b]?)?(?=\s|$|\||\b)/g;
      const chordMatches = line.match(strictChordPattern) || [];
      const validChordMatches = chordMatches.filter(m => /^[A-G]/.test(m.trim()));
      const hasBarLineStart = /^[\s]*[\|｜\u2502]/.test(line);
      // 修復：單一和弦（無|）也要識別，只要全行符合和弦模式
      const isChordOnlyLine = validChordMatches.length > 0 && line.trim().split(/\s+/).every(part => {
        // 檢查每個部分是否為和弦或小節線（含 Unicode 豎線 │）
        if (!part || part === '|' || part === '｜' || part === '\u2502') return true;
        // NC = No Chord（常見音樂標記）
        if (NC_PATTERN.test(part)) return true;
        // 延續低音：/B、/G（等同 G/B 寫法嘅低音部）
        if (isSlashBassContinuationToken(part)) return true;
        // 支援 D/F#、Bm7b5、E7b9 等（含 (b|#)數字 延伸）
        const chordWithSlash = part.match(/^[A-G][#b]?(maj|mj|m|min|sus|dim|aug)?(add|m7|maj7|7|9|11|13)?\d*((b|#)\d*)?(\/[A-G][#b]?)?$/);
        if (chordWithSlash) return true;
        // 清理後再檢查（處理 |G|、│G 這樣的情況）
        const cleanPart = part.replace(/[\|｜\u2502\/\s]/g, '');
        return !cleanPart || cleanPart.match(/^[A-G](#|b)?(maj|mj|m|min|sus|dim|aug)?(add|m7|maj7|7|9|11|13)?\d*((b|#)\d*)?$/);
      });
      const hasSlashBassInLine = /(?:^|[\s|｜\u2502])\/[A-G][#b]?(?=[\s|｜\u2502]|$)/.test(line);
      const hasChordPattern = hasBarLineStart
        ? (validChordMatches.length >= 1 || hasSlashBassInLine)
        : (validChordMatches.length >= 2 || isChordOnlyLine);
      // 排除元數據行：包含 Key/Capo/制譜/編譜/原調/調性 關鍵詞的行
      const isMetadataLine = /\b(Key|Capo|制譜|編譜|原調|調性|調)\b/i.test(line);
      const isChord = hasChordPattern && chineseChars.length < 3 && !isMetadataLine;
      
      // 檢查是否為歌詞行（有中文字或英文單詞，且冇和弦特徵）
      // 排除：如果英文單詞其實係和弦名（如 Fm, Em, G7 等），唔好當係歌詞
      const isEnglishWordsActuallyChords = englishWords.length > 0 && englishWords.every(word => 
        /^[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*$/i.test(word) || NC_PATTERN.test(word)
      );
      const isLyric = !isChord && (chineseChars.length > 0 || (englishWords.length > 0 && !isEnglishWordsActuallyChords));
      
      // 如果是歌詞行，優先處理
      if (isLyric) {
        // Arial 模式下，唔好拆開處理，直接顯示整行（保留空格）
        if (displayFont === 'arial') {
          elements.push(
            <div key={i} style={{ fontSize: `${lineFontSize}px`, marginBottom: `${lineFontSize * 0.6}px`, whiteSpace: 'pre', color: colors.lyricInside }}>
              {line}
            </div>
          );
          i++;
          continue;
        }
        
        // 等寬模式先拆開處理顏色
        const lyricParts = processLyricLine(line);
        // 檢查上一行是否為和弦行
        const prevLine = lines[i - 1];
        const prevHasChordPattern = prevLine && /\b[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*((b|#)\d*)?(?=\s|$|\||\b)/.test(prevLine);
        const prevHasChinese = prevLine && /[\u4e00-\u9fff]/.test(prevLine);
        const prevIsChord = prevHasChordPattern && !prevHasChinese;
        const marginTop = prevIsChord ? '0em' : '0';
        const marginBottom = prevIsChord ? '0em' : `${lineFontSize * 0.6}px`;
        
        elements.push(
          <div key={i} style={{ fontSize: `${lineFontSize}px`, marginTop, marginBottom, lineHeight: prevIsChord ? '1.1' : 'normal', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
            {lyricParts.map((part, idx) => {
              // 隱藏括號時，將括號變成空格占位（保持寬度）
              if (hideBrackets && (part.type === 'bracket-open' || part.type === 'bracket-close')) {
                return <span key={idx}>&nbsp;</span>;
              }
              // 決定顏色：括號內文字、括號本身都係白色
              let partColor;
              if (part.type === 'inside' || part.type === 'bracket-open' || part.type === 'bracket-close') {
                partColor = colors.lyricInside;
              } else {
                partColor = colors.lyricNormal;
              }
              return (
                <span key={idx} style={{ color: partColor, whiteSpace: 'pre-wrap' }}>
                  {part.text}
                </span>
              );
            })}
          </div>
        );
        i++;
        continue;
      }
      
      // 檢查是否為簡譜行（使用函數，包含英文字母檢查）
      // 和弦行優先：如果已偵測到和弦模式，唔好當簡譜
      const isNumericNotation = isNumericNotationLine(line) && !hasChordBar && !isChord;
      
      // 處理簡譜行
      if (isNumericNotation) {
        const notationParts = processNumericNotationLine(line);
        // 檢查上一行是否為和弦行，如果是則緊貼
        const prevLine = lines[i - 1];
        const prevHasChordPattern = prevLine && /\b[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*((b|#)\d*)?(?=\s|$|\||\b)/.test(prevLine);
        const prevHasChinese = prevLine && /[\u4e00-\u9fff]/.test(prevLine);
        const prevIsChord = prevHasChordPattern && !prevHasChinese;
        // 檢查下一行是否為和弦行
        const nextLine = lines[i + 1];
        const nextHasChordPattern = nextLine && /\b[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*((b|#)\d*)?(?=\s|$|\||\b)/.test(nextLine);
        const nextHasChinese = nextLine && /[\u4e00-\u9fff]/.test(nextLine);
        const nextIsChord = nextHasChordPattern && !nextHasChinese;
        const marginTop = prevIsChord ? '0em' : '0';
        const marginBottom = nextIsChord ? '0em' : `${lineFontSize * 0.6}px`;
        
        elements.push(
          <div key={i} style={{ 
            fontSize: `${lineFontSize}px`, 
            marginTop,
            marginBottom,
            lineHeight: prevIsChord ? '1.1' : 'normal',
            whiteSpace: 'pre-wrap', 
            overflowWrap: 'break-word',
            fontWeight: displayFont === 'arial' ? 'normal' : 300,
            fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
            maxWidth: '100%',
            minWidth: 0
          }}>
            {notationParts.map((part, idx) => {
              let content = part.content;
              if (hideBrackets && part.type === 'inside') {
                content = content.replace(/^[\(（]/, ' ').replace(/[\)）]$/, ' ');
              }
              const partColor = part.type === 'inside' ? colors.lyricInside : colors.numericNotation;
              return <span key={idx}>{renderNotationToken(content, partColor, `nn-${idx}-`)}</span>;
            })}
          </div>
        );
        i++;
        continue;
      }
      
      // 處理和弦行
      if (isChord) {
        // 收集中間的所有簡譜行，找到最終的歌詞行
        const notationLines = [];
        let targetLyricIndex = i + 1;
        let lastChordLineIndex = i; // 最後一行的和弦行（可能中間有簡譜行）
        
        while (targetLyricIndex < lines.length) {
          const targetLine = lines[targetLyricIndex];
          if (!targetLine) break;
          // 跳過空白行，繼續搵簡譜/歌詞（避免和弦與簡譜之間有空行時漏掉簡譜）
          // 但如果已收集簡譜行，空行代表用戶刻意嘅視覺分隔，停止搜索
          if (!targetLine.trim()) {
            if (notationLines.length > 0) break;
            targetLyricIndex++;
            continue;
          }
          
          const targetChinese = (targetLine.match(/[\u4e00-\u9fff]/g) || []).length;
          // 支援 ASCII |、全角｜、Unicode 豎線 │ (U+2502)
          const targetHasChord = lineHasChordMarker(targetLine);
          const targetDigits = (targetLine.match(/\d/g) || []).length;
          const targetHasBrackets = /[\(（]/.test(targetLine);
          // 簡譜可含 b/#（如 3b 降3、5# 升5），只計「非 b/#」嘅英文字母
          const targetOtherLetters = (targetLine.match(/[a-zA-Z]/g) || []).filter(c => !/[b#]/i.test(c)).length;
          const targetEnglish = (targetLine.match(/[a-zA-Z]+/g) || []).length;
          
          // 如果係「僅括號數字簡譜」行如 (3) (2) (7,) (1)，當簡譜行收集，唔好當歌詞行
          if (targetHasBrackets && !targetHasChord && isBracketsOnlyNumberedNotationLine(targetLine)) {
            notationLines.push({ index: targetLyricIndex, line: targetLine });
            targetLyricIndex++;
            continue;
          }
          // 如果係簡譜行（無括號，可含 3b、5# 等），先收集，唔好當歌詞行
          if (targetDigits > 3 && targetChinese < 3 && !targetHasChord && !targetHasBrackets && targetOtherLetters === 0) {
            notationLines.push({ index: targetLyricIndex, line: targetLine });
            targetLyricIndex++;
            continue;
          }
          // 如果係歌詞行（有中文字、英文單詞、或有括號），且冇和弦，停止搜索
          if ((targetChinese > 0 || targetEnglish > 0 || targetHasBrackets) && !targetHasChord) {
            break;
          }
          // 中間嘅和弦行（如第二行和弦）跳過，繼續搵歌詞行
          if (targetHasChord) {
            lastChordLineIndex = targetLyricIndex;
            targetLyricIndex++;
            continue;
          }
          // 其他情況停止
          break;
        }
        
        const lyricLine = lines[targetLyricIndex] || '';
        // Section marker（如 /v、/c）唔當歌詞
        const lyricIsSectionMarker = extractSectionMarker(lyricLine).hasMarker;
        // 檢查歌詞行：有中文字或英文單詞
        const lyricChinese = (lyricLine.match(/[\u4e00-\u9fff]/g) || []).length;
        const lyricEnglishWords = lyricLine.match(/[a-zA-Z]+/g) || [];
        const lyricEnglish = lyricEnglishWords.length;
        // 排除：如果英文單詞其實係和弦名，唔好當係歌詞
        const lyricEnglishIsChords = lyricEnglish > 0 && lyricEnglishWords.every(word => 
          /^[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*$/i.test(word) || NC_PATTERN.test(word)
        );
        const lyricHasBrackets = /[\(（]/.test(lyricLine);
        const hasLyric = !lyricIsSectionMarker && lyricLine && (lyricChinese > 0 || (lyricEnglish > 0 && !lyricEnglishIsChords) || lyricHasBrackets);
        
        if (hasLyric) {
          // 和弦行用最後見到的和弦行（可能中間有簡譜行，唔係 targetLyricIndex - 1）
          const chordLineForPair = lines[lastChordLineIndex] || '';
          const { prefix, suffix, cleanLine } = extractSectionMarkers(chordLineForPair, displayFont === 'manual');
          
          // 判斷是否需要拆分：有簡譜行時不拆分，保持原有行為
          const shouldSplit = notationLines.length === 0;
          // 使用 splitLongPair 拆分長歌詞（只在沒有簡譜行時，且是手機版）
          const pairs = shouldSplit 
            ? splitLongPair(cleanLine, lyricLine, 24, isMobile) // 手機屏幕約24個中文字
            : [{ chordLine: cleanLine, lyricLine }];
          // 取第一段歌詞嘅 preBracket，令「只有和弦冇歌詞」嘅行同歌詞行左邊對齊
          const firstPairResult = processPair(pairs[0].chordLine, pairs[0].lyricLine, transposeSemitones, hideBrackets, displayFont, preferFlats);
          const preBracketForChordOnly = firstPairResult?.lyricSplit?.preBracket || '';
          
          // 若有多行和弦（e.g. intro 行 + 本段和弦行），先單獨顯示前面嘅和弦行（與歌詞行同 margin）
          const firstChordLineIndex = i;
          if (lastChordLineIndex > firstChordLineIndex) {
            for (let chordOnlyIdx = firstChordLineIndex; chordOnlyIdx < lastChordLineIndex; chordOnlyIdx++) {
              const chordOnlyLine = lines[chordOnlyIdx];
              if (!chordOnlyLine || !lineHasChordMarker(chordOnlyLine)) continue; // 只顯示和弦行，跳過中間嘅簡譜行
              const { prefix: p, suffix: s, cleanLine: chordOnlyClean } = extractSectionMarkers(chordOnlyLine, displayFont === 'manual');
              const transposedChordOnly = transposeChordLine(chordOnlyClean, transposeSemitones, displayFont === 'mono' || displayFont === 'manual', preferFlats);
              const nextLine = lines[chordOnlyIdx + 1];
              const nextHasChord = nextLine && /\|[\s]*[A-G]/.test(nextLine);
              const nextHasLyric = nextLine && (/[\u4e00-\u9fff]/.test(nextLine) || /[a-zA-Z]+/.test(nextLine)) && !nextHasChord;
              // 與歌詞區塊同 margin bottom（例如 5.1px = lineFontSize * 0.3），每行 chord-only 都用同一數值
              const chordMarginBottom = (nextHasChord || nextHasLyric) ? `${lineFontSize * 0.3}px` : `${lineFontSize * 0.6}px`;
              elements.push(
                <div key={`chord-only-${chordOnlyIdx}`} style={{
                  color: colors.chord,
                  fontWeight: displayFont === 'arial' ? 'normal' : 300,
                  fontSize: `${lineFontSize}px`,
                  fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  marginBottom: chordMarginBottom,
                  lineHeight: '1.1'
                }}>
                  {preBracketForChordOnly && (
                    <span style={{ display: 'inline-block', verticalAlign: 'top' }}>
                      <span style={{ visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none' }}>{preBracketForChordOnly}</span>
                    </span>
                  )}
                  <ChordLineWithHover
                    chordLine={transposedChordOnly}
                    prefix={p}
                    suffix={s}
                    fontSize={lineFontSize}
                    theme={theme}
                    displayFont={displayFont}
                    chordColor={colors.chord}
                    prefixSuffixColor={colors.prefixSuffix}
                    onChordPress={onChordPress}
                  />
                </div>
              );
            }
          }
          
          pairs.forEach((pair, pairIndex) => {
            const result = processPair(pair.chordLine, pair.lyricLine, transposeSemitones, hideBrackets, displayFont, preferFlats);
            
            // 和弦-歌詞配對緊貼，多行拆分時先保持間距
            const isLastPair = pairIndex === pairs.length - 1;
            const pairMarginBottom = isLastPair ? `${lineFontSize * 0.3}px` : `${lineFontSize * 0.2}px`;
            
            const currentPrefix = pairIndex === 0 ? prefix : null;
            const currentSuffix = pairIndex === pairs.length - 1 ? suffix : null;
            // 一律用 grid 對齊（以歌詞為 spacer）；多出嘅和弦放喺最後加 10px 間距
            const useGridAlignment = result.lyricSplit && result.alignedChords && displayFont !== 'arial' && (result.lyricSplit.segments?.length ?? 0) > 0;
            const chordFontFamily = displayFont === 'arial'
              ? "Arial, Helvetica, sans-serif"
              : "'Source Code Pro', monospace";
            const prefixSuffixColor = colors.prefixSuffix;
            // 簡譜內容：顯示在和弦行下方、歌詞行上方（chord → notation → lyric）
            const notationContent = pairIndex === 0 && !hideNotation && notationLines.length > 0 ? notationLines.map(({ index, line: notationLine }) => {
              const notationFontSize = getLineFontSize(notationLine);
              const aligned = alignNotationWithLyrics(notationLine, lyricLine);
              const hasRealLyric = lyricLine && (/[\u4e00-\u9fff]/.test(lyricLine) || /[a-zA-Z]+/.test(lyricLine)) && !isNumericNotationLine(lyricLine);
              const notationMarginBottom = hasRealLyric ? '0.35em' : '0em';
              if (aligned) {
                return (
                  <div key={index} style={{ marginBottom: notationMarginBottom, lineHeight: '1.1', maxWidth: '100%', minWidth: 0 }}>
                    <div style={{
                      fontSize: `${notationFontSize}px`,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'break-word',
                      fontWeight: displayFont === 'arial' ? 'normal' : 300,
                      fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
                      color: colors.numericNotation,
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'flex-end',
                      maxWidth: '100%',
                      minWidth: 0
                    }}>
                      {aligned.map((item, idx) => {
                        if (item.type === 'text' || item.type === 'bracket') {
                          return (
                            <span key={idx} style={{ visibility: 'hidden', whiteSpace: 'pre' }}>
                              {item.content}
                            </span>
                          );
                        } else if (item.type === 'pair') {
                          const displayLyric = (hideBrackets && item.isInside)
                            ? item.lyric.replace(/^[\(（]|[\)）]$/g, '')
                            : item.lyric;
                          return (
                            <span key={idx} style={{
                              display: 'inline-flex',
                              justifyContent: 'center',
                              minWidth: `${getTextWidth(displayLyric) * (notationFontSize / 2)}px`,
                              color: colors.numericNotation
                            }}>
                              {renderNotationToken(item.notation, colors.numericNotation, `an-${idx}-`)}
                            </span>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                );
              }
              const notationParts = processNumericNotationLine(notationLine);
              const hasRealLyric2 = lyricLine && (/[\u4e00-\u9fff]/.test(lyricLine) || /[a-zA-Z]+/.test(lyricLine)) && !isNumericNotationLine(lyricLine);
              const notationMB = hasRealLyric2 ? '2px' : '0em';
              return (
                <div key={index} style={{
                  fontSize: `${notationFontSize}px`,
                  marginBottom: notationMB,
                  lineHeight: '1.1',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  fontWeight: displayFont === 'arial' ? 'normal' : 300,
                  fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
                  maxWidth: '100%',
                  minWidth: 0
                }}>
                  {notationParts.map((part, idx) => {
                    let content = part.content;
                    if (hideBrackets && part.type === 'inside') {
                      content = content.replace(/^[\(（]/, ' ').replace(/[\)）]$/, ' ');
                    }
                    const innerOnlyNotation = part.type === 'inside' && /^[\(（]\d+['#,.b]?[\)）]$/.test(part.content);
                    const partColor = innerOnlyNotation ? colors.numericNotation : (part.type === 'inside' ? colors.lyricInside : colors.numericNotation);
                    return <span key={idx}>{renderNotationToken(content, partColor, `fn-${idx}-`)}</span>;
                  })}
                </div>
              );
            }) : null;

            elements.push(
              <div key={`${i}-${pairIndex}`} style={{ marginBottom: pairMarginBottom }}>
                <ChordLyricBlockWithWrap
                  pair={pair}
                  result={result}
                  processPair={(p) => processPair(p.chordLine, p.lyricLine, transposeSemitones, hideBrackets, displayFont, preferFlats)}
                  pairMarginBottom={pairMarginBottom}
                  notationContent={notationContent}
                  renderBlock={(res, refs, notationContentBetween) => (
                <>
                {/* 和弦行 — grid alignment: overflow into remainder when space allows, expand cell when it doesn't */}
                {useGridAlignment && res.lyricSplit?.segments?.length ? (() => {
                  const segs = res.lyricSplit.segments.map((segment, segIdx) => {
                    const chord = res.alignedChords[segIdx];
                    const { bracketPart, remainder } = splitSegmentAtBracketClose(segment);
                    const bw = getTextWidth(bracketPart);
                    const chordText = chord ? ((chord.isBarStart ? '|' : '') + chord.displayName) : '';
                    const cw = chordText.length;
                    const rw = remainder ? getTextWidth(remainder) : 0;
                    return { chord, bracketPart, remainder, bw, cw, rw };
                  });

                  const layout = segs.map((s) => {
                    if (!s.chord || s.cw <= s.bw) {
                      return { ...s, mode: 'fit', trimmedRemainder: s.remainder };
                    }
                    // chord 有 trailing tokens 時強制 expand，避免 overflow 同 trailing 重疊
                    const hasTrailing = s.chord.trailing && s.chord.trailing.length > 0;
                    const excess = s.cw - s.bw;
                    if (!hasTrailing && excess + 1 <= s.rw) {
                      return { ...s, mode: 'overflow', trimmedRemainder: s.remainder };
                    }
                    return { ...s, mode: 'expand', trimmedRemainder: s.remainder };
                  });

                  const lastChordSegIdx = layout.reduce((last, s, i) => (s.chord ? i : last), -1);

                  return (
                  <div
                    ref={refs?.chordLineContainerRef}
                    className="font-light"
                    data-clean-text={(currentPrefix || '') + res.chordLine + (currentSuffix || '')}
                    style={{
                      fontSize: `${lineFontSize}px`,
                      whiteSpace: 'pre-wrap',
                      marginBottom: '0.1em',
                      lineHeight: '1.2',
                      fontWeight: 300,
                    }}
                  >
                    {currentPrefix && (
                      <span style={{ color: prefixSuffixColor, fontStyle: 'italic', fontSize: `${lineFontSize * 0.85}px` }}>
                        {currentPrefix}
                      </span>
                    )}
                    {res.lyricSplit.preBracket && (
                      <span style={{ display: 'inline-block', verticalAlign: 'top' }}>
                        <span style={{ visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none' }}>
                          {res.lyricSplit.preBracket}
                        </span>
                      </span>
                    )}
                    {layout.map((seg, segIdx) => {
                      const afterLastChord = segIdx > lastChordSegIdx;
                      const remainderAfterLastChord = segIdx >= lastChordSegIdx;
                      return (
                      <span key={segIdx} style={{ verticalAlign: 'top' }}>
                        <span style={{ display: 'inline-grid', gridTemplateColumns: '1fr', verticalAlign: 'top' }}>
                          <span style={{
                            gridRow: 1, gridColumn: 1, visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none', pointerEvents: 'none',
                            ...(afterLastChord ? { width: 0, minWidth: 0, overflow: 'hidden' } : {}),
                          }}>
                            {seg.bracketPart}
                          </span>
                          {seg.mode === 'expand' && seg.chord && (
                            <span style={{ gridRow: 1, gridColumn: 1, visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none', pointerEvents: 'none', fontFamily: chordFontFamily }}>
                              {'\u00A0'.repeat(Math.max(0, seg.cw - seg.rw + 1))}
                            </span>
                          )}
                          {seg.chord && (
                            <span
                              ref={refs && segIdx === 0 ? refs.firstChordSpanRef : undefined}
                              style={{
                              gridRow: 1, gridColumn: 1,
                              justifySelf: seg.mode === 'fit' ? 'center' : 'start',
                              fontFamily: chordFontFamily,
                              color: colors.chord,
                              whiteSpace: 'nowrap',
                              ...(seg.mode === 'overflow' ? { width: 0, overflow: 'visible', display: 'flex', justifyContent: 'flex-start' } : {}),
                            }}>
                              {seg.chord.isBarStart && <span>|</span>}
                              <ChordWithHover chord={seg.chord.displayName} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} />
                            </span>
                          )}
                        </span>
                        {seg.remainder ? (
                          <span style={{ display: 'inline-grid', gridTemplateColumns: '1fr', verticalAlign: 'top' }}>
                            <span style={{
                              gridRow: 1, gridColumn: 1, visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none', pointerEvents: 'none',
                              ...((remainderAfterLastChord && !(seg.chord && seg.chord.trailing && seg.chord.trailing.length > 0)) ? { width: 0, minWidth: 0, overflow: 'hidden' } : {}),
                            }}>
                              {seg.trimmedRemainder != null ? seg.trimmedRemainder : seg.remainder}
                            </span>
                            {seg.chord && seg.chord.trailing && seg.chord.trailing.length > 0 && (
                              <span style={{ gridRow: 1, gridColumn: 1, justifySelf: 'start', display: 'flex', gap: '0.5em' }}>
                                {seg.chord.trailing.map((t, tIdx) => (
                                  <span key={tIdx} style={{ fontFamily: chordFontFamily, color: colors.chord, whiteSpace: 'nowrap' }}>
                                    {t.isBarStart && '|'}
                                    {t.isChord ? <ChordWithHover chord={t.name} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} /> : t.name}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        ) : seg.chord && seg.chord.trailing && seg.chord.trailing.length > 0 ? (
                          <span style={{ fontFamily: chordFontFamily, color: colors.chord, whiteSpace: 'nowrap' }}>
                            {seg.chord.trailing.map((t, tIdx) => (
                              <span key={tIdx}>
                                {t.isBarStart && '|'}
                                {t.isChord ? <ChordWithHover chord={t.name} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} /> : t.name}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    );
                    })}
                    {res.alignedChords.length > res.lyricSplit.segments.length && (
                      <span style={{ marginLeft: '10px', display: 'inline' }}>
                        {res.alignedChords.slice(res.lyricSplit.segments.length).map((chord, extraIdx) => (
                          <span key={`extra-${extraIdx}`} style={{ fontFamily: chordFontFamily, color: colors.chord, whiteSpace: 'nowrap' }}>
                            {chord.isBarStart && '|'}
                            <ChordWithHover chord={chord.displayName} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} />
                            {chord.trailing && chord.trailing.length > 0 && chord.trailing.map((t, tIdx) => (
                              <span key={tIdx}>
                                {' '}{t.isBarStart && '|'}
                                {t.isChord ? <ChordWithHover chord={t.name} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} /> : t.name}
                              </span>
                            ))}
                            {' '}
                          </span>
                        ))}
                      </span>
                    )}
                    {currentSuffix && (
                      <span style={{ color: prefixSuffixColor, fontStyle: 'italic', fontSize: `${lineFontSize * 0.85}px` }}>
                        {currentSuffix}
                      </span>
                    )}
                  </div>
                  );
                })() : (refs ? (
                  <div ref={r => { if (r && refs.chordLineContainerRef) refs.chordLineContainerRef.current = r; if (r && refs.firstChordSpanRef) refs.firstChordSpanRef.current = r; }}>
                    <ChordLineWithHover
                      chordLine={res.chordLine}
                      prefix={currentPrefix}
                      suffix={currentSuffix}
                      fontSize={lineFontSize}
                      theme={theme}
                      displayFont={displayFont}
                      chordColor={colors.chord}
                      prefixSuffixColor={colors.prefixSuffix}
                      onChordPress={onChordPress}
                    />
                  </div>
                ) : (
                  <ChordLineWithHover
                    chordLine={res.chordLine}
                    prefix={currentPrefix}
                    suffix={currentSuffix}
                    fontSize={lineFontSize}
                    theme={theme}
                    displayFont={displayFont}
                    chordColor={colors.chord}
                    prefixSuffixColor={colors.prefixSuffix}
                    onChordPress={onChordPress}
                  />
                ))}

                {/* 簡譜行（和弦下方、歌詞上方） */}
                {notationContentBetween}

                {/* 歌詞行 */}
                <div
                  data-clean-text={res.lyricParts.map(p => p.text || '').join('').replace(/\r?\n/g, '')}
                  style={{ fontSize: `${lineFontSize}px`, whiteSpace: 'pre-wrap', lineHeight: '1.1', marginTop: '0.2em' }}
                >
                  {useGridAlignment && res.lyricSplit?.segments?.length ? (
                    <>
                      {res.lyricSplit.preBracket && (
                        <span style={{ whiteSpace: 'pre-wrap', color: colors.lyricNormal, fontWeight: 400 }}>
                          {res.lyricSplit.preBracket}
                        </span>
                      )}
                      {res.lyricSplit.segments.map((segment, segIdx) => {
                        const { bracketPart, remainder } = splitSegmentAtBracketClose(segment);
                        const insideWeight = 400;
                        const bracketOpen = bracketPart[0] || '';
                        const bracketClose = bracketPart[bracketPart.length - 1] || '';
                        const bracketInside = bracketPart.substring(1, bracketPart.length - 1);

                        return (
                          <span key={segIdx} style={{ whiteSpace: 'pre-wrap' }}>
                            <span style={{ color: colors.lyricInside, fontWeight: 100, opacity: 0.7 }}>
                              {hideBrackets ? '\u00A0' : bracketOpen}
                            </span>
                            <span style={{ color: colors.lyricInside, fontWeight: insideWeight }}>
                              {bracketInside}
                            </span>
                            <span style={{ color: colors.lyricInside, fontWeight: 100, opacity: 0.7 }}>
                              {hideBrackets ? '\u00A0' : bracketClose}
                            </span>
                            {remainder && (
                              <span style={{ color: colors.lyricNormal, fontWeight: 400 }}>
                                {remainder}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </>
                  ) : (
                    res.lyricParts.map((part, idx) => {
                      if (hideBrackets && (part.type === 'bracket-open' || part.type === 'bracket-close')) {
                        return <span key={idx}>&nbsp;</span>;
                      }
                      let partColor;
                      if (part.isInside || part.type === 'inside' || part.type === 'bracket-open' || part.type === 'bracket-close') {
                        partColor = colors.lyricInside;
                      } else {
                        partColor = colors.lyricNormal;
                      }
                      const cleanText = (part.text || '').replace(/\r?\n/g, '');
                      const isBracketChar = part.type === 'bracket-open' || part.type === 'bracket-close';
                      return (
                        <span key={idx} style={{
                          color: partColor,
                          fontWeight: isBracketChar ? 100 : 400,
                          opacity: isBracketChar ? 0.7 : 1
                        }}>
                          {cleanText}
                        </span>
                      );
                    })
                  )}
                </div>
                </>
                  )}
                />
              </div>
            );
          });
          
          i = targetLyricIndex + 1;
        } else if (notationLines.length > 0) {
          // 只有和弦 + 簡譜（如 intro (3) (2) (7,) (1)），冇歌詞行
          // 用 processPair 對齊和弦同簡譜括號
          const chordLineForNotationOnly = lines[lastChordLineIndex] || line;
          const { prefix, suffix, cleanLine } = extractSectionMarkers(chordLineForNotationOnly, displayFont === 'manual');
          const chordFontFamily = displayFont === 'arial'
            ? "Arial, Helvetica, sans-serif"
            : "'Source Code Pro', monospace";

          notationLines.forEach(({ index: notIdx, line: notationLine }, nlIdx) => {
            const notationFontSize = getLineFontSize(notationLine);
            const result = processPair(cleanLine, notationLine, transposeSemitones, hideBrackets, displayFont, preferFlats);
            const useGrid = result.lyricSplit && result.alignedChords && displayFont !== 'arial' && (result.lyricSplit.segments?.length ?? 0) > 0;

            elements.push(
              <div key={`${i}-notation-only-${nlIdx}`} style={{ marginBottom: `${lineFontSize * 0.3}px` }}>
                {/* 和弦行 — 對齊簡譜括號 */}
                {useGrid && result.lyricSplit?.segments?.length ? (() => {
                  const segs = result.lyricSplit.segments.map((segment, segIdx) => {
                    const chord = result.alignedChords[segIdx];
                    const { bracketPart, remainder } = splitSegmentAtBracketClose(segment);
                    const bw = getTextWidth(bracketPart);
                    const chordText = chord ? ((chord.isBarStart ? '|' : '') + chord.displayName) : '';
                    const cw = chordText.length;
                    const rw = remainder ? getTextWidth(remainder) : 0;
                    return { chord, bracketPart, remainder, bw, cw, rw };
                  });
                  const layout = segs.map((s) => {
                    if (!s.chord || s.cw <= s.bw) return { ...s, mode: 'fit', trimmedRemainder: s.remainder };
                    const hasTrailing = s.chord.trailing && s.chord.trailing.length > 0;
                    const excess = s.cw - s.bw;
                    if (!hasTrailing && excess + 1 <= s.rw) return { ...s, mode: 'overflow', trimmedRemainder: s.remainder };
                    return { ...s, mode: 'expand', trimmedRemainder: s.remainder };
                  });
                  const lastChordSegIdx = layout.reduce((last, s, idx2) => (s.chord ? idx2 : last), -1);

                  return (
                    <div className="font-light" style={{
                      fontSize: `${lineFontSize}px`, whiteSpace: 'pre-wrap', marginBottom: '0.1em', lineHeight: '1.2', fontWeight: 300,
                    }}>
                      {prefix && <span style={{ color: colors.prefixSuffix, fontStyle: 'italic', fontSize: `${lineFontSize * 0.85}px` }}>{prefix}</span>}
                      {result.lyricSplit.preBracket && (
                        <span style={{ display: 'inline-block', verticalAlign: 'top' }}>
                          <span style={{ visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none' }}>{result.lyricSplit.preBracket}</span>
                        </span>
                      )}
                      {layout.map((seg, segIdx) => {
                        const afterLastChord = segIdx > lastChordSegIdx;
                        const remainderAfterLastChord = segIdx >= lastChordSegIdx;
                        return (
                          <span key={segIdx} style={{ verticalAlign: 'top' }}>
                            <span style={{ display: 'inline-grid', gridTemplateColumns: '1fr', verticalAlign: 'top' }}>
                              <span style={{
                                gridRow: 1, gridColumn: 1, visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none', pointerEvents: 'none',
                                ...(afterLastChord ? { width: 0, minWidth: 0, overflow: 'hidden' } : {}),
                              }}>{seg.bracketPart}</span>
                              {seg.mode === 'expand' && seg.chord && (
                                <span style={{ gridRow: 1, gridColumn: 1, visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none', pointerEvents: 'none', fontFamily: chordFontFamily }}>
                                  {'\u00A0'.repeat(Math.max(0, seg.cw - seg.rw + 1))}
                                </span>
                              )}
                              {seg.chord && (
                                <span style={{
                                  gridRow: 1, gridColumn: 1,
                                  justifySelf: seg.mode === 'fit' ? 'center' : 'start',
                                  fontFamily: chordFontFamily, color: colors.chord, whiteSpace: 'nowrap',
                                  ...(seg.mode === 'overflow' ? { width: 0, overflow: 'visible', display: 'flex', justifyContent: 'flex-start' } : {}),
                                }}>
                                  {seg.chord.isBarStart && <span>|</span>}
                                  <ChordWithHover chord={seg.chord.displayName} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} />
                                </span>
                              )}
                            </span>
                            {seg.remainder ? (
                              <span style={{ display: 'inline-grid', gridTemplateColumns: '1fr', verticalAlign: 'top' }}>
                                <span style={{
                                  gridRow: 1, gridColumn: 1, visibility: 'hidden', whiteSpace: 'pre', userSelect: 'none', pointerEvents: 'none',
                                  ...((remainderAfterLastChord && !(seg.chord && seg.chord.trailing && seg.chord.trailing.length > 0)) ? { width: 0, minWidth: 0, overflow: 'hidden' } : {}),
                                }}>{seg.trimmedRemainder != null ? seg.trimmedRemainder : seg.remainder}</span>
                                {seg.chord && seg.chord.trailing && seg.chord.trailing.length > 0 && (
                                  <span style={{ gridRow: 1, gridColumn: 1, justifySelf: 'start', display: 'flex', gap: '0.5em' }}>
                                    {seg.chord.trailing.map((t, tIdx) => (
                                      <span key={tIdx} style={{ fontFamily: chordFontFamily, color: colors.chord, whiteSpace: 'nowrap' }}>
                                        {t.isBarStart && '|'}{t.isChord ? <ChordWithHover chord={t.name} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} /> : t.name}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </span>
                            ) : seg.chord && seg.chord.trailing && seg.chord.trailing.length > 0 ? (
                              <span style={{ fontFamily: chordFontFamily, color: colors.chord, whiteSpace: 'nowrap' }}>
                                {seg.chord.trailing.map((t, tIdx) => (
                                  <span key={tIdx}>{t.isBarStart && '|'}{t.isChord ? <ChordWithHover chord={t.name} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} /> : t.name}</span>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        );
                      })}
                      {result.alignedChords.length > result.lyricSplit.segments.length && (
                        <span style={{ marginLeft: '10px', display: 'inline' }}>
                          {result.alignedChords.slice(result.lyricSplit.segments.length).map((chord, extraIdx) => (
                            <span key={`extra-${extraIdx}`} style={{ fontFamily: chordFontFamily, color: colors.chord, whiteSpace: 'nowrap' }}>
                              {chord.isBarStart && '|'}<ChordWithHover chord={chord.displayName} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} />
                              {chord.trailing && chord.trailing.length > 0 && chord.trailing.map((t, tIdx) => (
                                <span key={tIdx}> {t.isBarStart && '|'}{t.isChord ? <ChordWithHover chord={t.name} theme={theme} displayFont={displayFont} chordColor={colors.chord} onChordPress={onChordPress} /> : t.name}</span>
                              ))}{' '}
                            </span>
                          ))}
                        </span>
                      )}
                      {suffix && <span style={{ color: colors.prefixSuffix, fontStyle: 'italic', fontSize: `${lineFontSize * 0.85}px` }}>{suffix}</span>}
                    </div>
                  );
                })() : (
                  <div style={{
                    color: colors.chord, fontWeight: displayFont === 'arial' ? 'normal' : 300,
                    fontSize: `${lineFontSize}px`,
                    fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
                    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', marginBottom: '0.05em', lineHeight: '1.1'
                  }}>
                    <ChordLineWithHover chordLine={result.chordLine} prefix={prefix} suffix={suffix} fontSize={lineFontSize} theme={theme} displayFont={displayFont} chordColor={colors.chord} prefixSuffixColor={colors.prefixSuffix} onChordPress={onChordPress} />
                  </div>
                )}
                {/* 簡譜行 */}
                {!hideNotation && (() => {
                  const notationParts = processNumericNotationLine(notationLine);
                  if (useGrid && result.lyricSplit?.segments?.length) {
                    return (
                      <div style={{
                        fontSize: `${notationFontSize}px`, whiteSpace: 'pre-wrap', lineHeight: '1.1', marginTop: '0.2em',
                        fontWeight: displayFont === 'arial' ? 'normal' : 300,
                        fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
                      }}>
                        {result.lyricSplit.preBracket && (
                          <span style={{ whiteSpace: 'pre-wrap', color: colors.numericNotation }}>{renderNotationToken(result.lyricSplit.preBracket, colors.numericNotation, 'gnpb-')}</span>
                        )}
                        {result.lyricSplit.segments.map((segment, segIdx) => {
                          const { bracketPart, remainder } = splitSegmentAtBracketClose(segment);
                          const bracketOpen = bracketPart[0] || '';
                          const bracketClose = bracketPart[bracketPart.length - 1] || '';
                          const bracketInside = bracketPart.substring(1, bracketPart.length - 1);
                          const innerOnlyNotation = /^\d+['#,.b]?$/.test(bracketInside.trim());
                          const insideColor = innerOnlyNotation ? colors.numericNotation : colors.lyricInside;
                          return (
                            <span key={segIdx} style={{ whiteSpace: 'pre-wrap' }}>
                              <span style={{ color: colors.numericNotation, opacity: 0.7 }}>{hideBrackets ? '\u00A0' : bracketOpen}</span>
                              <span style={{ color: insideColor }}>{renderNotationToken(bracketInside, insideColor, `gni-${segIdx}-`)}</span>
                              <span style={{ color: colors.numericNotation, opacity: 0.7 }}>{hideBrackets ? '\u00A0' : bracketClose}</span>
                              {remainder && <span>{renderNotationToken(remainder, colors.numericNotation, `gnr-${segIdx}-`)}</span>}
                            </span>
                          );
                        })}
                      </div>
                    );
                  }
                  return (
                    <div style={{
                      fontSize: `${notationFontSize}px`, lineHeight: '1.1', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
                      fontWeight: displayFont === 'arial' ? 'normal' : 300,
                      fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
                      maxWidth: '100%', minWidth: 0
                    }}>
                      {notationParts.map((part, idx) => {
                        let content = part.content;
                        if (hideBrackets && part.type === 'inside') {
                          content = content.replace(/^[\(（]/, ' ').replace(/[\)）]$/, ' ');
                        }
                        const innerOnlyNotation = part.type === 'inside' && /^[\(（]\d+['#,.b]?[\)）]$/.test(part.content);
                        const partColor = innerOnlyNotation ? colors.numericNotation : (part.type === 'inside' ? colors.lyricInside : colors.numericNotation);
                        return <span key={idx}>{renderNotationToken(content, partColor, `nof-${idx}-`)}</span>;
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          });
          // 如果 targetLyricIndex 指向空行（簡譜後有換行），唔好跳過，交畀主循環渲染間距
          if (lines[targetLyricIndex] !== undefined && !lines[targetLyricIndex].trim()) {
            i = targetLyricIndex;
          } else {
            i = targetLyricIndex + 1;
          }
        } else {
          // 冇歌詞行，單獨顯示和弦
          const { prefix, suffix, cleanLine } = extractSectionMarkers(line, displayFont === 'manual');
          const transposedChordLine = transposeChordLine(cleanLine, transposeSemitones, displayFont === 'mono' || displayFont === 'manual', preferFlats);
          // 檢查下一行是否為歌詞行或簡譜行
          const nextLine = lines[i + 1];
          const nextHasLyric = nextLine && (/[\u4e00-\u9fff]/.test(nextLine) || /[a-zA-Z]+/.test(nextLine));
          const nextHasChordOnly = nextLine && /\b[A-G][#b]?(maj|mj|m|min|sus|dim|aug|add|m7|7|9|11|13)?\d*((b|#)\d*)?(?=\s|$|\||\b)/.test(nextLine) && !/[\u4e00-\u9fff]/.test(nextLine);
          const nextIsNotation = nextLine && isNumericNotationLine(nextLine);
          const isFollowedByLyric = (nextHasLyric && !nextHasChordOnly) || nextIsNotation;
          const chordMarginBottom = isFollowedByLyric ? '0em' : `${lineFontSize * 0.6}px`;
          
          elements.push(
            <div key={i} style={{
              color: colors.chord,
              fontWeight: displayFont === 'arial' ? 'normal' : 300,
              fontSize: `${lineFontSize}px`,
              fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace",
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              marginBottom: chordMarginBottom,
              lineHeight: isFollowedByLyric ? '1.1' : 'normal'
            }}>
              <ChordLineWithHover
                chordLine={transposedChordLine}
                prefix={prefix}
                suffix={suffix}
                fontSize={lineFontSize}
                theme={theme}
                displayFont={displayFont}
                chordColor={colors.chord}
                prefixSuffixColor={colors.prefixSuffix}
                onChordPress={onChordPress}
              />
            </div>
          );
          i++;
        }
        continue;
      }
      
      // 其他行，普通顯示
      elements.push(
        <div key={i} style={{ color: colors.lyricNormal, fontSize: `${lineFontSize}px`, marginBottom: `${lineFontSize * 0.6}px`, whiteSpace: 'normal', overflowWrap: 'break-word' }}>{line}</div>
      );
      i++;
    }

    return elements;
  };


  const ControlBar = () => {
    // showInfo：優先使用外部傳入的值，否則內部管理
    const [internalShowInfo, setInternalShowInfo] = useState(() => !!youtubeVideoId);
    const showInfo = externalShowInfo !== undefined ? externalShowInfo : internalShowInfo;
    const setShowInfo = externalSetShowInfo || setInternalShowInfo;
    const [showChordDiagram, setShowChordDiagram] = useState(false);
    
    // 提取本曲所有獨特和弦（與譜面顯示一致：依目前 PLAY Key 轉調）
    const uniqueChords = (() => {
      if (!content) return [];
      const raw = extractChords(content);
      if (!raw.length) return [];
      if (transposeSemitones === 0) return raw;
      const seen = new Set();
      const out = [];
      for (const c of raw) {
        const t = transposeChord(c, transposeSemitones, preferFlats);
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return out;
    })();
    
    const chordStats = (() => {
      if (!content) return { total: 0, barreCount: 0 };
      const chordPattern = /\b[A-G][#b]?(?:maj|mj|m|min|dim|aug|sus|add|m7|maj7|7|9|11|13)?(?:\/[A-G][#b]?)?(?=\s|$|\||\b)/g;
      const matches = content.match(chordPattern) || [];
      const validChordPattern = /^[A-G][#b]?(maj|mj|m|min|dim|aug|sus|add|m7|maj7|7|9|11|13)*$/;
      const chords = matches.filter(c => validChordPattern.test(c.replace(/\/.*/, '')));
      const uniqueChords = [...new Set(chords)];
      const BARRE_CHORDS = ['B','Bm','Bb','Bbm','B7','Bm7','Bb7','C#','C#m','C#7','C#m7','Db','Dbm','F','Fm','F7','Fm7','F#','F#m','F#7','F#m7','Gb','Gbm','G#','G#m','G#7','G#m7','Ab','Abm'];
      const barreCount = uniqueChords.filter(c => BARRE_CHORDS.includes(c)).length;
      return { total: uniqueChords.length, barreCount };
    })();
    
    const hasSongInfo = songInfo && (songInfo.songYear || songInfo.composer || songInfo.lyricist || songInfo.arranger || songInfo.producer || songInfo.album);
    
    // 樂譜頁 layout：和弦改由頂部操作列 icon 開 pop-up，唔 render ControlBar
    if (hideKeyRowAndBottomBar) return null;
    
    return (
      <div className="px-2 sm:px-4 py-2 border-b border-[#1a1a1a]">
        <div className={`rounded-2xl p-2.5 sm:p-3 ${theme === 'day' ? 'bg-neutral-100' : 'bg-[#1A1A1A]'}`}>
          <div className="flex items-center justify-between">
            {/* 樂譜頁 layout 時唔顯示原調/出譜；只保留和弦圖入口 */}
            {!hideKeyRowAndBottomBar && (
            <div className="flex items-center gap-2 text-xs md:text-base whitespace-nowrap">
              <span className="flex items-center gap-1">
                <span className="text-[#FFD700]">♪</span>
                <span className="text-white font-medium">{originalKey}</span>
                {playKey && playKey !== originalKey && (
                  <span className="text-neutral-400">({playKey})</span>
                )}
              </span>
              <span className="text-neutral-600">|</span>
              {arrangedBy && (
                <span className="text-neutral-400">
                  出譜: {uploaderId ? (
                    <a 
                      href={`/profile/${uploaderId}`}
                      className="text-[#FFD700] hover:underline cursor-pointer"
                    >
                      {arrangedBy}
                    </a>
                  ) : (
                    <span className="text-[#FFD700]">{arrangedBy}</span>
                  )}
                </span>
              )}
            </div>
            )}
            {/* 非樂譜頁 layout 先顯示 YouTube/歌曲資訊展開列；樂譜頁已移去 Key 選擇器上方 */}
            {!hideKeyRowAndBottomBar && (youtubeVideoId || hasSongInfo) && (
              <>
                <span className="text-xs text-neutral-400">YouTube / 歌曲資訊</span>
                <button onClick={() => setShowInfo(!showInfo)} className="p-1 md:p-1.5 text-neutral-400 hover:text-white transition" title={showInfo ? '收起' : '展開 YouTube / 歌曲資訊'}>
                  <svg className={`w-4 h-4 md:w-5 md:h-5 transition-transform ${showInfo ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* YouTube 播放器 + 歌曲資訊（僅非樂譜頁 layout 顯示；樂譜頁已移去頁面） */}
          {!hideKeyRowAndBottomBar && (
          <div 
            className="mt-3 pt-3 border-t border-[#1a1a1a] space-y-3 transition-all duration-500 overflow-hidden"
            style={{ 
              maxHeight: showInfo ? '600px' : '0',
              opacity: showInfo ? 1 : 0,
              paddingTop: showInfo ? '0.75rem' : '0',
              visibility: showInfo ? 'visible' : 'hidden'
            }}
          >
            {youtubeVideoId && (
              <div className="aspect-video w-full rounded-lg overflow-hidden">
                <iframe 
                  width="100%" 
                  height="100%" 
                  src={youtubeSrc} 
                  title="YouTube" 
                  frameBorder="0" 
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                  allowFullScreen
                ></iframe>
              </div>
            )}
            {hasSongInfo && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] sm:text-xs md:text-sm text-neutral-400">
                {songInfo.songYear && <span>年份：<span className="text-white">{songInfo.songYear}</span></span>}
                {songInfo.album && <span>專輯：<span className="text-white">{songInfo.album}</span></span>}
                {songInfo.composer && <span>作曲：<span className="text-white">{songInfo.composer}</span></span>}
                {songInfo.lyricist && <span>填詞：<span className="text-white">{songInfo.lyricist}</span></span>}
                {songInfo.arranger && <span>編曲：<span className="text-white">{songInfo.arranger}</span></span>}
                {songInfo.producer && <span>監製：<span className="text-white">{songInfo.producer}</span></span>}
              </div>
            )}
          </div>
          )}

          {!hideKeyRowAndBottomBar && (
          <>
          <div className="flex items-center gap-2 text-xs md:text-base mt-3 whitespace-nowrap">
            <span className="text-neutral-400">原調: <span className="text-white">{originalKey}</span></span>
            <span className="text-neutral-600">→</span>
            <span className="text-neutral-400">PLAY: <span className="text-[#FFD700] font-medium">{currentKey}</span></span>
            {displayCapo > 0 && (
              <span className="bg-[#FFD700] text-black text-[10px] md:text-xs px-1.5 py-0.5 md:px-2 md:py-1 rounded font-medium">Capo {displayCapo}</span>
            )}
          </div>

          {!hideKeySelector && (
            <div className="flex gap-0.5 mt-3 pt-3 border-t border-[#1a1a1a]">
              {(baseKey?.endsWith('m') ? MINOR_KEYS.filter(k => !['Ebm','G#m','A#m'].includes(k)) : MAJOR_KEYS).map((key) => {
                const isCurrent = key === currentKey;
                return (
                  <button key={key} onClick={() => { setCurrentKey(key); onKeyChange?.(key); }} className={`flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 md:w-9 md:h-9 rounded-full flex items-center justify-center text-[10px] sm:text-xs md:text-sm font-bold transition hover:scale-105 ${isCurrent ? 'bg-[#FFD700] text-black' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}>
                    {key}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1a1a1a]">
            <div className="flex items-center gap-1.5 md:gap-2">
              <button onClick={() => handleFontSize(-1)} className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded bg-neutral-800 text-white hover:bg-neutral-700 transition text-xs md:text-sm">A-</button>
              <span className="w-6 md:w-8 text-center text-xs md:text-sm text-neutral-400">{fontSize}</span>
              <button onClick={() => handleFontSize(1)} className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded bg-neutral-800 text-white hover:bg-neutral-700 transition text-xs md:text-sm">A+</button>
              <div className="w-px h-5 md:h-6 bg-neutral-700 mx-1" />
              <button onClick={() => setIsAutoScroll(!isAutoScroll)} className={`flex items-center gap-1 px-2.5 py-1.5 md:px-4 md:py-2 rounded transition text-xs md:text-sm ${isAutoScroll ? 'bg-[#FFD700] text-black' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}>
                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span className="hidden sm:inline">自動滾動</span>
              </button>
              {isAutoScroll && (
                <div className="flex items-center gap-0.5">
                  <button onClick={() => setScrollSpeed(Math.max(1, scrollSpeed - 1))} className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center rounded bg-neutral-700 text-white text-xs md:text-sm" disabled={scrollSpeed <= 1}>−</button>
                  <span className="w-4 md:w-5 text-center text-xs md:text-sm text-neutral-400">{scrollSpeed}</span>
                  <button onClick={() => setScrollSpeed(Math.min(5, scrollSpeed + 1))} className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center rounded bg-neutral-700 text-white text-xs md:text-sm" disabled={scrollSpeed >= 5}>+</button>
                </div>
              )}
              <div className="w-px h-5 md:h-6 bg-neutral-700 mx-1" />
              <button onClick={() => setHideNotation(!hideNotation)} className={`flex items-center gap-1 px-2.5 py-1.5 md:px-4 md:py-2 rounded transition text-xs md:text-sm ${hideNotation ? 'bg-neutral-600 text-neutral-300' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`} title={hideNotation ? '顯示簡譜' : '隱藏簡譜'}>
                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={hideNotation ? "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" : "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"} />
                </svg>
                <span className="hidden sm:inline">{hideNotation ? '顯示簡譜' : '隱藏簡譜'}</span>
              </button>
              <div className="w-px h-5 md:h-6 bg-neutral-700 mx-1" />
              <button onClick={() => setHideBrackets(!hideBrackets)} className={`flex items-center gap-1 px-2.5 py-1.5 md:px-4 md:py-2 rounded transition text-xs md:text-sm ${hideBrackets ? 'bg-neutral-600 text-neutral-300' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`} title={hideBrackets ? '顯示括號' : '隱藏括號'}>
                <span className="text-xs md:text-sm font-mono">( )</span>
                <span className="hidden sm:inline">{hideBrackets ? '顯示()' : '隱藏()'}</span>
              </button>
            </div>
            <button onClick={handleCopy} className="p-2 md:p-2.5 text-neutral-400 hover:text-white transition" title="複製歌詞">
              <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          </>
          )}
        </div>
        
        {/* 和弦圖 - 從底向上彈出 carousel */}
        <ChordDiagramBottomSheet
          chords={uniqueChords}
          isOpen={showChordDiagram}
          onClose={() => setShowChordDiagram(false)}
          theme={theme}
        />
      </div>
    );
  };

  const handleContentCopy = useCallback((e) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const wrapper = e.currentTarget;
    const lines = [];
    let hasGridLines = false;

    const collectLines = (el) => {
      for (const child of el.children) {
        if (!range.intersectsNode(child)) continue;
        if (child.dataset && child.dataset.cleanText !== undefined) {
          lines.push(child.dataset.cleanText);
          hasGridLines = true;
        } else if (child.tagName === 'DIV') {
          const nested = child.querySelector('[data-clean-text]');
          if (nested) {
            collectLines(child);
          } else {
            lines.push(child.textContent);
          }
        }
      }
    };

    collectLines(wrapper);

    if (hasGridLines && lines.length > 0) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', lines.join('\n'));
    }
  }, []);

  if (isEditing && editable) {
    return (
      <div className={`${theme === 'day' ? 'bg-white rounded-xl border border-neutral-300' : 'bg-[#121212] rounded-xl border border-neutral-800'} ${className}`}>
        {showControls && <ControlBar />}
        <div className="p-4">
          <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className={`w-full h-96 p-4 rounded-lg border outline-none resize-none font-mono text-sm ${theme === 'day' ? 'bg-neutral-50 text-neutral-800 border-neutral-300' : 'bg-black text-neutral-300 border-neutral-700'}`} placeholder="輸入譜內容..." />
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setIsEditing(false)} className={`px-4 py-2 transition ${theme === 'day' ? 'text-neutral-600 hover:text-neutral-900' : 'text-neutral-400 hover:text-white'}`}>取消</button>
            <button onClick={handleSave} className={`px-4 py-2 rounded-lg transition ${theme === 'day' ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-[#FFD700] text-black hover:opacity-90'}`}>保存</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${fullWidth ? (theme === 'day' ? 'bg-white' : 'bg-black') : (theme === 'day' ? 'bg-white rounded-xl border border-neutral-300' : 'bg-[#121212] rounded-xl border border-neutral-800')} ${className}`} style={{ height: 'auto', minHeight: 'auto', maxHeight: 'none' }}>
      {showControls && <ControlBar />}
      <div ref={containerRef} className={fullWidth ? 'p-4' : `p-4 sm:p-6 ${theme === 'day' ? 'bg-white' : 'bg-[#121212]'}`} style={{ height: 'auto', minHeight: 'auto', maxHeight: 'none' }}>
        <div className={`tab-content-wrapper ${displayFont !== 'arial' ? 'font-light' : ''}`} onCopy={handleContentCopy} style={{ height: 'auto', minHeight: 'auto', maxHeight: 'none', fontFamily: displayFont === 'arial' ? "Arial, Helvetica, sans-serif" : "'Source Code Pro', 'Noto Sans Mono CJK TC', 'Consolas', 'Courier New', monospace" }}>
          {songInfo?.remark?.trim() && (
            <div
              className={theme === 'day' ? 'text-neutral-600' : 'text-[#B3B3B3]'}
              style={{ whiteSpace: 'pre-wrap', marginBottom: '1em' }}
            >
              {songInfo.remark.trim()}
            </div>
          )}
          {(notationAlphaTex || '').trim() ? (
            <div
              className={`mb-4 rounded-lg border overflow-hidden ${theme === 'day' ? 'border-neutral-300 bg-neutral-100' : 'border-neutral-700 bg-[#1a1a1a]'}`}
            >
              <NotationAlphaTabPreview alphaTex={notationAlphaTex} />
            </div>
          ) : null}
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default TabContent;