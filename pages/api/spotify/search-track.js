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
  
  // 嚴格匹配：歌名相似度 >= 80% 且歌手相似度 >= 70%
  // 或者歌名幾乎完全匹配（>= 95%）
  return (titleSim >= 0.8 && artistSim) || titleSim >= 0.95
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
    
    // 使用簡單搜尋語法（引號可能導致 400 錯誤）
    const searchQuery = title && artist 
      ? `${title} ${artist}`
      : q
    
    console.log('Spotify search query:', searchQuery)
    
    // Build search URL
    const searchUrl = new URL('https://api.spotify.com/v1/search')
    searchUrl.searchParams.append('q', searchQuery)
    searchUrl.searchParams.append('type', 'track')
    searchUrl.searchParams.append('limit', '10')
    
    console.log('Full search URL:', searchUrl.toString())
    
    const searchResponse = await fetch(searchUrl.toString(), {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    })
    
    const searchData = await searchResponse.json()
    
    if (searchData.error) {
      return res.status(500).json({ 
        error: 'Search failed',
        spotifyError: searchData.error
      })
    }
    
    let tracks = searchData.tracks?.items || []
    
    // 過濾結果：只保留匹配的
    if (tracks.length > 0 && title) {
      const filteredTracks = tracks.filter(track => isMatch(track, title, artist))
      
      // 如果過濾後還有結果，使用過濾後的
      if (filteredTracks.length > 0) {
        tracks = filteredTracks
      } else {
        // 完全沒有匹配的，返回空數組（讓前端去 YouTube 搜尋）
        console.log('No matching tracks after filtering')
        tracks = []
      }
    }
    
    // 如果精確搜尋沒有結果，嘗試更寬鬆的搜尋
    if (tracks.length === 0 && q) {
      console.log('Trying loose search:', q)
      
      const looseSearchUrl = new URL('https://api.spotify.com/v1/search')
      looseSearchUrl.searchParams.append('q', q)
      looseSearchUrl.searchParams.append('type', 'track')
      looseSearchUrl.searchParams.append('limit', '10')
      
      const looseSearchResponse = await fetch(looseSearchUrl.toString(), {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      })
      
      const looseData = await looseSearchResponse.json()
      const looseTracks = looseData.tracks?.items || []
      
      // 同樣過濾寬鬆搜尋的結果
      if (looseTracks.length > 0 && title) {
        const filteredLoose = looseTracks.filter(track => isMatch(track, title, artist))
        
        if (filteredLoose.length > 0) {
          tracks = filteredLoose
        } else {
          // 寬鬆搜尋也沒有匹配的，返回空數組
          console.log('No matching tracks in loose search either')
          tracks = []
        }
      } else {
        tracks = looseTracks
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
