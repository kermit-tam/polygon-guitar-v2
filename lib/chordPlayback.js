/**
 * 和弦發聲 - 使用真實結他樣本 (CDN: tonejs-instruments)
 */

import * as Tone from 'tone';

const CDN = 'https://cdn.jsdelivr.net/npm/tonejs-instrument-guitar-acoustic-mp3@1.1.2';

// 結他樣本 URL（Sampler 會自動 repitch 鄰近音）
const GUITAR_SAMPLES = {
  D2: `${CDN}/D2.mp3`, 'D#2': `${CDN}/Ds2.mp3`, E2: `${CDN}/E2.mp3`,
  F2: `${CDN}/F2.mp3`, 'F#2': `${CDN}/Fs2.mp3`, G2: `${CDN}/G2.mp3`,
  'G#2': `${CDN}/Gs2.mp3`, A2: `${CDN}/A2.mp3`, 'A#2': `${CDN}/As2.mp3`,
  B2: `${CDN}/B2.mp3`, C3: `${CDN}/C3.mp3`, 'C#3': `${CDN}/Cs3.mp3`,
  D3: `${CDN}/D3.mp3`, 'D#3': `${CDN}/Ds3.mp3`, E3: `${CDN}/E3.mp3`,
  F3: `${CDN}/F3.mp3`, 'F#3': `${CDN}/Fs3.mp3`, G3: `${CDN}/G3.mp3`,
  'G#3': `${CDN}/Gs3.mp3`, A3: `${CDN}/A3.mp3`, 'A#3': `${CDN}/As3.mp3`,
  B3: `${CDN}/B3.mp3`, C4: `${CDN}/C4.mp3`, 'C#4': `${CDN}/Cs4.mp3`,
  D4: `${CDN}/D4.mp3`, 'D#4': `${CDN}/Ds4.mp3`, E4: `${CDN}/E4.mp3`,
  F4: `${CDN}/F4.mp3`, 'F#4': `${CDN}/Fs4.mp3`, G4: `${CDN}/G4.mp3`,
  'G#4': `${CDN}/Gs4.mp3`, A4: `${CDN}/A4.mp3`, 'A#4': `${CDN}/As4.mp3`,
  B4: `${CDN}/B4.mp3`, C5: `${CDN}/C5.mp3`,
};

const GUITAR_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']; // 6弦到1弦
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * 根據弦號(1-6)和品位計算 Tone.js 音符
 */
function getNoteFromStringFret(stringNum, fret) {
  const stringIndex = 6 - stringNum;
  const baseNote = GUITAR_TUNING[stringIndex];
  if (!baseNote) return null;

  const match = baseNote.match(/^([A-G])(#|b?)(\d+)$/);
  if (!match) return null;

  const [, note, accidental, octave] = match;
  let noteIndex = NOTES.indexOf(note + accidental);
  let newOctave = parseInt(octave, 10);

  noteIndex += fret;
  while (noteIndex >= 12) {
    noteIndex -= 12;
    newOctave++;
  }

  return NOTES[noteIndex] + newOctave;
}

/**
 * 從和弦指法取得要播放的音符列表
 */
export function getNotesFromChordShape(shape) {
  if (!shape) return [];

  const played = new Map();

  if (shape.open) shape.open.forEach((s) => played.set(s, 0));
  if (shape.fingers) shape.fingers.forEach(([s, f]) => played.set(s, f));
  if (shape.barre) {
    for (let s = shape.barre.from; s <= shape.barre.to; s++) {
      if (!played.has(s)) played.set(s, shape.barre.fret);
    }
  }

  const mute = new Set(shape.mute || []);
  const notes = [];
  for (const [stringNum, fret] of played) {
    if (mute.has(stringNum)) continue;
    const note = getNoteFromStringFret(stringNum, fret);
    if (note) notes.push(note);
  }

  return notes.sort((a, b) => {
    const octA = parseInt(a.match(/\d+$/)?.[0] || 0, 10);
    const octB = parseInt(b.match(/\d+$/)?.[0] || 0, 10);
    if (octA !== octB) return octA - octB;
    return NOTES.indexOf(a.replace(/\d+$/, '')) - NOTES.indexOf(b.replace(/\d+$/, ''));
  });
}

let guitarSampler = null;
let loadPromise = null;

async function getGuitarSampler() {
  if (guitarSampler) return guitarSampler;
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    Tone.start().then(() => {
      guitarSampler = new Tone.Sampler({
        urls: GUITAR_SAMPLES,
        onload: () => resolve(guitarSampler),
        onerror: (e) => {
          console.warn('Guitar samples load error:', e);
          reject(e);
        },
      }).toDestination();
    }).catch(reject);
  });

  return loadPromise;
}

const STRUM_DELAY_FIRST = 250;   // 第一次撥弦：每弦 250ms
const STRUM_DELAY_REPEAT = 60;   // 重複撥弦：每弦 60ms
const GAP_BETWEEN_STRUMS = 600;  // 兩次撥弦之間間隔 600ms
const NOTE_DURATION_MS = 1200;   // 每個音符持續 1.2 秒

let _pendingTimers = [];
let _playbackGen = 0;

function cancelPendingPlayback(sampler) {
  _pendingTimers.forEach(id => clearTimeout(id));
  _pendingTimers = [];
  _playbackGen++;
  if (sampler) sampler.releaseAll();
}

/**
 * 播放和弦（撥弦兩次，每音持續較長讓尾音自然 decay）
 * 重複撳會先停止上一次播放，避免聲音疊加
 */
export async function playChord(shape) {
  const notes = getNotesFromChordShape(shape);
  if (notes.length === 0) return;

  try {
    const sampler = await getGuitarSampler();
    cancelPendingPlayback(sampler);
    const gen = _playbackGen;

    const scheduleNote = (note, delayMs) => {
      const attackTimer = setTimeout(() => {
        if (_playbackGen !== gen) return;
        sampler.triggerAttack(note, Tone.now());
        const releaseTimer = setTimeout(() => {
          if (_playbackGen !== gen) return;
          sampler.triggerRelease(note, Tone.now());
        }, NOTE_DURATION_MS);
        _pendingTimers.push(releaseTimer);
      }, delayMs);
      _pendingTimers.push(attackTimer);
    };

    // 第一次撥弦
    notes.forEach((note, i) => {
      scheduleNote(note, i * STRUM_DELAY_FIRST);
    });

    // 第二次撥弦
    const repeatOffset = (notes.length - 1) * STRUM_DELAY_FIRST + GAP_BETWEEN_STRUMS;
    notes.forEach((note, i) => {
      scheduleNote(note, repeatOffset + i * STRUM_DELAY_REPEAT);
    });
  } catch (e) {
    console.warn('Chord playback error:', e);
  }
}
