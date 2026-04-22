// Spotify API - 搜尋歌曲（嚴格匹配版本，優先返回最早年份）

export const config = {
  api: {
    bodyParser: true,
  },
}

// 計算字符串相似度 (0-1)
function similarity(str1, str2) {
  if (!str1 || !str2) return 0
  
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()
  
  // 完全匹配
  if (s1 === s2) return 1
  
  // 包含匹配
  if (s1.includes(s2) || s2.includes(s1)) return 0.9
  
  // 移除常見後綴再比較
  const cleanS1 = s1.replace(/\s*[-–—:]\s*(live|remix|version|ver\.?|acoustic|studio|edit|radio|feat\.?|ft\.?|with).*$/, '').trim()
  const cleanS2 = s2.replace(/\s*[-–—:]\s*(live|remix|version|ver\.?|acoustic|studio|edit|radio|feat\.?|ft\.?|with).*$/, '').trim()
  
  if (cleanS1 === cleanS2) return 0.85
  if (cleanS1.includes(cleanS2) || cleanS2.includes(cleanS1)) return 0.8
  
  // Levenshtein 距離計算
  const len1 = s1.length
  const len2 = s2.length
  const matrix = []
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  
  const distance = matrix[len1][len2]
  const maxLen = Math.max(len1, len2)
  return maxLen === 0 ? 1 : (maxLen - distance) / maxLen
}

// 檢查是否匹配（考慮歌名和歌手）
function isMatch(track, targetTitle, targetArtist) {
  const trackName = track.name || ''
  const artistNames = track.artists?.map(a => a.name) || []
  
  // 歌名相似度
  const titleSim = similarity(trackName, targetTitle)
  
  // 如果沒有指定歌手，只看歌名（需要 >= 80% 相似度）
  if (!targetArtist) {
    return titleSim >= 0.8
  }
  
  // 檢查歌手相似度（需要 >= 70% 相似度）
  const artistSim = artistNames.some(name => similarity(name, targetArtist) >= 0.7)
  
  // 歌名相似度 >= 70% 且歌手相似度 >= 70%
  // 或者歌名幾乎完全匹配（>= 90%）
  return (titleSim >= 0.7 && artistSim) || titleSim >= 0.9
}

export default async function handler(req, res) {
  console.log('=== Spotify Track Search API called ===')
  console.log('Method:', req.method)
  
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  try {
    const params = req.method === 'POST' ? req.body : req.query
    console.log('Params received:', params)
    
    const artist = params.artist || params.artistName
    const title = params.title || params.songTitle || params.name
    let q = params.q || params.query
    
    if (!q && artist && title) {
      q = `${title} ${artist}`
    }
    
    if (!q && !artist && !title) {
      return res.status(400).json({ error: 'Missing query or artist/title' })
    }
    
    const SPOTIFY_CLIENT_ID = (process.env.SPOTIFY_CLIENT_ID || '').trim()
    const SPOTIFY_CLIENT_SECRET = (process.env.SPOTIFY_CLIENT_SECRET || '').trim()
    
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Missing Spotify credentials' })
    }
    
    // 獲取 Token
    const credentialsString = `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
    const base64Credentials = Buffer.from(credentialsString).toString('base64')
    
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${base64Credentials}`
      },
      body: 'grant_type=client_credentials'
    })
    
    const tokenData = await tokenResponse.json()
    
    if (!tokenResponse.ok) {
      return res.status(500).json({ 
        error: 'Spotify auth failed',
        spotifyError: tokenData
      })
    }
    
    // 搜尋策略：3 層 fallback
    // 1. field filter: track:{title} artist:{artist} （最精準）
    // 2. title only field filter: track:{title} （唔限歌手）
    // 3. 原始 query fallback
    
    const doSearch = async (queryStr) => {
      console.log('Spotify search query:', queryStr)
      const url = new URL('https://api.spotify.com/v1/search')
      url.searchParams.append('q', queryStr)
      url.searchParams.append('type', 'track')
      url.searchParams.append('limit', '10')
      const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } })
      const data = await res.json()
      if (data.error) console.error('Spotify error:', JSON.stringify(data.error))
      return data.error ? [] : (data.tracks?.items || [])
    }

    const applyFilter = (tracks, mustMatch) => {
      if (!title || tracks.length === 0) return tracks
      const filtered = tracks.filter(t => isMatch(t, title, artist))
      // 有過濾結果就用，否則 mustMatch=true 返空，mustMatch=false 返原始
      return filtered.length > 0 ? filtered : (mustMatch ? [] : tracks)
    }

    // 第 1 層：field filter（歌名 + 歌手）
    let tracks = []
    if (title && artist) {
      // 只用英文部分 artist（Spotify 對中文 artist filter 支援較差）
      const artistForFilter = artist.replace(/[\u4e00-\u9fff]/g, '').trim() || artist
      const pass1 = await doSearch(`track:${title} artist:${artistForFilter}`)
      tracks = applyFilter(pass1, false)
    }

    // 第 2 層：track field filter（只限歌名）
    if (tracks.length === 0 && title) {
      const pass2 = await doSearch(`track:${title}`)
      tracks = applyFilter(pass2, false)
    }

    // 第 3 層：原始 query（最寬鬆）
    if (tracks.length === 0) {
      const fallbackQ = (title && artist) ? `${title} ${artist}` : (q || title || artist)
      if (fallbackQ) {
        const pass3 = await doSearch(fallbackQ)
        tracks = applyFilter(pass3, false)
      }
    }

    if (tracks.length === 0) {
      return res.status(404).json({ error: 'Track not found' })
    }
    
    let results = tracks.map(track => formatTrackData(track))
    
    // 按年份排序（最遲的優先：最新歌曲排最前）
    results.sort((a, b) => {
      const yearA = parseInt(a.releaseYear) || 9999
      const yearB = parseInt(b.releaseYear) || 9999
      return yearB - yearA
    })
    
    return res.status(200).json({ results })
    
  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ error: error.message })
  }
}

// 將 Spotify track 數據轉換為前端期望的格式
function formatTrackData(track) {
  const images = track.album?.images || []
  const albumImage = images[0]?.url || ''
  const thumbnail = images[images.length - 1]?.url || ''
  
  const releaseDate = track.album?.release_date || ''
  const releaseYear = releaseDate ? releaseDate.split('-')[0] : ''
  
  const firstArtist = track.artists?.[0]
  
  return {
    id: track.id,
    name: track.name,
    artist: firstArtist?.name || '',
    artists: track.artists?.map(a => ({ name: a.name, id: a.id })) || [],
    album: track.album?.name || '',
    albumId: track.album?.id || '',
    artistId: firstArtist?.id || '',
    albumImage: albumImage,
    thumbnail: thumbnail || albumImage,
    duration: track.duration_ms || 0,
    releaseYear: releaseYear,
    releaseDate: releaseDate,
    popularity: track.popularity || 0,
    previewUrl: track.preview_url || null,
    spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`
  }
}
