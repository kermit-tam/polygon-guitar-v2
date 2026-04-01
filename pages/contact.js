import Head from 'next/head'
import Layout from '@/components/Layout'
import ContactForm from '@/components/ContactForm'

export default function ContactPage() {
  return (
    <Layout>
      <Head>
        <title>聯絡我們 | Polygon Guitar</title>
        <meta name="description" content="聯絡 Polygon Guitar 團隊" />
      </Head>
      <div className="max-w-2xl mx-auto px-6 pb-16 pt-6">
        <h1 className="text-3xl font-bold text-white mb-2">聯絡我們</h1>
        <p className="text-white/50 text-sm mb-8">有任何問題或意見，歡迎聯絡我們。</p>
        <ContactForm subject="聯絡我們" />
      </div>
    </Layout>
  )
}
