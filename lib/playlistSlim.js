/**
 * Slim song/tab payload for playlist list views.
 * Keeps page and API payloads under Next.js 128 kB limit by excluding full `content` and other large fields.
 * Use in getStaticProps (playlist page), API (playlist-page), and cache writes.
 */

const SLIM_SONG_KEYS = new Set([
  'id', 'title', 'artistName', 'artist', 'artistId', 'artistSlug', 'viewCount', 'likes', 'uploadYear',
  'thumbnail', 'coverImage', 'albumImage', 'youtubeVideoId', 'youtubeUrl', 'artistPhoto', 'originalKey',
  'composer', 'lyricist', 'arranger', 'uploaderPenName', 'createdAt',
  // 叱咤歌單列
  'chartYear', 'chartPosition', 'playlistItemKind', 'spotifyUrl', 'spotifyTrackId', 'chaksaEntryId'
])

export function toSlimSong(song) {
  if (!song || typeof song !== 'object') return song
  const out = {}
  for (const key of SLIM_SONG_KEYS) {
    if (key in song && song[key] !== undefined) out[key] = song[key]
  }
  return out
}

export function toSlimSongs(songs) {
  return Array.isArray(songs) ? songs.map(toSlimSong) : []
}
