// pages/library/playlist/[id].js - 自創歌單，UI 跟歌單頁 playlist/[id] 一致
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from '@/components/Link';
import { db } from '../../../lib/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from '@/lib/firestore-tracked';
import { getTabsByIds } from '../../../lib/tabs';
import { Music, Heart, Plus, ListMusic, ArrowUpDown, Pencil, X, Search, User, Copy, ArrowLeft } from 'lucide-react';

const InstagramIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" />
  </svg>
);
import Layout from '../../../components/Layout';
import { getSongThumbnail } from '../../../lib/getSongThumbnail';
import { toggleLikeSong, checkIsLiked, getUserPlaylists, addSongToPlaylist, createPlaylist, removeSongFromPlaylist, deletePlaylist, updatePlaylist } from '../../../lib/playlistApi';
import { useAuth } from '../../../contexts/AuthContext';
import { useArtistMap } from '@/lib/useArtistMap';

function computeShuffleOrder(length) {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export default function UserPlaylistDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const { getArtistName } = useArtistMap();
  const [playlist, setPlaylist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState('default');
  const [shuffleOrder, setShuffleOrder] = useState([]);

  const [selectedSong, setSelectedSong] = useState(null);
  const [selectedSongLiked, setSelectedSongLiked] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionModalDragY, setActionModalDragY] = useState(0);
  const actionModalTouchStartY = useRef(0);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [addToPlaylistSelectedIds, setAddToPlaylistSelectedIds] = useState([]);
  const [addToPlaylistInitialIds, setAddToPlaylistInitialIds] = useState([]);
  const [showCreatePlaylistInput, setShowCreatePlaylistInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [playlistMenuDragY, setPlaylistMenuDragY] = useState(0);
  const playlistMenuTouchStartY = useRef(0);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [editDescriptionValue, setEditDescriptionValue] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);
  const [sortModalDragY, setSortModalDragY] = useState(0);
  const sortModalTouchStartY = useRef(0);
  const [showAddSongModal, setShowAddSongModal] = useState(false);
  const [addSongSearchQuery, setAddSongSearchQuery] = useState('');
  const [addSongCatalog, setAddSongCatalog] = useState([]);
  const addSongArtistMap = useRef(new Map());
  const [addSongLoading, setAddSongLoading] = useState(false);
  const [addingSongId, setAddingSongId] = useState(null);
  const [addSongDragY, setAddSongDragY] = useState(0);
  const addSongTouchStartY = useRef(0);
  const [showEditPlaylistModal, setShowEditPlaylistModal] = useState(false);
  const [editPlaylistDragY, setEditPlaylistDragY] = useState(0);
  const editPlaylistTouchStartY = useRef(0);
  const [touchDragIndex, setTouchDragIndex] = useState(null);
  const [touchDragY, setTouchDragY] = useState(0);
  const touchDragStartYRef = useRef(0);
  const touchDragYRef = useRef(0);
  const touchDragRowHeightRef = useRef(56);
  const touchDragRowTopRef = useRef(0);
  const editListScrollRef = useRef(null);
  const EDIT_ROW_HEIGHT = 56;
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    setIsTouchDevice(typeof window !== 'undefined' && 'ontouchstart' in window);
  }, []);

  useEffect(() => {
    if (id && user) {
      loadPlaylist(user.uid);
    }
  }, [id, user]);

  useEffect(() => {
    if (sortMode !== 'shuffle' || !songs.length) return;
    if (shuffleOrder.length !== songs.length) {
      setShuffleOrder(computeShuffleOrder(songs.length));
    }
  }, [sortMode, songs.length]);

  // 打開任何底部 Modal 時鎖住背景 scroll（含歌曲「更多」Action Modal）
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (showActionModal || showAddSongModal || showEditPlaylistModal || showSortModal || showPlaylistMenu) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showActionModal, showAddSongModal, showEditPlaylistModal, showSortModal, showPlaylistMenu]);


  // 打開「加入歌曲」Modal 時載入歌曲目錄
  useEffect(() => {
    if (!showAddSongModal) return;
    setAddSongLoading(true);
    fetch('/api/search-data')
      .then((r) => r.json())
      .then((data) => {
        const map = new Map();
        (data.artists || []).forEach(a => { if (a.id && a.name) map.set(a.id, a.name) });
        addSongArtistMap.current = map;
        setAddSongCatalog(data.tabs || data.hotTabs || []);
      })
      .catch(() => setAddSongCatalog([]))
      .finally(() => setAddSongLoading(false));
  }, [showAddSongModal]);

  const loadPlaylist = async (userId) => {
    setLoading(true);
    try {
      const playlistDoc = await getDoc(doc(db, 'userPlaylists', id));
      if (!playlistDoc.exists()) {
        setLoading(false);
        return;
      }
      const playlistData = { id: playlistDoc.id, ...playlistDoc.data() };
      if (playlistData.userId !== userId) {
        setLoading(false);
        return;
      }
      setPlaylist(playlistData);
      if (playlistData.songIds && playlistData.songIds.length > 0) {
        const songDetails = await getTabsByIds(playlistData.songIds);
        setSongs(songDetails);
      }
    } catch (error) {
      console.error('載入歌單失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSortedSongs = () => {
    const sorted = [...songs];
    switch (sortMode) {
      case 'artist':
        return sorted.sort((a, b) => (getArtistName(a) || '').toLowerCase().localeCompare((getArtistName(b) || '').toLowerCase(), 'zh-HK'));
      case 'year':
        return sorted.sort((a, b) => {
          const yearA = a.songYear || a.uploadYear || 0;
          const yearB = b.songYear || b.uploadYear || 0;
          if (yearA && yearB) return yearB - yearA;
          if (yearA) return -1;
          if (yearB) return 1;
          return 0;
        });
      case 'shuffle':
        if (shuffleOrder.length === sorted.length) {
          return shuffleOrder.map((i) => sorted[i]);
        }
        return sorted;
      case 'recent':
        return [...sorted].reverse();
      default:
        return sorted;
    }
  };

  const sortedSongs = getSortedSongs();

  const handleSongClick = (songId) => {
    router.push(`/tabs/${songId}`);
  };

  const currentSongIds = new Set(playlist?.songIds || songs.map((s) => s.id));
  const addSongFiltered = addSongCatalog
    .filter((tab) => {
      if (currentSongIds.has(tab.id)) return false;
      const q = addSongSearchQuery.trim().toLowerCase();
      if (!q) return true;
      const title = (tab.title || '').toLowerCase();
      const artistName = (tab.artist || addSongArtistMap.current.get(tab.artistId) || '').toLowerCase();
      return title.includes(q) || artistName.includes(q);
    })
    .sort((a, b) => (b.uploadYear || 0) - (a.uploadYear || 0))
    .slice(0, 20);

  const DRAG_CLOSE_THRESHOLD = 80;

  const getClientY = (e) => e.touches?.[0]?.clientY ?? e.clientY;

  const handleActionModalSheetDragStart = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable) e.preventDefault();
    actionModalTouchStartY.current = getClientY(e);
    try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const handleActionModalSheetDragMove = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable) e.preventDefault();
    const y = getClientY(e);
    const delta = y - actionModalTouchStartY.current;
    if (delta > 0) setActionModalDragY(Math.min(delta, 200));
  };
  const handleActionModalSheetDragEnd = () => {
    if (actionModalDragY >= DRAG_CLOSE_THRESHOLD) {
      setShowActionModal(false);
      setActionModalDragY(0);
    } else {
      setActionModalDragY(0);
    }
  };

  const handleAddSongSheetDragStart = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    addSongTouchStartY.current = getClientY(e);
    try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (_) {}
  };

  const handleAddSongSheetDragMove = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    const y = getClientY(e);
    const delta = y - addSongTouchStartY.current;
    if (delta > 0) setAddSongDragY(Math.min(delta, 200));
  };

  const handleAddSongSheetDragEnd = () => {
    if (addSongDragY >= DRAG_CLOSE_THRESHOLD) {
      setShowAddSongModal(false);
      setAddSongSearchQuery('');
      setAddSongDragY(0);
    } else {
      setAddSongDragY(0);
    }
  };

  const handleEditPlaylistSheetDragStart = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    editPlaylistTouchStartY.current = getClientY(e);
    try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const handleEditPlaylistSheetDragMove = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    const y = getClientY(e);
    const delta = y - editPlaylistTouchStartY.current;
    if (delta > 0) setEditPlaylistDragY(Math.min(delta, 200));
  };
  const handleEditPlaylistSheetDragEnd = () => {
    if (editPlaylistDragY >= DRAG_CLOSE_THRESHOLD) {
      setShowEditPlaylistModal(false);
      setEditPlaylistDragY(0);
    } else {
      setEditPlaylistDragY(0);
    }
  };

  const handleSortModalSheetDragStart = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    sortModalTouchStartY.current = getClientY(e);
    try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const handleSortModalSheetDragMove = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    const y = getClientY(e);
    const delta = y - sortModalTouchStartY.current;
    if (delta > 0) setSortModalDragY(Math.min(delta, 200));
  };
  const handleSortModalSheetDragEnd = () => {
    if (sortModalDragY >= DRAG_CLOSE_THRESHOLD) {
      setShowSortModal(false);
      setSortModalDragY(0);
    } else {
      setSortModalDragY(0);
    }
  };

  const orderedSongsForEdit = (playlist?.songIds || []).map((sid) => songs.find((s) => s.id === sid)).filter(Boolean);

  const handleRemoveFromPlaylist = async (songId) => {
    try {
      await removeSongFromPlaylist(id, songId);
      setSongs((prev) => prev.filter((s) => s.id !== songId));
      setPlaylist((p) => (p ? { ...p, songIds: (p.songIds || []).filter((sid) => sid !== songId) } : p));
    } catch (e) {
      console.error(e);
      alert('移除失敗，請重試');
    }
  };

  const handleEditPlaylistReorder = async (fromIndex, toIndex) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= orderedSongsForEdit.length) return;
    const reordered = [...orderedSongsForEdit];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);
    const newSongIds = reordered.map((s) => s.id);
    try {
      await updateDoc(doc(db, 'userPlaylists', id), { songIds: newSongIds, updatedAt: serverTimestamp() });
      setPlaylist((p) => (p ? { ...p, songIds: newSongIds } : p));
      setSongs(reordered);
    } catch (e) {
      console.error(e);
      alert('更新次序失敗，請重試');
    }
  };

  const handleEditHandleTouchStart = (e, index) => {
    const clientY = e.touches[0].clientY;
    touchDragStartYRef.current = clientY;
    const row = e.currentTarget.closest('li');
    if (row) {
      const rect = row.getBoundingClientRect();
      touchDragRowHeightRef.current = rect.height;
      touchDragRowTopRef.current = rect.top;
    }
    setTouchDragIndex(index);
    setTouchDragY(clientY);
  };

  useEffect(() => {
    if (touchDragIndex === null) return;
    const onMove = (e) => {
      const clientY = e.touches?.[0]?.clientY;
      if (clientY == null) return;
      if (Math.abs(clientY - touchDragStartYRef.current) > 8) e.preventDefault();
      touchDragYRef.current = clientY;
      setTouchDragY(clientY);
    };
    const onEnd = () => {
      const el = editListScrollRef.current;
      const list = orderedSongsForEdit;
      const currentY = touchDragYRef.current;
      if (el && list.length > 0) {
        const rect = el.getBoundingClientRect();
        const rowH = touchDragRowHeightRef.current || EDIT_ROW_HEIGHT;
        const relativeY = currentY - rect.top + el.scrollTop;
        const dropIndex = Math.max(0, Math.min(list.length - 1, Math.floor(relativeY / rowH)));
        if (dropIndex !== touchDragIndex) handleEditPlaylistReorder(touchDragIndex, dropIndex);
      }
      setTouchDragIndex(null);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { once: true });
    document.addEventListener('touchcancel', onEnd, { once: true });
    return () => {
      document.removeEventListener('touchmove', onMove);
    };
  }, [touchDragIndex]);

  const handleAddSongToPlaylist = async (songId) => {
    setAddingSongId(songId);
    try {
      await addSongToPlaylist(id, songId);
      const [added] = await getTabsByIds([songId]);
      if (added) {
        setSongs((prev) => [...prev, added]);
      }
      setPlaylist((p) => p ? { ...p, songIds: [...(p.songIds || []), songId] } : p);
    } catch (e) {
      console.error(e);
      alert('加入失敗，請重試');
    } finally {
      setAddingSongId(null);
    }
  };

  const handleMoreClick = async (e, song) => {
    e.stopPropagation();
    setSelectedSong(song);
    if (user) {
      const [liked, list] = await Promise.all([
        checkIsLiked(user.uid, song.id),
        getUserPlaylists(user.uid)
      ]);
      setSelectedSongLiked(liked);
      setUserPlaylists(list);
    } else {
      setSelectedSongLiked(false);
    }
    setShowActionModal(true);
  };

  const handleCopyShareLink = async () => {
    if (!selectedSong) return;
    const url = `${window.location.origin}/tabs/${selectedSong.id}`;
    try {
      await navigator.clipboard.writeText(url);
      alert('已複製連結');
    } catch (err) {
      alert('複製失敗');
    }
  };

  const handleSelectLyricsShare = () => {
    if (!selectedSong?.id) return;
    setShowActionModal(false);
    router.push(`/tools/tab-share?tabId=${selectedSong.id}`);
  };

  const handleShare = async () => {
    if (!selectedSong) return;
    const url = `${window.location.origin}/tabs/${selectedSong.id}`;
    if (navigator.share) {
      await navigator.share({
        title: `${selectedSong.title} - ${getArtistName(selectedSong)}`,
        url
      });
    } else {
      await navigator.clipboard.writeText(url);
      alert('已複製連結到剪貼簿');
    }
    setShowActionModal(false);
  };

  const handleAddToLiked = async () => {
    if (!selectedSong || !user) {
      alert('請先登入後即可收藏喜愛的結他譜');
      return;
    }
    try {
      const result = await toggleLikeSong(user.uid, selectedSong.id);
      setSelectedSongLiked(result.isLiked);
    } catch (error) {
      alert('操作失敗：' + error.message);
    }
  };

  const handleAddToPlaylistClick = () => {
    setShowActionModal(false);
    // 預設剔選已包含此歌嘅歌單（排除當前歌單）
    const alreadyIn = (userPlaylists || [])
      .filter((pl) => pl.id !== id && pl.songIds && pl.songIds.includes(selectedSong?.id))
      .map((pl) => pl.id);
    setAddToPlaylistSelectedIds(alreadyIn);
    setAddToPlaylistInitialIds(alreadyIn);
    setShowAddToPlaylist(true);
  };

  const toggleAddToPlaylistSelection = (playlistId) => {
    setAddToPlaylistSelectedIds((prev) =>
      prev.includes(playlistId) ? prev.filter((pid) => pid !== playlistId) : [...prev, playlistId]
    );
  };

  const confirmAddToPlaylist = async () => {
    if (!selectedSong) return;
    const idsToAdd = addToPlaylistSelectedIds.filter((id) => !addToPlaylistInitialIds.includes(id));
    const idsToRemove = addToPlaylistInitialIds.filter((id) => !addToPlaylistSelectedIds.includes(id));
    if (idsToAdd.length === 0 && idsToRemove.length === 0) {
      setShowAddToPlaylist(false);
      setAddToPlaylistSelectedIds([]);
      setAddToPlaylistInitialIds([]);
      return;
    }
    try {
      for (const playlistId of idsToAdd) {
        await addSongToPlaylist(playlistId, selectedSong.id);
      }
      for (const playlistId of idsToRemove) {
        await removeSongFromPlaylist(playlistId, selectedSong.id);
      }
      setShowAddToPlaylist(false);
      setAddToPlaylistSelectedIds([]);
      setAddToPlaylistInitialIds([]);
      if (idsToAdd.length && idsToRemove.length) {
        alert(`已加入 ${idsToAdd.length} 個歌單，已從 ${idsToRemove.length} 個歌單移除`);
      } else if (idsToRemove.length) {
        alert(idsToRemove.length > 1 ? `已從 ${idsToRemove.length} 個歌單移除` : '已從歌單移除');
      } else {
        alert(idsToAdd.length > 1 ? `已加入 ${idsToAdd.length} 個歌單` : '已加入歌單');
      }
    } catch (error) {
      alert('操作失敗：' + (error.message || '請重試'));
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !user || !selectedSong) return;
    try {
      const result = await createPlaylist(user.uid, newPlaylistName.trim());
      await addSongToPlaylist(result.playlistId, selectedSong.id);
      setShowCreatePlaylistInput(false);
      setShowAddToPlaylist(false);
      setNewPlaylistName('');
    } catch (error) {
      alert('創建失敗：' + (error.message || '請重試'));
    }
  };

  const handlePlaylistMenuSheetDragStart = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable) e.preventDefault();
    playlistMenuTouchStartY.current = getClientY(e);
    try { if (e.target?.setPointerCapture && e.pointerId != null) e.target.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const handlePlaylistMenuSheetDragMove = (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.cancelable) e.preventDefault();
    const y = getClientY(e);
    const delta = y - playlistMenuTouchStartY.current;
    if (delta > 0) setPlaylistMenuDragY(Math.min(delta, 200));
  };
  const handlePlaylistMenuSheetDragEnd = () => {
    if (playlistMenuDragY >= DRAG_CLOSE_THRESHOLD) {
      setShowPlaylistMenu(false);
      setPlaylistMenuDragY(0);
    } else {
      setPlaylistMenuDragY(0);
    }
  };

  const savePlaylistMeta = async () => {
    const titleTrimmed = editTitleValue.trim();
    if (!titleTrimmed) {
      alert('歌單名稱不可為空');
      return;
    }
    setIsSavingTitle(true);
    try {
      await updatePlaylist(id, {
        title: titleTrimmed,
        description: (editDescriptionValue || '').trim()
      });
      setPlaylist({ ...playlist, title: titleTrimmed, description: (editDescriptionValue || '').trim() });
      setShowPlaylistMenu(false);
      setPlaylistMenuDragY(0);
    } catch (error) {
      console.error('更新歌單失敗:', error);
      alert('更新失敗，請重試');
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!confirm('確定要刪除此歌單？刪除後無法還原。')) return;
    try {
      await deletePlaylist(id, user.uid);
      router.push('/library');
    } catch (error) {
      console.error('刪除歌單失敗:', error);
      alert('刪除失敗，請重試');
    }
  };

  if (loading) {
    return (
      <Layout fullWidth hideHeader>
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full" />
        </div>
      </Layout>
    );
  }

  if (!playlist) {
    return (
      <Layout fullWidth hideHeader>
        <div className="min-h-screen bg-black flex items-center justify-center px-4">
          <div className="text-center">
            <p className="text-neutral-400 mb-4">歌單不存在或你無權限查看</p>
            <Link
              href="/library"
              className="inline-flex items-center px-6 py-3 bg-[#FFD700] text-black rounded-full font-medium hover:opacity-90 transition"
            >
              返回收藏
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  const coverSongs = songs.slice(0, 4);

  return (
    <Layout fullWidth hideHeader>
      <Head>
        <meta name="theme-color" content="transparent" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <div className="relative z-10 min-h-screen pb-24 bg-black" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* 返回 + 封面（自製歌單：頭四首歌 2x2 生成） */}
        <div className="relative pt-4 pb-4" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <Link
            href="/library"
            className="absolute top-4 z-10 inline-flex items-center text-white hover:text-white/90 transition p-1.5 -ml-1.5"
            style={{ left: '1rem' }}
            aria-label="返回"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex justify-center">
            <div className="w-[60vw] max-w-[300px] max-h-[300px] aspect-square overflow-hidden rounded bg-[#282828] shadow-xl grid grid-cols-2 grid-rows-2">
              {coverSongs.length === 0 ? (
                <div className="col-span-2 row-span-2 w-full h-full flex items-center justify-center bg-[#282828]">
                  <Music className="w-24 h-24 text-[#3E3E3E]" />
                </div>
              ) : (
                Array.from({ length: 4 }, (_, i) => {
                  const song = coverSongs[i];
                  if (!song) {
                    return <div key={`empty-${i}`} className="w-full h-full min-h-0 bg-[#282828]" aria-hidden />;
                  }
                  const thumb = getSongThumbnail(song);
                  return (
                    <div key={song.id} className="relative w-full h-full min-h-0 bg-[#282828]">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="w-full h-full object-cover"
                          loading={i < 2 ? 'eager' : 'lazy'}
                          decoding="async"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-[#282828] text-[#3E3E3E]"><Music className="w-6 h-6" strokeWidth={1.5} /></div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 標題行：歌單名（一行 + truncate）+ 右邊兩行右對齊 */}
        <div className="pb-1" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-bold text-white truncate flex-1 min-w-0" style={{ fontSize: '1.5rem' }}>
              {playlist.title}
            </h1>
            <div className="text-right flex-shrink-0 text-[12px] md:text-[14px] text-neutral-500">
              <div>共 {songs.length} 首</div>
              {user?.displayName && <div>By {user.displayName}</div>}
            </div>
          </div>
        </div>

        {/* 簡介 - 與網站歌單頁同 style：0.85rem #999 */}
        {playlist.description && (
          <div className="pb-0" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <p className="text-[0.85rem] text-[#999] leading-snug line-clamp-4 whitespace-pre-line">{playlist.description}</p>
          </div>
        )}

        {/* 操作按鈕列：加入、編輯、排序、名稱 */}
        <div className="py-2 flex flex-wrap items-center gap-2" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <button
            type="button"
            onClick={() => setShowAddSongModal(true)}
            className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition"
          >
            <Plus className="w-4 h-4 shrink-0" />
            加入
          </button>
          <button
            type="button"
            onClick={() => setShowEditPlaylistModal(true)}
            className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition"
          >
            <ListMusic className="w-4 h-4 shrink-0" />
            編輯
          </button>
          <button
            type="button"
            onClick={() => setShowSortModal(true)}
            className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition"
          >
            <ArrowUpDown className="w-4 h-4 shrink-0" />
            排序
          </button>
          <button
            type="button"
            onClick={() => {
              setEditTitleValue(playlist.title || '');
              setEditDescriptionValue(playlist.description || '');
              setShowPlaylistMenu(true);
            }}
            className="flex items-center justify-center gap-1 w-[85px] px-3 py-1.5 rounded-full bg-[#282828] text-white text-sm font-medium hover:bg-[#3E3E3E] transition"
          >
            <Pencil className="w-4 h-4 shrink-0" />
            歌單
          </button>
        </div>

        {/* Songs List（同歌單頁） */}
        {songs.length > 0 ? (
          <div style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            {sortedSongs.map((song) => (
              <div key={song.id} className="group">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSongClick(song.id)}
                  className="w-full flex items-center gap-3 py-2 pl-0 pr-0 rounded-[7px] md:hover:bg-white/5 md:transition cursor-pointer"
                >
                  <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
                    {getSongThumbnail(song) ? (
                      <img
                        src={getSongThumbnail(song)}
                        alt={song.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></span>
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <h3 className="text-[1rem] font-medium text-[#e6e6e6] truncate md:group-hover:text-[#FFD700] md:transition">
                      {song.title}
                    </h3>
                    <p className="text-[0.85rem] text-[#999] truncate">{getArtistName(song)}</p>
                  </div>
                  <button
                    onClick={(e) => handleMoreClick(e, song)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 text-[#999] hover:text-white transition -my-1"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 14.96 2.54" fill="currentColor" aria-hidden>
                      <circle cx="1.27" cy="1.27" r="1.27" />
                      <circle cx="7.48" cy="1.27" r="1.27" />
                      <circle cx="13.69" cy="1.27" r="1.27" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <p className="text-neutral-500">暫無歌曲</p>
          </div>
        )}

        {/* Action Modal：高度跟內容、唔左右滑；Portal + touch-action:none 防背景一齊滾 */}
        {showActionModal && typeof document !== 'undefined' && createPortal(
          <div className="fixed inset-0 z-[9999] overflow-x-hidden" style={{ touchAction: 'none' }}>
            <div
              className="fixed inset-0 bg-black/60"
              onClick={() => { setShowActionModal(false); setActionModalDragY(0); }}
              aria-hidden
            />
            <div
              className="fixed bottom-0 left-0 right-0 w-full bg-[#121212] rounded-t-3xl flex flex-col overflow-x-hidden overflow-y-auto max-h-[90vh]"
              style={{
                paddingBottom: 'env(safe-area-inset-bottom, 0)',
                transform: `translateY(${actionModalDragY}px)`,
                transition: actionModalDragY === 0 ? 'transform 0.2s ease-out' : 'none'
              }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={handleActionModalSheetDragStart}
                onTouchMove={handleActionModalSheetDragMove}
                onTouchEnd={handleActionModalSheetDragEnd}
                onTouchCancel={handleActionModalSheetDragEnd}
                onPointerDown={handleActionModalSheetDragStart}
                onPointerMove={handleActionModalSheetDragMove}
                onPointerUp={handleActionModalSheetDragEnd}
                onPointerCancel={handleActionModalSheetDragEnd}
                role="button"
                tabIndex={0}
                aria-label="向下拖曳關閉"
                onKeyDown={(e) => e.key === 'Enter' && (setShowActionModal(false), setActionModalDragY(0))}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
              </div>
              <div className="pb-24 px-4 pt-0 text-left overflow-x-hidden min-w-0">
                {selectedSong && (
                  <div className="mb-4 pb-4 border-b border-[#3E3E3E] flex items-center gap-3">
                    <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
                      {getSongThumbnail(selectedSong) ? (
                        <img
                          src={getSongThumbnail(selectedSong)}
                          alt={selectedSong.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium truncate">{selectedSong.title}</p>
                      <p className="text-neutral-400 text-sm truncate">{getArtistName(selectedSong)}</p>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <button onClick={handleCopyShareLink} className="w-full flex items-center space-x-4 py-3 pl-0 pr-4 hover:bg-[#1a1a1a] rounded-lg text-left">
                    <Copy className="w-5 h-5 text-[#B3B3B3]" />
                    <span className="text-white">複製分享連結</span>
                  </button>
                  <button onClick={handleSelectLyricsShare} className="w-full flex items-center space-x-4 py-3 pl-0 pr-4 hover:bg-[#1a1a1a] rounded-lg text-left">
                    <InstagramIcon className="w-5 h-5 text-[#B3B3B3] shrink-0" />
                    <span className="text-white">選取歌詞分享</span>
                  </button>
                  <button onClick={handleAddToLiked} className="w-full flex items-center space-x-4 py-3 pl-0 pr-4 hover:bg-[#1a1a1a] rounded-lg text-left">
                    <Heart className={`w-5 h-5 text-[#FFD700] ${selectedSongLiked ? 'fill-[#FFD700]' : 'fill-none'}`} strokeWidth={1.5} />
                    <span className="text-white">{selectedSongLiked ? '取消喜愛' : '加入喜愛結他譜'}</span>
                  </button>
                  <button onClick={handleAddToPlaylistClick} className="w-full flex items-center space-x-4 py-3 pl-0 pr-4 hover:bg-[#1a1a1a] rounded-lg text-left">
                    <svg className="w-5 h-5 text-[#B3B3B3] shrink-0" viewBox="0 0 8.7 8.7" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" strokeMiterlimit={10} aria-hidden>
                      <circle cx="4.4" cy="4.4" r="4" />
                      <line x1="2.2" y1="4.4" x2="6.5" y2="4.4" />
                      <line x1="4.4" y1="2.2" x2="4.4" y2="6.5" />
                    </svg>
                    <span className="text-white">加入歌單</span>
                  </button>
                  {selectedSong && (selectedSong.artistId || selectedSong.artist_id || selectedSong.artistSlug) && (
                    <Link
                      href={`/artists/${selectedSong.artistId || selectedSong.artist_id || selectedSong.artistSlug}`}
                      onClick={() => setShowActionModal(false)}
                      className="w-full flex items-center space-x-4 py-3 pl-0 pr-4 hover:bg-[#1a1a1a] rounded-lg block text-left"
                    >
                      <User className="w-5 h-5 text-[#B3B3B3]" />
                      <span className="text-white">瀏覽歌手</span>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* 加入歌單 Modal */}
        {showAddToPlaylist && (
          <>
            <div
              className="fixed inset-0 bg-black/60 z-50"
              onClick={() => {
                setShowAddToPlaylist(false);
                setShowCreatePlaylistInput(false);
                setNewPlaylistName('');
                setAddToPlaylistSelectedIds([]);
                setAddToPlaylistInitialIds([]);
              }}
            />
            <div className="fixed bottom-0 left-0 right-0 bg-[#121212] rounded-t-3xl z-[60] pb-24 max-h-[70vh] overflow-y-auto">
              <div className="flex flex-col items-center justify-center py-2 min-h-[36px]">
                <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
              </div>
              <div className="text-left" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
              <h3 className="text-white text-lg font-bold mb-4">加入歌單</h3>
              <div className="space-y-2">
                {userPlaylists.filter((pl) => pl.id !== id).map((pl) => {
                  const isSelected = addToPlaylistSelectedIds.includes(pl.id);
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => toggleAddToPlaylistSelection(pl.id)}
                      className="w-full flex items-center gap-3 pl-0 pr-3 py-1.5 hover:bg-[#1a1a1a] rounded-2xl text-left"
                    >
                      <div className="w-12 h-12 rounded-[4px] bg-[#282828] flex items-center justify-center flex-shrink-0">
                        <Music className="w-6 h-6 text-[#3E3E3E]" />
                      </div>
                      <span className="text-white font-medium flex-1 min-w-0 truncate">{pl.title}</span>
                      <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center border-2 ${isSelected ? 'bg-[#FFD700] border-[#FFD700]' : 'border-[#525252]'}`}>
                        {isSelected && (
                          <svg className="w-3.5 h-3.5 text-black" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* 分隔線（space-y-2 統一 0.5rem） */}
                <div className="h-px bg-[#3E3E3E] w-full shrink-0" />
                <button
                  type="button"
                  onClick={() => setShowCreatePlaylistInput(true)}
                  className="w-full flex items-center space-x-3 pl-0 pr-3 py-1.5 hover:bg-[#1a1a1a] rounded-2xl text-left"
                >
                  <div className="w-12 h-12 rounded-[4px] bg-[#121212] border-2 border-dashed border-[#FFD700] flex items-center justify-center flex-shrink-0">
                    <Plus className="w-6 h-6 text-[#FFD700]" />
                  </div>
                  <span className="text-[#FFD700] font-medium">創建新歌單</span>
                </button>

                <button
                  type="button"
                  onClick={confirmAddToPlaylist}
                  disabled={!addToPlaylistSelectedIds.some((id) => !addToPlaylistInitialIds.includes(id)) && !addToPlaylistInitialIds.some((id) => !addToPlaylistSelectedIds.includes(id))}
                  className={`w-full py-3 rounded-full font-medium transition ${addToPlaylistSelectedIds.some((id) => !addToPlaylistInitialIds.includes(id)) || addToPlaylistInitialIds.some((id) => !addToPlaylistSelectedIds.includes(id)) ? 'bg-[#FFD700] text-black hover:bg-yellow-400' : 'bg-[#3E3E3E] text-[#737373] cursor-not-allowed'}`}
                >
                  確認
                </button>

                {showCreatePlaylistInput && (
                  <div className="mt-3 p-3 bg-[#1a1a1a] rounded-lg text-left">
                    <input
                      type="text"
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      placeholder="輸入歌單名稱"
                      className="w-full bg-[#282828] text-white px-3 py-2 rounded-lg mb-2 outline-none"
                      autoFocus
                    />
                    <div className="flex space-x-2">
                      <button
                        onClick={handleCreatePlaylist}
                        disabled={!newPlaylistName.trim()}
                        className="flex-1 bg-[#FFD700] text-black py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        創建並加入
                      </button>
                      <button
                        onClick={() => {
                          setShowCreatePlaylistInput(false);
                          setNewPlaylistName('');
                        }}
                        className="flex-1 bg-[#282828] text-white py-2 rounded-lg"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
              </div>
            </div>
          </>
        )}

        {/* 加入歌單 - 底部彈出 Menu（Portal 到 body，確保蓋住底部黃 bar） */}
        {showAddSongModal && typeof document !== 'undefined' && createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/60 z-[9999]"
              onClick={() => {
                setShowAddSongModal(false);
                setAddSongSearchQuery('');
              }}
              aria-hidden
            />
            <div
              className="fixed bottom-0 left-0 right-0 h-[65vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{
                paddingBottom: 'env(safe-area-inset-bottom, 0)',
                transform: `translateY(${addSongDragY}px)`,
                transition: addSongDragY === 0 ? 'transform 0.2s ease-out' : 'none',
                maxWidth: '1050px',
                margin: '0 auto'
              }}
            >
              {/* Handle + 標題列：成塊都可以向下拖曳關閉，搜尋 bar 對上嘅面積都觸發到 */}
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={handleAddSongSheetDragStart}
                onTouchMove={handleAddSongSheetDragMove}
                onTouchEnd={handleAddSongSheetDragEnd}
                onTouchCancel={handleAddSongSheetDragEnd}
                onPointerDown={handleAddSongSheetDragStart}
                onPointerMove={handleAddSongSheetDragMove}
                onPointerUp={handleAddSongSheetDragEnd}
                onPointerCancel={handleAddSongSheetDragEnd}
                role="button"
                tabIndex={0}
                aria-label="向下拖曳關閉"
                onKeyDown={(e) => e.key === 'Enter' && (setShowAddSongModal(false), setAddSongSearchQuery(''), setAddSongDragY(0))}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAddSongModal(false);
                      setAddSongSearchQuery('');
                    }}
                    className="p-2 -ml-2 text-[#B3B3B3] md:hover:text-white rounded-lg"
                    aria-label="關閉"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <h2 className="text-white font-bold text-lg truncate flex-1 text-center pointer-events-none">
                    加入歌單
                  </h2>
                  <div className="w-10" />
                </div>
              </div>
              <div className="px-4 pb-3 flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#666]" />
                  <input
                    type="text"
                    placeholder="搜尋歌曲"
                    value={addSongSearchQuery}
                    onChange={(e) => setAddSongSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-[#282828] text-white placeholder-[#666] rounded-full outline-none"
                  />
                </div>
              </div>
              <div
                className="overflow-y-auto flex-1 min-h-0 pb-4 overscroll-contain bg-[#121212] touch-pan-y px-4"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {addSongLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : addSongFiltered.length === 0 ? (
                  <div className="text-center py-12 text-[#B3B3B3] text-sm">
                    {addSongSearchQuery.trim() ? '搵唔到符合嘅歌曲' : '載入中…'}
                  </div>
                ) : (
                  <ul className="space-y-0">
                    {addSongFiltered.map((tab) => {
                      const isAdding = addingSongId === tab.id;
                      return (
                        <li key={tab.id}>
                          <button
                            type="button"
                            onClick={() => handleAddSongToPlaylist(tab.id)}
                            disabled={isAdding}
                            className="w-full flex items-center gap-2 py-1.5 px-2 rounded-2xl md:hover:bg-white/5 text-left disabled:opacity-70"
                          >
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <p className="text-white font-medium truncate leading-tight" style={{ fontSize: 15, lineHeight: '20px' }}>{tab.title}</p>
                              <p className="text-neutral-500 truncate leading-tight" style={{ fontSize: 13, lineHeight: '16px' }}>{tab.artist || addSongArtistMap.current.get(tab.artistId) || tab.artistId}</p>
                            </div>
                            <span className="w-10 h-10 flex items-center justify-center flex-shrink-0 text-[#FFD700] pointer-events-none">
                              {isAdding ? (
                                <div className="w-5 h-5 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 8.73 8.73" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeMiterlimit="10">
                                  <circle cx="4.36" cy="4.36" r="3.99" />
                                  <line x1="2.22" y1="4.36" x2="6.51" y2="4.36" />
                                  <line x1="4.36" y1="2.22" x2="4.36" y2="6.51" />
                                </svg>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body
        )}

        {/* 編輯歌單 - 底部彈出 Menu（同「加入歌曲」style）：排序 + 刪減 */}
        {showEditPlaylistModal && typeof document !== 'undefined' && createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/60 z-[9999]"
              onClick={() => { setShowEditPlaylistModal(false); setEditPlaylistDragY(0); }}
              aria-hidden
            />
            <div
              className="fixed bottom-0 h-[65vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{
                paddingBottom: 'env(safe-area-inset-bottom, 0)',
                left: '50%',
                width: '100%',
                maxWidth: '1050px',
                transform: `translateX(-50%) translateY(${editPlaylistDragY}px)`,
                transition: editPlaylistDragY === 0 ? 'transform 0.2s ease-out' : 'none'
              }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={handleEditPlaylistSheetDragStart}
                onTouchMove={handleEditPlaylistSheetDragMove}
                onTouchEnd={handleEditPlaylistSheetDragEnd}
                onTouchCancel={handleEditPlaylistSheetDragEnd}
                onPointerDown={handleEditPlaylistSheetDragStart}
                onPointerMove={handleEditPlaylistSheetDragMove}
                onPointerUp={handleEditPlaylistSheetDragEnd}
                onPointerCancel={handleEditPlaylistSheetDragEnd}
                role="button"
                tabIndex={0}
                aria-label="向下拖曳關閉"
                onKeyDown={(e) => e.key === 'Enter' && (setShowEditPlaylistModal(false), setEditPlaylistDragY(0))}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowEditPlaylistModal(false); setEditPlaylistDragY(0); }}
                    className="p-2 -ml-2 text-[#B3B3B3] md:hover:text-white rounded-lg"
                    aria-label="關閉"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <h2 className="text-white font-bold text-lg truncate flex-1 text-center pointer-events-none">
                    編輯歌單
                  </h2>
                  <div className="w-10" />
                </div>
              </div>
              <div
                ref={editListScrollRef}
                className="overflow-y-auto flex-1 min-h-0 pb-4 overscroll-contain bg-[#121212] touch-pan-y px-4 select-none"
                style={{ WebkitOverflowScrolling: 'touch', WebkitTouchCallout: 'none' }}
              >
                {orderedSongsForEdit.length === 0 ? (
                  <div className="text-center py-12 text-[#B3B3B3] text-sm">歌單入面未有歌曲</div>
                ) : (
                  <ul className="space-y-0">
                    {orderedSongsForEdit.map((song, index) => {
                      const thumb = getSongThumbnail(song);
                      const isDragging = touchDragIndex === index;
                      return (
                        <li
                          key={song.id}
                          className={`flex items-center gap-2 py-1.5 rounded-2xl md:hover:bg-white/5 transition-opacity ${isDragging ? 'opacity-0' : ''}`}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={(e) => {
                            e.preventDefault();
                            try {
                              const { index: fromIndex } = JSON.parse(e.dataTransfer.getData('application/json') || '{}');
                              if (typeof fromIndex === 'number') handleEditPlaylistReorder(fromIndex, index);
                            } catch (_) {}
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRemoveFromPlaylist(song.id); }}
                            className="w-10 h-10 flex items-center justify-center flex-shrink-0 rounded-lg md:hover:opacity-90 transition -ml-1"
                            aria-label="從歌單移除"
                          >
                            <svg className="w-5 h-5" viewBox="0 0 9.5 9.5" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#9B2D2D" strokeLinecap="round" strokeMiterlimit={10} strokeWidth={0.8}>
                              <circle cx="4.8" cy="4.8" r="4" />
                              <line x1="2.6" y1="4.8" x2="6.9" y2="4.8" />
                            </svg>
                          </button>
                          <div className="w-10 h-10 rounded-lg bg-[#282828] flex-shrink-0 overflow-hidden">
                            {thumb ? (
                              <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-5 h-5" strokeWidth={1.5} /></div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <p className="text-white font-medium truncate leading-tight" style={{ fontSize: 15, lineHeight: '20px' }}>{song.title}</p>
                            <p className="text-neutral-500 truncate leading-tight" style={{ fontSize: 13, lineHeight: '16px' }}>{getArtistName(song)}</p>
                          </div>
                          <span
                            className="cursor-grab active:cursor-grabbing p-1.5 -mr-1.5 text-[#666] md:hover:text-[#B3B3B3] flex-shrink-0 select-none touch-none"
                            style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
                            draggable={!isTouchDevice}
                            onTouchStart={(e) => handleEditHandleTouchStart(e, index)}
                            onContextMenu={(e) => e.preventDefault()}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/json', JSON.stringify({ index }));
                              e.dataTransfer.effectAllowed = 'move';
                              const row = e.currentTarget.closest('li');
                              if (row && e.dataTransfer.setDragImage) {
                                const clone = row.cloneNode(true);
                                clone.style.cssText = `position:absolute;left:-9999px;width:${row.offsetWidth}px;opacity:0.95;background:#282828;border-radius:8px;pointer-events:none;`;
                                document.body.appendChild(clone);
                                e.dataTransfer.setDragImage(clone, row.offsetWidth / 2, row.offsetHeight / 2);
                                const el = e.currentTarget;
                                const onDragEnd = () => {
                                  if (document.body.contains(clone)) document.body.removeChild(clone);
                                  el.removeEventListener('dragend', onDragEnd);
                                };
                                el.addEventListener('dragend', onDragEnd);
                              }
                            }}
                            aria-label="拖曳改次序"
                          >
                            <svg className="w-5 h-5 shrink-0" viewBox="0 0 5.1 3.5" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#4d4d4d" strokeLinecap="round" strokeMiterlimit={10} strokeWidth={0.5}>
                              <line x1="0.4" y1="0.5" x2="4.7" y2="0.5" />
                              <line x1="0.4" y1="1.7" x2="4.7" y2="1.7" />
                              <line x1="0.4" y1="3" x2="4.7" y2="3" />
                            </svg>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </>,
          document.body
        )}

        {/* 排序 - 底部彈出 Menu（同編輯歌單 style） */}
        {showSortModal && typeof document !== 'undefined' && createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/60 z-[9999]"
              onClick={() => { setShowSortModal(false); setSortModalDragY(0); }}
              aria-hidden
            />
            <div
              className="fixed bottom-0 left-0 right-0 h-[65vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{
                paddingBottom: 'env(safe-area-inset-bottom, 0)',
                transform: `translateY(${sortModalDragY}px)`,
                transition: sortModalDragY === 0 ? 'transform 0.2s ease-out' : 'none',
                maxWidth: '1050px',
                margin: '0 auto'
              }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={handleSortModalSheetDragStart}
                onTouchMove={handleSortModalSheetDragMove}
                onTouchEnd={handleSortModalSheetDragEnd}
                onTouchCancel={handleSortModalSheetDragEnd}
                onPointerDown={handleSortModalSheetDragStart}
                onPointerMove={handleSortModalSheetDragMove}
                onPointerUp={handleSortModalSheetDragEnd}
                onPointerCancel={handleSortModalSheetDragEnd}
                role="button"
                tabIndex={0}
                aria-label="向下拖曳關閉"
                onKeyDown={(e) => e.key === 'Enter' && (setShowSortModal(false), setSortModalDragY(0))}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowSortModal(false); setSortModalDragY(0); }}
                    className="p-2 -ml-2 text-[#B3B3B3] md:hover:text-white rounded-lg"
                    aria-label="關閉"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <h2 className="text-white font-bold text-lg truncate flex-1 text-center pointer-events-none">
                    排序
                  </h2>
                  <div className="w-10" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 pb-4 px-4">
                {[
                  { key: 'default', label: '自訂次序' },
                  { key: 'artist', label: '歌手' },
                  { key: 'year', label: '年份' },
                  { key: 'recent', label: '最近加入' }
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSortMode(key);
                      setShowSortModal(false);
                      setSortModalDragY(0);
                    }}
                    className={`w-full flex items-center justify-between py-3.5 rounded-2xl text-left px-3 md:hover:bg-white/5 transition ${sortMode === key ? 'text-[#FFD700]' : 'text-white'}`}
                  >
                    <span className="font-normal">{label}</span>
                    {sortMode === key && <span className="text-[#FFD700] text-sm">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body
        )}

        {/* 歌單 - 底部彈出 Menu：編輯名稱、編輯簡介、刪除歌單 */}
        {showPlaylistMenu && typeof document !== 'undefined' && createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/60 z-[9999]"
              onClick={() => { setShowPlaylistMenu(false); setPlaylistMenuDragY(0); }}
              aria-hidden
            />
            <div
              className="fixed bottom-0 left-0 right-0 h-[65vh] bg-[#121212] rounded-t-3xl z-[9999] flex flex-col overflow-hidden"
              style={{
                paddingBottom: 'env(safe-area-inset-bottom, 0)',
                transform: `translateY(${playlistMenuDragY}px)`,
                transition: playlistMenuDragY === 0 ? 'transform 0.2s ease-out' : 'none',
                maxWidth: '1050px',
                margin: '0 auto'
              }}
            >
              <div
                className="flex flex-col flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                onTouchStart={handlePlaylistMenuSheetDragStart}
                onTouchMove={handlePlaylistMenuSheetDragMove}
                onTouchEnd={handlePlaylistMenuSheetDragEnd}
                onTouchCancel={handlePlaylistMenuSheetDragEnd}
                onPointerDown={handlePlaylistMenuSheetDragStart}
                onPointerMove={handlePlaylistMenuSheetDragMove}
                onPointerUp={handlePlaylistMenuSheetDragEnd}
                onPointerCancel={handlePlaylistMenuSheetDragEnd}
                role="button"
                tabIndex={0}
                aria-label="向下拖曳關閉"
                onKeyDown={(e) => e.key === 'Enter' && (setShowPlaylistMenu(false), setPlaylistMenuDragY(0))}
              >
                <div className="flex flex-col items-center justify-center py-2 px-12 -mx-4 min-h-[36px]">
                  <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowPlaylistMenu(false); setPlaylistMenuDragY(0); }}
                    className="p-2 -ml-2 text-[#B3B3B3] md:hover:text-white rounded-lg"
                    aria-label="關閉"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <h2 className="text-white font-bold text-lg truncate flex-1 text-center pointer-events-none">
                    歌單
                  </h2>
                  <div className="w-10" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 pb-4 px-4 space-y-4">
                <div>
                  <label className="block text-[#B3B3B3] text-sm mb-1.5">編輯名稱</label>
                  <input
                    type="text"
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    placeholder="歌單名稱"
                    className="w-full bg-[#282828] text-white px-3 py-2.5 rounded-xl outline-none placeholder-[#666]"
                  />
                </div>
                <div>
                  <label className="block text-[#B3B3B3] text-sm mb-1.5">編輯簡介</label>
                  <textarea
                    value={editDescriptionValue}
                    onChange={(e) => setEditDescriptionValue(e.target.value)}
                    placeholder="簡介（選填）"
                    rows={3}
                    className="w-full bg-[#282828] text-white px-3 py-2.5 rounded-xl outline-none placeholder-[#666] resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={savePlaylistMeta}
                  disabled={isSavingTitle || !editTitleValue.trim()}
                  className="w-full py-2.5 rounded-full bg-[#FFD700] text-black font-medium hover:opacity-90 disabled:opacity-50 transition"
                >
                  {isSavingTitle ? '儲存中…' : '儲存'}
                </button>
                <button
                  type="button"
                  onClick={handleDeletePlaylist}
                  className="w-full py-2.5 rounded-full border border-red-500/80 text-red-400 hover:bg-red-500/20 transition font-normal"
                >
                  刪除歌單
                </button>
              </div>
            </div>
          </>,
          document.body
        )}

        {/* 電話拖曳 ghost：獨立 portal 到 body，避免 modal 嘅 transform 令 fixed 以 modal 為 containing block 而向下偏移 */}
        {showEditPlaylistModal && touchDragIndex !== null && orderedSongsForEdit[touchDragIndex] && typeof document !== 'undefined' && createPortal(
          (() => {
            const listEl = editListScrollRef.current;
            const r = listEl?.getBoundingClientRect();
            const rowH = touchDragRowHeightRef.current || EDIT_ROW_HEIGHT;
            const rawTop = touchDragRowTopRef.current + (touchDragY - touchDragStartYRef.current);
            const top = r ? Math.max(r.top, Math.min(r.bottom - rowH, rawTop)) : rawTop;
            return (
              <div
                className="fixed left-0 right-0 px-4 pointer-events-none z-[10001]"
                style={{
                  top: `${top}px`,
                  transform: 'translateZ(0)'
                }}
              >
                <div className="flex items-center gap-2 py-1.5 rounded-2xl bg-[#282828] shadow-lg border border-[#444] opacity-95">
                  <div className="w-10 flex-shrink-0" />
                  <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] flex-shrink-0 overflow-hidden">
                    {(() => {
                      const dragThumb = getSongThumbnail(orderedSongsForEdit[touchDragIndex]);
                      return dragThumb ? (
                        <img src={dragThumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-5 h-5" strokeWidth={1.5} /></div>
                      );
                    })()}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className="text-white font-medium truncate leading-tight" style={{ fontSize: 15, lineHeight: '20px' }}>{orderedSongsForEdit[touchDragIndex].title}</p>
                    <p className="text-neutral-500 truncate leading-tight" style={{ fontSize: 13, lineHeight: '16px' }}>{getArtistName(orderedSongsForEdit[touchDragIndex])}</p>
                  </div>
                  <div className="w-10 flex-shrink-0" />
                </div>
              </div>
            );
          })(),
          document.body
        )}

        <style jsx global>{`
          .scrollbar-hide {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          .scrollbar-hide::-webkit-scrollbar {
            display: none;
          }
        `}</style>
      </div>
    </Layout>
  );
}
