// SEO 配置與工具
import { getArtistSlug } from '@/lib/tabs'

export const siteConfig = {
  name: 'Polygon Guitar',
  description: '香港最大結他譜庫，超過 3000 份結他譜，包括廣東歌、國語歌、英文歌。提供轉調、自動滾動、和弦分析功能。',
  url: 'https://polygon.guitars',
  logo: 'https://polygon.guitars/logo.png',
  twitter: '@polygonguitar',
  facebook: 'polygonguitar',
  /** Default share image when no page-specific image is available */
  defaultOgImage: 'https://polygon.guitars/og-image.jpg',
}

/** Ensure og:image is an absolute URL (required by Facebook/Twitter/LinkedIn). */
export function getAbsoluteOgImage(imageUrl, fallback = siteConfig.defaultOgImage) {
  if (!imageUrl || typeof imageUrl !== 'string') return fallback
  const trimmed = imageUrl.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  const base = siteConfig.url.replace(/\/$/, '')
  return trimmed.startsWith('/') ? `${base}${trimmed}` : fallback
}

const CLOUDINARY_BASE = 'https://res.cloudinary.com/drld2cjpo/image/upload/'
const OG_TRANSFORM = 'c_pad,w_1200,h_630,b_black,f_jpg,q_auto/'

/**
 * Returns a 1200×630 OG-safe image URL.
 * For Cloudinary images: injects pad+black-bg transformation.
 * For external images (Wikipedia, YouTube, etc.): returns as-is.
 */
export function getOgImage(imageUrl, fallback = siteConfig.defaultOgImage) {
  const url = getAbsoluteOgImage(imageUrl, fallback)
  if (url.startsWith(CLOUDINARY_BASE)) {
    return CLOUDINARY_BASE + OG_TRANSFORM + url.slice(CLOUDINARY_BASE.length)
  }
  return url
}

// 生成樂譜頁面標題
export function generateTabTitle(songTitle, artistName) {
  return `${songTitle} - ${artistName} 結他譜 Chords | Polygon Guitar`
}

// 生成樂譜描述
export function generateTabDescription(songTitle, artistName, key) {
  return `${artistName}《${songTitle}》結他譜，原調 ${key}，提供和弦圖、歌詞、轉調功能。免費瀏覽超過 3000 份香港廣東歌、國語歌結他譜。`
}

// 生成歌手頁面標題
export function generateArtistTitle(artistName) {
  return `${artistName} 結他譜 Chords Tabs | Polygon Guitar`
}

// 生成歌手描述
export function generateArtistDescription(artistName, songCount) {
  return `瀏覽 ${artistName} 所有結他譜，共 ${songCount} 首歌曲。包括和弦、歌詞、轉調功能。Polygon Guitar 提供高質素結他譜下載。`
}

// 熱門關鍵詞列表
export const popularKeywords = [
  '結他譜', 'guitar tabs', 'chords', '和弦', '結他', 'guitar',
  '廣東歌結他譜', '粵語歌chords', '國語歌結他譜', '中文歌吉他譜',
  '香港結他譜', 'hk guitar tabs', 'cantopop chords',
  '張學友結他譜', '陳奕迅結他譜', '周杰倫結他譜',
  '轉調', 'capo', '結他教學'
]

// 結他譜 Schema.org 結構化數據
export function generateTabSchema(tab, artist) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicComposition',
    name: tab.title,
    composer: {
      '@type': 'Person',
      name: tab.composer || artist?.name
    },
    lyricist: tab.lyricist ? {
      '@type': 'Person',
      name: tab.lyricist
    } : undefined,
    musician: {
      '@type': 'Person',
      name: artist?.name
    },
    musicalKey: tab.originalKey,
    url: `https://polygon.guitars/tabs/${tab.id}`,
    image: tab.coverImage || tab.albumImage || tab.thumbnail || artist?.photoURL,
    datePublished: tab.createdAt,
    dateModified: tab.updatedAt,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Polygon Guitar',
      url: 'https://polygon.guitars'
    }
  }
}

// 歌手 Schema.org
export function generateArtistSchema(artist, tabs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    name: artist.name,
    url: `https://polygon.guitars/artists/${encodeURIComponent(getArtistSlug(artist) || artist.id || '')}`,
    image: artist.photoURL || artist.wikiPhotoURL,
    description: artist.bio,
    sameAs: artist.wikiUrl,
    track: tabs.map(tab => ({
      '@type': 'MusicRecording',
      name: tab.title,
      url: `https://polygon.guitars/tabs/${tab.id}`
    }))
  }
}

// Breadcrumb Schema
export function generateBreadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  }
}
