const { AlphaTabWebPackPlugin } = require('@coderline/alphatab-webpack')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Allow LAN access from local network devices (e.g. 192.168.1.x)
  allowedDevOrigins: ['192.168.1.252'],

  // alphaTab ships web workers / worklets; Webpack must bundle them (fixes file://…alphaTab.worker.mjs errors)
  transpilePackages: ['@coderline/alphatab'],

  webpack: (config) => {
    // Apply on both client and server compilations — alphaTab is pulled into some server/SSG chunks and logs the warning otherwise.
    config.plugins.push(new AlphaTabWebPackPlugin())
    return config
  },

  // 圖片優化設定
  images: {
    remotePatterns: [
      { hostname: 'i.ytimg.com' },           // YouTube 縮圖
      { hostname: 'res.cloudinary.com' },    // Cloudinary
      { hostname: 'upload.wikimedia.org' },  // 維基百科
      { hostname: 'i.scdn.co' },             // Spotify
      { hostname: 'mosaic.scdn.co' },        // Spotify mosaic
      { hostname: 'image-cdn-ak.spotifycdn.com' },
      { hostname: 'image-cdn-fa.spotifycdn.com' },
    ],
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 86400, // 24小時快取
  },

  async redirects() {
    return [
      {
        source: '/songs/:slug',
        destination: '/artists/:slug',
        permanent: true,
      },
    ]
  },

  // 壓縮設定
  compress: true,

  // 實驗性功能
  // experimental: {
  //   optimizeCss: true, // 需要 critters 套件
  // },
}

module.exports = nextConfig
