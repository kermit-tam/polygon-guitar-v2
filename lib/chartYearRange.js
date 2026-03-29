/**
 * 樂壇年度 → 顯示用年份區間（與歌手頁 `pages/artists/[id].js` 一致）
 */

export function getChartYearRange(year) {
  const y = typeof year === 'number' ? year : parseInt(year, 10)
  if (Number.isNaN(y)) return '未知年份'
  if (y >= 2021) return '2021-2026'
  if (y >= 2016) return '2016-2020'
  if (y >= 2011) return '2011-2015'
  if (y >= 2006) return '2006-2010'
  if (y >= 2000) return '2000-2005'
  if (y >= 1995) return '1995-1999'
  if (y >= 1990) return '1990-1994'
  if (y >= 1980) return '1980-1989'
  return '1979 或更早'
}

/** 區間顯示順序（新→舊，未知最後） */
export const CHART_YEAR_RANGE_ORDER = [
  '2021-2026',
  '2016-2020',
  '2011-2015',
  '2006-2010',
  '2000-2005',
  '1995-1999',
  '1990-1994',
  '1980-1989',
  '1979 或更早',
  '未知年份'
]

/**
 * @param {Array<{ chartYear?: number }>} songs
 * @returns {Array<[string, typeof songs]>}
 */
export function groupChaksaSongsByYearRange(songs) {
  const groups = {}
  for (const s of songs) {
    const y = s.chartYear
    const range = y != null && !Number.isNaN(Number(y)) ? getChartYearRange(y) : '未知年份'
    if (!groups[range]) groups[range] = []
    groups[range].push(s)
  }
  for (const range of Object.keys(groups)) {
    groups[range].sort((a, b) => {
      const ya = a.chartYear ?? 0
      const yb = b.chartYear ?? 0
      if (yb !== ya) return yb - ya
      return (a.chartPosition || 99) - (b.chartPosition || 99)
    })
  }
  return CHART_YEAR_RANGE_ORDER.filter((r) => groups[r]?.length).map((r) => [r, groups[r]])
}

/**
 * 叱咤歌單：按榜單年份逐年分組（標題即 "2025"、"2024"…）
 * @returns {Array<[string, typeof songs]>}
 */
export function groupChaksaSongsByYear(songs) {
  const groups = {}
  for (const s of songs) {
    const y = s.chartYear
    const key = y != null && !Number.isNaN(Number(y)) ? String(Number(y)) : '未知年份'
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => (a.chartPosition || 99) - (b.chartPosition || 99))
  }
  const numericKeys = Object.keys(groups).filter((k) => k !== '未知年份')
  numericKeys.sort((a, b) => Number(b) - Number(a))
  const order = [...numericKeys]
  if (groups['未知年份']?.length) order.push('未知年份')
  return order.map((k) => [k, groups[k]])
}
