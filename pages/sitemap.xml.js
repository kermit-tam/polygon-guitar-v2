/**
 * Dynamic XML sitemap — served at /sitemap.xml
 * Includes static pages + all artists and tabs from search data cache.
 * Cached at CDN for 1 hour (s-maxage=3600); stale responses served for up to 24h while revalidating.
 * New artists/tabs appear automatically within 1 hour of being published.
 */

const BASE_URL = 'https://polygon.guitars'

const STATIC_PAGES = [
  { url: '/',            priority: '1.0', changefreq: 'daily' },
  { url: '/artists',     priority: '0.9', changefreq: 'daily' },
  { url: '/search',      priority: '0.8', changefreq: 'weekly' },
  { url: '/tab-requests',priority: '0.6', changefreq: 'weekly' },
  { url: '/about',       priority: '0.4', changefreq: 'monthly' },
  { url: '/contact',     priority: '0.3', changefreq: 'monthly' },
  { url: '/partnership', priority: '0.3', changefreq: 'monthly' },
  { url: '/terms',       priority: '0.3', changefreq: 'monthly' },
  { url: '/sitemap',     priority: '0.3', changefreq: 'monthly' },
  { url: '/feedback',    priority: '0.3', changefreq: 'monthly' },
  { url: '/support',     priority: '0.3', changefreq: 'monthly' },
]

function escape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${escape(loc)}</loc>`,
    lastmod   ? `    <lastmod>${lastmod}</lastmod>` : '',
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
    priority   ? `    <priority>${priority}</priority>` : '',
    '  </url>',
  ].filter(Boolean).join('\n')
}

function buildSitemap(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(urlEntry),
    '</urlset>',
  ].join('\n')
}

export async function getServerSideProps({ res }) {
  try {
    const { getSearchDataCached } = await import('@/lib/searchData')
    const { getArtistSlug } = await import('@/lib/tabs')

    const payload = await getSearchDataCached()
    const artists = payload?.artists || []
    const tabs = payload?.tabs || []

    const today = new Date().toISOString().slice(0, 10)

    const entries = [
      // Static pages
      ...STATIC_PAGES.map(({ url, priority, changefreq }) => ({
        loc: `${BASE_URL}${url}`,
        changefreq,
        priority,
      })),

      // Artist pages
      ...artists.map((artist) => {
        const slug = getArtistSlug(artist) || artist.id
        return {
          loc: `${BASE_URL}/artists/${encodeURIComponent(slug)}`,
          changefreq: 'weekly',
          priority: '0.8',
        }
      }),

      // Tab pages
      ...tabs.map((tab) => ({
        loc: `${BASE_URL}/tabs/${tab.id}`,
        changefreq: 'monthly',
        priority: '0.7',
        lastmod: tab.updatedAt
          ? new Date(tab.updatedAt).toISOString().slice(0, 10)
          : today,
      })),
    ]

    const xml = buildSitemap(entries)

    res.setHeader('Content-Type', 'application/xml')
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.write(xml)
    res.end()
  } catch (e) {
    console.error('[sitemap.xml]', e?.message)
    res.setHeader('Content-Type', 'application/xml')
    res.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')
    res.end()
  }

  return { props: {} }
}

export default function SitemapXml() {
  return null
}
