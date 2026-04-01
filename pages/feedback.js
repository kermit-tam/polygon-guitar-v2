import Head from 'next/head'
import Layout from '@/components/Layout'
import ContactForm from '@/components/ContactForm'

export default function FeedbackPage() {
  return (
    <Layout>
      <Head>
        <title>問題回報 | Polygon Guitar</title>
        <meta name="description" content="回報 Polygon Guitar 的問題或錯誤" />
      </Head>
      <div className="max-w-2xl mx-auto px-6 pb-16 pt-6">
        <h1 className="text-3xl font-bold text-white mb-2">問題回報</h1>
        <p className="text-white/50 text-sm mb-8">發現任何問題或錯誤？請告訴我們，我們會盡快修復。</p>
        <ContactForm subject="問題回報" />
      </div>
    </Layout>
  )
}
