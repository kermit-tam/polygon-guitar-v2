import Head from 'next/head'
import Layout from '@/components/Layout'
import Link from '@/components/Link'

const SECTIONS = [
  {
    title: '主要頁面',
    links: [
      { label: '首頁', href: '/' },
      { label: '搜尋', href: '/search' },
      { label: '歌手列表', href: '/artists' },
    ],
  },
  {
    title: '個人功能',
    links: [
      { label: '收藏庫', href: '/library' },
      { label: '最近瀏覽', href: '/library/recent-tabs' },
      { label: '已收藏歌曲', href: '/library/liked' },
      { label: '求譜', href: '/tab-requests' },
      { label: '個人頁面', href: '/profile' },
    ],
  },
  {
    title: '關於本站',
    links: [
      { label: '關於我們', href: '/about' },
      { label: '聯絡我們', href: '/contact' },
      { label: '合作聯繫', href: '/partnership' },
      { label: '使用條款', href: '/terms' },
      { label: '問題回報', href: '/feedback' },
      { label: '支持 Polygon', href: '/support' },
    ],
  },
]

export default function SitemapPage() {
  return (
    <Layout>
      <Head>
        <title>網站地圖 | Polygon Guitar</title>
        <meta name="description" content="Polygon Guitar 網站地圖" />
      </Head>
      <div className="max-w-2xl mx-auto px-6 pb-16 pt-6">
        <h1 className="text-3xl font-bold text-white mb-10">網站地圖</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
          {SECTIONS.map(({ title, links }) => (
            <section key={title}>
              <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">{title}</h2>
              <ul className="space-y-2">
                {links.map(({ label, href }) => (
                  <li key={href}>
                    <Link href={href} className="text-white/70 hover:text-[#FFD700] text-sm transition-colors">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Layout>
  )
}
