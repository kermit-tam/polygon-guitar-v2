/**
 * 從中文維基抓取叱咤頒獎禮「至尊歌曲／專業推介十大」資料。
 *
 * Markdown（預設）：
 *   node scripts/fetch-chaksa-wiki-top10.js > scripts/chaksa-wiki-1989-2015-preview.md
 *
 * CSV（Google 試算表：檔案 → 匯入 → 上載 → 分隔符號「逗號」、編碼 UTF-8）：
 *   node scripts/fetch-chaksa-wiki-top10.js --csv > scripts/chaksa-wiki-1989-2015.csv
 *
 * 需網絡；請遵守維基機械人方針，唔好短時間瘋狂重跑。
 */
const https = require('https')
const querystring = require('querystring')
const cheerio = require('cheerio')

const UA = 'PolygonGuitarChaksaRef/1.0 (https://polygon.guitars; contact: dev) node'

function wikiGet(title) {
  const q = querystring.stringify({
    action: 'parse',
    page: title,
    prop: 'text',
    format: 'json',
    formatversion: '2'
  })
  return new Promise((resolve, reject) => {
    https
      .get('https://zh.wikipedia.org/w/api.php?' + q, { headers: { 'User-Agent': UA } }, (r) => {
        let b = ''
        r.on('data', (c) => (b += c))
        r.on('end', () => {
          try {
            resolve(JSON.parse(b))
          } catch (e) {
            reject(new Error(b.slice(0, 200)))
          }
        })
      })
      .on('error', reject)
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function cleanArtistCol(s) {
  if (!s) return s
  let t = s.replace(/\[註\s*\d+\]/g, '').trim()
  const cut = t.search(/\s*作曲[：:]/)
  if (cut !== -1) t = t.slice(0, cut).trim()
  return t
}

function stripBookTitle(s) {
  if (!s) return s
  return s.replace(/^[《「『]+/, '').replace(/[》」』]+$/, '').trim()
}

function cellText($, el) {
  return $(el)
    .text()
    .replace(/\s+/g, ' ')
    .trim()
}

/** 搵「歌曲／歌手」三欄 wikitable（唔依賴章節 DOM，因維基用 mw-heading 包 h2/h3） */
function extractTop10Table(html) {
  const $ = cheerio.load(html)
  let best = []
  $('table.wikitable').each((_, tbl) => {
    const rows = []
    $(tbl)
      .find('tr')
      .each((_, tr) => {
        const cells = $(tr)
          .find('th,td')
          .map((_, c) => cellText($, c))
          .get()
        rows.push(cells)
      })
    if (rows.length < 4) return
    const head = (rows[0] || []).join('')
    if (!/歌曲/.test(head) || !/(歌手|主唱)/.test(head)) return
    const data = []
    for (let j = 1; j < rows.length; j++) {
      const r = rows[j]
      if (r.length < 3) continue
      const rank = r[0]
      const song = r[1]
      const artist = r[2]
      if (!song || !artist || /^歌曲$/.test(song)) continue
      if (
        /至尊|^第[一二三四五六七八九十百\d]+位/.test(rank) ||
        /^\s*第\d+位\s*$/.test(rank) ||
        /^\d{1,2}$/.test(rank)
      ) {
        data.push({ rank, song, artist })
      }
    }
    if (data.length > best.length) best = data
  })
  return best
}

function extractSupreme(html) {
  const $ = cheerio.load(html)
  let out = null
  $('h2, h3, h4').each((_, el) => {
    const t = $(el).text().replace(/\[edit\]/gi, '').trim()
    if (!/至尊歌曲大獎/.test(t) || out) return
    let sib = $(el).parent().next().length ? $(el).parent().next() : $(el).next()
    for (let k = 0; k < 12 && sib.length; k++) {
      const tag = (sib[0].tagName || '').toLowerCase()
      if (/^h[1-6]$/.test(tag)) break
      if (tag === 'ul' || tag === 'ol') {
        const songBold = sib.find('li > b').first().text().replace(/\s+/g, ' ').trim()
        const mainLi = sib
          .find('li li')
          .filter((_, x) => /主唱/.test($(x).text()))
          .first()
        if (songBold && mainLi.length) {
          let art = mainLi.find('a').first().text().trim()
          if (!art) {
            art = mainLi
              .text()
              .replace(/^主唱[、，、\s]*/i, '')
              .replace(/\s+/g, ' ')
              .trim()
            const colon = art.indexOf('：') >= 0 ? art.indexOf('：') : art.indexOf(':')
            if (colon >= 0) art = art.slice(colon + 1).trim()
          }
          out = { song: stripBookTitle(songBold), artist: cleanArtistCol(art) }
          break
        }
        const li = sib.find('li').first().text().replace(/\s+/g, ' ').trim()
        let m = li.match(/^(.+)（([^）]+)）$/)
        if (m) {
          out = { song: stripBookTitle(m[1].trim()), artist: m[2].trim() }
          break
        }
        m = li.match(/[《「]([^」》]+)[」》]\s*[（(]([^）)]+)[）)]/)
        if (m) {
          out = { song: stripBookTitle(m[1]), artist: m[2] }
          break
        }
        m = li.match(/[《「]([^」》]+)[」》]\s*(.+)$/)
        if (m) {
          out = { song: stripBookTitle(m[1]), artist: cleanArtistCol(m[2]).slice(0, 80) }
          break
        }
        m = li.match(/^(.+?)\s*[-－—]\s*(.+)$/)
        if (m)
          out = {
            song: stripBookTitle(m[1].replace(/^[《「]/, '').replace(/[」》]$/, '')),
            artist: cleanArtistCol(m[2]).slice(0, 80)
          }
        break
      }
      if (tag === 'p' || tag === 'div') {
        const txt = sib.text().replace(/\s+/g, ' ').trim()
        const m = txt.match(/[《「]([^」》]+)[」》]\s*[（(]([^）)]+)[）)]/)
        if (m && txt.length < 200) {
          out = { song: m[1], artist: m[2] }
          break
        }
      }
      sib = sib.next()
    }
  })
  return out
}

function mergeSupremeTopRow(rows, supreme) {
  if (!supreme || !rows.length) return rows
  const hasSup = rows.some((r) => /至尊/.test(r.rank))
  if (hasSup) return rows
  return [{ rank: '至尊歌', song: supreme.song, artist: supreme.artist }, ...rows]
}

const CN_POS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** 回傳 1–10 字串，方便試算表 sort；未知則空字串 */
function rankLabelToChartPosition(rankLabel) {
  if (!rankLabel) return ''
  if (/至尊/.test(rankLabel)) return '1'
  if (/未能從頁面抓到/.test(rankLabel)) return ''
  if (/未附十大表格/.test(rankLabel)) return '1'
  const m = rankLabel.match(/第([一二三四五六七八九十])位/)
  if (m && CN_POS[m[1]] != null) return String(CN_POS[m[1]])
  const m2 = rankLabel.match(/第(\d{1,2})位/)
  if (m2) return m2[1]
  if (/^\d{1,2}$/.test(rankLabel.trim())) return rankLabel.trim()
  return ''
}

function escapeCsv(value) {
  if (value == null || value === '') return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function fetchAll() {
  const earlyYears = []
  for (let y = 1989; y <= 1994; y++) {
    const title = `${y}年度叱咤樂壇流行榜頒獎典禮得獎名單`
    try {
      const j = await wikiGet(title)
      if (j.error) {
        earlyYears.push({ year: y, error: j.error.info || JSON.stringify(j.error) })
      } else {
        const html = j.parse?.text || ''
        const supreme = extractSupreme(html)
        earlyYears.push({ year: y, supreme })
      }
    } catch (e) {
      earlyYears.push({ year: y, error: String(e.message || e) })
    }
    await sleep(350)
  }

  const top10Years = []
  for (let y = 1995; y <= 2015; y++) {
    const title = `${y}年度叱咤樂壇流行榜頒獎典禮得獎名單`
    try {
      const j = await wikiGet(title)
      if (j.error) {
        top10Years.push({ year: y, error: j.error.info })
        await sleep(350)
        continue
      }
      const html = j.parse?.text || ''
      const supreme = extractSupreme(html)
      const rawTable = extractTop10Table(html)
      let rows = mergeSupremeTopRow(rawTable, supreme)
      if (!rows.length && supreme) {
        rows = [
          {
            rank: '（維基此屆未附十大表格）',
            song: supreme.song,
            artist: supreme.artist
          }
        ]
      }
      const hasTop10Heading = html.includes('叱咤十大') && html.includes('專業推介')
      const wikiNote =
        rawTable.length === 0 && !hasTop10Heading
          ? '中文維基此頁未見「專業推介…叱咤十大」區塊；若只有至尊大獎會顯示於下表。'
          : null
      top10Years.push({ year: y, rows, wikiNote })
    } catch (e) {
      top10Years.push({ year: y, error: String(e.message || e) })
    }
    await sleep(350)
  }

  return { earlyYears, top10Years }
}

function printMarkdown({ earlyYears, top10Years }) {
  console.log('## 1989–1994（維基：叱咤樂壇至尊歌曲大獎摘錄；當年未必有「專業推介十大」）\n')
  for (const e of earlyYears) {
    if (e.error) console.log(`- **${e.year}**：抓取失敗 — ${e.error}`)
    else if (e.supreme) console.log(`- **${e.year}**：至尊 —《${e.supreme.song}》${e.supreme.artist}`)
    else console.log(`- **${e.year}**：未能自動解析至尊歌（請打開維基該年頁）`)
  }

  console.log('\n## 1995–2015 專業推介叱咤十大（維基表格）\n')
  for (const block of top10Years) {
    if (block.error) {
      console.log(`\n### ${block.year} 年度 — 錯誤：${block.error}\n`)
      continue
    }
    console.log(`\n### ${block.year} 年度\n`)
    if (block.wikiNote) console.log(`> ${block.wikiNote}\n`)
    console.log('| 排名 | 歌曲 | 歌手 |')
    console.log('|------|------|------|')
    if (!block.rows.length) {
      console.log('| — | （未能從頁面抓到表格，請手動查維基） | |')
    } else {
      for (const r of block.rows) {
        const rank = (r.rank || '').replace(/\|/g, '\\|')
        const song = r.song.replace(/\|/g, '\\|')
        const artist = r.artist.replace(/\|/g, '\\|')
        console.log(`| ${rank} | ${song} | ${cleanArtistCol(artist)} |`)
      }
    }
  }
}

function printCsv({ earlyYears, top10Years }) {
  const cols = ['award_year', 'section', 'rank_label', 'chart_position', 'song', 'artist', 'wiki_note']
  console.log(cols.map(escapeCsv).join(','))

  for (const e of earlyYears) {
    if (e.error) {
      console.log([e.year, 'supreme_only', '', '', '', '', e.error].map(escapeCsv).join(','))
      continue
    }
    if (e.supreme) {
      console.log(
        [
          e.year,
          'supreme_only',
          '至尊歌',
          '1',
          e.supreme.song,
          cleanArtistCol(e.supreme.artist),
          '1989–1994 維基僅摘錄至尊歌曲大獎'
        ]
          .map(escapeCsv)
          .join(',')
      )
    } else {
      console.log([e.year, 'supreme_only', '', '', '', '', '未能解析至尊歌'].map(escapeCsv).join(','))
    }
  }

  for (const block of top10Years) {
    if (block.error) {
      console.log([block.year, 'professional_top10', '', '', '', '', block.error].map(escapeCsv).join(','))
      continue
    }
    const blockNote = block.wikiNote || ''
    if (!block.rows.length) {
      console.log(
        [block.year, 'professional_top10', '', '', '', '', blockNote || '未能從頁面抓到表格'].map(escapeCsv).join(',')
      )
      continue
    }
    for (const r of block.rows) {
      const pos = rankLabelToChartPosition(r.rank)
      const section =
        /未附十大表格/.test(r.rank) && block.rows.length === 1 ? 'supreme_only_fallback' : 'professional_top10'
      console.log(
        [
          block.year,
          section,
          r.rank,
          pos,
          r.song,
          cleanArtistCol(r.artist),
          blockNote && block.rows.indexOf(r) === 0 ? blockNote : ''
        ]
          .map(escapeCsv)
          .join(',')
      )
    }
  }
}

async function main() {
  const wantCsv = process.argv.includes('--csv') || process.argv.includes('--format=csv')
  const data = await fetchAll()
  if (wantCsv) printCsv(data)
  else printMarkdown(data)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
