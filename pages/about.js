import Head from 'next/head'
import Image from 'next/image'
import Layout from '@/components/Layout'

/** 相集：圖放 public/about/；[0] 喺全文最前；[1..] 喺頭三段之後、後半部文字之前。 */
const ABOUT_PHOTOS = [
  {
    src: '/about/20-Oct-2012-Polygon-Musicstair.jpg',
    alt: 'Polygon MusicStair，2012年10月20日',
    caption: 'MusicStair · 20 Oct 2012',
  },
  {
    src: '/about/28-Dec-2012-Polygon-Musicstair.jpg',
    alt: 'Polygon MusicStair，2012年12月28日',
    caption: 'MusicStair · 28 Dec 2012',
  },
  {
    src: '/about/13-Apr-2013-Polygon-Musicstair.jpg',
    alt: 'Polygon MusicStair，2013年4月13日',
    caption: 'MusicStair · 13 Apr 2013',
  },
  {
    src: '/about/28-Oct-2013-Polygon-Musicstair.jpg',
    alt: 'Polygon MusicStair，2013年10月28日',
    caption: 'MusicStair · 28 Oct 2013',
  },
  {
    src: '/about/2-Nov-2013-Polygon-Musicstair.jpg',
    alt: 'Polygon MusicStair，2013年11月2日',
    caption: 'MusicStair · 2 Nov 2013',
  },
]

const PHOTO_BEFORE_ALL_TEXT = ABOUT_PHOTOS[0]
const PHOTOS_AFTER_FIRST_SECTION = ABOUT_PHOTOS.slice(1)

const PROSE = 'text-white/85 text-[0.95rem] leading-relaxed'

function AboutPhotoFigure({ ph, sizes }) {
  if (!ph) return null
  return (
    <figure className="overflow-hidden rounded-lg border border-white/10 bg-[#121212]">
      <div className="relative w-full aspect-[4/3]">
        <Image
          src={ph.src}
          alt={ph.alt}
          fill
          className="object-cover"
          sizes={sizes}
        />
      </div>
      {ph.caption ? (
        <figcaption className="text-white/50 text-xs px-3 py-2">{ph.caption}</figcaption>
      ) : null}
    </figure>
  )
}

export default function AboutPage() {
  return (
    <Layout>
      <Head>
        <title>關於我們 | Polygon Guitar</title>
        <meta
          name="description"
          content="Polygon Guitar 由 2011 年 Blogger 結他譜收藏館起步，PolyU 朋友與結他友同行，免費公開結他譜。"
        />
      </Head>
      <article className="max-w-2xl mx-auto px-6 pb-16 pt-6">
        <h1 className="text-3xl font-bold text-white mb-6">關於我們</h1>

        {PHOTO_BEFORE_ALL_TEXT ? (
          <div className="mb-8">
            <AboutPhotoFigure ph={PHOTO_BEFORE_ALL_TEXT} sizes="(max-width: 672px) 100vw, 42rem" />
          </div>
        ) : null}

        <div className={`space-y-5 ${PROSE}`}>
          <p>
            2011年幾個年少無知嘅小伙子，上載第一份譜開始，建立自己嘅「結他譜」收藏館，從此對外開放。
          </p>
          <p>
            仿效我哋由細睇到大嘅歷史網站「結他友」，因為嗰時好多新歌(尤其係廣東歌)都無，我哋就自己執譜放上blogger，好似儲閃卡咁，儲咗大約500份，原來不知不覺吸引咗好多結他友。
          </p>
          <p>
            Polygon成員都係喺PolyU認識，但就聚集咗好多大學以外嘅朋友。Polygon最初只係大學入面嘅一個3人組合，喺校內舉辦過幾次for
            fun嘅歌唱比賽；畢業之後我哋開始搞活動
            -「MusicStair」，同Polygon嘅結他網友見面，唔單只有鍾意彈結他唱歌嘅人，仲有鍾意聽歌嘅人，我哋定期相約喺PolyU嘅大樓梯，唱歌busking；我哋亦有試過情人節、萬聖節，移師到尖東海旁唱歌，燃燒咗好多個青春晚上。
          </p>
        </div>

        {PHOTOS_AFTER_FIRST_SECTION.length > 0 ? (
          <div className="my-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PHOTOS_AFTER_FIRST_SECTION.map((ph) => (
              <AboutPhotoFigure key={ph.src} ph={ph} sizes="(max-width: 640px) 100vw, 50vw" />
            ))}
          </div>
        ) : null}

        <div className={`space-y-5 ${PROSE}`}>
          <p>
            真嘅，唔係個個鍾意結他都做到結他手，青春過後Polygon各成員都各散東西，又越過高山又越過谷。2026年Polygon成員又再重聚，想念結他之餘，更想念以往因為一支結他、一份譜而認識嘅每個人，我哋決定不如重新嚟過，反正打開個舊鐵盒，我哋仲有好多結他譜喺度！Polygon嘅結他譜從來都係免費公開，或者每份譜嘅回報，就係令我哋認識更多朋友！
          </p>
          <p>
            你實聽人講過㗎喇：
            <br />
            「譜嚟講」，我哋唔夠原創作曲人準確，但求user-friendly，易上手，令你更加容易愛上結他。所謂雅俗共賞，結他朋友Gathering，不求滿漢全席或者法國Fine
            Dining，只求鑊氣小炒飲啤酒！當然，我哋都歡迎每位結他友，自帶最好嘅Chord進場，幫助呢一個大家都有份嘅收藏館，修復不完美。
          </p>
          <p>
            雖然我哋都有成員係教結他，但係我哋想你知道：Polygon唔係你嘅結他導師，而你嘅結他朋友，人同結他嘅交流應該係咁。
          </p>
          <p>
            人大咗，未必再好似以前咁多朋友，但喺你寂寞emo嘅時候，至少都仲有一支結他、一份譜。對我哋鍾意結他嘅人嚟講，人生「有得彈」，先係冇得彈。
          </p>
        </div>

        <footer className="mt-10 text-right text-white/55 text-sm leading-relaxed">
          <p className="font-medium text-white/70">Polygon</p>
          <p>1/4/2026</p>
        </footer>
      </article>
    </Layout>
  )
}
