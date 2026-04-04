/**
 * Dynamic XML sitemap — /api/sitemap.xml
 * Uses the search data cache (1 Firestore read) instead of querying collections directly.
 * CDN-cached for 1 hour; new content appears automatically within ~1 hour of publishing.
 */

const SITE_URL = 'https://polygon.guitars'

const STATIC_PAGES = [
  { url: '/',             changefreq: 'daily',   priority: '1.0' },
  { url: '/artists',      changefreq: 'daily',   priority: '0.9' },
  { url: '/search',       changefreq: 'weekly',  priority: '0.8' },
  { url: '/tab-requests', changefreq: 'weekly',  priority: '0.6' },
  { url: '/about',        changefreq: 'monthly', priority: '0.4' },
  { url: '/contact',      changefreq: 'monthly', priority: '0.3' },
  { url: '/partnership',  changefreq: 'monthly', priority: '0.3' },
  { url: '/terms',        changefreq: 'monthly', priority: '0.3' },
  { url: '/sitemap',      changefreq: 'monthly', priority: '0.3' },
  { url: '/feedback',     changefreq: 'monthly', priority: '0.3' },
  { url: '/support',      changefreq: 'monthly', priority: '0.3' },
]

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toIsoDate(val) {
  if (!val) return null
  try {
    const d = val instanceof Date ? val : new Date(val)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod    ? `    <lastmod>${lastmod}</lastmod>` : '',
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
    priority   ? `    <priority>${priority}</priority>` : '',
    '  </url>',
  ].filter(Boolean).join('\n')
}

export default async function handler(req, res) {
  try {
    const { getSearchDataCached } = await import('@/lib/searchData')
    const { getArtistSlug } = await import('@/lib/tabs')

    // 1 Firestore read — all artists, tabs, and playlists are bundled in this cache doc
    const payload = await getSearchDataCached()
    const artists   = payload?.artists   || []
    const tabs      = payload?.tabs      || []
    const playlists = payload?.playlists || []

    const entries = [
      // Static pages
      ...STATIC_PAGES.map(({ url, changefreq, priority }) => ({
        loc: `${SITE_URL}${url}`,
        changefreq,
        priority,
      })),

      // Artist pages
      ...artists.map((artist) => {
        const slug = getArtistSlug(artist) || artist.id
        return {
          loc: `${SITE_URL}/artists/${encodeURIComponent(slug)}`,
          lastmod: toIsoDate(artist.updatedAt),
          changefreq: 'weekly',
          priority: '0.8',
        }
      }),

      // Tab pages
      ...tabs.map((tab) => ({
        loc: `${SITE_URL}/tabs/${encodeURIComponent(tab.slug ?? tab.id)}`,
        lastmod: toIsoDate(tab.updatedAt || tab.createdAt),
        changefreq: 'monthly',
        priority: '0.7',
      })),

      // Playlist pages
      ...playlists
        .filter((p) => p.isActive !== false)
        .map((playlist) => ({
          loc: `${SITE_URL}/playlist/${playlist.id}`,
          lastmod: toIsoDate(playlist.updatedAt),
          changefreq: 'weekly',
          priority: '0.6',
        })),
    ]

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries.map(urlEntry),
      '</urlset>',
    ].join('\n')

    res.setHeader('Content-Type', 'application/xml')
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).send(xml)
  } catch (e) {
    console.error('[sitemap.xml]', e?.message)

    // Minimal fallback — static pages only
    const fallback = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...STATIC_PAGES.map(({ url, changefreq, priority }) =>
        urlEntry({ loc: `${SITE_URL}${url}`, changefreq, priority })
      ),
      '</urlset>',
    ].join('\n')

    res.setHeader('Content-Type', 'application/xml')
    res.setHeader('Cache-Control', 'public, s-maxage=60')
    return res.status(200).send(fallback)
  }
}
