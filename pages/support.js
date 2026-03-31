import Head from 'next/head'
import Layout from '@/components/Layout'

export default function SupportPage() {
  return (
    <Layout>
      <Head>
        <title>支持 Polygon | Polygon Guitar</title>
        <meta name="description" content="支持 Polygon Guitar 的發展" />
      </Head>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-white mb-4">支持 Polygon</h1>
        <p className="text-white/50 text-sm">內容即將推出。</p>
      </div>
    </Layout>
  )
}
