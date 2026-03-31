import Head from 'next/head'
import Layout from '@/components/Layout'

export default function AboutPage() {
  return (
    <Layout>
      <Head>
        <title>關於我們 | Polygon Guitar</title>
        <meta name="description" content="關於 Polygon Guitar — 香港最大結他譜庫" />
      </Head>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-white mb-4">關於我們</h1>
        <p className="text-white/50 text-sm">內容即將推出。</p>
      </div>
    </Layout>
  )
}
