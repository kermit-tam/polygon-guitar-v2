import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from '@/components/Link'
import { ArrowLeft, Pin } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { ROLES, ROLE_LABELS, ROLE_COLORS, hasPermission } from '@/lib/roles'
import Layout from '@/components/Layout'

const ADMIN_PINNED_KEY = 'pg_admin_pinned_hrefs'

const sections = [
  {
    title: '歌手',
    items: [
      { href: '/admin/artists-v2', label: '歌手管理', roles: [ROLES.SUPER_ADMIN, ROLES.SCORE_CHECKER, ROLES.ART_DIRECTOR] },
      { href: '/admin/artists-region', label: '地區設定', roles: [ROLES.SUPER_ADMIN, ROLES.SCORE_CHECKER] },
      { href: '/admin/artists-sort', label: '排序 / Tier', roles: [ROLES.SUPER_ADMIN, ROLES.SCORE_CHECKER] },
      { href: '/admin/merge-artists', label: '合併重複', roles: [ROLES.SUPER_ADMIN, ROLES.SCORE_CHECKER] },
    ]
  },
  {
    title: '歌單',
    items: [
      { href: '/admin/playlists', label: '歌單管理', roles: [ROLES.SUPER_ADMIN, ROLES.PLAYLIST_MAKER] },
      { href: '/admin/playlist-covers', label: '封面生成器', roles: [ROLES.SUPER_ADMIN, ROLES.PLAYLIST_MAKER, ROLES.ART_DIRECTOR] },
    ]
  },
  {
    title: 'Spotify',
    items: [
      { href: '/admin/spotify-manager', label: 'Spotify 管理', roles: [ROLES.SUPER_ADMIN, ROLES.ART_DIRECTOR] },
      { href: '/admin/update-track-info', label: '批量更新歌曲資訊', roles: [ROLES.SUPER_ADMIN, ROLES.SCORE_CHECKER] },
    ]
  },
  {
    title: '外觀',
    items: [
      { href: '/admin/home-settings', label: '首頁設置', roles: [ROLES.SUPER_ADMIN] },
      { href: '/admin/category-images', label: '分類封面', roles: [ROLES.SUPER_ADMIN, ROLES.ART_DIRECTOR] },
      { href: '/admin/site-logo', label: '網站 Logo', roles: [ROLES.SUPER_ADMIN, ROLES.ART_DIRECTOR] },
    ]
  },
  {
    title: '樂譜',
    items: [
      { href: '/admin/batch-uploader-pen-name', label: '批量改出譜者名稱', roles: [ROLES.SUPER_ADMIN] },
    ]
  },
  {
    title: '遊戲',
    items: [
      { href: '/admin/game-settings', label: '1秒前奏估歌仔設置', roles: [ROLES.SUPER_ADMIN, ROLES.SCORE_CHECKER] },
    ]
  },
  {
    title: '數據',
    items: [
      { href: '/admin/daily-uploads', label: '每日上傳', roles: [ROLES.SUPER_ADMIN] },
      { href: '/admin/artist-report', label: '歌手報表', roles: [ROLES.SUPER_ADMIN] },
    ]
  },
  {
    title: '系統',
    items: [
      { href: '/admin/admins', label: '管理員設定', roles: [ROLES.SUPER_ADMIN] },
      { href: '/admin/role-settings', label: '角色權限', roles: [ROLES.SUPER_ADMIN] },
      { href: '/admin/home-settings?tab=cache', label: '清除快取', roles: [ROLES.SUPER_ADMIN] },
      { href: '/admin/cache-docs', label: '快取架構文檔', roles: [ROLES.SUPER_ADMIN] },
      { href: '/admin/site-map', label: '網站地圖', roles: [ROLES.SUPER_ADMIN, ROLES.SCORE_CHECKER, ROLES.ART_DIRECTOR, ROLES.PLAYLIST_MAKER] },
    ]
  },
]

function getStoredPinnedHrefs() {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(ADMIN_PINNED_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function setStoredPinnedHrefs(hrefs) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ADMIN_PINNED_KEY, JSON.stringify(hrefs))
  } catch (_) {}
}

export default function AdminIndex() {
  const { user, userRole } = useAuth()
  const [pinnedHrefs, setPinnedHrefs] = useState([])

  useEffect(() => {
    setPinnedHrefs(getStoredPinnedHrefs())
  }, [])

  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN

  const visibleSections = sections
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        isSuperAdmin || item.roles.includes(userRole)
      )
    }))
    .filter(section => section.items.length > 0)

  const visibleHrefSet = new Set(visibleSections.flatMap(s => s.items.map(i => i.href)))
  const pinnedOrdered = pinnedHrefs.filter(h => visibleHrefSet.has(h))

  const togglePin = (e, href) => {
    e.preventDefault()
    e.stopPropagation()
    const next = pinnedOrdered.includes(href)
      ? pinnedOrdered.filter(h => h !== href)
      : [...pinnedOrdered, href]
    setPinnedHrefs(next)
    setStoredPinnedHrefs(next)
  }

  const roleLabel = isSuperAdmin
    ? '超級管理員'
    : (ROLE_LABELS[userRole] || '管理員')
  const roleColor = isSuperAdmin
    ? 'bg-red-500'
    : (ROLE_COLORS[userRole] || 'bg-neutral-500')

  const hrefToLabel = {}
  visibleSections.forEach(s => s.items.forEach(i => { hrefToLabel[i.href] = i.label }))

  const renderItem = (item, showPin = true) => (
    <Link
      key={item.href}
      href={item.href}
      className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
    >
      <span className="text-[15px]">{item.label}</span>
      <div className="flex items-center gap-2">
        {showPin && (
          <button
            type="button"
            onClick={(e) => togglePin(e, item.href)}
            className={`p-1.5 rounded-lg transition-colors touch-manipulation ${
              pinnedOrdered.includes(item.href)
                ? 'text-[#FFD700] bg-[#FFD700]/10'
                : 'text-[#B3B3B3] hover:text-white hover:bg-white/10'
            }`}
            aria-label={pinnedOrdered.includes(item.href) ? '取消置頂' : '置頂'}
          >
            <Pin className={`w-4 h-4 ${pinnedOrdered.includes(item.href) ? 'fill-current' : ''}`} strokeWidth={2} />
          </button>
        )}
        <svg className="w-4 h-4 text-[#B3B3B3] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )

  return (
    <Layout>
      <Head>
        <title>後台 | Polygon Guitar</title>
      </Head>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">後台</h1>
            <span className={`px-2 py-0.5 ${roleColor} text-white text-[11px] font-medium rounded`}>
              {roleLabel}
            </span>
          </div>
          <Link href="/" className="text-[#B3B3B3] hover:text-white transition-colors" aria-label="返回首頁">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </div>

        {/* Pinned section */}
        {pinnedOrdered.length > 0 && (
          <div className="mb-6">
            <h2 className="text-[#B3B3B3] text-xs font-medium uppercase tracking-wider mb-2 px-1">
              置頂
            </h2>
            <div className="bg-[#121212] rounded-xl overflow-hidden divide-y divide-white/5">
              {pinnedOrdered.map(href => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <span className="text-[15px]">{hrefToLabel[href] ?? href}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => togglePin(e, href)}
                      className="p-1.5 rounded-lg transition-colors text-[#FFD700] bg-[#FFD700]/10 touch-manipulation"
                      aria-label="取消置頂"
                    >
                      <Pin className="w-4 h-4 fill-current" strokeWidth={2} />
                    </button>
                    <svg className="w-4 h-4 text-[#B3B3B3] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Sections */}
        <div className="space-y-6">
          {visibleSections.map(section => {
            const unpinnedItems = section.items.filter(item => !pinnedOrdered.includes(item.href))
            if (unpinnedItems.length === 0) return null
            return (
              <div key={section.title}>
                <h2 className="text-[#B3B3B3] text-xs font-medium uppercase tracking-wider mb-2 px-1">
                  {section.title}
                </h2>
                <div className="bg-[#121212] rounded-xl overflow-hidden divide-y divide-white/5">
                  {unpinnedItems.map(item => renderItem(item))}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-[#B3B3B3] text-xs mt-8 mb-4">Polygon Guitar v2</p>
      </div>
    </Layout>
  )
}
