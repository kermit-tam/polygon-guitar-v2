/**
 * GET /api/playlist-page?id=xxx
 * Returns playlist page payload (playlist, songs=slim, uniqueArtists, otherPlaylists).
 * Songs are slim (no content) to keep response under 128 kB.
 * When Firestore cache/playlist_{id} is fresh: 1 read. On miss: full build then 1 write.
 */

import { getPlaylistPageCache, setPlaylistPageCache } from '@/lib/playlistPageCache'
import { getPlaylist, getPlaylistSongs, getAllActivePlaylists } from '@/lib/playlists'
import { isChaksaPlaylist, resolveChaksaPlaylistItems } from '@/lib/chaksaPlaylist'
import { toSlimSongs } from '@/lib/playlistSlim'

function serializePayload(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v))
  )
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : null
  if (!id) {
    return res.status(400).json({ error: 'Missing id' })
  }

  try {
    const cached = await getPlaylistPageCache(id)
    if (cached) {
      res.setHeader('Cache-Control', 'no-store')
      return res.json({ ...cached, songs: toSlimSongs(cached.songs || []) })
    }

    const playlistData = await getPlaylist(id)
    if (!playlistData) {
      return res.status(404).json({ error: 'Playlist not found' })
    }

    let songs = []
    let uniqueArtists = []
    if (isChaksaPlaylist(playlistData) && Array.isArray(playlistData.chartEntries) && playlistData.chartEntries.length > 0) {
      const resolved = await resolveChaksaPlaylistItems(playlistData.chartEntries)
      songs = resolved.songs
      uniqueArtists = resolved.uniqueArtists
    } else {
      const songIds = playlistData.songIds || []
      const res = songIds.length > 0 ? await getPlaylistSongs(songIds) : { songs: [], uniqueArtists: [] }
      songs = res.songs
      uniqueArtists = res.uniqueArtists
    }
    const slimSongs = toSlimSongs(songs)
    const otherPlaylists = await getAllActivePlaylists()

    const payload = {
      playlist: playlistData,
      songs: slimSongs,
      uniqueArtists,
      otherPlaylists: { auto: otherPlaylists.auto || [], manual: otherPlaylists.manual || [] }
    }
    await setPlaylistPageCache(id, payload)

    res.setHeader('Cache-Control', 'no-store')
    return res.json(serializePayload(payload))
  } catch (err) {
    console.error('[playlist-page API]', err?.message)
    return res.status(500).json({ error: 'Failed to load playlist', message: err?.message })
  }
}
