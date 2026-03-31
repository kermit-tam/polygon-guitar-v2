import Head from 'next/head'
import Layout from '@/components/Layout'

const SECTION = ({ title, children }) => (
  <section className="mb-8">
    <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
    <div className="text-white/60 text-sm leading-relaxed space-y-2">{children}</div>
  </section>
)

export default function TermsPage() {
  return (
    <Layout>
      <Head>
        <title>使用條款 | Polygon Guitar</title>
        <meta name="description" content="Polygon Guitar 使用條款" />
      </Head>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-white mb-2">使用條款</h1>
        <p className="text-white/40 text-xs mb-10">最後更新：2025 年</p>

        <SECTION title="1. 接受條款">
          <p>使用 Polygon Guitar（「本網站」）即表示你同意受本使用條款約束。如不同意，請停止使用本網站。</p>
        </SECTION>

        <SECTION title="2. 服務說明">
          <p>Polygon Guitar 提供廣東歌及其他歌曲的結他譜，供個人學習及非商業用途使用。本網站保留隨時修改、暫停或終止服務的權利，恕不另行通知。</p>
        </SECTION>

        <SECTION title="3. 知識產權">
          <p>本網站所有內容，包括但不限於文字、圖片、結他譜、標誌及設計，均受版權法保護，版權歸 Polygon Guitar 或相關版權持有人所有。</p>
          <p>未經書面授權，不得複製、轉載、修改或以任何形式散佈本網站內容作商業用途。</p>
        </SECTION>

        <SECTION title="4. 用戶行為">
          <p>你同意不會：</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>以任何非法或未經授權的方式使用本網站</li>
            <li>上傳含有惡意軟件、病毒或有害內容的文件</li>
            <li>嘗試未經授權存取本網站的系統或數據</li>
            <li>干擾或破壞本網站的正常運作</li>
          </ul>
        </SECTION>

        <SECTION title="5. 用戶提交內容">
          <p>用戶向本網站提交的結他譜及相關內容，即表示授予 Polygon Guitar 免費、非獨家的使用、顯示及分發權利。你保證所提交的內容不侵犯任何第三方的知識產權。</p>
        </SECTION>

        <SECTION title="6. 免責聲明">
          <p>本網站提供的結他譜及內容僅供參考，準確性可能因版本或詮釋而有所差異。本網站不對任何因使用本網站內容而引起的損失或損害負責。</p>
        </SECTION>

        <SECTION title="7. 私隱政策">
          <p>使用本網站即表示你同意我們收集及使用你的基本資料（如電郵地址）以提供服務。我們不會將你的個人資料出售予第三方。</p>
        </SECTION>

        <SECTION title="8. 條款修改">
          <p>Polygon Guitar 保留隨時修改本使用條款的權利。修改後的條款將於本頁發布後即時生效。繼續使用本網站即表示接受修改後的條款。</p>
        </SECTION>

        <SECTION title="9. 適用法律">
          <p>本使用條款受香港特別行政區法律管轄。</p>
        </SECTION>

        <SECTION title="10. 聯絡我們">
          <p>如對本使用條款有任何疑問，請透過<a href="/contact" className="text-[#FFD700] hover:underline ml-1">聯絡頁面</a>與我們聯繫。</p>
        </SECTION>
      </div>
    </Layout>
  )
}
