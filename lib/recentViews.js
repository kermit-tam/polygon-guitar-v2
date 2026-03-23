// 瀏覽記錄功能
import { doc, updateDoc, arrayUnion, getDoc, setDoc } from '@/lib/firestore-tracked';
import { db } from './firebase';
import { getTabArtistIds } from '@/lib/tabs';

const MAX_RECENT_ITEMS = 20;

// 添加瀏覽記錄到 localStorage（支援未登入用戶）
function addToLocalStorage(item) {
  try {
    const viewItem = {
      ...item,
      timestamp: new Date().toISOString()
    };
    
    // 讀取現有記錄
    const saved = localStorage.getItem('recentViews');
    const recentViews = saved ? JSON.parse(saved) : [];
    
    // 移除同類型同 ID 嘅舊記錄（避免重複）
    const filtered = recentViews.filter(
      v => !(v.type === item.type && v.id === item.id)
    );
    
    // 添加新記錄到最前面
    const updated = [viewItem, ...filtered].slice(0, MAX_RECENT_ITEMS);
    
    // 保存到 localStorage
    localStorage.setItem('recentViews', JSON.stringify(updated));
  } catch (error) {
    console.error('Error saving to localStorage:', error);
  }
}

// 添加瀏覽記錄
export async function addRecentView(userId, item) {
  // 無論登入與否，都寫入 localStorage（首頁會讀取）
  addToLocalStorage(item);
  
  // 如果已登入，同時寫入 Firestore
  if (!userId) return;

  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    const viewItem = {
      ...item,
      timestamp: new Date().toISOString()
    };

    if (userDoc.exists()) {
      const currentData = userDoc.data();
      const recentViews = currentData.recentViews || [];
      
      // 移除同類型同 ID 嘅舊記錄（避免重複）
      const filtered = recentViews.filter(
        v => !(v.type === item.type && v.itemId === item.itemId)
      );
      
      // 添加新記錄到最前面
      const updated = [viewItem, ...filtered].slice(0, MAX_RECENT_ITEMS);
      
      await updateDoc(userRef, {
        recentViews: updated
      });
    } else {
      // 創建新用戶文檔
      await setDoc(userRef, {
        recentViews: [viewItem]
      });
    }
  } catch (error) {
    console.error('Error adding recent view:', error);
  }
}

// 從 localStorage 移除已刪除嘅項目
export function removeFromRecentViews(type, id) {
  if (typeof window === 'undefined' || !id) return;
  try {
    const saved = localStorage.getItem('recentViews');
    if (!saved) return;
    const list = JSON.parse(saved);
    const filtered = list.filter(v => !(v.type === type && v.id === id));
    if (filtered.length !== list.length) {
      localStorage.setItem('recentViews', JSON.stringify(filtered));
    }
  } catch (_) {}
}

// 從 YouTube URL 提取縮圖
function getYouTubeThumbnail(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (match) {
    return `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`;
  }
  return null;
}

// 記錄歌曲瀏覽：只存 artistIds（與 tabs 文件一致），顯示名由 artist map 解析
export async function recordSongView(userId, song) {
  const thumbnail =
    song.coverImage ||
    song.albumImage ||
    song.thumbnail ||
    getYouTubeThumbnail(song.youtubeUrl) ||
    song.artistPhoto ||
    null;

  const artistIds = getTabArtistIds(song)
  const artistsForRecent =
    artistIds.length > 1 && Array.isArray(song.artists) && song.artists.length > 1
      ? song.artists.map((a, i) => ({
          role:
            i === 0
              ? 'main'
              : a.role === 'feat' || a.relation === 'feat'
                ? 'feat'
                : 'slash'
        }))
      : null
  await addRecentView(userId, {
    type: 'tab',
    id: song.id,
    itemId: song.id,
    title: song.title,
    artistIds,
    ...(artistsForRecent ? { artists: artistsForRecent } : {}),
    ...(thumbnail ? { thumbnail } : {})
  })
}

// 記錄歌手瀏覽：只存 id + image，顯示時用 artist map 解析名
export async function recordArtistView(userId, artist) {
  const id = artist.id || artist.normalizedName || artist.slug;
  const image = artist.photoURL || artist.wikiPhotoURL || artist.photo || null;
  await addRecentView(userId, {
    type: 'artist',
    id,
    itemId: id,
    image
  });
}

// 記錄歌單瀏覽
export async function recordPlaylistView(userId, playlist) {
  await addRecentView(userId, {
    type: 'playlist',
    id: playlist.id,
    itemId: playlist.id,
    title: playlist.title,
    subtitle: '歌單',
    image: playlist.coverImage || null,
    thumbnail: playlist.coverImage || null
  });
}
