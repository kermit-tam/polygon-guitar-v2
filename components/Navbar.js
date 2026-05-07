import Link from '@/components/Link'
import { useAuth } from '@/contexts/AuthContext'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Shield } from 'lucide-react'

// Avoid SSR warning: useLayoutEffect cannot run on server; use useEffect during SSR so initial output matches
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
import { useRouter } from 'next/router'

// Hardcoded so we don't hit Firebase on every page visit
const SITE_LOGO_ICON_URL = 'https://res.cloudinary.com/drld2cjpo/image/upload/v1775023265/artists/site_logo_1775023264527.png'
const SITE_LOGO_TEXT_URL = 'https://res.cloudinary.com/drld2cjpo/image/upload/v1774852951/artists/site_logo_1774852951511.png'
const SITE_NAME = 'Polygon 結他譜'

/** 頂欄選單：顯示／隱藏 Admin「View as」浮動掣（樣式參考深底黃盾牌 pill） */
function NavbarAdminViewAsToggle({ show, onToggle, itemPadding }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 ${itemPadding} py-2`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#282828] border border-[#444] pl-2 pr-2.5 py-1 shrink-0">
        <Shield className="w-3.5 h-3.5 text-[#FFD700] shrink-0" strokeWidth={2} aria-hidden />
        <span className="text-white text-xs font-medium">View as</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={show}
        aria-label={show ? '隱藏 View as 浮動掣' : '顯示 View as 浮動掣'}
        onClick={(e) => {
          e.stopPropagation()
          onToggle(!show)
        }}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30 ${show ? 'bg-black/55' : 'bg-black/20'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${show ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
  )
}

export default function Navbar() {
  const { user, logout, isAuthenticated, isAdmin, loading: authLoading, realIsAdmin, showAdminViewAsButton, setShowAdminViewAsButton } = useAuth()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const router = useRouter()
  const menuRef = useRef(null)
  const triggerRef = useRef(null)
  const navRef = useRef(null)
  // Desktop: 避免「點擊 Link」被誤判為點擊外部；mousedown 在 menu 內設 true，document click 時見 true 就不關閉
  const clickedInsideMenuRef = useRef(false)
  // Desktop 下拉選單：固定喺 nav bar 下方（唔遮住頂欄）
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 12 })
  useIsomorphicLayoutEffect(() => {
    if (!isMenuOpen || typeof window === 'undefined') return
    if (navRef.current && triggerRef.current) {
      const navRect = navRef.current.getBoundingClientRect()
      const triggerRect = triggerRef.current.getBoundingClientRect()
      setMenuPosition({
        top: navRect.bottom + 4,
        right: window.innerWidth - triggerRect.right,
      })
    }
  }, [isMenuOpen])

  // 路由變化時關閉選單，避免點擊 Link 時先關閉導致導航被取消
  useEffect(() => {
    const handleRouteChange = () => setIsMenuOpen(false)
    router.events.on('routeChangeStart', handleRouteChange)
    return () => router.events.off('routeChangeStart', handleRouteChange)
  }, [router.events])

  // 關閉選單時重置 desktop 下拉位置，下次打開會重新計算（喺 nav bar 下方）
  useEffect(() => {
    if (!isMenuOpen) setMenuPosition({ top: 0, right: 12 })
  }, [isMenuOpen])

  // 只喺 desktop 點擊外部關閉選單（手機唔用，避免撳 icon 後選單被誤關）
  useEffect(() => {
    if (!isMenuOpen) return
    const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    const handleClickOutside = (e) => {
      if (!isDesktop()) return
      if (clickedInsideMenuRef.current) {
        clickedInsideMenuRef.current = false
        return
      }
      if (menuRef.current && !menuRef.current.contains(e.target)) setIsMenuOpen(false)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isMenuOpen])

  // iPhone Safari：選單打開時鎖 body，防止背景收到 touch/scroll
  useEffect(() => {
    if (typeof document === 'undefined') return
    const isMobile = () => window.matchMedia('(max-width: 767px)').matches
    if (isMenuOpen && isMobile()) {
      const scrollY = window.scrollY
      document.body.setAttribute('data-nav-menu-open', 'true')
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      return () => {
        document.body.removeAttribute('data-nav-menu-open')
        document.body.style.overflow = ''
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
        window.scrollTo(0, scrollY)
      }
    }
  }, [isMenuOpen])

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  return (
    <nav
      ref={navRef}
      className={`bg-[#FFD700] fixed top-0 left-0 right-0 will-change-transform ${isMenuOpen ? 'z-[10000]' : 'z-[100]'}`}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="max-w-[1050px] mx-auto pl-4 pr-3">
        <div className="flex justify-between relative z-10 bg-[#FFD700] mt-1 mb-1" style={{ height: '4.4rem' }}>
          {/* Logo + 副標題 */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <img
                src={SITE_LOGO_ICON_URL}
                alt=""
                loading="eager"
                decoding="async"
                style={{ height: 50, width: 'auto' }}
              />
              <div className="flex flex-col justify-center">
                <div className="relative" style={{ maxWidth: 155 }}>
                  <img
                    src={SITE_LOGO_TEXT_URL}
                    alt={SITE_NAME}
                    loading="eager"
                    decoding="async"
                    style={{ maxWidth: 155, marginTop: 4, marginBottom: 3 }}
                  />
                  {/* 隱藏連結：「G」上面的透明按鈕 */}
                  <Link
                    href="/game"
                    aria-label="估歌遊戲"
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: '57%',
                      width: '13%',
                      bottom: 3,
                      background: 'transparent',
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
                <span className="text-black tracking-[0.2em] navbar-tagline" style={{ fontSize: '1rem', lineHeight: '1.2rem'}}>
                  香港廣東歌結他譜網
                </span>
              </div>
            </Link>
          </div>

          {/* Desktop：頭像/icon，點擊開選單（出譜在選單內） */}
          <div className="hidden md:flex md:relative items-center gap-2" ref={menuRef}>
            <button
              ref={triggerRef}
              onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen) }}
              className="text-black/70 p-1 rounded-full focus:outline-none"
              aria-label={isMenuOpen ? '關閉選單' : '開啟選單'}
            >
              {isAuthenticated && user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || '用戶'}
                  className="rounded-full object-cover w-[42px] h-[42px]"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="flex items-center justify-center rounded-full bg-black/10 w-[42px] h-[42px]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
              )}
            </button>
            {/* Desktop 下拉選單：固定喺 nav bar 下方，唔遮住頂欄 */}
            {isMenuOpen && menuPosition.top > 0 && (
              <div
                className="fixed py-2 w-56 bg-[#FFD700] border border-black/10 rounded-lg shadow-lg z-[9999]"
                style={{ top: menuPosition.top, right: menuPosition.right }}
                onMouseDown={() => { clickedInsideMenuRef.current = true }}
              >
                {isAuthenticated && (
                  <>
                    <Link
                      href="/tabs/new"
                      className="flex items-center gap-2 text-black/70 px-4 py-2 font-medium"
                      onClick={(e) => { e.preventDefault(); router.push('/tabs/new') }}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      出譜
                    </Link>
                    <Link
                      href="/library/drafts"
                      className="flex items-center gap-2 text-black/70 px-4 py-2 font-medium"
                      onClick={(e) => { e.preventDefault(); router.push('/library/drafts') }}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                        <path d="M19.5 7.125L16.875 4.5" />
                        <path d="M18 14.25V18A2.25 2.25 0 0115.75 20.25H6A2.25 2.25 0 013.75 18V8.25A2.25 2.25 0 016 6h3.75" />
                      </svg>
                      草稿
                    </Link>
                    <Link
                      href={`/profile/${user.uid}`}
                      className="flex items-center gap-2 text-black/70 px-4 py-2 font-medium"
                      onClick={(e) => { e.preventDefault(); router.push(`/profile/${user.uid}`) }}
                    >
                      {user?.photoURL ? (
                        <img src={user.photoURL} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
                      ) : (
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                          <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      )}
                      我的主頁
                    </Link>
                  </>
                )}
                {isAdmin && (
                  <>
                    {isAuthenticated && <div className="my-2 mx-4 border-t border-black/10" />}
                    <Link
                      href="/admin/home-settings"
                      className="flex items-center gap-2 text-black/70 px-4 py-2 font-medium"
                      onClick={(e) => { e.preventDefault(); router.push('/admin/home-settings') }}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      首頁設置
                    </Link>
                    <Link
                      href="/admin/playlists"
                      className="flex items-center gap-2 text-black/70 px-4 py-2 font-medium"
                      onClick={(e) => { e.preventDefault(); router.push('/admin/playlists') }}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      管理歌單
                    </Link>
                    <Link
                      href="/admin"
                      className="flex items-center gap-2 text-black/70 px-4 py-2 font-medium"
                      onClick={(e) => { e.preventDefault(); router.push('/admin') }}
                    >
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      管理後台
                    </Link>
                  </>
                )}
                {realIsAdmin && (
                  <NavbarAdminViewAsToggle
                    show={showAdminViewAsButton}
                    onToggle={setShowAdminViewAsButton}
                    itemPadding="px-4"
                  />
                )}
                {isAuthenticated && <div className="my-2 mx-4 border-t border-black/10" />}
                {isAuthenticated ? (
                  <button type="button" onClick={() => { handleLogout(); setIsMenuOpen(false) }} className="flex items-center gap-2 w-full text-left text-black/70 font-medium px-4 py-2">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3l3-3m0 0l-3-3m3 3H9" />
                    </svg>
                    登出
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="flex items-center gap-2 text-black font-bold px-4 py-2"
                    onClick={(e) => { e.preventDefault(); router.push('/login') }}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                    </svg>
                    登入
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Mobile：頭像/選單 icon（出譜在選單內） */}
          <div className="md:hidden flex items-center gap-1">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-black/70 p-1 rounded-full focus:outline-none"
              aria-label={isMenuOpen ? '關閉選單' : '開啟選單'}
            >
              {isMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : isAuthenticated && user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || '用戶'}
                  className="rounded-full object-cover w-[42px] h-[42px]"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="flex items-center justify-center rounded-full bg-black/10 w-[42px] h-[42px]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile：點擊外部關閉 + 遮罩阻擋背景點擊（全屏、阻擋 touch/click 穿透） */}
      {isMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0"
            style={{
              top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 1,
              pointerEvents: 'auto',
              touchAction: 'none',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
              cursor: 'pointer',
              minHeight: '100dvh',
              background: 'transparent',
            }}
            role="button"
            tabIndex={0}
            aria-label="關閉選單"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                e.preventDefault()
                e.stopPropagation()
                setIsMenuOpen(false)
              }
            }}
            onTouchEnd={(e) => {
              // Only close when the overlay itself was tapped; otherwise allow link navigation
              if (e.target === e.currentTarget) {
                e.preventDefault()
                setIsMenuOpen(false)
              }
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Enter' && setIsMenuOpen(false)}
          />
          <div className="md:hidden relative z-[2] bg-[#FFD700] border-t border-yellow-600">
          <div className="px-2 py-2">
            {isAuthenticated && (
              <>
                <Link 
                  href="/tabs/new" 
                  className="flex items-center gap-2 text-black/70 px-3 py-2 font-medium"
                >
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  出譜
                </Link>
                <Link
                  href="/library/drafts"
                  className="flex items-center gap-2 text-black/70 px-3 py-2 font-medium"
                >
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                    <path d="M19.5 7.125L16.875 4.5" />
                    <path d="M18 14.25V18A2.25 2.25 0 0115.75 20.25H6A2.25 2.25 0 013.75 18V8.25A2.25 2.25 0 016 6h3.75" />
                  </svg>
                  草稿
                </Link>
                <Link
                  href={`/profile/${user.uid}`}
                  className="flex items-center gap-2 text-black/70 px-3 py-2 font-medium"
                >
                  {user?.photoURL ? (
                    <img src={user.photoURL} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
                  ) : (
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                  我的主頁
                </Link>
              </>
            )}
            {isAdmin && (
              <>
                {isAuthenticated && <div className="my-2 mx-3 border-t border-yellow-600" />}
                <Link 
                  href="/admin/home-settings" 
                  className="flex items-center gap-2 text-black/70 px-3 py-2 font-medium"
                >
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  首頁設置
                </Link>
                <Link 
                  href="/admin/playlists" 
                  className="flex items-center gap-2 text-black/70 px-3 py-2 font-medium"
                >
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  管理歌單
                </Link>
                <Link 
                  href="/admin" 
                  className="flex items-center gap-2 text-black/70 px-3 py-2 font-medium"
                >
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  管理後台
                </Link>
              </>
            )}
            {realIsAdmin && (
              <NavbarAdminViewAsToggle
                show={showAdminViewAsButton}
                onToggle={setShowAdminViewAsButton}
                itemPadding="px-3"
              />
            )}
            {isAuthenticated && <div className="my-2 mx-3 border-t border-yellow-600" />}
            {isAuthenticated ? (
              <button
                onClick={() => {
                  handleLogout()
                  setIsMenuOpen(false)
                }}
                className="flex items-center gap-2 w-full text-left text-black/70 font-medium px-3 py-2"
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3l3-3m0 0l-3-3m3 3H9" />
                </svg>
                登出
              </button>
            ) : (
              <Link 
                href="/login" 
                className="flex items-center gap-2 text-black font-bold px-3 py-2"
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                </svg>
                登入
              </Link>
            )}
          </div>
          </div>
        </>
      )}
    </nav>
  )
}
