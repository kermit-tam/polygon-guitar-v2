import { useState, useEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/router'
import { db } from '@/lib/firebase'
import { doc, getDoc, collection, query, where, getDocs } from '@/lib/firestore-tracked'
import { getUserPlaylists } from '@/lib/playlistApi'
import { getTabsByIds } from '@/lib/tabs'
import Layout from '@/components/Layout'
import Link from '@/components/Link'
import { useAuth } from '@/contexts/AuthContext'
import { getSongThumbnail } from '@/lib/getSongThumbnail'
import { ArrowLeft, MoreVertical, Pencil, PenLine, ChevronDown, ChevronUp, Eye, Heart, Bookmark, Music } from 'lucide-react'
import { useArtistMap } from '@/lib/useArtistMap'
import { PROFILE_SOCIAL_ICONS, PROFILE_SOCIAL_ORDER } from '@/components/ProfileSocialIcons'
import { PlaylistCard } from '@/components/LazyImage'

// 社交媒體圖標組件（icon 與 edit 頁共用 PROFILE_SOCIAL_ICONS）
const SocialIcon = ({ platform, url }) => {
  if (!url) return null

  const getFullUrl = (url, type) => {
    if (!url) return null
    const raw = String(url).trim()
    if (!raw) return null
    if (/^https?:\/\//i.test(raw)) return raw
    if (/^(javascript|data|vbscript):/i.test(raw)) return null
    
    const prefixes = {
      facebook: 'https://facebook.com/',
      instagram: 'https://instagram.com/',
      youtube: 'https://youtube.com/@',
      whatsapp: 'https://wa.me/',
      threads: 'https://threads.net/@'
    }

    // 個人網站：輸入 domain（例如 polygon.guitars）時，自動補 https://
    if (type === 'website') return `https://${raw.replace(/^\/+/, '')}`

    return prefixes[type] ? prefixes[type] + raw : `https://${raw.replace(/^\/+/, '')}`
  }

  const fullUrl = getFullUrl(url, platform)
  if (!fullUrl) return null

  return (
    <a
      href={fullUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="w-12 h-12 rounded-full bg-[#FFD700] flex items-center justify-center text-black hover:scale-110 transition-transform"
      title={platform}
    >
      {PROFILE_SOCIAL_ICONS[platform] || PROFILE_SOCIAL_ICONS.website}
    </a>
  )
}

function resolveTabCoverImage(tab) {
  if (!tab) return null
  if (tab.coverImage) return tab.coverImage
  if (tab.albumImage) return tab.albumImage
  if (tab.thumbnail) return tab.thumbnail
  const vid = tab.youtubeVideoId || tab.youtubeUrl?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1]
  if (vid) return `https://img.youtube.com/vi/${vid}/mqdefault.jpg`
  return null
}

export default function PublicProfile() {
  const router = useRouter()
  const { id } = router.query
  const { user: currentUser } = useAuth()
  const { getArtistName } = useArtistMap()
  
  const [profile, setProfile] = useState(null)
  const [uploads, setUploads] = useState([])
  const [playlists, setPlaylists] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [showProfileMore, setShowProfileMore] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [allTabsExpanded, setAllTabsExpanded] = useState(false)
  const [uploadsError, setUploadsError] = useState(null)
  const ALL_TABS_INITIAL = 10

  useEffect(() => {
    if (id) {
      loadProfile()
    }
  }, [id])

  const loadProfile = async () => {
    setIsLoading(true)
    setUploadsError(null)
    try {
      const userDoc = await getDoc(doc(db, 'users', id))
      
      if (!userDoc.exists()) {
        setError('用戶不存在')
        setIsLoading(false)
        return
      }

      const userData = { id: userDoc.id, ...userDoc.data() }
      
      if (userData.isPublicProfile === false && currentUser?.uid !== id) {
        setError('此用戶的個人主頁未公開')
        setIsLoading(false)
        return
      }

      setProfile(userData)
      setFollowerCount(userData.followerCount || 0)

      // 載入上傳的樂譜：只以 uploaderPenName == 帳戶 penName（真實／placeholder 相同）；無 penName 則不列出
      try {
        if (userData.penName) {
          const tabsQuery = query(
            collection(db, 'tabs'),
            where('uploaderPenName', '==', userData.penName)
          )
          const tabsSnapshot = await getDocs(tabsQuery)
          const list = tabsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          list.sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0
            const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0
            return tb - ta
          })
          setUploads(list)
        } else {
          setUploads([])
        }
      } catch (e) {
        console.error('Error loading uploads:', e)
        setUploadsError(e?.message || String(e))
        setUploads([])
      }
      
      // 載入歌單
      if (userData.showPlaylists !== false) {
        try {
          const userPlaylists = await getUserPlaylists(id)
          const topPlaylists = userPlaylists.slice(0, 5)
          const ids = [...new Set(topPlaylists.flatMap((pl) => (pl.songIds || []).slice(0, 4)).filter(Boolean))]

          if (ids.length > 0) {
            const tabs = await getTabsByIds(ids)
            const byId = new Map(tabs.map((t) => [t.id, t]))
            const withCovers = topPlaylists.map((pl) => ({
              ...pl,
              coverSongs: (pl.songIds || [])
                .slice(0, 4)
                .map((sid) => {
                  const tab = byId.get(sid)
                  const thumb = resolveTabCoverImage(tab)
                  return thumb ? { id: sid, thumbnail: thumb } : null
                })
                .filter(Boolean)
            }))
            setPlaylists(withCovers)
          } else {
            setPlaylists(topPlaylists)
          }
        } catch (e) {
          console.error('Error loading playlists:', e)
        }
      }

      // 檢查是否已追蹤
      if (currentUser) {
        try {
          const followDoc = await getDoc(doc(db, 'users', id, 'followers', currentUser.uid))
          setIsFollowing(followDoc.exists())
        } catch (e) {
          console.log('Error checking follow status:', e)
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error)
      setError('載入資料失敗: ' + error.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFollow = async () => {
    if (!currentUser) {
      router.push('/login')
      return
    }
    if (currentUser.uid === id) return

    setFollowLoading(true)
    try {
      const { doc, setDoc, deleteDoc, increment, updateDoc } = await import('@/lib/firestore-tracked')

      if (isFollowing) {
        await deleteDoc(doc(db, 'users', id, 'followers', currentUser.uid))
        await updateDoc(doc(db, 'users', id), {
          followerCount: increment(-1)
        })
        setFollowerCount(prev => Math.max(0, prev - 1))
        setIsFollowing(false)
      } else {
        await setDoc(doc(db, 'users', id, 'followers', currentUser.uid), {
          createdAt: new Date().toISOString()
        })
        await updateDoc(doc(db, 'users', id), {
          followerCount: increment(1)
        })
        setFollowerCount(prev => prev + 1)
        setIsFollowing(true)
      }
    } catch (error) {
      console.error('Follow error:', error)
      alert('追蹤操作失敗，請稍後再試。如持續發生請確認 Firestore 規則已部署。')
    } finally {
      setFollowLoading(false)
    }
  }

  const totalViews = uploads.reduce((sum, tab) => sum + (tab.viewCount || 0), 0)
  // 熱門：按瀏覽量取頭 5 首；其餘為所有出譜（保持上傳時間序）
  const popularTabs = [...uploads].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, 5)
  const popularIds = new Set(popularTabs.map(t => t.id))
  const otherTabs = uploads.filter(t => !popularIds.has(t.id))
  const isOwnProfile = currentUser?.uid === id
  const socialMedia = profile?.socialMedia || {}
  const hasSocialLinks = Object.values(socialMedia).some(url => url && url.trim() !== '')

  useEffect(() => {
    if (typeof document === 'undefined' || !showProfileMore) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [showProfileMore])

  if (isLoading) {
    return (
      <Layout hideHeader>
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full"></div>
        </div>
      </Layout>
    )
  }

  if (error) {
    return (
      <Layout hideHeader>
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-center">
            <p className="text-neutral-400 mb-4">{error}</p>
            <Link href="/" className="inline-flex items-center text-[#FFD700] hover:underline" aria-label="返回首頁">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </Layout>
    )
  }

  if (!profile) return null

  const BIO_COLLAPSED_LINES = 3
  const bioLines = profile.bio ? profile.bio.split('\n') : []
  const bioIsLong = bioLines.length > BIO_COLLAPSED_LINES
  const bioDisplay = profile.bio && (bioExpanded || !bioIsLong)
    ? profile.bio
    : bioLines.slice(0, BIO_COLLAPSED_LINES).join('\n')

  return (
    <Layout>
      <div className="min-h-screen bg-black pb-24 px-4">

        {/* Profile Header - 依 wireframe: photo | name+follow → 統計 → contact 全寬 → description + button */}
        <div className="max-w-2xl mx-auto pt-4 pb-2 relative">
          {/* 右上角：更多（僅自己 profile 顯示）*/}
          {isOwnProfile && (
            <button
              type="button"
              onClick={() => setShowProfileMore(true)}
              className="absolute top-0 right-0 p-2 rounded-full text-[#B3B3B3] hover:text-white hover:bg-white/10 transition"
              aria-label="更多"
            >
              <MoreVertical className="w-6 h-6" />
            </button>
          )}
          {/* 上排：photo + name + follow */}
          <div className="flex gap-4">
            <img
              src={profile.photoURL || '/default-avatar.png'}
              alt={profile.displayName}
              className="w-24 h-24 md:w-28 md:h-28 rounded-full object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0 flex flex-col justify-center -mt-3">
              <div className="flex items-center gap-3 mb-0 flex-wrap">
                <h1 className="text-white text-lg md:text-xl font-bold truncate">
                  {profile.displayName || '未命名用戶'}
                </h1>
                {isOwnProfile && (
                  <Link
                    href="/profile/edit"
                    className="mt-3 px-4 py-1.5 rounded-full text-sm font-medium bg-neutral-700 text-white hover:bg-neutral-600 transition flex-shrink-0 border border-neutral-600"
                  >
                    編輯
                  </Link>
                )}
                {!isOwnProfile && currentUser && (
                  <button
                    type="button"
                    onClick={handleFollow}
                    disabled={followLoading}
                    className={`mt-3 px-4 py-1.5 rounded-full text-sm font-medium transition flex-shrink-0 border border-[#FFD700] disabled:opacity-60 ${
                      isFollowing ? 'bg-neutral-800 text-[#FFD700]' : 'bg-[#FFD700] text-black'
                    }`}
                  >
                    {followLoading ? '處理中...' : (isFollowing ? '追蹤中' : '追蹤')}
                  </button>
                )}
                {!currentUser && !isOwnProfile && (
                  <Link
                    href="/login"
                    className="mt-3 px-4 py-1.5 rounded-full text-sm font-medium border border-[#FFD700] bg-[#FFD700] text-black hover:opacity-90 transition flex-shrink-0 inline-block"
                  >
                    追蹤
                  </Link>
                )}
              </div>
              {profile.penName && (
                <p className="text-[#FFD700] text-sm flex items-center gap-1 -mt-3 mb-3">
                  <PenLine className="w-3.5 h-3.5 flex-shrink-0" />
                  {profile.penName}
                </p>
              )}
              {/* 統計：對齊右欄，數字在上、標籤在下（02 設計：白字）*/}
              <div className="flex gap-6 md:gap-10">
                <div className="flex flex-col gap-0 leading-tight">
                  <span className="text-white text-lg md:text-xl font-bold">{uploads.length}</span>
                  <span className="text-white/80 text-xs -mt-0.5">出譜數目</span>
                </div>
                <div className="flex flex-col gap-0 leading-tight">
                  <span className="text-white text-lg md:text-xl font-bold">{totalViews >= 1000 ? (totalViews / 1000).toFixed(1) + 'k' : totalViews.toLocaleString()}</span>
                  <span className="text-white/80 text-xs -mt-0.5">總瀏覽量</span>
                </div>
                <div className="flex flex-col gap-0 leading-tight">
                  <span className="text-white text-lg md:text-xl font-bold">{followerCount >= 1000 ? (followerCount / 1000).toFixed(0) + 'k' : String(followerCount)}</span>
                  <span className="text-white/80 text-xs -mt-0.5">粉絲</span>
                </div>
              </div>
            </div>
          </div>

          {/* Contact link - 全寬、置中（02：黑底上一排黃色圓鈕）*/}
          {hasSocialLinks && (
            <div className="w-full pt-4 pb-3 mt-0">
              <div className="flex items-center gap-3 flex-wrap">
                {PROFILE_SOCIAL_ORDER.map((platform) =>
                  socialMedia[platform] && String(socialMedia[platform]).trim() ? (
                    platform === 'whatsapp' ? (
                      <span key={platform} className="inline-block -mt-0.5">
                        <SocialIcon platform={platform} url={socialMedia[platform]} />
                      </span>
                    ) : (
                      <SocialIcon key={platform} platform={platform} url={socialMedia[platform]} />
                    )
                  ) : null
                )}
              </div>
            </div>
          )}

          {/* Description + 顯示全部 按鈕在右下（wireframe: description block + button）*/}
          {profile.bio && (
            <div className="mt-0 flex flex-col items-stretch">
              <div
                className={bioIsLong && !bioExpanded ? 'overflow-hidden' : ''}
                style={bioIsLong && !bioExpanded ? {
                  maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)'
                } : undefined}
              >
                <p className="text-[#B3B3B3] text-sm leading-relaxed whitespace-pre-wrap">
                  {bioDisplay}
                  {bioIsLong && !bioExpanded && '……'}
                </p>
              </div>
              {bioIsLong && (
                <div className="flex justify-start mt-2">
                  <button
                    type="button"
                    onClick={() => setBioExpanded(!bioExpanded)}
                    className="flex items-center gap-1 text-white/90 text-xs hover:text-[#FFD700] transition"
                  >
                    {bioExpanded ? (
                      <>
                        收起
                        <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" />
                      </>
                    ) : (
                      <>
                        顯示全部
                        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 熱門 / 所有出譜 / 自創歌單 - 統一容器 */}
        <div className="max-w-2xl mx-auto mt-4 space-y-4">
          {profile.showUploads !== false && !uploadsError && uploads.length === 0 && (
            <section className="rounded-xl bg-[#121212] border border-neutral-800 p-4">
              <p className="text-[#B3B3B3] text-sm">目前沒有樂譜。</p>
              {!profile.penName && (
                <p className="text-[#B3B3B3] text-xs mt-1">
                  此帳戶未有出譜者名稱，無法顯示樂譜列表。請到「編輯個人資料」設定出譜者名稱，並確保樂譜的 <code className="bg-[#282828] px-1 rounded">uploaderPenName</code> 與之一致。
                </p>
              )}
            </section>
          )}
          {profile.showUploads !== false && uploadsError && (
            <section className="rounded-xl bg-[#121212] border border-neutral-800 p-4">
              <p className="text-amber-400 text-sm mb-2">無法載入樂譜列表：{uploadsError}</p>
              <p className="text-[#B3B3B3] text-xs mb-3">若錯誤提到「index」，請在專案目錄執行：firebase deploy --only firestore:indexes</p>
              <button
                type="button"
                onClick={() => loadProfile()}
                className="px-3 py-1.5 rounded-lg bg-[#FFD700] text-black text-sm font-medium hover:bg-yellow-400"
              >
                重試
              </button>
            </section>
          )}
          {profile.showUploads !== false && uploads.length > 0 && (
            <section>
              <h2 className="text-white font-bold text-lg mb-0">熱門</h2>
              <div className="space-y-0">
                {popularTabs.map((tab) => {
                  const thumbnail = getSongThumbnail(tab)
                  return (
                    <Link key={tab.id} href={`/tabs/${tab.slug ?? tab.id}`}>
                      <div className="flex items-center gap-3 py-1.5 pl-0 pr-3 rounded-lg hover:bg-[#181818] transition cursor-pointer group">
                        {thumbnail ? (
                          <img
                            src={thumbnail}
                            alt={tab.title}
                            className="w-12 h-12 rounded-[4px] object-cover flex-shrink-0 bg-[#282828]"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-[4px] bg-[#282828] flex items-center justify-center flex-shrink-0">
                            <Music className="w-5 h-5 text-neutral-500" strokeWidth={1.5} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white text-sm font-medium truncate group-hover:text-[#FFD700] transition">{tab.title}</h3>
                          <p className="text-[#B3B3B3] text-xs">{getArtistName(tab)}</p>
                        </div>
<div className="text-[#B3B3B3] text-xs flex-shrink-0 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5" />
                          {(tab.viewCount || 0).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-0">
                          <Heart className="w-3.5 h-3.5 text-neutral-500 fill-neutral-500 flex-shrink-0" />
                          <Bookmark className="w-3.5 h-3.5 text-neutral-500 fill-neutral-500 flex-shrink-0" />
                          {(tab.likes ?? 0) + (tab.playlistCount ?? 0)}
                        </span>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {profile.showUploads !== false && otherTabs.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-white font-bold text-lg">所有出譜 <span className="text-[#B3B3B3] font-normal text-base">({otherTabs.length})</span></h2>
                {otherTabs.length > ALL_TABS_INITIAL && (
                  <button
                    type="button"
                    onClick={() => setAllTabsExpanded(prev => !prev)}
                    className="p-1 text-[#B3B3B3] hover:text-[#FFD700] transition flex-shrink-0"
                    title={allTabsExpanded ? '收埋' : '展開'}
                    aria-expanded={allTabsExpanded}
                  >
                    {allTabsExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
              <div className="space-y-0">
                {(allTabsExpanded ? otherTabs : otherTabs.slice(0, ALL_TABS_INITIAL)).map((tab, index) => (
                  <Fragment key={tab.id}>
                    {index > 0 && <div className="h-px bg-neutral-800 min-w-full" aria-hidden="true" />}
                    <Link href={`/tabs/${tab.slug ?? tab.id}`}>
                      <div className="flex items-center gap-3 py-2 pl-0 pr-3 hover:bg-[#181818] transition rounded-lg">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white text-sm font-medium truncate">{tab.title}</h3>
                        <p className="text-[#B3B3B3] text-xs">{getArtistName(tab)}</p>
                      </div>
                      <div className="text-[#B3B3B3] text-xs flex-shrink-0 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5" />
                          {(tab.viewCount || 0).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-0">
                          <Heart className="w-3.5 h-3.5 text-neutral-500 fill-neutral-500 flex-shrink-0" />
                          <Bookmark className="w-3.5 h-3.5 text-neutral-500 fill-neutral-500 flex-shrink-0" />
                          {(tab.likes ?? 0) + (tab.playlistCount ?? 0)}
                        </span>
                      </div>
                    </div>
                  </Link>
                  </Fragment>
                ))}
                {otherTabs.length > ALL_TABS_INITIAL && !allTabsExpanded && (
                  <div className="flex justify-center mt-3">
                    <button
                      type="button"
                      onClick={() => setAllTabsExpanded(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-600 text-white/90 text-xs hover:text-[#FFD700] hover:border-[#FFD700]/50 transition"
                    >
                      顯示全部
                      <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {profile.showPlaylists !== false && playlists.length > 0 && (
            <section className="-mt-1" style={{ marginBottom: 25 }}>
              <h2 className="text-white font-bold text-lg mb-2">自創歌單</h2>
              <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3" data-drag-scroll>
                {playlists.map((playlist) => (
                  <Link key={playlist.id} href={`/library/playlist/${playlist.id}`} className="flex-shrink-0 flex flex-col text-left group w-[24vw] md:w-28">
                    <div className="w-[24vw] h-[24vw] md:w-28 md:h-28 rounded-[4px] overflow-hidden bg-[#282828] mb-2 shadow-lg relative grid grid-cols-2 grid-rows-2">
                      {(playlist.coverSongs || []).length > 0 ? (
                        Array.from({ length: 4 }, (_, i) => {
                          const song = playlist.coverSongs[i]
                          if (!song) return <div key={`empty-${playlist.id}-${i}`} className="w-full h-full min-h-0 bg-[#282828]" aria-hidden />
                          return (
                            <div key={`${playlist.id}-${song.id}`} className="relative w-full h-full min-h-0 bg-[#282828]">
                              {song.thumbnail ? (
                                <img src={song.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-[#282828]"><Music className="w-5 h-5 text-neutral-500" strokeWidth={1.5} /></div>
                              )}
                            </div>
                          )
                        })
                      ) : playlist.coverImage ? (
                        <div className="col-span-2 row-span-2 w-full h-full">
                          <img src={playlist.coverImage} alt={playlist.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        </div>
                      ) : (
                        <div className="col-span-2 row-span-2 w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
                          <Music className="w-8 h-8 text-neutral-500" strokeWidth={1.5} />
                        </div>
                      )}
                    </div>
                    <div className="text-white font-medium truncate text-[0.95rem] md:text-[15px] leading-[1.3] md:leading-[1.33] mb-[1px] md:mb-0">
                      {playlist.title}
                    </div>
                    {typeof playlist.description === 'string' && playlist.description.trim() && (
                      <div className="text-neutral-500 line-clamp-2 text-[0.8rem] md:text-[13px] leading-[1.3]">{playlist.description.trim()}</div>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Profile 更多 Menu - 底部彈出，僅「編輯個人資料」*/}
      {showProfileMore && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 bg-black/60 z-[9999]" onClick={() => setShowProfileMore(false)} aria-hidden />
          <div
            className="fixed bottom-0 left-0 right-0 bg-[#121212] rounded-t-3xl z-[9999] overflow-hidden animate-slide-up"
            style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0))' }}
          >
            <div className="flex flex-col items-center py-2 px-12">
              <div className="w-10 h-1 rounded-full bg-[#525252]" />
            </div>
            <div className="px-4 pb-4">
              <Link
                href="/profile/edit"
                onClick={() => setShowProfileMore(false)}
                className="w-full flex items-center gap-3 py-3.5 rounded-2xl text-left md:hover:bg-white/5 transition text-white"
              >
                <Pencil className="w-5 h-5 text-[#B3B3B3] shrink-0" />
                編輯個人資料
              </Link>
            </div>
          </div>
        </>,
        document.body
      )}
    </Layout>
  )
}
