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
        <meta name="description" content="Polygon Guitar 使用條款 / Terms of Service" />
      </Head>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-white mb-2">使用條款 / Terms of Service</h1>
        <p className="text-white/40 text-xs mb-10">Last updated: 2026</p>

        <SECTION title="1. 接受條款 / Acceptance of Terms">
          <p>使用 Polygon Guitar（「本網站」）即表示你已閱讀、明白並同意受本使用條款約束。如不同意，請停止使用本網站。</p>
          <p>By accessing or using Polygon Guitar (the “Website”), you acknowledge that you have read, understood and agree to be bound by these Terms of Service. If you do not agree, please stop using the Website immediately.</p>
        </SECTION>

        <SECTION title="2. 服務說明 / Description of Service">
          <p>Polygon Guitar 提供廣東歌及其他歌曲的結他譜，以及與結他譜相關的網站功能（包括但不限於搜尋、收藏、歌單與個人主頁），只供個人學習及非商業用途使用。</p>
          <p>本網站保留隨時修改、暫停或終止全部或部分服務的權利，恕不另行個別通知。</p>
          <p>Polygon Guitar provides guitar chord sheets and tabs for Cantopop and other songs, together with related site features (including but not limited to search, library, playlists and user profiles), solely for personal study and non‑commercial use.</p>
          <p>We reserve the right to modify, suspend or discontinue any part of the Service at any time, with or without individual notice.</p>
        </SECTION>

        <SECTION title="3. 知識產權 / Intellectual Property">
          <p>除用戶上載內容外，本網站上的所有內容（包括但不限於標誌、介面設計、排版、文字說明及系統程式碼）均受版權及其他知識產權法保護，權利由 Polygon Guitar 或相關權利人擁有。</p>
          <p>未經事先書面同意，你不得將本網站任何內容用於商業用途，包括但不限於複製、轉載、改編、公開展示或再發佈。</p>
          <p>Except for user‑generated content, all materials on the Website (including but not limited to logos, interface design, layouts, texts and source code) are protected by copyright and other intellectual property laws and are owned by Polygon Guitar or the respective rights holders.</p>
          <p>You may not use any content from the Website for commercial purposes without prior written consent, including but not limited to copying, reproducing, adapting, publicly displaying or redistributing such content.</p>
        </SECTION>

        <SECTION title="4. 用戶行為 / User Conduct">
          <p>你同意在使用本網站時遵守適用法律，並不得作出以下行為：</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>以任何非法、未經授權或違反本條款的方式使用本網站；</li>
            <li>上載含有惡意程式、病毒或可能損害系統或其他用戶之檔案；</li>
            <li>嘗試未經授權存取本網站、伺服器或相關數據庫；</li>
            <li>以任何方式干擾、破壞或試圖繞過本網站的安全或正常運作。</li>
          </ul>
          <p>You agree to comply with all applicable laws when using the Website and must not engage in any of the following:</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>Using the Service in any illegal, unauthorised or terms‑violating manner;</li>
            <li>Uploading files that contain malware, viruses or any harmful code that may damage systems or other users;</li>
            <li>Attempting to gain unauthorised access to the Website, servers or related databases;</li>
            <li>Interfering with, disrupting or attempting to circumvent the security or normal operation of the Service.</li>
          </ul>
        </SECTION>

        <SECTION title="5. 用戶上載內容 / User‑Generated Content">
          <p>Polygon Guitar 主要以用戶上載結他譜及相關內容運作。本網站並不主動編輯或審核所有個別譜面，只提供平台讓用戶分享作品。</p>
          <p>你確認並同意，你上載或提交到本網站的任何內容（包括但不限於結他譜、文字說明、標題及歌單），均由你本人獨自負責，你保證該等內容不侵犯任何第三方之版權或其他權利。</p>
          <p>任何用戶上載內容所產生的版權或法律爭議，均屬該用戶個人行為，<span className="font-semibold text-white">並不構成 Polygon Guitar 之立場或行為</span>。如權利人認為某內容有侵權之虞，可透過聯絡頁面通知我們，我們會在合理時間內查閱及按需要將相關內容下架。</p>
          <p>你同意授予 Polygon Guitar 一個非獨家、全球性、免版稅的權利，以在本網站及相關宣傳渠道中使用、展示及傳送你上載之內容，僅用於提供及推廣本網站服務。</p>
          <p>Polygon Guitar operates primarily as a platform where users upload guitar tabs and related content. We do not proactively edit or review every individual score; we provide the infrastructure for users to share their work.</p>
          <p>You acknowledge and agree that you are solely responsible for any content you upload or submit to the Website (including but not limited to tabs, descriptions, titles and playlists), and you warrant that such content does not infringe any third‑party copyright or other rights.</p>
          <p>Any copyright or legal disputes arising from user‑generated content shall be attributed solely to the respective user and <span className="font-semibold text-white">do not represent the actions or stance of Polygon Guitar</span>. If a rights holder believes that certain content may be infringing, they may contact us via the contact page, and we will review the request and, where appropriate, remove the content within a reasonable time.</p>
          <p>You grant Polygon Guitar a non‑exclusive, worldwide, royalty‑free licence to use, display and transmit your uploaded content on the Website and in related promotional materials, solely for the purpose of providing and promoting the Service.</p>
        </SECTION>

        <SECTION title="6. 免責聲明 / Disclaimer">
          <p>本網站所提供的結他譜及相關資料僅供參考及練習用途，實際和弦、編曲或歌詞可能因版本、調整或個人詮釋而有所不同。</p>
          <p>在法律許可的最大範圍內，Polygon Guitar 並不就本網站內容的準確性、完整性或適用性作出任何明示或暗示的保證，亦不對因使用本網站或任何內容而引致的任何直接或間接損失負責。</p>
          <p>The guitar tabs and related information provided on the Website are for reference and practice purposes only; actual chords, arrangements or lyrics may differ due to version differences, transposition or personal interpretation.</p>
          <p>To the maximum extent permitted by law, Polygon Guitar makes no express or implied warranties regarding the accuracy, completeness or fitness for purpose of any content on the Website, and shall not be liable for any direct or indirect losses arising from the use of the Service or its contents.</p>
        </SECTION>

        <SECTION title="7. 私隱及個人資料 / Privacy and Personal Data">
          <p>使用本網站即表示你同意我們在合理及必要範圍內收集及使用你的基本資料（例如電郵地址、登入識別）以提供帳戶及相關功能。</p>
          <p>我們不會將你的個人資料出售予第三方，並會以合理方式保護你的帳戶安全；惟互聯網傳輸本身存在風險，我們無法保證資料傳輸時絕對安全。</p>
          <p>By using the Website, you consent to our collection and use of your basic information (such as email address and login identifiers) to provide your account and related features within a reasonable and necessary scope.</p>
          <p>We do not sell your personal data to third parties and will take reasonable measures to safeguard your account; however, internet transmission inherently carries risks and we cannot guarantee absolute security of data in transit.</p>
        </SECTION>

        <SECTION title="8. 條款修改 / Changes to Terms">
          <p>Polygon Guitar 有權隨時更新或修改本使用條款。更新後的條款將刊登於本頁面並即時生效。</p>
          <p>你繼續使用本網站，即表示你同意並接受經修訂後的條款。</p>
          <p>Polygon Guitar may update or amend these Terms of Service from time to time. The updated version will be published on this page and will take effect immediately upon posting.</p>
          <p>Your continued use of the Website after any changes constitutes your acceptance of the revised Terms.</p>
        </SECTION>

        <SECTION title="9. 適用法律及爭議 / Governing Law and Disputes">
          <p>本使用條款受香港特別行政區法律管轄並按其解釋，任何爭議如未能友好解決，將提交香港法院處理。</p>
          <p>These Terms of Service are governed by and construed in accordance with the laws of the Hong Kong Special Administrative Region, and any disputes that cannot be resolved amicably shall be submitted to the courts of Hong Kong.</p>
        </SECTION>

        <SECTION title="10. 聯絡我們 / Contact Us">
          <p>
            如對本使用條款或內容下架事宜有任何查詢或投訴，請透過
            <a href="/contact" className="text-[#FFD700] hover:underline mx-1">聯絡頁面</a>
            與我們聯繫，我們會盡力在合理時間內回覆。
          </p>
          <p>
            If you have any questions about these Terms or wish to request removal of specific content, please contact us via the
            <a href="/contact" className="text-[#FFD700] hover:underline mx-1">contact page</a>
            and we will respond within a reasonable time.
          </p>
        </SECTION>
      </div>
    </Layout>
  )
}
