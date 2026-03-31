import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from '@/components/Link'
import { useAuth } from '@/contexts/AuthContext'
import Navbar from './Navbar'
import { navIcons } from '@/lib/navIcons'
import { CONTENT_MAX_WIDTH_CLASS } from '@/lib/layoutConstants'

export default function Layout({ children, fullWidth = false, hideHeader = false }) {
  const router = useRouter()
  const { isAdmin } = useAuth()
  const currentPath = router.pathname
  // 搜尋頁、樂譜詳情頁、歌詞分享頁不顯示頂部 nav
  const isTabDetailPage = currentPath === '/tabs/[id]'
  const isTabSharePage = currentPath === '/tools/tab-share'
  const showHeader = !hideHeader && currentPath !== '/search' && !isTabDetailPage && !isTabSharePage

  // 檢查當前頁面是否激活
  const isActive = (path) => {
    if (path === '/' && currentPath === '/') return true
    if (path !== '/' && currentPath.startsWith(path)) return true
    return false
  }

  // 底部導航項目 - 手機版（5個項目：首頁、搜尋、歌手、收藏、求譜）
  const mobileNavItems = [
    { path: '/', label: '首頁', icon: 'home' },
    { path: '/search', label: '搜尋', icon: 'search' },
    { path: '/artists', label: '歌手', icon: 'artists' },
    { path: '/library', label: '收藏', icon: 'library' },
    { path: '/tab-requests', label: '求譜', icon: 'hand' },
  ]

  // 底部導航項目 - 桌面版（根據是否 Admin 動態生成）
  const getDesktopNavItems = () => {
    const items = [
      { path: '/', label: '首頁', icon: 'home' },
      { path: '/search', label: '搜尋', icon: 'search' },
      { path: '/artists', label: '歌手', icon: 'artists' },
      { path: '/library', label: '收藏', icon: 'library' },
      { path: '/tab-requests', label: '求譜', icon: 'hand' },
      { path: '/tabs/new', label: '出譜', icon: 'upload' },
    ]
    
    // 只有 Admin 先顯示管理項目
    if (isAdmin) {
      items.push(
        { path: '/admin', label: '管理', icon: 'admin' }
      )
    }
    
    return items
  }

  // Icon 組件 — 有自訂圖片顯示圖片；artists/upload/admin 用內聯 SVG；其他冇圖則顯示 label 首字
  const Icon = ({ name, className, iconUrl, label, active }) => {
    const opacityClass = active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'
    // 歌手：人頭+半身（32×32）；未選中線框、點擊/選中時實色
    if (name === 'artists') {
      return (
        <svg className={`${className} shrink-0 text-inherit transition-colors`} fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.1} viewBox="0 0 32.9 32.9">
          <circle cx="16.5" cy="10.82" r="5.02" />
          <path d="M25.2,27.1c0-4.3-3.9-7.8-8.8-7.8s-8.8,3.5-8.8,7.8h17.6Z" />
        </svg>
      )
    }
    // 搜尋：一律用自訂 SVG；未選中線框、選中時中間實心圓
    // 搜尋：選中前用自訂放大鏡（單 path 實心）；選中後用圓+柄+中間實心圓
    if (name === 'search') {
      return (
        <svg className={`${className} shrink-0 text-inherit transition-colors`} viewBox="0 0 32.9 32.9">
          {active ? (
            <>
              <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} fillRule="evenodd" d="M19.8,8.8c-3-3-8-3-11,0-3,3-3,8,0,11,3,3,8,3,11,0,3-3,3-8,0-11Z" />
              <line x1="19.9" y1="19.9" x2="26.4" y2="26.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
              <circle cx="14.3" cy="14.3" r="5.11" fill="currentColor" stroke="none" />
            </>
          ) : (
            <path fill="currentColor" stroke="none" d="M27.21,25.59l-5.85-5.85c2.64-3.47,2.39-8.61-.75-11.75-1.67-1.67-3.91-2.59-6.31-2.59s-4.65.92-6.31,2.59c-3.42,3.42-3.42,9.2,0,12.63,1.67,1.67,3.91,2.59,6.31,2.59,2.01,0,3.9-.65,5.44-1.83l5.85,5.85c.22.22.52.34.81.34s.59-.11.81-.34c.45-.45.45-1.18,0-1.63ZM9.61,18.99c-2.54-2.54-2.54-6.83,0-9.37,1.23-1.23,2.9-1.91,4.69-1.91s3.45.68,4.69,1.91c2.54,2.54,2.54,6.83,0,9.37-1.23,1.23-2.9,1.91-4.69,1.91s-3.45-.68-4.69-1.91Z" />
          )}
        </svg>
      )
    }
    // 收藏：一律用自訂 SVG；選中前線框（polygon+兩線）、選中後 polygon 實心；向上移 0.2px
    if (name === 'library') {
      const strokeProps = { stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2 }
      return (
        <svg className={`${className} shrink-0 text-inherit transition-colors -translate-y-[0.2px]`} viewBox="0 0 32.9 32.9">
          <polygon points="23.69 27.1 9.21 27.1 8.04 14.73 24.86 14.73 23.69 27.1" fill={active ? 'currentColor' : 'none'} {...strokeProps} />
          <line x1="9.1" y1="10.71" x2="23.8" y2="10.71" {...strokeProps} />
          <line x1="10.37" y1="6.9" x2="22.53" y2="6.9" {...strokeProps} />
        </svg>
      )
    }
    // 求譜：選中時結他實心 SVG（自訂），未選中時結他線框 SVG（維持原樣）
    if (name === 'hand') {
      return (
        <svg className={`${className} shrink-0 text-inherit transition-colors`} viewBox="0 0 634.7 905.9" xmlns="http://www.w3.org/2000/svg">
          {active ? (
            <path fill="currentColor" d="M542.6,151c-48.47,0-87.9,39.43-87.9,87.9v34.15c-7.9-2.34-16.25-3.6-24.9-3.6-21.45,0-41.12,7.73-56.4,20.54-15.28-12.81-34.95-20.54-56.4-20.54-8.65,0-17,1.26-24.9,3.6v-123.75c0-48.47-39.43-87.9-87.9-87.9s-87.9,39.43-87.9,87.9v166.6c-7.9-2.34-16.25-3.6-24.9-3.6-48.47,0-87.9,39.43-87.9,87.9v173.4c0,46.83,7.3,90.77,21.69,130.59,14.43,39.92,35.7,74.98,63.22,104.2,27.86,29.58,61.48,52.5,99.93,68.13,38.99,15.84,82.27,23.88,128.65,23.88s89.67-8.03,128.65-23.88c38.45-15.63,72.07-38.55,99.93-68.13,27.52-29.22,48.79-64.28,63.22-104.2,14.4-39.83,21.69-83.76,21.69-130.59V238.9c0-48.47-39.43-87.9-87.9-87.9ZM429.8,332.45c13.73,0,24.9,11.17,24.9,24.9v87.44c0,13.73-11.17,24.9-24.9,24.9s-24.9-11.17-24.9-24.9v-87.44c0-13.73,11.17-24.9,24.9-24.9ZM317,332.45c13.73,0,24.9,11.17,24.9,24.9v87.44c0,13.73-11.17,24.9-24.9,24.9s-24.9-11.17-24.9-24.9v-87.44c0-13.73,11.17-24.9,24.9-24.9ZM567.5,573.6c0,160.25-98.33,263.8-250.5,263.8s-250.5-103.55-250.5-263.8v-173.4c0-13.73,11.17-24.9,24.9-24.9s24.03,10.33,24.85,23.33c-.03.55-.04,1.11-.04,1.67v126.2c0,17.4,14.1,31.5,31.5,31.5,27.27,0,46.89,6.39,59.98,19.53,24.42,24.51,24.24,71.07,24.14,98.88,0,1.88-.01,3.68-.01,5.39,0,17.4,14.1,31.5,31.5,31.5s31.5-14.1,31.5-31.5c0-1.63,0-3.35.01-5.15.13-35.13.38-100.54-42.5-143.59-18.87-18.94-43.37-30.88-73.11-35.67v-76.51c.06-.79.1-1.59.1-2.39V149.3c0-13.73,11.17-24.9,24.9-24.9s24.9,11.17,24.9,24.9v295.49c0,48.47,39.43,87.9,87.9,87.9,21.45,0,41.12-7.73,56.4-20.54,15.28,12.81,34.95,20.54,56.4,20.54,48.47,0,87.9-39.43,87.9-87.9v-205.89c0-13.73,11.17-24.9,24.9-24.9s24.9,11.17,24.9,24.9v334.7Z" />
          ) : (
            <path fill="currentColor" d="M543,151c-8.83,0-17.36,1.32-25.4,3.77v-32.57c0-48.19-39.21-87.4-87.4-87.4-14.64,0-28.45,3.63-40.59,10.02-15.75-23.05-42.24-38.22-72.21-38.22-38.64,0-71.49,25.2-83.01,60.03-9.3-3.38-19.34-5.23-29.79-5.23-48.19,0-87.4,39.21-87.4,87.4v167.27c-8.04-2.45-16.57-3.77-25.4-3.77-48.19,0-87.4,39.21-87.4,87.4v173.4c0,46.77,7.29,90.65,21.67,130.42,14.41,39.86,35.64,74.86,63.12,104.03,27.81,29.53,61.37,52.41,99.75,68.01,38.93,15.82,82.15,23.84,128.46,23.84s89.54-8.02,128.47-23.84c38.38-15.6,71.94-38.48,99.75-68.01,27.48-29.17,48.71-64.17,63.12-104.03,14.38-39.77,21.67-83.65,21.67-130.42V238.4c0-48.19-39.21-87.4-87.4-87.4ZM568.4,573.1c0,160.56-98.52,264.3-251,264.3s-251-103.74-251-264.3v-173.4c0-14.01,11.39-25.4,25.4-25.4s24.53,10.55,25.35,23.83c-.03.55-.05,1.11-.05,1.67v126.2c0,17.12,13.88,31,31,31,27.41,0,47.14,6.44,60.33,19.68,24.57,24.66,24.39,71.34,24.28,99.24,0,1.88-.01,3.67-.01,5.38,0,17.12,13.88,31,31,31s31-13.88,31-31c0-1.64,0-3.35.01-5.15.13-35.06.38-100.33-42.36-143.23-18.88-18.95-43.44-30.87-73.26-35.59v-76.95c.06-.79.1-1.58.1-2.38V148.8c0-14.01,11.39-25.4,25.4-25.4s25.4,11.39,25.4,25.4v245.7c0,17.12,13.88,31,31,31s31-13.88,31-31V94c0-14.01,11.39-25.4,25.4-25.4s25.4,11.39,25.4,25.4v295.3c0,17.12,13.88,31,31,31s31-13.88,31-31V122.2c0-14.01,11.39-25.4,25.4-25.4s25.4,11.39,25.4,25.4v295.8c0,17.12,13.88,31,31,31s31-13.88,31-31v-179.6c0-14.01,11.39-25.4,25.4-25.4s25.4,11.39,25.4,25.4v334.7Z" />
          )}
        </svg>
      )
    }
    // 首頁：一律用自訂 SVG；選中前兩 path（屋+橫線）、選中後單 path（屋實心）
    if (name === 'home') {
      return (
        <svg className={`${className} shrink-0 text-inherit transition-colors`} viewBox="0 0 32.9 32.9">
          {active ? (
            <path fill="currentColor" stroke="none" d="M28.07,15.98l-10.85-10.62c-.05-.05-.11-.07-.17-.11-.06-.04-.12-.09-.18-.12-.07-.03-.14-.03-.21-.04-.07-.01-.14-.04-.21-.04s-.14.02-.21.04c-.07.01-.14.02-.21.04-.07.03-.12.08-.18.12-.06.04-.12.06-.17.11L4.83,15.98c-.43.42-.44,1.12-.02,1.56.22.22.5.33.79.33s.56-.1.77-.31l.75-.73v10.18c0,.61.49,1.1,1.1,1.1h16.46c.61,0,1.1-.49,1.1-1.1v-10.18l.75.73c.21.21.49.31.77.31s.57-.11.79-.33c.42-.43.42-1.13-.02-1.56ZM20.99,22.63c-1.75.93-3.43,1.12-4.54,1.12-2,0-3.57-.61-4.54-1.12-.49-.26-.67-.86-.41-1.35.26-.49.87-.67,1.35-.41.76.41,2,.89,3.6.89.88,0,2.21-.15,3.6-.89.49-.26,1.09-.07,1.35.42s.07,1.09-.42,1.35Z" />
          ) : (
            <>
              <path fill="currentColor" stroke="none" d="M28.07,15.99l-10.85-10.62c-.05-.05-.12-.08-.18-.12-.06-.04-.11-.09-.17-.11-.07-.03-.14-.03-.22-.04-.07-.01-.13-.04-.2-.04s-.13.02-.2.04c-.07.01-.15.02-.22.04-.06.03-.11.07-.17.11-.06.04-.13.07-.19.12L4.83,15.99c-.43.42-.44,1.12-.02,1.56.22.22.5.33.79.33s.56-.1.77-.31l.75-.73v10.18c0,.61.49,1.1,1.1,1.1h16.46c.61,0,1.1-.49,1.1-1.1v-10.18l.75.73c.21.21.49.31.77.31s.57-.11.79-.33c.42-.43.42-1.13-.02-1.56ZM23.58,25.91h-14.26v-11.23l7.13-6.98,7.13,6.98v11.23Z" />
              <path fill="currentColor" stroke="none" d="M12.6,21.66c-.61,0-1.1.49-1.1,1.1s.49,1.1,1.1,1.1h7.69c.61,0,1.1-.49,1.1-1.1s-.49-1.1-1.1-1.1h-7.69Z" />
            </>
          )}
        </svg>
      )
    }
    if (iconUrl) {
      return <img src={iconUrl} alt="" className={`${className} object-contain transition-opacity ${opacityClass}`} />
    }
    // 出譜：文件+向上箭嘴（27×27、幼 stroke，顏色跟父層 text-black / text-black/60 統一）
    if (name === 'upload') {
      return (
        <svg className="w-[27px] h-[27px] shrink-0 text-inherit transition-colors" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} viewBox="0 0 24 24">
          <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
    }
    // 管理：齒輪（27×27、幼 stroke，顏色跟父層統一）
    if (name === 'admin') {
      return (
        <svg className="w-[27px] h-[27px] shrink-0 text-inherit transition-colors" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} viewBox="0 0 24 24">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    }
    return (
      <span className={`${className} flex items-center justify-center text-base font-bold shrink-0 ${opacityClass}`}>
        {label?.[0] || ''}
      </span>
    )
  }

  const desktopNavItems = getDesktopNavItems()

  // 離開搜尋頁時移除 body class（同步隱藏用）
  useEffect(() => {
    if (currentPath !== '/search' && typeof document !== 'undefined') {
      document.body.classList.remove('pg-hide-top-nav')
    }
  }, [currentPath])

  const FOOTER_LINKS = [
    { label: '關於我們', href: '/about' },
    { label: '聯絡我們', href: '/contact' },
    { label: '合作聯繫', href: '/partnership' },
    { label: '使用條款', href: '/terms' },
    { label: '網站地圖', href: '/sitemap' },
    { label: '問題回報', href: '/feedback' },
    { label: '支持 Polygon', href: '/support' },
  ]

  return (
    <div className={`${showHeader ? 'bg-black' : 'bg-transparent'} text-white min-h-screen min-h-[calc(100vh+1px)]`}>
      <div className={`${CONTENT_MAX_WIDTH_CLASS} mx-auto`}>
        <div className="pg-top-nav-wrapper">{showHeader && <Navbar />}</div>
        <main
          className={fullWidth
            ? (showHeader ? 'pb-16 md:pb-0' : 'pb-16 md:pb-0')
            : (showHeader ? 'pb-24' : 'pb-24')
          }
          style={showHeader ? { paddingTop: fullWidth ? 'calc(4.4rem + env(safe-area-inset-top, 0px))' : 'calc(4.4rem + 10px + env(safe-area-inset-top, 0px))' } : {}}
        >
          {children}
        </main>
      </div>

      {showHeader && (
        <footer className="bg-black pb-[150px] md:pb- pt-8 px-6">
          <div className="max-w-4xl mx-auto flex flex-col items-center gap-5">
            {/* Social icons */}
            <div className="flex items-center gap-4">
              <a href="https://www.instagram.com/polygon.guitars/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-white/50 hover:text-white transition-colors">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <circle cx="12" cy="12" r="4.5" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a href="https://www.facebook.com/polygonguitar" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="text-white/50 hover:text-white transition-colors">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                </svg>
              </a>
            </div>

            {/* Copyright */}
            <p className="text-white/50 text-xs tracking-wider">
              © {new Date().getFullYear()} POLYGON GUITARS
            </p>

            {/* Links */}
            <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
              {FOOTER_LINKS.map(({ label, href }) => (
                <Link key={href} href={href} className="text-white/50 hover:text-white text-xs transition-colors">
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </footer>
      )}
      
      {/* 手機版底部導航 - 黃底黑字設計 */}
      {/* z-[110]：高於和弦圖 bottom sheet 遮罩 (105)，唔會被 dim */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#FFD700] z-[110] md:hidden" style={{ paddingBottom: 'min(env(safe-area-inset-bottom, 0px), 30px)' }}>
        <div className="flex justify-around items-center h-16 max-w-md mx-auto px-2">
          {mobileNavItems.map((item) => (
            <Link 
              key={item.path}
              href={item.path}
              prefetch={true}
              onClick={() => {
                if (item.path === '/search') {
                  try { sessionStorage.setItem('pg_focus_search', '1') } catch (_) {}
                  document.body.classList.add('pg-hide-top-nav')
                }
              }}
              className={`flex flex-col items-center justify-center min-h-[44px] min-w-[44px] ${
                isActive(item.path) ? 'text-black font-bold' : 'text-black/60 active:text-black'
              }`}
            >
              <div className="pointer-events-none">
                <Icon 
                  name={item.icon} 
                  iconUrl={navIcons[item.icon]}
                  label={item.label}
                  active={isActive(item.path)}
                  className={item.icon === 'hand' ? 'w-[25px] h-[25px] translate-y-[2.8px]' : 'w-[32px] h-[32px]'}
                />
              </div>
              <span className={`text-xs font-medium pointer-events-none ${item.icon === 'hand' ? 'mt-2' : 'mt-0.5'}`}>{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {/* 桌面版底部導航 - 黃底黑字設計 */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#FFD700] z-[110] hidden md:block">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
            {desktopNavItems.map((item) => (
                <Link 
                  key={item.path}
                  href={item.path}
                  prefetch={true}
                  onClick={() => {
                    if (item.path === '/search') {
                      try { sessionStorage.setItem('pg_focus_search', '1') } catch (_) {}
                      document.body.classList.add('pg-hide-top-nav')
                    }
                  }}
                  className={`flex flex-col items-center px-3 py-1 ${
                    isActive(item.path) ? 'text-black font-bold' : 'text-black/60 hover:text-black'
                  }`}
                >
                  <div className={`flex items-center justify-center shrink-0 pointer-events-none ${item.icon === 'hand' ? 'h-[25px] w-[25px]' : 'h-8 w-8'}`}>
                    <Icon 
                      name={item.icon} 
                      iconUrl={navIcons[item.icon]}
                      label={item.label}
                      active={isActive(item.path)}
                      className={item.icon === 'hand' ? 'w-[25px] h-[25px] translate-y-[2.8px]' : 'w-[32px] h-[32px]'}
                    />
                  </div>
                  <span className={`text-xs font-medium pointer-events-none ${item.icon === 'hand' ? 'mt-2' : 'mt-0.5'} ${(item.label === '出譜' || item.label === '管理') ? 'md:-translate-y-[0.5px]' : ''}`}>{item.label}</span>
                </Link>
            ))}
          </div>
        </div>
      </nav>
    </div>
  )
}
