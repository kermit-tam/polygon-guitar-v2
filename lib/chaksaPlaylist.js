/**
 * 叱咤十大手動歌單：chartEntries 解析與 songIds 投影
 */

import { getPlaylistSongs } from '@/lib/playlists'

export const CHAKSA_MANUAL_TYPE = 'chaksa'

export function isChaksaPlaylist(playlist) {
  return playlist?.source === 'manual' && playlist?.manualType === CHAKSA_MANUAL_TYPE
}

/** 由 chartEntries 產生 songIds（僅 tab，順序與 entries 一致） */
export function songIdsFromChartEntries(chartEntries) {
  if (!Array.isArray(chartEntries)) return []
  return chartEntries
    .filter((e) => e && e.source === 'tab' && typeof e.tabId === 'string' && e.tabId.trim())
    .map((e) => e.tabId.trim())
}

/**
 * @param {Array<{
 *   entryId: string,
 *   year: number,
 *   position: number,
 *   source: 'tab'|'external',
 *   tabId?: string,
 *   title?: string,
 *   artistName?: string,
 *   coverUrl?: string,
 *   spotifyTrackId?: string,
 *   spotifyUrl?: string
 * }>} chartEntries
 * @returns {Promise<{ songs: object[], uniqueArtists: object[] }>}
 */
export async function resolveChaksaPlaylistItems(chartEntries) {
  if (!Array.isArray(chartEntries) || chartEntries.length === 0) {
    return { songs: [], uniqueArtists: [] }
  }

  const tabIdsUnique = [
    ...new Set(
      chartEntries
        .filter((e) => e && e.source === 'tab' && e.tabId && String(e.tabId).trim())
        .map((e) => String(e.tabId).trim())
    )
  ]

  const { songs: enrichedTabs, uniqueArtists } =
    tabIdsUnique.length > 0
      ? await getPlaylistSongs(tabIdsUnique)
      : { songs: [], uniqueArtists: [] }

  const tabMap = new Map(enrichedTabs.map((s) => [s.id, s]))

  const songs = []
  for (const entry of chartEntries) {
    if (!entry || typeof entry.year !== 'number' || typeof entry.position !== 'number') continue

    const chartYear = entry.year
    const chartPosition = entry.position

    if (entry.source === 'tab' && entry.tabId) {
      const base = tabMap.get(String(entry.tabId).trim())
      if (!base) continue
      songs.push({
        ...base,
        chartYear,
        chartPosition,
        playlistItemKind: 'tab',
        chaksaEntryId: entry.entryId || null
      })
      continue
    }

    if (entry.source === 'external') {
      const title = (entry.title || '').trim() || '（未命名）'
      const artistName = (entry.artistName || '').trim() || '—'
      const coverUrl = entry.coverUrl || entry.albumImage || ''
      songs.push({
        id: `ext:${entry.entryId || `${chartYear}-${chartPosition}`}`,
        title,
        artistName,
        artist: artistName,
        albumImage: coverUrl || undefined,
        thumbnail: coverUrl || undefined,
        chartYear,
        chartPosition,
        playlistItemKind: 'external',
        chaksaEntryId: entry.entryId || null,
        spotifyUrl: entry.spotifyUrl || null,
        spotifyTrackId: entry.spotifyTrackId || null
      })
    }
  }

  return { songs, uniqueArtists }
}
