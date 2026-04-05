import Head from 'next/head'
import Image from 'next/image'
import Layout from '@/components/Layout'

const PROSE = 'text-white/85 text-[0.95rem] leading-relaxed'

/**
 * 相放 public/support/，檔名同下面 src 一致即可（建議 JPG / WebP）。
 * 改圖：換檔或改呢個陣列嘅 src、alt、caption。
 */
const SUPPORT_PHOTOS = [
  {
    src: '/support/support-1.jpg',
    alt: 'Polygon 支持頁相片 1',
    caption: '',
    priority: true,
  },
  {
    src: '/support/support-2.jpg',
    alt: 'Polygon 支持頁相片 2',
    caption: '',
  },
  {
    src: '/support/support-3.jpg',
    alt: 'Polygon 支持頁相片 3',
    caption: '',
  },
]

function SupportPhotoFigure({ ph, sizes }) {
  if (!ph?.src) return null
  return (
    <figure className="overflow-hidden rounded-lg border border-white/10 bg-[#121212]">
      <div className="relative w-full aspect-[4/3]">
        <Image src={ph.src} alt={ph.alt} fill className="object-cover" sizes={sizes} priority={ph.priority} />
      </div>
      {ph.caption ? (
        <figcaption className="text-white/50 text-xs px-3 py-2">{ph.caption}</figcaption>
      ) : null}
    </figure>
  )
}

export default function SupportPage() {
  return (
    <Layout>
      <Head>
        <title>支持 Polygon | Polygon Guitar</title>
        <meta
          name="description"
          content="Polygon 由三位熱愛廣東歌同結他嘅朋友工餘經營，內容免費公開；若你認同我哋嘅價值，歡迎考慮課金支持營運。"
        />
      </Head>
      <article className="max-w-2xl mx-auto px-6 pb-16 pt-6">
        <h1 className="text-3xl font-bold text-white mb-6">支持 Polygon</h1>

        {SUPPORT_PHOTOS.length > 0 ? (
          <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {SUPPORT_PHOTOS.map((ph) => (
              <SupportPhotoFigure key={ph.src} ph={ph} sizes="(max-width: 640px) 100vw, 33vw" />
            ))}
          </div>
        ) : null}

        <div className={`space-y-5 ${PROSE}`}>
          <p>
            Polygon 而家由 3 個熱愛廣東歌、熱愛結他嘅 40 歲中佬營運，3 位成員都各自有家庭、工作，只可以抽出工餘時間經營
            Polygon。Polygon 所有內容都係免費對外公開，因此有賴各位結他友支持，撐住我哋，我哋唔求有咩報酬，只係希望可以收到繼續營運
            Polygon 網站嘅資金。
          </p>
          <p>
            如果行有餘力，亦認同 Polygon 嘅價值，希望大家會考慮課金支持，令 Polygon 可以繼續營運，繼續同大家一齊彈落去。
          </p>
        </div>
      </article>
    </Layout>
  )
}
