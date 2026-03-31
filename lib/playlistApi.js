// lib/playlistApi.js
import { 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc, 
  updateDoc,
  increment,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  documentId
} from '@/lib/firestore-tracked';
import { db } from './firebase';
import {
  patchCacheLikedCount,
  patchCacheSavedPlaylist,
  patchCacheSavedArtist,
  patchCacheAddPlaylist,
  patchCacheRemovePlaylist,
  patchCacheUpdatePlaylist,
  patchCachePlaylistCovers,
} from './userLibraryCache';

/**
 * 切換喜愛狀態（加入或移除喜愛）
 * @param {string} userId 
 * @param {string} songId 
 * @returns {Promise<{isLiked: boolean}>}
 */
export async function toggleLikeSong(userId, songId) {
  if (!userId || !songId) throw new Error('參數錯誤');
  
  const likedRef = doc(db, 'userLikedSongs', `${userId}_${songId}`);
  
  try {
    const likedDoc = await getDoc(likedRef);
    
    if (likedDoc.exists()) {
      await deleteDoc(likedRef);
      patchCacheLikedCount(userId, -1, songId);
      return { isLiked: false, action: 'removed' };
    } else {
      await setDoc(likedRef, {
        userId,
        songId,
        likedAt: serverTimestamp()
      });
      patchCacheLikedCount(userId, 1, songId);
      return { isLiked: true, action: 'added' };
    }
  } catch (error) {
    console.error('切換喜愛狀態失敗:', error);
    throw error;
  }
}

/**
 * 檢查歌曲是否已被喜愛
 * @param {string} userId 
 * @param {string} songId 
 * @returns {Promise<boolean>}
 */
export async function checkIsLiked(userId, songId) {
  if (!userId || !songId) return false;
  
  try {
    const likedRef = doc(db, 'userLikedSongs', `${userId}_${songId}`);
    const likedDoc = await getDoc(likedRef);
    return likedDoc.exists();
  } catch (error) {
    console.error('檢查喜愛狀態失敗:', error);
    return false;
  }
}

/**
 * 獲取用戶所有喜愛歌曲ID
 * @param {string} userId 
 * @returns {Promise<Array<string>>}
 */
export async function getUserLikedSongs(userId) {
  if (!userId) return [];
  
  try {
    const q = query(
      collection(db, 'userLikedSongs'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data().songId);
  } catch (error) {
    console.error('獲取喜愛歌曲失敗:', error);
    return [];
  }
}

// ==================== 已收藏歌單（site playlists 收藏到收藏頁） ====================

/**
 * 將站內歌單加入「已收藏歌單」
 * @param {string} userId
 * @param {string} playlistId - 來自 playlists collection 的 id
 * @returns {Promise<{saved: boolean}>}
 */
export async function savePlaylistToLibrary(userId, playlistId, playlistMeta) {
  if (!userId || !playlistId) throw new Error('參數錯誤');
  const ref = doc(db, 'userSavedPlaylists', `${userId}_${playlistId}`);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return { saved: true, alreadySaved: true };
  }
  await setDoc(ref, {
    userId,
    playlistId,
    savedAt: serverTimestamp()
  });
  try {
    await updateDoc(doc(db, 'playlists', playlistId), { savedCount: increment(1) });
  } catch (_) {}
  // Fire-and-forget cache update
  (async () => {
    try {
      let meta = playlistMeta;
      if (!meta) {
        const plSnap = await getDoc(doc(db, 'playlists', playlistId));
        if (plSnap.exists()) meta = { id: playlistId, ...plSnap.data() };
      }
      if (meta) patchCacheSavedPlaylist(userId, meta, true);
    } catch (_) {}
  })();
  return { saved: true, alreadySaved: false };
}

/**
 * 從「已收藏歌單」移除
 */
export async function removeSavedPlaylist(userId, playlistId) {
  if (!userId || !playlistId) throw new Error('參數錯誤');
  const ref = doc(db, 'userSavedPlaylists', `${userId}_${playlistId}`);
  await deleteDoc(ref);
  try {
    const plRef = doc(db, 'playlists', playlistId);
    const plSnap = await getDoc(plRef);
    if (plSnap.exists() && (plSnap.data().savedCount || 0) > 0) {
      await updateDoc(plRef, { savedCount: increment(-1) });
    }
  } catch (_) {}
  patchCacheSavedPlaylist(userId, { id: playlistId }, false);
  return { saved: false };
}

/**
 * 檢查當前歌單是否已收藏
 */
export async function checkIsPlaylistSaved(userId, playlistId) {
  if (!userId || !playlistId) return false;
  try {
    const ref = doc(db, 'userSavedPlaylists', `${userId}_${playlistId}`);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch (e) {
    console.error('檢查收藏歌單失敗:', e);
    return false;
  }
}

/**
 * 獲取用戶已收藏的站內歌單 ID 列表
 */
export async function getUserSavedPlaylistIds(userId) {
  if (!userId) return [];
  try {
    const q = query(
      collection(db, 'userSavedPlaylists'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data().playlistId);
  } catch (error) {
    console.error('獲取已收藏歌單失敗:', error);
    return [];
  }
}

const BATCH_IN_LIMIT = 30; // Firestore 'in' query max

/** Ensure playlist title is always a displayable string (avoids "NaN" from bad data). */
function safePlaylistTitle(title) {
  if (typeof title === 'string' && title.trim()) return title.trim();
  return '未命名歌單';
}

function resolveTabCoverImage(tab) {
  if (!tab) return null;
  if (tab.coverImage) return tab.coverImage;
  if (tab.albumImage) return tab.albumImage;
  if (tab.thumbnail) return tab.thumbnail;
  const vid = tab.youtubeVideoId || tab.youtubeUrl?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (vid) return `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
  return null;
}

async function refreshUserPlaylistCoverImage(playlistRef, plDataOverride = null) {
  const snap = plDataOverride ? null : await getDoc(playlistRef);
  const plData = plDataOverride || (snap?.exists() ? snap.data() : null);
  if (!plData || plData.customCover === true) return;

  const firstSongId = (plData.songIds || [])[0];
  let nextCover = null;
  if (firstSongId) {
    const songSnap = await getDoc(doc(db, 'tabs', firstSongId));
    if (songSnap.exists()) nextCover = resolveTabCoverImage(songSnap.data());
  }

  const currentCover = plData.coverImage || null;
  if ((currentCover || null) !== (nextCover || null)) {
    await updateDoc(playlistRef, {
      coverImage: nextCover || null,
      updatedAt: serverTimestamp()
    });
  }
}

/**
 * 獲取已收藏歌單（含 savedAt，供收藏頁「最近加入」排序）
 * 使用 batch 查詢 playlists，避免 N+1：1 query + ceil(N/30) getDocs(playlists)
 */
export async function getSavedPlaylistsWithMeta(userId) {
  if (!userId) return [];
  try {
    const q = query(
      collection(db, 'userSavedPlaylists'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    const orderedIds = snapshot.docs.map((d) => d.data().playlistId);
    const savedAtMap = new Map(
      snapshot.docs.map((d) => {
        const { playlistId, savedAt } = d.data();
        return [playlistId, savedAt?.toMillis?.() ?? 0];
      })
    );
    if (orderedIds.length === 0) return [];

    const playlistById = new Map();
    for (let i = 0; i < orderedIds.length; i += BATCH_IN_LIMIT) {
      const chunk = orderedIds.slice(i, i + BATCH_IN_LIMIT);
      const batchQ = query(
        collection(db, 'playlists'),
        where(documentId(), 'in', chunk)
      );
      const batchSnap = await getDocs(batchQ);
      batchSnap.docs.forEach((d) => playlistById.set(d.id, { id: d.id, ...d.data() }));
    }

    const list = orderedIds
      .map((id) => {
        const meta = playlistById.get(id);
        if (!meta) return null;
        return { ...meta, title: safePlaylistTitle(meta.title), savedAtMs: savedAtMap.get(id) ?? 0 };
      })
      .filter(Boolean);
    return list;
  } catch (error) {
    console.error('獲取已收藏歌單（含 meta）失敗:', error);
    return [];
  }
}

// ==================== 已收藏歌手 ====================

/**
 * 將歌手加入「已收藏歌手」
 */
export async function saveArtistToLibrary(userId, artistId, artistMeta) {
  if (!userId || !artistId) throw new Error('參數錯誤');
  const ref = doc(db, 'userSavedArtists', `${userId}_${artistId}`);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return { saved: true, alreadySaved: true };
  }
  await setDoc(ref, {
    userId,
    artistId,
    savedAt: serverTimestamp()
  });
  // Fire-and-forget cache update
  (async () => {
    try {
      let meta = artistMeta;
      if (!meta) {
        const arSnap = await getDoc(doc(db, 'artists', artistId));
        if (arSnap.exists()) meta = { id: artistId, ...arSnap.data() };
      }
      if (meta) patchCacheSavedArtist(userId, meta, true);
    } catch (_) {}
  })();
  return { saved: true, alreadySaved: false };
}

/**
 * 從「已收藏歌手」移除（取消收藏）
 */
export async function removeSavedArtist(userId, artistId) {
  if (!userId || !artistId) throw new Error('參數錯誤');
  const ref = doc(db, 'userSavedArtists', `${userId}_${artistId}`);
  await deleteDoc(ref);
  patchCacheSavedArtist(userId, { id: artistId }, false);
  return { saved: false };
}

/**
 * 檢查歌手是否已收藏
 */
export async function checkIsArtistSaved(userId, artistId) {
  if (!userId || !artistId) return false;
  try {
    const ref = doc(db, 'userSavedArtists', `${userId}_${artistId}`);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch (e) {
    console.error('檢查收藏歌手失敗:', e);
    return false;
  }
}

/**
 * 獲取用戶已收藏的歌手 ID 列表
 */
export async function getUserSavedArtistIds(userId) {
  if (!userId) return [];
  try {
    const q = query(
      collection(db, 'userSavedArtists'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.data().artistId);
  } catch (error) {
    console.error('獲取已收藏歌手失敗:', error);
    return [];
  }
}

/**
 * 獲取已收藏歌手（含 savedAt，供收藏頁「最近加入」排序）
 * 使用 batch 查詢 artists，避免 N+1：1 query + ceil(N/30) getDocs(artists)
 */
export async function getSavedArtistsWithMeta(userId) {
  if (!userId) return [];
  try {
    const q = query(
      collection(db, 'userSavedArtists'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    const orderedIds = snapshot.docs.map((d) => d.data().artistId);
    const savedAtMap = new Map(
      snapshot.docs.map((d) => {
        const { artistId, savedAt } = d.data();
        return [artistId, savedAt?.toMillis?.() ?? 0];
      })
    );
    if (orderedIds.length === 0) return [];

    const artistById = new Map();
    for (let i = 0; i < orderedIds.length; i += BATCH_IN_LIMIT) {
      const chunk = orderedIds.slice(i, i + BATCH_IN_LIMIT);
      const batchQ = query(
        collection(db, 'artists'),
        where(documentId(), 'in', chunk)
      );
      const batchSnap = await getDocs(batchQ);
      batchSnap.docs.forEach((d) => artistById.set(d.id, { id: d.id, ...d.data() }));
    }

    const list = orderedIds
      .map((id) => {
        const meta = artistById.get(id);
        if (!meta) return null;
        return { ...meta, savedAtMs: savedAtMap.get(id) ?? 0 };
      })
      .filter(Boolean);
    return list;
  } catch (error) {
    console.error('獲取已收藏歌手（含 meta）失敗:', error);
    return [];
  }
}

/**
 * 創建新歌單
 * @param {string} userId 
 * @param {string} title 
 * @param {string} description 
 * @returns {Promise<{playlistId: string}>}
 */
export async function createPlaylist(userId, title, description = '') {
  if (!userId || !title.trim()) throw new Error('參數錯誤');
  
  try {
    const playlistData = {
      userId,
      title: title.trim(),
      description: description.trim(),
      songIds: [],
      coverImage: null, // 如果為 null，會用前4首歌封面拼貼
      isPublic: false,
      likes: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    const docRef = await addDoc(collection(db, 'userPlaylists'), playlistData);
    patchCacheAddPlaylist(userId, { id: docRef.id, title: title.trim() });
    return { playlistId: docRef.id, ...playlistData };
  } catch (error) {
    console.error('創建歌單失敗:', error);
    throw error;
  }
}

/**
 * 獲取用戶所有歌單
 * @param {string} userId 
 * @returns {Promise<Array>}
 */
export async function getUserPlaylists(userId) {
  if (!userId) return [];
  
  try {
    const q = query(
      collection(db, 'userPlaylists'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    
    // 按創建時間排序（最新的在前面）
    const playlists = snapshot.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, title: safePlaylistTitle(data.title) };
    }).sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeB - timeA;
    });

    // 低負荷 fallback：舊歌單未 backfill coverImage 時，只批量查「第一首歌」補顯示用封面
    const firstSongIds = [];
    const seenFirstSong = new Set();
    playlists.forEach((pl) => {
      if (pl.coverImage) return;
      const firstSongId = Array.isArray(pl.songIds) ? pl.songIds[0] : null;
      if (firstSongId && !seenFirstSong.has(firstSongId)) {
        seenFirstSong.add(firstSongId);
        firstSongIds.push(firstSongId);
      }
    });

    if (firstSongIds.length > 0) {
      const tabById = new Map();
      for (let i = 0; i < firstSongIds.length; i += BATCH_IN_LIMIT) {
        const chunk = firstSongIds.slice(i, i + BATCH_IN_LIMIT);
        const tabsQ = query(
          collection(db, 'tabs'),
          where(documentId(), 'in', chunk)
        );
        const tabsSnap = await getDocs(tabsQ);
        tabsSnap.docs.forEach((d) => tabById.set(d.id, d.data()));
      }

      playlists.forEach((pl) => {
        if (pl.coverImage) return;
        const firstSongId = Array.isArray(pl.songIds) ? pl.songIds[0] : null;
        if (!firstSongId) return;
        const tab = tabById.get(firstSongId);
        const fallback = resolveTabCoverImage(tab);
        if (fallback) pl.coverImage = fallback;
      });
    }
    
    return playlists;
  } catch (error) {
    console.error('獲取用戶歌單失敗:', error);
    return [];
  }
}

/**
 * 獲取單個歌單詳情
 * @param {string} playlistId 
 * @returns {Promise<Object|null>}
 */
export async function getPlaylist(playlistId) {
  if (!playlistId) return null;
  
  try {
    const playlistRef = doc(db, 'userPlaylists', playlistId);
    const playlistDoc = await getDoc(playlistRef);
    
    if (playlistDoc.exists()) {
      return { id: playlistDoc.id, ...playlistDoc.data() };
    }
    return null;
  } catch (error) {
    console.error('獲取歌單詳情失敗:', error);
    return null;
  }
}

/**
 * 添加歌曲到歌單
 * @param {string} playlistId 
 * @param {string} songId 
 * @returns {Promise<{success: boolean}>}
 */
export async function addSongToPlaylist(playlistId, songId) {
  if (!playlistId || !songId) throw new Error('參數錯誤');
  
  try {
    const playlistRef = doc(db, 'userPlaylists', playlistId);
    const playlistDoc = await getDoc(playlistRef);
    
    if (!playlistDoc.exists()) {
      throw new Error('歌單不存在');
    }
    
    const plData = playlistDoc.data();
    const currentSongs = plData.songIds || [];
    
    if (currentSongs.includes(songId)) {
      return { success: false, message: '歌曲已在歌單中' };
    }
    
    await updateDoc(playlistRef, {
      songIds: arrayUnion(songId),
      updatedAt: serverTimestamp()
    });
    
    try {
      const songRef = doc(db, 'tabs', songId);
      await updateDoc(songRef, { playlistCount: increment(1) });
      console.log('[playlistCount] incremented for', songId);
    } catch (e) {
      console.error('[playlistCount] increment failed:', e);
    }
    
    // 自動封面（非 customCover）：加歌後同步封面（以第一首歌封面為準）
    try {
      await refreshUserPlaylistCoverImage(playlistRef);
    } catch (e) {
      console.error('更新 user playlist 封面失敗(add):', e);
    }

    if (plData.userId) {
      patchCachePlaylistCovers(plData.userId, playlistId);
    }
    
    return { success: true, action: 'added' };
  } catch (error) {
    console.error('添加歌曲到歌單失敗:', error);
    throw error;
  }
}

/**
 * 從歌單移除歌曲
 * @param {string} playlistId 
 * @param {string} songId 
 */
export async function removeSongFromPlaylist(playlistId, songId) {
  if (!playlistId || !songId) throw new Error('參數錯誤');
  
  try {
    const playlistRef = doc(db, 'userPlaylists', playlistId);
    const playlistDoc = await getDoc(playlistRef);
    
    await updateDoc(playlistRef, {
      songIds: arrayRemove(songId),
      updatedAt: serverTimestamp()
    });
    
    try {
      const songRef = doc(db, 'tabs', songId);
      const songDoc = await getDoc(songRef);
      if (songDoc.exists() && (songDoc.data().playlistCount || 0) > 0) {
        await updateDoc(songRef, { playlistCount: increment(-1) });
      }
    } catch (_) {}
    
    try {
      const existed = playlistDoc.exists() ? playlistDoc.data() : null;
      const nextSongIds = (existed?.songIds || []).filter((id) => id !== songId);
      await refreshUserPlaylistCoverImage(playlistRef, {
        ...(existed || {}),
        songIds: nextSongIds
      });
    } catch (e) {
      console.error('更新 user playlist 封面失敗(remove):', e);
    }

    const plUserId = playlistDoc.exists() ? playlistDoc.data().userId : null;
    if (plUserId) {
      patchCachePlaylistCovers(plUserId, playlistId);
    }
    
    return { success: true, action: 'removed' };
  } catch (error) {
    console.error('從歌單移除歌曲失敗:', error);
    throw error;
  }
}

/**
 * 刪除歌單
 * @param {string} playlistId 
 * @param {string} userId 
 */
export async function deletePlaylist(playlistId, userId) {
  if (!playlistId || !userId) throw new Error('參數錯誤');
  
  try {
    // 驗證權限
    const playlist = await getPlaylist(playlistId);
    if (!playlist || playlist.userId !== userId) {
      throw new Error('無權限刪除此歌單');
    }
    
    await deleteDoc(doc(db, 'userPlaylists', playlistId));
    patchCacheRemovePlaylist(userId, playlistId);
    return { success: true };
  } catch (error) {
    console.error('刪除歌單失敗:', error);
    throw error;
  }
}

/**
 * 更新歌單資訊
 * @param {string} playlistId 
 * @param {Object} updates - { title, description, isPublic }
 */
export async function updatePlaylist(playlistId, updates, userId) {
  if (!playlistId) throw new Error('參數錯誤');
  
  try {
    const playlistRef = doc(db, 'userPlaylists', playlistId);
    await updateDoc(playlistRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });

    // 當 songIds 被整批更新（例如手動排序）時，自動維護 userPlaylists 封面（非 customCover）
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'songIds')) {
      try {
        const snap = await getDoc(playlistRef);
        if (snap.exists()) {
          await refreshUserPlaylistCoverImage(playlistRef, snap.data());
        }
      } catch (e) {
        console.error('更新 user playlist 封面失敗(updatePlaylist.songIds):', e);
      }
    }
    
    // Fire-and-forget cache update
    (async () => {
      try {
        let uid = userId;
        if (!uid) {
          const snap = await getDoc(playlistRef);
          uid = snap.exists() ? snap.data().userId : null;
        }
        if (uid && updates.title) {
          patchCacheUpdatePlaylist(uid, playlistId, { title: updates.title });
        }
      } catch (_) {}
    })();
    
    return { success: true };
  } catch (error) {
    console.error('更新歌單失敗:', error);
    throw error;
  }
}

/**
 * 獲取歌單封面（前4首歌的封面）
 * 使用單次 getDocs(documentId() in ids)，避免 4 次 getDoc。
 * @param {Array<string>} songIds
 * @returns {Promise<Array<string>>}
 */
export async function getPlaylistCovers(songIds) {
  if (!songIds || songIds.length === 0) return [];

  const ids = songIds.slice(0, 4);
  if (ids.length === 0) return [];

  try {
    const q = query(
      collection(db, 'tabs'),
      where(documentId(), 'in', ids)
    );
    const snapshot = await getDocs(q);
    const byId = new Map(snapshot.docs.map((d) => [d.id, d.data()]));
    return ids
      .map((id) => byId.get(id)?.thumbnail)
      .filter(Boolean);
  } catch (error) {
    console.error('獲取歌單封面失敗:', error);
    return [];
  }
}
