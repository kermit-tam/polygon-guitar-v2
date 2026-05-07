import { useState, useEffect } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export default function GameHomePage() {
  const router = useRouter()
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)

  // 鎖定 body scroll
  useEffect(() => {
    const prev = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
    }
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    const preventTouch = (e) => e.preventDefault()
    document.addEventListener('touchmove', preventTouch, { passive: false })
    return () => {
      document.documentElement.style.overflow = prev.htmlOverflow
      document.body.style.overflow = prev.bodyOverflow
      document.body.style.position = prev.bodyPosition
      document.body.style.width = ''
      document.removeEventListener('touchmove', preventTouch)
    }
  }, [])

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(query(collection(db, 'gameArtists'), where('enabled', '==', true)))
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99))
        setArtists(list)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <Layout hideBottomNav hideFooter>
      <Head>
        <title>1秒前奏估歌仔 | Polygon Guitar</title>
      </Head>

      <div
        className="bg-black flex flex-col items-center px-4"
        style={{ height: '100dvh', overflow: 'hidden' }}
      >
        {/* Logo */}
        <div className="pt-10 pb-6 flex flex-col items-center">
          <img src="/game-logo.svg" alt="1秒前奏估歌仔" style={{ height: 80 }} />
          <p className="text-[#B3B3B3] text-sm mt-3">選擇歌手開始遊戲</p>
        </div>

        {loading && (
          <p className="text-[#B3B3B3] text-sm">載入中...</p>
        )}

        {/* 歌手圓形網格 */}
        {!loading && artists.length === 0 && (
          <p className="text-[#B3B3B3] text-sm text-center">未有可選擇嘅歌手，請先在後台設定</p>
        )}

        <div className="flex flex-wrap justify-center gap-6 w-full max-w-md">
          {artists.map(artist => (
            <button
              key={artist.id}
              onClick={() => router.push(`/game/${artist.artistId}`)}
              className="flex flex-col items-center gap-2 group"
            >
              <div
                className="rounded-full overflow-hidden border-2 border-transparent group-active:border-[#FFD700] transition-all"
                style={{ width: 100, height: 100 }}
              >
                {artist.photo ? (
                  <img
                    src={artist.photo}
                    alt={artist.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-[#121212] flex items-center justify-center text-3xl">🎸</div>
                )}
              </div>
              <span className="text-white text-sm font-medium">{artist.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Layout>
  )
}
