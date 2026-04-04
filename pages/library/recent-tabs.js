// pages/library/recent-tabs.js - 最近瀏覽的結他譜（最多 20 份，localStorage）
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from '@/components/Link';
import { auth } from '../../lib/firebase';
import { getRecentTabIds } from '../../lib/libraryRecentViews';
import { getTabsByIds } from '../../lib/tabs';
import { getSongThumbnail } from '../../lib/getSongThumbnail';
import { useAuth } from '../../contexts/AuthContext';
import { toggleLikeSong, checkIsLiked, getUserPlaylists, addSongToPlaylist, createPlaylist, removeSongFromPlaylist } from '../../lib/playlistApi';
import SongActionSheet from '../../components/SongActionSheet';
import Layout from '../../components/Layout';
import { useArtistMap } from '@/lib/useArtistMap';
import Head from 'next/head';
import { Clock, ArrowLeft, Copy, Share, Heart, Music, User, Plus } from 'lucide-react';

export default function RecentTabs() {
  const router = useRouter();
  const fromHome = router.query.from === 'home';
  const backHref = fromHome ? '/' : '/library';
  const backLabel = fromHome ? '返回首頁' : '返回收藏';
  const { user } = useAuth();
  const { getArtistName } = useArtistMap();
  const [tabs, setTabs] = useState([]);
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [selectedTabLiked, setSelectedTabLiked] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [addToPlaylistSelectedIds, setAddToPlaylistSelectedIds] = useState([]);
  const [addToPlaylistInitialIds, setAddToPlaylistInitialIds] = useState([]);
  const [showCreatePlaylistInput, setShowCreatePlaylistInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      if (currentUser) {
        setAuthUser(currentUser);
        loadTabs();
      } else {
        router.push('/login');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (document.visibilityState === 'visible' && authUser) {
      loadTabs();
    }
  }, [authUser?.uid]);

  const handleMoreClick = async (e, tab) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedTab(tab);
    if (user) {
      const [liked, playlists] = await Promise.all([
        checkIsLiked(user.uid, tab.id),
        getUserPlaylists(user.uid)
      ]);
      setSelectedTabLiked(liked);
      setUserPlaylists(playlists);
    } else {
      setSelectedTabLiked(false);
    }
    setShowActionModal(true);
  };

  const handleCopyShareLink = async () => {
    if (!selectedTab) return;
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/tabs/${selectedTab.id}`;
    try {
      await navigator.clipboard.writeText(url);
      alert('已複製連結');
    } catch (err) {
      alert('複製失敗');
    }
  };

  const handleSelectLyricsShare = () => {
    if (!selectedTab?.id) return;
    setShowActionModal(false);
    router.push(`/tools/tab-share?tabId=${selectedTab.id}`);
  };

  const handleAddToLiked = async () => {
    if (!selectedTab || !user) {
      alert('請先登入後即可收藏喜愛的結他譜');
      return;
    }
    try {
      const result = await toggleLikeSong(user.uid, selectedTab.id);
      setSelectedTabLiked(result.isLiked);
    } catch (error) {
      alert('操作失敗：' + (error?.message || error));
    }
  };

  const handleAddToPlaylistClick = () => {
    if (!user) {
      alert('請先登入後即可收藏喜愛的結他譜');
      return;
    }
    setShowActionModal(false);
    const alreadyIn = (userPlaylists || [])
      .filter((pl) => pl.songIds && pl.songIds.includes(selectedTab?.id))
      .map((pl) => pl.id);
    setAddToPlaylistSelectedIds(alreadyIn);
    setAddToPlaylistInitialIds(alreadyIn);
    setShowAddToPlaylist(true);
  };

  const toggleAddToPlaylistSelection = (playlistId) => {
    setAddToPlaylistSelectedIds((prev) =>
      prev.includes(playlistId) ? prev.filter((id) => id !== playlistId) : [...prev, playlistId]
    );
  };

  const confirmAddToPlaylist = async () => {
    if (!selectedTab) return;
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
        await addSongToPlaylist(playlistId, selectedTab.id);
      }
      for (const playlistId of idsToRemove) {
        await removeSongFromPlaylist(playlistId, selectedTab.id);
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
      alert('操作失敗：' + (error?.message || error));
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !user || !selectedTab) return;
    try {
      const result = await createPlaylist(user.uid, newPlaylistName.trim());
      await addSongToPlaylist(result.playlistId, selectedTab.id);
      setShowCreatePlaylistInput(false);
      setShowAddToPlaylist(false);
      setNewPlaylistName('');
      alert(`已創建歌單「${newPlaylistName.trim()}」並加入歌曲`);
    } catch (error) {
      alert('創建歌單失敗：' + (error?.message || error));
    }
  };

  const loadTabs = async () => {
    setLoading(true);
    try {
      const recent = getRecentTabIds();
      if (recent.length === 0) {
        setTabs([]);
        setLoading(false);
        return;
      }
      const tabIds = recent.map(({ id }) => id).filter(Boolean);
      const list = tabIds.length ? await getTabsByIds(tabIds) : [];
      setTabs(list);
    } catch (error) {
      console.error('載入最近瀏覽失敗:', error);
      setTabs([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout fullWidth hideHeader>
      <Head>
        <title>最近瀏覽 | Polygon Guitar</title>
        <meta name="theme-color" content="#000000" />
      </Head>
      <div className="relative z-10 min-h-screen pb-24 bg-black" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="relative pt-4 pb-1" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <Link
            href={backHref}
            className="inline-flex items-center text-white hover:text-white/90 transition p-1.5 -ml-1.5"
            aria-label={backLabel}
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </div>

        <div className="pb-1" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-bold text-white truncate" style={{ fontSize: '1.5rem' }}>
              最近瀏覽
            </h1>
            <span className="text-[12px] md:text-[14px] text-neutral-500 whitespace-nowrap flex-shrink-0">
              共 {tabs.length} 份
            </span>
          </div>
        </div>

        {tabs.length > 0 ? (
          <div style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            {tabs.map((tab) => (
              <div key={tab.id} className="group flex items-center gap-3 py-2 pl-0 pr-0 rounded-[7px] md:hover:bg-white/5 md:transition">
                <Link href={`/tabs/${tab.slug ?? tab.id}`} className="flex-1 flex items-center gap-3 min-w-0">
                  <div className="w-[49px] h-[49px] rounded-[5px] bg-neutral-800 flex-shrink-0 overflow-hidden">
                    {getSongThumbnail(tab) ? (
                      <img
                        src={getSongThumbnail(tab)}
                        alt={tab.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-neutral-500"><Music className="w-6 h-6" strokeWidth={1.5} /></span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <h3 className="text-[1rem] font-medium text-[#e6e6e6] truncate md:group-hover:text-[#FFD700] md:transition">
                      {tab.title}
                    </h3>
                    <p className="text-[0.85rem] text-[#999] truncate">{getArtistName(tab)}</p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={(e) => handleMoreClick(e, tab)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 text-[#999] hover:text-white transition -my-1"
                  aria-label="更多"
                >
                  <svg className="w-4 h-4" viewBox="0 0 14.96 2.54" fill="currentColor" aria-hidden>
                    <circle cx="1.27" cy="1.27" r="1.27" />
                    <circle cx="7.48" cy="1.27" r="1.27" />
                    <circle cx="13.69" cy="1.27" r="1.27" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
            <Clock className="w-16 h-16 text-[#3E3E3E] mx-auto mb-4" />
            <h3 className="text-xl text-white mb-2">未有最近瀏覽</h3>
            <p className="text-neutral-500 mb-6">打開過嘅結他譜會顯示喺呢度（最多 20 份）</p>
            <Link
              href={backHref}
              className="inline-flex items-center px-6 py-3 bg-[#FFD700] text-black rounded-full font-medium hover:opacity-90 transition"
            >
              {backLabel}
            </Link>
          </div>
        )}

        {/* 更多 - 底部彈出 Menu（統一用 SongActionSheet） */}
        <SongActionSheet
          open={showActionModal}
          onClose={() => setShowActionModal(false)}
          title={selectedTab?.title ?? ''}
          artist={selectedTab ? getArtistName(selectedTab) : ''}
          thumbnailUrl={selectedTab ? getSongThumbnail(selectedTab) : null}
          liked={selectedTabLiked}
          likeLabel={selectedTabLiked ? '取消喜愛' : '加入喜愛結他譜'}
          onCopyShareLink={handleCopyShareLink}
          onSelectLyricsShare={handleSelectLyricsShare}
          onAddToLiked={handleAddToLiked}
          onAddToPlaylist={handleAddToPlaylistClick}
          artistHref={selectedTab && (selectedTab.artistId || selectedTab.artist_id || selectedTab.artistSlug) ? `/artists/${selectedTab.artistId || selectedTab.artist_id || selectedTab.artistSlug}` : undefined}
          paddingBottom="env(safe-area-inset-bottom, 0)"
        />

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
            <div className="fixed bottom-0 left-0 right-0 bg-[#121212] rounded-t-2xl z-[60] pb-24 max-h-[70vh] overflow-y-auto">
              <div className="flex flex-col items-center justify-center py-2 min-h-[36px]">
                <div className="w-10 h-1 rounded-full bg-[#525252] shrink-0" />
              </div>
              <div className="text-left" style={{ paddingLeft: '1rem', paddingRight: '1rem' }}>
                <h3 className="text-white text-lg font-bold mb-4">加入歌單</h3>
                <div className="space-y-2">
                  {userPlaylists.map((pl) => {
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
                  <div className="h-px bg-[#3E3E3E] w-full shrink-0" />
                  <button
                    type="button"
                    onClick={() => setShowCreatePlaylistInput(true)}
                    className="w-full flex items-center space-x-3 pl-0 pr-3 py-1.5 md:hover:bg-[#1a1a1a] rounded-2xl text-left"
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
                          onClick={() => { setShowCreatePlaylistInput(false); setNewPlaylistName(''); }}
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
      </div>
    </Layout>
  );
}
