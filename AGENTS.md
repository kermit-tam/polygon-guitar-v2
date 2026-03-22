# Polygon Guitar V2 - 項目記憶檔案

> 最後更新：2026-03-11（Carousel 標準：100px 卡片 + gap-4，與最近瀏覽同款）
> 
> 此檔案用於保存項目背景、技術規格、設計風格及開發偏好，方便每次啟動時快速恢復上下文。

---

## 專案概覽

| 項目 | 詳情 |
|------|------|
| 名稱 | Polygon Guitar v2 |
| 網域 | **polygon.guitars** ✅ 已上線 |
| 技術棧 | Next.js 16 + JavaScript + Tailwind CSS + Firebase (Firestore, Auth) + Cloudinary + Vercel |
| 目標 | 取代 Blogger (polygonguitar.blogspot.com)，遷移 3000-4000 份舊譜 |
| 本地開發 | `npm run dev` → http://localhost:3000 |

---

## 設計規格

### Spotify 深色模式風格

| 元素 | 顏色代碼 | 用途 |
|------|----------|------|
| 背景 | `#000000` | 頁面底色 |
| 卡片背景 | `#121212` | 卡片、容器 |
| 強調色 | `#FFD700` | 和弦、Key、按鈕 |
| 主要文字 | `#FFFFFF` | 標題、歌名 |
| 次要文字 | `#B3B3B3` | 說明、輔助文字 |
| 底部導航 | `#FFD700` bg + black text | 手機版導航欄 |

### 樂譜格式

```
|C      G/B    |Am     F
(暗)如何(蠶)食了(光)
```

- 使用等寬字體 `Sarasa Mono TC`
- 和弦對齊歌詞括號 `( )`
- 支援 Slash Chord（如 G/B）

---

## 技術架構

### 和弦指法資料（`lib`）

| 來源 | 用途 |
|------|------|
| `@tombatossals/chords-db` | 主資料庫（多 positions） |
| `lib/chordSlashFallbacks.json` | chords-db 無嘅 slash（如 `m7/G`） |
| `lib/chordThumbVoicings.json` | 精選拇指／Hendrix／民謠式指法，合併入 `getChordAlternatives`（預設 append；`d/f#` 等 `THUMB_VOICINGS_PREPEND_FIRST` 會 **排最前** 且預揀第一格）；`fingers[]` 可用 0–4 或 **`"T"` / `"thumb"`**（SVG **T**） |
| `lib/chordDb.js` 內 `POSITION_OVERRIDES` | 覆寫某和弦第一式（與 chords-db 同欄位） |

### 頁面結構 (Pages Router)

```
pages/
├── index.js              # 首頁（四區結構）
├── login.js              # Google 登入
├── library.js            # 樂譜庫
├── search.js             # 搜尋頁
├── artists/
│   ├── index.js          # 歌手列表
│   ├── [id].js           # 歌手詳情頁
│   └── [id]/edit.js      # 編輯歌手
├── tabs/
│   ├── new.js            # 上傳樂譜
│   ├── [id].js           # 樂譜顯示
│   └── [id]/edit.js      # 編輯樂譜
├── playlist/[id].js      # Playlist 頁
└── admin/                # 後台管理
    ├── index.js
    ├── artists.js        # 歌手管理
    ├── migrate.js        # 舊譜修復工具
    ├── import-tabs.js    # Blogger 導入
    ├── playlists.js      # Playlist 管理
    ├── logo.js           # Logo 上傳
    └── ...
```

### 主要元件

| 元件 | 功能 |
|------|------|
| `Layout.js` | 整體佈局 + 底部導航 |
| `Navbar.js` | 頂部導航欄 |
| `TabContent.js` | 樂譜顯示 + 轉調 + 自動滾動 |
| `TabCard.js` | 樂譜卡片 |
| `ArtistSongsList.js` | 歌手歌曲列表 |
| `ArtistAutoFill.js` | 自動搜尋維基建立歌手 |
| `YouTubeSearchModal.js` | YouTube 搜尋選擇 |
| `LikeButton.js` | 讚好功能 |
| `TabTagsSelector.js` | 三層標籤系統 |
| `TabVersionComparison.js` | 版本比較 |
| `GpSegmentUploader` | GP 檔案上傳與預覽 | `components/GpSegmentUploader.jsx` |
| `GpSegmentPlayer` | GP 譜面顯示 | `components/GpSegmentPlayer.jsx` |
| **`SongActionSheet`** | **歌曲「更多」底部彈出 Menu（統一規格）** | `components/SongActionSheet.js` |

#### 更多掣標準（以後加「更多」請跟呢個）

加「更多」掣時，**必須用** `SongActionSheet` 元件，唔好再複製貼上彈出層。規格已包：

- **內容左對齊 1rem**（`px-4`）
- **把手**：`px-12 -mx-4`，無移位問題
- **拖曳關閉**：向下拖 >80px 關閉，鎖 body 滾動
- **封面縮圖**：49×49，無圖時 🎸 fallback

**用法**：`<SongActionSheet open={...} onClose={...} title={...} artist={...} thumbnailUrl={...} liked={...} likeLabel={...} onCopyShareLink onSelectLyricsShare onAddToLiked onAddToPlaylist artistHref={...} />`。可選 `paddingBottom`（預設留位給底部導航）。已用頁面：`artists/[id].js`、`playlist/[id].js`、`library/recent-tabs.js`、`library/liked.js`。

#### Carousel 標準（橫向滾動卡片 — 「carousel」一律跟呢個）

凡提到 **carousel**、橫向滾動卡片、或要與首頁「最近瀏覽」同款時，必須用以下規格：

| 項目 | 規格 |
|------|------|
| **卡片寬度** | `w-[32vw]`（32% 視窗寬） |
| **封面尺寸** | `w-[32vw] h-[32vw]`（32vw 正方形） |
| **間距** | `gap-3`（12px） |
| **歌曲/歌單圓角** | `rounded-[4px]` |
| **歌手頭像圓角** | `rounded-full` |
| **區塊內邊距** | `paddingLeft: '1rem'`、`pr-6`、`py-2 -my-2` |

**元件用法**（`components/LazyImage.js`）：

- **歌曲**：`<SongCard ... compact />` → 32vw、rounded-[4px]
- **歌單**：`<PlaylistCard ... compact />` → 32vw、rounded-[4px]
- **歌手**：`<ArtistAvatar ... compact />` → 32vw、rounded-full

**容器結構**：

```jsx
<section style={{ marginBottom: 25 }}>
  <h2 className="font-bold text-white pr-6 pb-2 pt-0" style={{ fontSize: '1.375rem', paddingLeft: '1rem' }}>標題</h2>
  <div className="flex overflow-x-auto scrollbar-hide pr-6 py-2 -my-2 gap-3" style={{ paddingLeft: '1rem' }}>
    {/* 用 SongCard compact / PlaylistCard compact / ArtistAvatar compact，或自訂 w-[32vw] h-[32vw] 卡片 */}
  </div>
</section>
```

**骨架屏**：`flex-shrink-0 w-[32vw]`，封面 `w-[32vw] h-[32vw] rounded-[4px]`（或歌手 `rounded-full`）。已用：首頁各區、搜尋頁熱門歌曲、Playlist 頁推薦歌單、`RecentItems`（最近瀏覽）。

### Firestore 資料結構

```javascript
// artists 集合
{
  name: string,           // 歌手名
  slug: string,           // URL 用（如 "beyond"）
  gender: 'male'|'female'|'group'|'other',
  photoURL: string,       // Cloudinary 用戶上傳
  wikiPhotoURL: string,   // 維基百科備份
  bio: string,              // 簡介
  songCount: number,        // 歌曲數量
  viewCount: number,        // 瀏覽次數
  isActive: boolean,
  createdAt: timestamp,
  // Spotify 資料（2026-02-13 新增）
  spotifyId: string,        // Spotify 歌手 ID
  spotifyFollowers: number, // 粉絲數
  spotifyPopularity: number,// 人氣度 0-100
  spotifyGenres: array      // 音樂類型
}

// songs 集合
{
  title: string,
  artistName: string,
  artistSlug: string,
  artistId: string,       // 關聯 artists
  originalKey: string,    // 原調（如 "C"）
  content: string,        // 樂譜內容
  youtubeUrl: string,
  thumbnail: string,      // YouTube 縮圖
  uploadYear: number,     // 年份（分組用）
  viewCount: number,
  arrangedBy: string,     // 編曲者（區分版本）
  uploaderId: string,
  uploaderPenName: string,// 上傳者筆名
  likes: number,
  createdAt: timestamp,
  source: 'migrated'|'manual'
}

// playlists 集合
{
  title: string,
  description: string,
  source: 'auto'|'manual',
  autoType: 'monthly'|'weekly'|'trending',
  manualType: 'artist'|'theme'|'series',
  songIds: array,
  coverImage: string,
  isActive: boolean,
  displayOrder: number
}

// songVersions 集合（同歌多版本）
{
  songId: string,
  arrangedBy: string,
  versionType: 'original'|'simplified'|'advanced'|'live',
  content: string,
  uploaderId: string,
  createdAt: timestamp
}
```

### 轉調計算邏輯

```javascript
// Capo 計算公式
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const capo = (originalIndex - targetIndex + 12) % 12;

// 顯示邏輯
// Capo 0: 顯示 "原調: C"
// Capo 4: 顯示 "Key: E (Capo 4) Play C"
// 警告: Capo >= 9 時顯示高位警告
```

---

## 已完成功能 ✅

1. **Firebase 後端**
   - Firestore 資料庫
   - Google Authentication
   - 安全規則設定

2. **歌手管理**
   - 上傳歌手相片（Cloudinary 匿名上傳）
   - 自動搜尋維基百科建立歌手檔案
   - 歌手頁面（Hero 16:9 + 熱門歌曲 + 年份分組）

3. **樂譜系統**
   - 上傳樂譜（含 YouTube thumbnail 自動提取）
   - 樂譜顯示（等寬字體 + 和弦對齊）
   - 轉調系統（Capo 計算 + 高位警告）
   - 自動滾動、字體調整、複製功能

4. **互動功能**
   - 讚好系統（❤️）
   - 瀏覽次數統計（每次頁面載入都計數，類似 Google Analytics）
   - 三層標籤系統（難度/手動標記/用戶投票）

5. **Playlist 系統**
   - 自動數據區（本月熱門、本週新增）
   - 手動精選區

6. **首頁結構**
   - 歌手分類區
   - 熱門歌手區
   - Playlist 區
   - 教學區

7. **後台管理工具**（2026-02-07 新增）
   - **遷移樂譜管理** `/admin/migrated-tabs` - 查看/編輯/修復 Blogger 遷移的樂譜
   - **歌手管理 V2** `/admin/artists-v2` - 統一管理歌手資料、分類、批量設置
   - **合併重複歌手** `/admin/merge-artists` - 自動檢測並合併中英文重複歌手
   - **Logo 上傳** `/admin/logo` - 上傳網站 Logo
   - **數據審查工具** `/admin/data-review` - 找出可疑歌手/歌曲、批量刪除
   - **歌手名修復工具** `/admin/fix-artist` - 快速修復 UNKNOWN 歌手（如新青年理髮廳）
   - **全站瀏覽統計** `/admin/analytics` - 類似 Google Analytics，追蹤所有頁面瀏覽
   - **首頁設置** `/admin/home-settings` - 管理熱門歌手顯示、手動揀選、排序方式
   - **分類封面管理** `/admin/category-covers` - 管理首頁男/女/組合分類封面圖片
   - 維基百科搜尋整合 - 編輯樂譜時可直接搜尋歌手中文名
   - 多選批量操作 - 支援批量設置歌手分類

8. **歌手頁面優化**（2026-02-07）
   - 手機版 Key 徽章單行顯示、選中樣式優化
   - 歌手簡介「ⓘ」按鈕（手機 Modal / 電腦直接顯示）

9. **底部導航**（2026-02-07）
   - 修復為黃底 `#FFD700` + 黑字設計

10. **SEO 優化**（2026-02-09）
    - 每頁獨特 Title、Description、Canonical URL
    - Open Graph & Twitter Card 社交分享標籤
    - 結構化數據 Schema.org：MusicComposition、MusicGroup、BreadcrumbList
    - 動態 Sitemap (`/api/sitemap.xml`)
    - Robots.txt (`/api/robots.txt`)
    - 網域已成功遷移至 `polygon.guitars`

11. **社交功能**（2026-02-09）
    - 樂譜留言系統 (`TabComments` component)
    - 歌手頁面求譜功能 (`ArtistTabRequests`)
    - 合唱歌曲支援 (collaborators 陣列)

12. **Spotify 資料擴展**（2026-02-13 - 第一階段）
    - **粉絲數追蹤**：從 Spotify API 獲取 `followers` 數據
    - **Spotify Choice 排名**：歌手列表新增「🎵 Spotify Choice」排序選項，按粉絲數排名
    - **擴展資料欄位**：`spotifyPopularity` (人氣度 0-100)、`spotifyGenres` (音樂類型陣列)
    - **後台更新**：`/admin/spotify-manager` 批量更新時自動儲存粉絲數

13. **首頁 UI 改進**（2026-02-13）
    - **頂部 bar 變黃色**：由黑色 `#121212` 改為黃色 `#FFD700`，文字/圖標改為黑色
    - **取消白色資訊列**：刪除「Polygon 結他譜」+「總瀏覽量」行，直接顯示搜尋 bar
    - **隱藏瀏覽量**：歌手卡片、歌曲卡片不再顯示瀏覽數字（只在後台顯示）

14. **首頁熱門歌手改進**（2026-02-13）
    - **新增後台設置** `/admin/home-settings`：管理熱門歌手顯示同排序
    - **手動揀選歌手**：支持手動揀選男/女/組合歌手，揀選後會優先顯示
    - **多種排序方式**：
      - 總瀏覽量（默認）
      - 譜數目
      - Admin 評分
      - 混合排序（瀏覽量50% + 譜數30% + 評分20%）
    - **最新上架移到底部**：調整區域順序，最新上架放喺最底

15. **歌單視圖切換功能**（2026-02-13）
    - **列表/網格視圖**：Playlist 詳情頁支持兩種視圖切換
    - **列表視圖**：一條條顯示（默認），適合多歌曲歌單
    - **網格視圖**：一格格卡片，橫向滾動，似首頁熱門譜咁
    - **後台設置**：創建/編輯歌單時可設置默認視圖模式
    - **使用場景**：方大同精選等歌手專輯可用網格模式展示

16. **首頁 UI 全面改版**（2026-02-20）
    - **分類卡片**：正方形設計 (`aspect-square`)，圓角 `rounded-[4px]`
    - **標籤位置**：移至右下方，實色背景（男歌手藍色 `#1fc3df`、女歌手粉紅 `#ff9b98`、組合黃色 `#fed702`）
    - **歌手預覽**：分類卡片下方顯示該類別前 5 位熱門歌手名單
    - **熱門歌手區**：圓形大頭設計 (`rounded-full`)，尺寸 `w-24 h-24 md:w-32 md:h-32`
    - **區域順序**：最新上架移至底部
    - **隱藏瀏覽量**：歌手卡片、歌曲卡片不再顯示瀏覽數字

17. **歌手頁面全新設計**（2026-02-20）
    - **Hero 區域**：大幅歌手相片背景 + 漸變遮罩
    - **熱門歌曲**：前 5 首顯示 YouTube 縮圖 + 歌曲資訊
    - **所有歌曲**：第 6 首起用精簡列表顯示
    - **列表佈局**：歌曲名稱（左）、評分（中）、出譜者（右）
    - **年份分組**：按上傳年份分組顯示（2021-2026、2016-2020 等）
    - **排序選項**：按年份、按筆畫、按瀏覽

18. **樂譜頁面 Header 改版**（2026-02-20）
    - **封面圖片**：左上角顯示 YouTube 縮圖
    - **動態歌名**：根據長度調整字體大小（短歌名更大）
    - **操作按鈕**：主題切換、編輯、心心按鈕集中喺歌手名右邊
    - **主題切換**：支援日間/夜間模式切換

---

## 待修復/進行中 🔄

### 高優先級

1. ~~**歌手頁面手機版優化**~~ ✅ **已完成**（2026-02-07）
   - Key 圓形徽章 `w-7 h-7`（28px），強制單行顯示 12 個 Key
   - 選中 Key「黑底黃字黃邊」`bg-black text-[#FFD700] border border-[#FFD700]`
   - 排名數字縮細
   - 縮圖 `w-8 h-8`（32px）
   - 歌手簡介「ⓘ」按鈕（手機 Modal，電腦直接顯示）

2. ~~**底部導航顏色修復**~~ ✅ **已完成**（2026-02-07）
   - 手機版已修復為黃底 `#FFD700`

3. ~~**Logo 上傳功能**~~ ✅ **已完成**（2026-02-07）
   - 後台 `/admin/logo` 頁面已可上傳 Logo

4. ~~**域名遷移與 SEO 優化**~~ ✅ **已完成**（2026-02-09）
   - 網域 `polygon.guitars` 已成功遷移並 SSL 自動配置
   - DNS 設置：Namecheap nameservers → ns1.vercel-dns.com, ns2.vercel-dns.com
   - SEO Meta Tags：每頁獨特 Title、Description、Canonical URL
   - Open Graph & Twitter Card 標籤
   - 結構化數據 JSON-LD (Schema.org)：MusicComposition、MusicGroup、WebSite、BreadcrumbList
   - `/api/robots.txt` - 搜索引擎爬蟲規則
   - `/api/sitemap.xml` - 動態網站地圖
   - 等待設置：Firebase Admin SDK 環境變數以啟用完整 sitemap

5. ~~**舊譜編輯權限修復**~~ ✅ **已完成**（2026-02-09）
   - 問題：Blogger 遷移的舊譜沒有 `createdBy` 欄位，導致無法編輯/刪除
   - 解決：更新 Firebase Rules 和客戶端代碼，允許編輯沒有 `createdBy` 的舊譜
   - 需要手動更新 Firebase Console 的 Rules

### 中優先級

5. **Blogger 遷移**（進行中 - 已完成 100 份）
   - Blog ID: `7655351322076661979`
   - API Key: 已設置於環境變數 `BLOGGER_API_KEY`
   - 總量：約 3000-4000 篇文章
   - **已完成：第 1-100 篇**（透過 `import-100-tabs.js`）
   - 自動創建對應歌手檔案，標記 `source: 'blogger'`

5. **YouTube 搜尋內嵌**
   - 上傳時顯示 3 個結果揀選

---

## 待開發功能 📋

| 優先級 | 功能 | 說明 |
|--------|------|------|
| P1 | 結他教室 | 教學影片分類：初學/前奏/彈唱 |
| P1 | Band房目錄 | 港九新界練團室 |
| P2 | 樂器舖優惠 | 廣告位 |
| P2 | 用戶筆名系統 | Pen Name 顯示 |
| P3 | 評分留言 | 1-5 星 + 留言 |
| P3 | 域名連結 | polygon.guitars 正式上線 |

---

## 重要設定

### Firebase
- 專案：`polygon-guitar-v2`
- 地區：`asia-east2` (香港)
- 服務：Firestore、Authentication (Google)、Storage

### Cloudinary
- Cloud Name：`drld2cjpo`
- Preset：`artist_photos` (Unsigned)
- 用途：歌手相片上傳

### 首頁與搜尋快取（Firestore 讀取優化）
- **首頁**：完整數據存於 **`cache/homePage`**，每 6 小時過期；每次首頁訪問僅 **1 次 Firestore 讀取**（當快取有效時）。重建：後台 首頁設置 → 「🔄 重建首頁快取」；或 `POST /api/admin/rebuild-home-cache`（Bearer token 或 `x-cron-secret`）。
- **搜尋頁**：完整數據存於 **`cache/searchData`**，每 **24 小時**過期；每次 `/api/search-data` 僅 **1 次讀取**。重建/打破快取：後台 首頁設置 → 「🔄 重建搜尋快取」；或 `POST /api/admin/rebuild-search-cache`（同上 auth）。
- **後台 getAllTabs**：完整列表（不含 content）存於 **`cache/allTabs`**，每 **24 小時**過期；冷啟動時僅 **1 次讀取**（快取有效）。重建：`POST /api/admin/rebuild-all-tabs-cache`（Bearer 或 `x-cron-secret`）。需要 content 的頁面（數據審查、分析樂譜）使用 `getAllTabs({ withContent: true })`。
- 可選：用 cron 定期呼叫上述 API（帶 `CRON_SECRET`）以保持快取常暖。Firestore 規則：`cache` 集合只讀、寫入僅透過 Firebase Admin。

### 環境變數
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=drld2cjpo
YOUTUBE_API_KEY=
BLOGGER_API_KEY=
# 可選：首頁快取重建 API 用（cron 或手動 bust）
CRON_SECRET=   # 或 HOME_CACHE_BUST_SECRET
# Firebase Admin（用於 sitemap、首頁快取寫入等）
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

---

## 開發偏好

### 用戶指令
- **「push」** = 推送到 GitHub（`git add -A && git commit -m "..." && git push`）

### ⚠️ 重要規則：每次更改必須部署
> **任何代碼修改後，必須立即部署到 Vercel，確保網上版本同步更新**

**部署流程：**
```bash
# 1. 確認所有更改
git status

# 2. 提交更改
git add -A
git commit -m "描述更改內容"
git push

# 3. 部署到 Vercel
vercel --prod
```

**部署後檢查：**
- 確認 Production URL 正常運作
- 測試修改的功能是否正常
- 檢查 Console 有無錯誤

---

### 編碼風格
- **說明／註解／AI 回覆**：用**繁體中文**（粵語口語可），**唔好用簡體字**
- 使用 JavaScript（非 TypeScript）
- Tailwind CSS 優先
- 手機版優先設計（Mobile First）
- 深色模式為預設

### 響應式斷點
```css
/* 手機 */
< 768px

/* 桌面 */
>= 768px (md:)
```

### 常用 Tailwind 組合
```css
/* 卡片 */
bg-[#121212] rounded-xl border border-gray-800

/* 按鈕 - 主要 */
bg-[#FFD700] text-black hover:bg-yellow-400

/* 按鈕 - 次要 */
bg-[#282828] text-white hover:bg-[#3E3E3E]

/* 文字 */
text-white / text-[#B3B3B3] / text-[#FFD700]
```

---

## Spotify 資料擴展計劃 📊

分階段實現 Spotify API 數據整合，用於歌手排名和資料豐富化。

### 第一階段 ✅ 已完成（2026-02-13）
- **粉絲數 (`spotifyFollowers`)**：用於「Spotify Choice」排名
- **人氣度 (`spotifyPopularity`)**：0-100 分
- **音樂類型 (`spotifyGenres`)**：如 Cantopop、Mandopop
- **應用**：歌手列表排序選項「🎵 Spotify Choice」

### 第二階段 🔄 進行中
- **多尺寸相片**：儲存 640px (Hero)、300px (卡片)、64px (列表)
- **歌手頁面顯示**：粉絲數、音樂類型標籤

### 第三階段 📋 待定
- **熱門歌曲 Top 10**：顯示歌手熱門歌曲
- **專輯資料**：專輯封面、發行年份

### 第四階段 📋 待定
- **歌曲詳情**：BPM、調性 (Key)、試聽連結
- **應用於譜頁面**：顯示歌曲 BPM、原調驗證

---

## Blogger 遷移詳情

### 遷移進度
| 批次 | 範圍 | 數量 | 狀態 |
|------|------|------|------|
| 第 1 批 | 第 1-100 篇 | 94 份 | ✅ 完成 |
| 第 2-5 批 | 第 101-500 篇 | 334 份 | ✅ 完成 |
| 總計 | 已遷移 428 篇 | ~3100 份 | 🔄 進行中 |

**注意**：實際導入 94 份（過濾咗 6 篇教學/測驗文）

### 相關檔案

| 檔案 | 用途 |
|------|------|
| `scripts/migrate-blogger.js` | 主要遷移腳本，支援分批遷移 (`--limit`, `--offset`) |
| `scripts/import-30-tabs.js` | 最初測試用，導入前 30 篇 |
| `scripts/import-100-tabs.js` | 導入第 31-130 篇（已執行） |
| `scripts/fix-migrated-tabs.js` | 修復已導入但缺少 artistId 的 tabs |
| `scripts/backfill-tab-artist-photo.js` | 為缺少封面的樂譜寫入 tab.artistPhoto（從 artists）。預設每次最多 200 次寫入以免超 quota；`--limit=N` 自訂；`--all` 不設上限：`node scripts/backfill-tab-artist-photo.js [--dry-run] [--limit=200] [--all]` |
| `scripts/fix-all-artist-names.js` | 修復雙語歌手名 + 合併重複歌手（命令列工具） |
| `scripts/fill-playlist-by-lyricist.js` | 按填詞人（如林夕）將符合嘅歌寫入指定 playlist：`node scripts/fill-playlist-by-lyricist.js 林夕 <playlistId>` |
| `pages/admin/import-tabs.js` | 後台手動導入頁面（單首/CSV 批量） |
| `pages/admin/migrated-tabs.js` | **遷移樂譜管理後台**（查看/編輯/刪除/修復問題、維基搜尋） |
| `pages/admin/artists-v2.js` | **歌手管理 V2**（統一管理、多選批量設置分類） |
| `pages/admin/merge-artists.js` | **合併重複歌手**（自動檢測中英文重複、手動合併） |
| `pages/admin/data-review.js` | **數據審查工具**（找出可疑歌手/歌曲、✓正確標記、批量刪除） |
| `pages/admin/fix-artist.js` | **歌手名修復工具**（修復 UNKNOWN 歌手，如「新青年理髮廳」） |
| `pages/admin/analytics.js` | **全站瀏覽統計**（類似 GA，追蹤所有頁面） |

### 標題解析邏輯
```javascript
// 支援格式：
// "歌手 - 歌名"
// "歌手 | 歌名"  
// "歌名 by 歌手"
// "歌手 歌名"（已知歌手列表匹配）
```

### 內容提取
- 原調：匹配 `原調: X` / `Key: X`
- Capo：匹配 `Capo: X` / `夾X`
- YouTube：提取 `youtube.com/watch?v=` 或 `youtu.be/`
- HTML 轉換：`<br>` → `\n`, `</p>` → `\n\n`

### 分批遷移命令
```bash
# 測試模式（只分析不寫入）
node scripts/migrate-blogger.js --limit=50

# 第一批：1-200
node scripts/migrate-blogger.js --write --limit=200 --offset=0

# 第二批：201-400
node scripts/migrate-blogger.js --write --limit=200 --offset=200

# 全部一次過（約需 5-10 分鐘）
node scripts/migrate-blogger.js --write --all
```

### 遷移數據結構
```javascript
{
  title: string,        // 歌名
  artist: string,       // 歌手名
  artistId: string,     // 自動生成
  content: string,      // 純文本樂譜
  originalKey: string,  // 提取的原調（默認 C）
  capo: number,         // 提取的 Capo（可為 null）
  youtubeUrl: string,   // 提取的 YouTube 連結
  source: 'blogger',    // 標記來源
  createdAt: Date,      // 原發布日期
  views: 0, likes: 0, viewCount: 0
}
```

### 過濾規則
- 自動跳過：鼓譜（`drum`、`鼓譜`）、教學文（`教學`）、木箱鼓
- 重複檢測：以 `title` + `artist` 為唯一鍵

---

## 用戶流程

```
用戶上傳樂譜
    ↓
輸入歌手名
    ↓
自動搜尋維基百科
    ↓
建立歌手檔案（待審核）
    ↓
管理員後台確認
    ↓
樂譜正式顯示
```

---

## 關鍵決定記錄

| 日期 | 決定 | 原因 |
|------|------|------|
| 初期 | 唔用 Logo（遲啟上傳 PNG）| 簡化初期開發 |
| 初期 | 擱置 Imgur，改用 Cloudinary | 更穩定嘅匿名上傳 |
| 初期 | 簡單 Parser | 用戶輸入格式唔統一 |
| 初期 | 深色模式優先 | Spotify 風格，護眼 |
| 2026-02-07 | 新增後台管理工具 | 遷移樂譜管理、歌手管理 V2、合併重複歌手 |
| 2026-02-07 | 修復歌手改名問題 | 查詢函數支援多種 ID 變體，解決改名後睇唔到歌嘅問題 |
| 2026-02-07 | 維基自動搜尋修復 | 恢復自動搜尋歌手資料功能，自動填入相片/簡介/年份 |
| 2026-02-07 | 年份欄位分開 | 歌手資料分為「出生年份」同「出道年份」兩個獨立欄位 |
| 2026-02-07 | 智能歌手合併檢測 | 改進重複檢測算法，支援簡繁轉換、相似度匹配、部分英文名匹配 |
| 2026-02 | 改用 Pages Router | 簡化 Firebase 整合 |

---

### 2026-02-07 (Part 6) - Blogger 遷移第 2-5 批 (第 101-500 篇)

#### 遷移結果
| 項目 | 數量 |
|------|------|
| **成功導入** | 334 份樂譜 |
| **自動跳過** | 64 篇（教學/測驗/鼓譜）|
| **已存在** | 1 份 |
| **失敗** | 1 份（歌手名含 "/" 字符）|
| **處理範圍** | 第 101-500 篇 |

#### 清理工作
- **刪除 Fingerstyle 譜**: 110 個（根據用戶要求，Fingerstyle 獨奏譜不遷移）

#### 新增歌手類型（已過濾 Fingerstyle）
- **熱門歌手**: 鄭秀文、ROVER、林家謙、盧廣仲、AGA
- **國際歌手**: Lady Gaga、Ed Sheeran、Charlie Puth

#### Blogger 遷移完整記錄 ✅

| 批次 | 範圍 | 導入數量 | 累計 |
|------|------|----------|------|
| 第 1 批 | 1-100 | 94 | 94 |
| 第 2-5 批 | 101-500 | 334 | 428 |
| 第 6 批 | 501-800 | 291 | 719 |
| 第 7 批 | 801-1000 | 191 | 910 |
| 第 8 批 | 1001-1400 | 373 | 1283 |
| 第 9 批 | 1401-1800 | 282 | 1565 |
| 第 10 批 | 1801-2200 | 391 | 1956 |
| 第 11 批 | 2201-2600 | 398 | 2354 |
| 第 12 批 | 2601-3000 | 395 | 2749 |
| 第 13 批 | 3001-3521 | **497** | **3246** |

**總結**: 從 Blogger 共 3,521 篇文章中成功導入 **3,246 份樂譜**，自動過濾約 275 篇非樂譜內容。

**主要歌手**: 陳奕迅(60+)、周杰倫(50+)、張學友(30+)、五月天(25+)、楊千嬅(20+)、容祖兒(20+)、周柏豪(20+)、Beyond(15+)

#### 2026-02-07 - 歌手資料修復
1. **清理錯誤歌手名**: 
   - 刪除 18 個無效歌手（課程、產品、單個字母等）
   - 修復 12 個錯誤歌手名（如 "Ben.E.King Stand" → "Ben E. King"）
   - 合併重複歌手（如 "At 17" + "At17" → "at17"）

2. **維基百科自動填充**:
   - 已為 100+ 歌手自動獲取維基資料
   - 補充：相片、簡介、性別類型、出生年份
   - 修復後統計：487 個歌手中 139 個已有性別類型 (29%)

3. **修復後歌手統計**:
   - 總歌手數：487
   - 有性別類型：139 (29%)
   - 有維基相片：121 (25%)
   - 有出生年份：87 (18%)

#### 2026-02-07 更新
1. **出譜者名稱統一為 uploaderPenName**: 顯示與寫入一律用 `uploaderPenName`；舊資料可執行 `node scripts/backfill-uploader-pen-name.js` 將 `arrangedBy` 抄入 `uploaderPenName`。
2. **批量清理元數據**: 創建 `extract-metadata-from-content.js` 腳本，從內容中提取「曲：xxx 詞：xxx Key:xxx Arranged By xxx」格式，存入對應欄位並從內容中刪除該行
   - 已處理 85 份樂譜
   - 提取並更新：作曲、填詞、原調、編譜者

---

## 工作摘要

### 2026-02-13 - 瀏覽數統計改進 + 數據審查工具 + Spotify 擴展

#### 瀏覽數統計改進
- **移除 Session 限制**：每次頁面載入都計數（包括刷新）
- **原理**：類似 Google Analytics，每次 `page_view` 都記錄
- **優點**：準確反映實際訪問量，用戶多次練習同一首歌都會計
- **Firestore 規則**：允許任何人更新 `viewCount` 欄位，無需登入

#### 新增歌手名修復工具 `/admin/fix-artist`
用於快速修復被錯誤標記為 UNKNOWN 的歌手：

**預設快速修復：**
| 按鈕 | 搜尋關鍵字 | 修復後歌手名 |
|------|------------|--------------|
| 新青年理髮廳 | 新青年、理髮廳 | 新青年理髮廳 |
| per se | per se | per se |
| Serrini | serrini、樹妮妮 | Serrini |
| Ian 陳卓賢 | iii、ian chan | Ian 陳卓賢 |

**功能：**
- 一鍵搜尋所有相關歌曲（包括標題或歌手名包含關鍵字）
- 自動創建歌手（如果不存在）
- 批量修復所有歌曲的 `artist`、`artistId`、`artistSlug`
- 也可逐個歌曲單獨修復

#### 新增全站頁面瀏覽統計 `/admin/analytics`
類似 Google Analytics 的全站瀏覽追蹤系統：

**功能：**
- **全站追蹤**：每個頁面（樂譜、歌手、首頁、搜尋等）都會記錄
- **實時更新**：今日瀏覽數實時顯示
- **時間統計**：今日、昨日、近7天、近30天、總瀏覽
- **頁面分布**：按頁面類型統計（樂譜頁、歌手頁、首頁等）
- **熱門頁面**：瀏覽量最高的頁面排行
- **最近訪問**：實時顯示最近的訪問記錄

**技術實現：**
- 在 `_app.js` 使用 `routeChangeComplete` 事件追蹤所有路由變化
- 數據儲存在 Firestore `pageViews` 集合
- 記錄信息：頁面類型、ID、標題、路徑、時間、屏幕分辨率、語言等
- **包含所有訪客**（包括未登入用戶）
- **自動過濾機器人**（檢查 User Agent）

**頁面類型：**
| 類型 | 說明 |
|------|------|
| `tab` | 樂譜頁面 |
| `artist` | 歌手詳情頁 |
| `artists-list` | 歌手列表頁 |
| `home` | 首頁 |
| `search` | 搜尋頁 |
| `library` | 樂譜庫 |
| `playlist` | 歌單頁 |
| `admin` | 後台頁面 |

#### 數據審查工具 `/admin/data-review`

#### 新增數據審查工具 `/admin/data-review`
用於找出並清理資料庫中可疑的歌手和歌曲：

**可疑歌手檢測規則：**
| 規則 | 說明 | 圖示 |
|------|------|------|
| 單個字母 | A, B, C 等 | 🔤 |
| 純數字 | 123 等 | 🔢 |
| 名稱過短 | 2字或以下 | ✂️ |
| 教學/課程 | 包含教學關鍵詞 | 📚 |
| 排行榜 | 排行榜/排名 | 📊 |
| 攻略指南 | 攻略/指南 | 🗺️ |
| 測驗考試 | 測驗/Quiz | 📝 |
| 產品/商店 | 商品/樂器店 | 🛍️ |
| 鼓譜 | Drum/鼓譜 | 🥁 |
| Ukulele | 烏克麗麗 | 🎸 |
| 沒有歌曲 | 無關聯歌曲 | 📭 |

**可疑歌曲檢測規則：**
| 規則 | 說明 | 圖示 |
|------|------|------|
| 教學內容 | 課程/教學 | 📚 |
| 測驗內容 | 測驗/考試 | 📝 |
| 非結他樂器 | Drum/Ukulele | 🥁 |
| 目錄索引 | 目錄/列表 | 📂 |
| Fingerstyle | 指彈譜 | 👆 |
| 內容過短 | 少於20字 | 📄 |
| 標題過長 | 超過100字 | 📏 |

**功能：**
- 顯示統計：總數 vs 可疑數 vs 已審查數
- 分類篩選：點擊標籤過濾
- 批量操作：多選後批量刪除
- 單個刪除：每個項目獨立刪除按鈕
- 查看詳情：跳轉到歌手/歌曲頁面
- **✓ 正確標記**：標記項目為已審查，以後不再顯示
- **保持捲動**：刪除/標記後不重新載入，保持操作流暢

#### 數據審查工具 UX 改進
- **不重新載入**：刪除或標記後只從本地 state 移除，不重新載入全部數據
- **保持捲動位置**：操作後保持頁面捲動位置，提升審查效率
- **✓ 正確按鈕**：添加綠色「✓ 正確」按鈕，標記項目為已審查 (`reviewedAt` + `isReviewed`)
- **已審查統計**：顯示已審查項目數量
- **過濾已審查**：自動過濾掉已標記的項目

#### Spotify 資料擴展第一階段（已完成）
- 粉絲數追蹤 (`spotifyFollowers`)
- Spotify Choice 排名排序
- 人氣度 (`spotifyPopularity`) 和音樂類型 (`spotifyGenres`)

---

### 2026-02-07 (Part 4) - Blogger 遷移完成 + 歌手資料修復

#### Blogger 遷移總結
| 批次 | 範圍 | 導入數量 | 累計 |
|------|------|----------|------|
| 第 1 批 | 1-100 | 94 | 94 |
| 第 2-5 批 | 101-500 | 334 | 428 |
| 第 6 批 | 501-800 | 291 | 719 |
| 第 7 批 | 801-1000 | 191 | 910 |
| 第 8 批 | 1001-1400 | 373 | 1283 |
| 第 9 批 | 1401-1800 | 282 | 1565 |
| 第 10 批 | 1801-2200 | 391 | 1956 |
| 第 11 批 | 2201-2600 | 398 | 2354 |
| 第 12 批 | 2601-3000 | 395 | 2749 |
| 第 13 批 | 3001-3521 | 497 | **3246** |

**總計**: 從 Blogger 共 **3,521** 篇文章中成功導入 **3,246 份樂譜**

#### 歌手資料修復
1. **清理錯誤歌手名**: `cleanup-artists.js`
   - 刪除 18 個無效歌手（課程、產品、單個字母如 A/C/V/E）
   - 修復 12 個錯誤歌手名（如 "Ben.E.King Stand" → "Ben E. King"）
   - 合併重複歌手（如 "At 17" + "At17" → "at17"）

2. **維基百科自動填充**: `fix-artists-wiki.js`
   - 已為 100+ 歌手自動獲取維基資料
   - 補充：相片、簡介、性別類型、出生年份
   - 修復後：487 個歌手中 139 個已有性別類型 (29%)

#### 編譜者功能
1. **提取編譜者**: 從樂譜內容自動提取 "Arranged By xxx"
2. **上傳者筆名**: 新增 `uploaderPenName` 欄位
3. **顯示優化**: 編譜者顯示在 Header（與 Key 同一行），避免重複

---

### 2026-02-07 (Part 2) - Blogger 遷移第 1 批 (第 1-100 篇)

#### 遷移結果
| 項目 | 數量 |
|------|------|
| **成功導入** | 94 份樂譜 |
| **自動跳過** | 6 篇（教學/測驗/空標題）|
| **新建歌手** | 62 個 |

#### 過濾規則（已加入 `migrate-blogger-v2.js`）
自動跳過以下關鍵詞：
```javascript
'drum', '鼓譜', '教學', '測驗', 'Quiz', '常識', '問題', '題目',
'木箱鼓', 'cajon', 'kalimba', '鋼琴教學', '課程', '團購',
'目錄', '排行榜', 'Rockschool', 'Party', 'Cover'
```

#### Unknown 歌手修正（17首）
| # | 原標題 | 修正後 | 標籤 |
|---|--------|--------|------|
| 1 | 謝雅兒《我們都 | 謝雅兒 - 我們都(可以)是天使 | |
| 2 | 草蜢 失戀 | 草蜢 - 失戀 | |
| 3 | 父親節必唱 郭富城 強 | 郭富城 - 強 | 父親節必唱 |
| 4 | 心急人上 | Cookies - 心急人上 | |
| 5 | 如果太多牛奶味 | 朱咪咪 - 如果太多牛奶味 | 廣告歌 |
| 6 | 周國賢 離魂記 | 周國賢 - 離魂記 | |
| 7 | Tiger邱傲然 問多一次 | Tiger 邱傲然 - 問多一次 | |
| 8 | 勇気100％ 忍者亂太郎主題曲 | 忍者亂太郎 - 勇気100％ | 動畫主題曲 |
| 9 | 陳百強 念親恩 | 陳百強 - 念親恩 | |
| 10 | 《伸手觸碰那些夢》| 永倫籃球會 - 伸手觸碰那些夢 | 主題曲 |
| 11 | 1994 TYSON YOSHI & 周殷廷 | TYSON YOSHI - 1994 (feat. 周殷廷) | 合唱 |
| 12 | 陳曉東 水瓶座 | 陳曉東 - 水瓶座 | |
| 13 | Forward《出走半生》| Forward - 出走半生 | |
| 14 | 點心歌 單音譜 | 兒歌 - 點心歌 | 兒歌、單音譜 |
| 15 | 愛後餘生 | 謝霆鋒 - 愛後餘生 | |
| 16 | 最佳位置 | 陳慧琳 - 最佳位置 | |
| 17 | 分手總要在雨天 | 張學友 - 分手總要在雨天 | |

#### 新增歌手（11個）
謝雅兒、草蜢、Cookies、朱咪咪、周國賢、Tiger 邱傲然、忍者亂太郎、永倫籃球會、TYSON YOSHI、Forward、兒歌

#### 維基百科自動更新
- 執行 `fetch-wiki-for-artists.js` 自動抓取 62 個歌手資料
- 獲取：歌手類型、出道年份、出生年份、維基圖片

#### 歌手類型統計（62個）
| 類型 | 數量 |
|------|------|
| 男歌手 (male) | 37個 |
| 女歌手 (female) | 14個 |
| 組合 (group) | 7個 |
| 其他 (other) | 4個 |

**其他類別**：兒歌、Forward、永倫籃球會、忍者亂太郎

---

### 2026-02-07 (Part 3) - Barre 和弦檢測更新

#### 問題
原有 `lib/tabAnalysis.js` 嘅 Barre 和弦檢測只包含升調（sharp）和弦，**漏咗降調（flat）和弦**如 Ab、Bb、Db、Eb、Gb。

#### 修正內容
更新 `BARRE_PATTERNS` 陣列，全面支援：

| 類別 | 包含和弦 | 備註 |
|------|----------|------|
| ~~F 系列~~ | ~~F~~ | **F 改為 Non-Barre**（可簡化按）|
| F 變體 | Fm, F7, Fmaj7, Fadd9, Fsus4 | 仍需 Barre |
| B 系列 | B, Bm, B7, Bm7, Bb, Bbm, Bbm7 |
| C# / Db | C#, C#m, C#7, Db, Dbm |
| F# / Gb | F#, F#m, F#7, Gb, Gbm |
| G# / Ab | G#, G#m, Ab, Abm, Abmaj7, Abm7 |
| Bb / A# | Bb, Bbm, Bb7, A#m |
| Eb / D# | Eb, Ebm, Eb7, D#m |
| 進階形態 | Bm11, Bbm9, C#m9, F#m9, Abm9, Bbm9 |

#### F 和弦處理
- **F** = Non-Barre（簡化按：食指+中指）
- **Fmaj7** = Non-Barre（簡化按：食指+無名指）
- **Fm, F7, Fadd9, Fsus4** = Barre（必需橫按）

#### 測試結果
```
15個獨特和弦：C, Am, F, G, Em, Dm, Ab, Bb, B, F#m, Bm7, E7, Abm, C#m, F#, Fmaj7
Barre 和弦：       Ab, Bb, B, F#m, Bm7,      Abm, C#m, F#      (8個)
開放和弦： C, Am, F,  G, Em, Dm,                E7,     Fmaj7  (8個)
難度評估：進階 (Barre > 5)

常用進行：C G Am F      -> 0 Barre (BB級)
          C G Am Fmaj7  -> 0 Barre (BB級)
          C G Am Fm     -> 1 Barre (初階)
```

#### 難度評估標準
| Barre 數量 | 難度 |
|-----------|------|
| 0-2 個 | 初階 |
| 3-5 個 | 中級 |
| 5+ 個 | 進階 |

#### 相關檔案
- `lib/tabAnalysis.js` - 和弦分析邏輯
- 自動標籤：`無Barre和弦`、`大量橫按`

---

### 2026-02-07 (Part 5) - UI 修復完成

#### 完成項目
1. **歌手頁面手機版優化**
   - Key 圓形徽章 `w-7 h-7`（28px），單行顯示 12 個 Key
   - 選中 Key 樣式：`bg-black text-[#FFD700] border border-[#FFD700]`
   - 排名數字縮細
   - 縮圖 `w-8 h-8`（32px），使用 YouTube 縮圖
   - 歌手簡介「ⓘ」按鈕（手機 Modal / 電腦直接顯示）

2. **底部導航顏色修復**
   - 手機版已修復為黃底 `#FFD700` + 黑字

3. **Logo 上傳功能**
   - 後台 `/admin/logo` 頁面已可上傳 PNG Logo

---

### 2026-02-07 (Part 4) - PlayKey Bug 修復

#### 問題
發現部分遷移嘅譜有 `Capo` 值但 `PlayKey` 為空，導致顯示時缺少「Play X」資訊。

#### 修復內容
檢查所有譜，從內容提取 `Play X` 並更新數據庫。

#### 受影響譜（16個）
| 歌手 | 歌名 | Capo | PlayKey |
|------|------|------|---------|
| 陳冠希 | 壞孩子的天空 | 1 | G |
| Cookies | 心急人上 | 4 | C |
| 古天樂 | 像我這一種男人 | 3 | A |
| 張學友 | 吻別 | 1 | F |
| 周國賢 | 離魂記 | 2 | E |
| 謝霆鋒 | 逆行 | 1 | E |
| Dear Jane | 你流淚所以我流淚 | 3 | G |
| Supper Moment | 無盡 | 6 | C |
| 陳百強 | 念親恩 | 3 | C |
| ... | 等等共 16 個 | | |

#### 相關檔案
- `lib/tabs.js` - 轉調計算
- `components/TabContent.js` - 譜面顯示

#### 歌手譜數排名（前5）
| 歌手 | 譜數 |
|------|------|
| Dear Jane | 5 |
| 陳奕迅 | 4 |
| 謝霆鋒 | 4 |
| 張學友 | 4 |
| MC 張天賦 | 4 |

#### 下次遷移命令
```bash
# 第 2 批（第 101-200 篇）
node scripts/migrate-blogger-v2.js --write --limit=100 --offset=100
```

---

### 2026-02-07 (Part 1)

#### 新增功能
1. **創建 AGENTS.md** - 項目記憶檔案系統
2. **遷移樂譜管理後台** `/admin/migrated-tabs`
   - 查看所有遷移樂譜及其來源分佈
   - 編輯樂譜內容、歌手、調性
   - 維基百科搜尋整合
   - 自動修復問題功能
3. **歌手管理 V2** `/admin/artists-v2`
   - 統一顯示所有歌手（32個）
   - 多選批量設置分類（男/女/組合）
   - 編輯歌手資料、照片、Hero
4. **合併重複歌手** `/admin/merge-artists`
   - 自動檢測中英文重複歌手
   - 一鍵合併轉移樂譜
   - 手動選擇合併模式

#### Bug 修復
1. **歌手分類顯示** - `unknown` 同空字符串歸入「其他」分類
2. **歌手改名後查詢** - `getTabsByArtist` 支援多種 ID 變體查詢
3. **雙語歌手名解析** - 支援「中文名 英文名」格式

### 智能匹配算法 (`lib/artistNameMatcher.js`)
改進歌手重複檢測，支援：
- **完全匹配** - 大小寫不敏感
- **簡繁轉換** - 自動處理簡體/繁體中文
- **相似度匹配** - Levenshtein 距離算法，容錯拼寫
- **部分匹配** - 「Eason Chan」vs「Eason」
- **常見變體** - 預設對照表（陳奕迅/Eason Chan 等）
- **匹配原因顯示** - 列出檢測到嘅匹配理由

### 已知限制
- 歌手改名後，舊樂譜的 `artistId` 不會自動更新（已透過查詢函數兼容處理）
- UNKNOWN 歌手需要手動修復

---

## 最近更新（2026-03-01）- Guitar Pro 支援

### GP 檔案上傳與顯示功能

#### 新元件
| 元件 | 功能 | 路徑 |
|------|------|------|
| `GpSegmentUploader` | GP 檔案上傳、預覽、段落選擇 | `components/GpSegmentUploader.jsx` |
| `GpSegmentPlayer` | GP 譜面顯示（含手機版控制） | `components/GpSegmentPlayer.jsx` |

#### 功能特點
1. **檔案上傳**
   - 支援 .gp3, .gp4, .gp5, .gpx, .gp 格式
   - Cloudinary 上傳 + Firebase Storage 後備
   - 自動解析小節數

2. **段落管理**
   - 支援 Intro, Verse, Chorus, Interlude, Solo, Outro, Bridge, Pre-chorus
   - 可選擇開始/結束小節
   - 儲存顯示設置（每行小節數、線條粗細、字體大小）

3. **顯示優化**
   - 深色/淺色主題
   - 手機版控制項（每行 1/2 小節、線條粗細 0.3-1.0、字體 12-20px）
   - 六線譜線條固定 0.8，其他線條可調
   - 隱藏 AlphaTab 水印

4. **測試頁面**
   - `/admin/test-gp-display` - 顏色控制測試
   - `/admin/test-gp-player` - 播放功能測試
   - `/admin/test-gp-upload` - 上傳功能測試

#### 技術實現
- 使用 `@coderline/alphatab` 函式庫
- SVG 渲染引擎
- 本地字體 `Bravura.woff2`
- 範例檔案：`public/samples/幸福摩天輪.gp`

---

## 備註

- 每個歌手可有多張樂譜
- 同一首歌可有多個版本（以 `arrangedBy` 區分）
- 歌手相片先用 Cloudinary，後備維基百科
- 舊譜遷移時標記 `source: 'blogger'`


---

## 最近更新記錄 (2026-02-23)

### 2026-02-23 (Part 4) - Tab頁面封面 + 歌手名保留

**修復內容：**
1. **Tab頁面封面優先顯示 Spotify 專輯相**
   - 優先順序：`albumImage` (Spotify) > `thumbnail` > YouTube 縮圖
   
2. **編輯/新增樂譜時保留用戶輸入嘅歌手名**
   - Spotify搜尋：唔再自動更改歌手名同歌名
   - 維基百科自動填入：唔再自動更改歌手名

---

### 2026-02-23 (Part 3) - 簡譜對齊優化

**修復內容：**
1. **單一和弦（冇|）**都識做和弦行
2. **英文按單詞對位** - "What" 係一個字，唔係每個字母
3. **空格同括號唔對簡譜音符**

---

### 2026-02-23 (Part 2) - 隱藏括號功能修復

**新增：**
- 隱藏括號 `()` 功能改為直接唔 render（之前用 opacity）
- 支援所有模式：純歌詞行、和弦+歌詞對齊行、簡譜對齊模式

---

### 2026-02-23 (Part 1) - 簡譜對齊支援英文

**修復：**
- 簡譜對齊功能支援英文字母
- 括號隱藏改用 `opacity: 0`

---

### 2026-02-20 - 首頁多項修復

**修復內容：**
1. **TabCard 封面圖片 + Fallback**
   - 新增正方形封面圖片顯示（Spotify > YouTube > 歌手相）
   - 無圖片時顯示 🎵 + 歌手名 fallback

2. **首頁圖片移除 hover 響應**
   - 所有圖片移除 `group-hover:scale-105` 效果
   - 移除 `draggable` 屬性防止拖曳

3. **Hero Photo 空位問題**
   - 改用 div 包裝圖片，使用 `object-cover` 填滿

4. **後台自訂區域名稱**
   - 前往 `/admin/home-settings` 頁面
   - 點擊區域名稱可直接編輯

---

### 2026-02-13 - 歌手改名修復

**修復：**
- 使用 `artist.id` 作為連結，保留舊連結不變
- 歌手改名時不更新 `normalizedName`

---

### 2026-02-09 - 後台功能增強

**新增：**
1. **管理員編輯按鈕** - 歌手頁面白色背景編輯按鈕
2. **Hero Photo 上傳** - 歌手編輯頁面支援 Hero 相上傳
3. **MusicBrainz API 修復** - 處理 `releaseYear` undefined 錯誤

---

### 2026-02-08 - 首頁優化

**修復：**
1. **首頁效能優化** - 並行數據獲取、記憶體緩存
2. **手動揀選修復** - 使用 `getTabsByIds` 取代過濾
3. **數字簡譜識別** - 修復高八度符號 (`1'`, `5#`)
4. **UI 統一** - Pill 按鈕寬度統一、移除歌單卡片黃邊

---

### 2026-02-07 - 大量後台功能

**新增後台功能：**
1. **歌手管理 V2** `/admin/artists-v2`
2. **合併重複歌手** `/admin/merge-artists`
3. **數據審查工具** `/admin/data-review`
4. **歌手名修復工具** `/admin/fix-artist`
5. **全站瀏覽統計** `/admin/analytics`
6. **首頁設置** `/admin/home-settings`
7. **分類封面管理** `/admin/category-covers`

**遷移進度：** Blogger 第 13 批完成，共 3246 份樂譜

---

## 備註

- 每個歌手可有多張樂譜
- 同一首歌可有多個版本（以 `arrangedBy` 區分）
- 歌手相片先用 Cloudinary，後備維基百科
- 舊譜遷移時標記 `source: 'blogger'`

