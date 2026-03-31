/**
 * GET /api/home-data
 * Returns one JSON payload with all homepage data (settings, hot tabs, latest,
 * playlists, artists, categories, and preloaded songs for custom sections like 最新廣東歌).
 * Single round-trip for the client; all Firestore reads run on the server.
 *
 * ?reportSizes=1 — returns a size breakdown instead of full data (to debug payload size).
 * ?inspect=1     — returns the full payload pretty-printed (detailed content of every list).
 */

import { getHomeDataCached, bustHomeDataApiCache } from '@/lib/homeData'

function sizeOf(obj) {
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8')
  } catch {
    return JSON.stringify(obj).length
  }
}

function buildSizeReport(data) {
  const report = { totalBytes: 0, totalKB: 0, keys: {} }
  if (!data || typeof data !== 'object') return report
  for (const key of Object.keys(data)) {
    const val = data[key]
    let bytes = sizeOf(val)
    let count = null
    if (Array.isArray(val)) {
      count = val.length
      if (val.length > 0 && typeof val[0] === 'object') {
        const sample = sizeOf(val[0])
        report.keys[key] = { bytes, kB: (bytes / 1024).toFixed(1), count, approxPerItem: Math.round(sample) }
      } else {
        report.keys[key] = { bytes, kB: (bytes / 1024).toFixed(1), count }
      }
    } else if (val && typeof val === 'object' && !(val instanceof Date)) {
      if (key === 'hotArtists') {
        const sub = {}
        for (const k of Object.keys(val)) {
          const b = sizeOf(val[k])
          sub[k] = { bytes: b, kB: (b / 1024).toFixed(1), count: Array.isArray(val[k]) ? val[k].length : null }
        }
        report.keys[key] = { bytes, kB: (bytes / 1024).toFixed(1), sub }
      } else if (key === 'customPlaylistSongs') {
        const sectionCount = Object.keys(val).length
        const totalSongs = Object.values(val).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
        report.keys[key] = { bytes, kB: (bytes / 1024).toFixed(1), sections: sectionCount, totalSongs }
      } else {
        report.keys[key] = { bytes, kB: (bytes / 1024).toFixed(1) }
      }
    } else {
      report.keys[key] = { bytes, kB: (bytes / 1024).toFixed(1) }
    }
    report.totalBytes += bytes
  }
  report.totalKB = (report.totalBytes / 1024).toFixed(1)
  report.totalMB = (report.totalBytes / (1024 * 1024)).toFixed(2)
  return report
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.query.bust === '1' || req.query.bust === 'true') {
    bustHomeDataApiCache()
  }
  try {
    const data = await getHomeDataCached()
    if (req.query.reportSizes === '1' || req.query.reportSizes === 'true') {
      return res.status(200).json(buildSizeReport(data))
    }
    if (req.query.inspect === '1' || req.query.inspect === 'true') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(200).send(JSON.stringify(data, null, 2))
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300')
    try {
      return res.status(200).json(data)
    } catch (jsonErr) {
      console.error('[api/home-data] json serialize failed', jsonErr?.message)
      res.setHeader('Content-Type', 'application/json')
      return res.status(200).send(JSON.stringify(data))
    }
  } catch (e) {
    console.error('[api/home-data]', e?.message || e)
    return res.status(500).json({ error: 'Failed to load homepage data', detail: e?.message })
  }
}
