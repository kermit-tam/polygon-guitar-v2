// YouTube 搜尋 API
// 用於求譜功能，當 Spotify 找不到歌曲時作為後備

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { q } = req.query
  
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter' })
  }

  try {
    const apiKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY
    
    if (!apiKey) {
      console.error('YOUTUBE_API_KEY not set')
      return res.status(500).json({ error: 'YouTube API not configured' })
    }

    // 搜尋 YouTube 影片
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=3&key=${apiKey}`
    
    const response = await fetch(searchUrl)
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('YouTube API error:', errorData)
      
      // 檢查是否 quota exceeded
      if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
        return res.status(429).json({ 
          error: 'quotaExceeded',
          message: 'YouTube API 配額已用完，請稍後再試或使用手動輸入'
        })
      }
      
      // 其他錯誤（如 invalid key, access forbidden 等）
      return res.status(500).json({ 
        error: 'YouTube search failed',
        video: null 
      })
    }

    const data = await response.json()
    
    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ video: null })
    }

    const videos = data.items.map(video => ({
      id: video.id.videoId,
      title: video.snippet.title,
      thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url,
      channelTitle: video.snippet.channelTitle,
    }))

    // all=true 時返回全部結果，否則只返回第一個（向下兼容）
    if (req.query.all === 'true') {
      return res.status(200).json({ videos })
    }

    return res.status(200).json({ video: videos[0] })
    
  } catch (error) {
    console.error('YouTube search error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
