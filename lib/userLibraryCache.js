/**
 * Client-side read/write cache for the library page.
 *
 * Data lives in Firestore `userLibraryCache/{userId}`.
 * One document = one read on page load (vs. 4+ queries + hydration).
 *
 * Source-of-truth collections (userLikedSongs, userPlaylists, etc.) remain unchanged.
 * This cache is a denormalised read-view, updated incrementally on every write
 * and rebuilt from scratch on cache miss.
 */

import { db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, increment as firestoreIncrement, arrayUnion, arrayRemove } from '@/lib/firestore-tracked';
import { getUserPlaylists, getUserLikedSongs, getSavedPlaylistsWithMeta, getSavedArtistsWithMeta } from './playlistApi';
import { getTabsByIds } from './tabs';
import { getSongThumbnail } from './getSongThumbnail';

const COLLECTION = 'userLibraryCache';

const SS_KEY = 'pg_library_cache';

function _readSessionCache(userId) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.userId === userId) return parsed.data;
  } catch (_) {}
  return null;
}

function _writeSessionCache(userId, data) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify({ userId, data }));
  } catch (_) {}
}

function _clearSessionCache() {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(SS_KEY); } catch (_) {}
}

/** Returns true when sessionStorage has been cleared by a mutation. */
export function isLibraryCacheStale(userId) {
  return !_readSessionCache(userId);
}

/** Check if an artist is saved, using sessionStorage cache (no Firestore read). Returns null if cache unavailable. */
export function isArtistSavedInCache(userId, artistId) {
  if (!userId || !artistId) return null;
  const cached = _readSessionCache(userId);
  if (!cached) return null;
  return (cached.savedArtists || []).some((a) => a.id === artistId);
}

/** Check if a song is liked, using sessionStorage cache. Returns null if cache unavailable. */
export function isSongLikedInCache(userId, songId) {
  if (!userId || !songId) return null;
  const cached = _readSessionCache(userId);
  if (!cached || !cached.likedSongIds) return null;
  return cached.likedSongIds.includes(songId);
}

/** Get user playlists from sessionStorage cache. Returns null if cache unavailable. */
export function getPlaylistsFromCache(userId) {
  if (!userId) return null;
  const cached = _readSessionCache(userId);
  if (!cached) return null;
  return cached.playlists || [];
}

function resolveCover(tab) {
  if (!tab) return null;
  return { id: tab.id, thumbnail: getSongThumbnail(tab) || null };
}

// ==================== Read ====================

/**
 * Read the library cache doc. Returns the cached data or rebuilds on miss.
 * Checks sessionStorage first to avoid Firestore reads on refresh.
 */
export async function getUserLibrary(userId) {
  if (!userId) return null;
  const cached = _readSessionCache(userId);
  if (cached) return cached;
  let result = null;
  try {
    const ref = doc(db, COLLECTION, userId);
    const snap = await getDoc(ref);
    if (snap.exists()) result = snap.data();
  } catch (e) {
    console.warn('[userLibraryCache] cache read failed, rebuilding:', e?.message);
  }
  // Rebuild if missing or if schema is outdated (e.g. likedSongIds not present)
  if (!result || !result.likedSongIds) result = await rebuildUserLibraryCache(userId);
  if (result) _writeSessionCache(userId, result);
  return result;
}

/** Invalidate the session cache so the next call hits Firestore. */
export function invalidateLibraryMemCache() {
  _clearSessionCache();
}

// ==================== Full rebuild ====================

/**
 * Rebuild cache from source-of-truth collections and write to Firestore.
 * Called on first visit or when cache doc is missing.
 */
export async function rebuildUserLibraryCache(userId) {
  if (!userId) return null;

  const [userPlaylists, savedPlaylists, savedArtists, likedSongIds] = await Promise.all([
    getUserPlaylists(userId),
    getSavedPlaylistsWithMeta(userId),
    getSavedArtistsWithMeta(userId),
    getUserLikedSongs(userId),
  ]);

  const tabIdsForCovers = [];
  const seen = new Set();
  for (const pl of userPlaylists) {
    for (const id of (pl.songIds || []).slice(0, 4)) {
      if (id && !seen.has(id)) {
        seen.add(id);
        tabIdsForCovers.push(id);
      }
    }
  }
  const tabList = tabIdsForCovers.length ? await getTabsByIds(tabIdsForCovers) : [];
  const tabMap = new Map(tabList.map((t) => [t.id, resolveCover(t)]));

  const playlists = userPlaylists.map((pl) => ({
    id: pl.id,
    title: pl.title,
    songCount: (pl.songIds || []).length,
    coverImage: pl.coverImage || null,
    coverSongs: (pl.songIds || []).slice(0, 4).map((id) => tabMap.get(id)).filter(Boolean),
    createdAtMs: pl.createdAt?.toMillis?.() || 0,
  }));

  const cacheData = {
    likedCount: likedSongIds.length,
    likedSongIds,
    playlists,
    savedPlaylists: savedPlaylists.map((pl) => ({
      id: pl.id,
      title: pl.title,
      coverImage: pl.coverImage || null,
      curatedBy: pl.curatedBy || 'Polygon',
      savedAtMs: pl.savedAtMs || 0,
    })),
    savedArtists: savedArtists.map((ar) => ({
      id: ar.id,
      name: ar.name,
      photoURL: ar.photoURL || ar.wikiPhotoURL || null,
      savedAtMs: ar.savedAtMs || 0,
    })),
    updatedAt: Date.now(),
  };

  try {
    await setDoc(doc(db, COLLECTION, userId), cacheData);
  } catch (e) {
    console.warn('[userLibraryCache] rebuild write failed:', e?.message);
  }

  return cacheData;
}

// ==================== Incremental patch helpers ====================
// All patches are fire-and-forget: failures are swallowed so they never
// block the primary write. The next page visit will rebuild if needed.

/**
 * +1 or -1 liked count, and add/remove songId from likedSongIds.
 */
export function patchCacheLikedCount(userId, delta, songId) {
  if (!userId) return;
  // Update sessionStorage in-place so the tab page sees the change immediately
  if (songId) {
    const cached = _readSessionCache(userId);
    if (cached) {
      const ids = cached.likedSongIds || [];
      if (delta > 0 && !ids.includes(songId)) {
        cached.likedSongIds = [songId, ...ids];
      } else if (delta < 0) {
        cached.likedSongIds = ids.filter((id) => id !== songId);
      }
      cached.likedCount = (cached.likedCount || 0) + delta;
      cached.updatedAt = Date.now();
      _writeSessionCache(userId, cached);
    } else {
      _clearSessionCache();
    }
  } else {
    _clearSessionCache();
  }
  const update = { likedCount: firestoreIncrement(delta), updatedAt: Date.now() };
  if (songId) update.likedSongIds = delta > 0 ? arrayUnion(songId) : arrayRemove(songId);
  updateDoc(doc(db, COLLECTION, userId), update).catch(() => {});
}

/**
 * Add or remove a saved (site) playlist.
 * @param {{ id, title, coverImage?, curatedBy? }} playlistMeta
 */
export async function patchCacheSavedPlaylist(userId, playlistMeta, isSaved) {
  if (!userId) return;
  _clearSessionCache();
  try {
    const ref = doc(db, COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    let list = snap.data().savedPlaylists || [];
    list = list.filter((p) => p.id !== playlistMeta.id);
    if (isSaved) {
      list.push({
        id: playlistMeta.id,
        title: playlistMeta.title || '未命名歌單',
        coverImage: playlistMeta.coverImage || null,
        curatedBy: playlistMeta.curatedBy || 'Polygon',
        savedAtMs: Date.now(),
      });
    }
    await updateDoc(ref, { savedPlaylists: list, updatedAt: Date.now() });
  } catch (_) {}
}

/**
 * Add or remove a saved artist.
 * @param {{ id, name, photoURL?, wikiPhotoURL? }} artistMeta
 */
export async function patchCacheSavedArtist(userId, artistMeta, isSaved) {
  if (!userId) return;
  _clearSessionCache();
  try {
    const ref = doc(db, COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    let list = snap.data().savedArtists || [];
    list = list.filter((a) => a.id !== artistMeta.id);
    if (isSaved) {
      list.push({
        id: artistMeta.id,
        name: artistMeta.name,
        photoURL: artistMeta.photoURL || artistMeta.wikiPhotoURL || null,
        savedAtMs: Date.now(),
      });
    }
    await updateDoc(ref, { savedArtists: list, updatedAt: Date.now() });
  } catch (_) {}
}

/**
 * Add a newly created user playlist to cache.
 */
export async function patchCacheAddPlaylist(userId, playlist) {
  if (!userId) return;
  _clearSessionCache();
  try {
    const ref = doc(db, COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const list = snap.data().playlists || [];
    list.unshift({
      id: playlist.id,
      title: playlist.title,
      songCount: 0,
      coverImage: null,
      coverSongs: [],
      createdAtMs: Date.now(),
    });
    await updateDoc(ref, { playlists: list, updatedAt: Date.now() });
  } catch (_) {}
}

/**
 * Remove a deleted user playlist from cache.
 */
export async function patchCacheRemovePlaylist(userId, playlistId) {
  if (!userId) return;
  _clearSessionCache();
  try {
    const ref = doc(db, COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const list = (snap.data().playlists || []).filter((p) => p.id !== playlistId);
    await updateDoc(ref, { playlists: list, updatedAt: Date.now() });
  } catch (_) {}
}

/**
 * Update a user playlist's metadata (title, etc.) in cache.
 */
export async function patchCacheUpdatePlaylist(userId, playlistId, updates) {
  if (!userId || !playlistId) return;
  _clearSessionCache();
  try {
    const ref = doc(db, COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const list = (snap.data().playlists || []).map((p) => {
      if (p.id !== playlistId) return p;
      return { ...p, ...updates };
    });
    await updateDoc(ref, { playlists: list, updatedAt: Date.now() });
  } catch (_) {}
}

/**
 * Refresh a single playlist's songCount + coverImage + coverSongs from source playlist doc.
 * 只在寫入時讀 tabs 前 4 首；頁面 render 時唔再額外讀。
 */
export async function patchCachePlaylistCovers(userId, playlistId) {
  if (!userId || !playlistId) return;
  _clearSessionCache();
  try {
    const [plSnap, cacheSnap] = await Promise.all([
      getDoc(doc(db, 'userPlaylists', playlistId)),
      getDoc(doc(db, COLLECTION, userId)),
    ]);
    if (!plSnap.exists() || !cacheSnap.exists()) return;

    const songIds = plSnap.data().songIds || [];
    const coverImage = plSnap.data().coverImage || null;
    const coverIds = songIds.slice(0, 4);
    let coverSongs = [];
    if (coverIds.length > 0) {
      const tabs = await getTabsByIds(coverIds);
      const tabMap = new Map(tabs.map((t) => [t.id, t]));
      coverSongs = coverIds.map((id) => tabMap.get(id)).filter(Boolean).map(resolveCover);
    }

    const list = (cacheSnap.data().playlists || []).map((p) => {
      if (p.id !== playlistId) return p;
      return { ...p, songCount: songIds.length, coverImage, coverSongs };
    });
    await updateDoc(doc(db, COLLECTION, userId), { playlists: list, updatedAt: Date.now() });
  } catch (_) {}
}
