#!/usr/bin/env node
/**
 * 修復 Firestore tabs 入面 slug 含有 URL 不安全字符（`/`、`(`、`)`、`?` 等）嘅文檔。
 *
 * 早期 `backfill-tab-slugs.js` 嘅 slugify 冇剝走呢啲字符，導致部分舊譜嘅 slug 入面有 `/`、
 * `()` 等，例如：`family-of-the-year-hero-(boyhood-/沒關係-這是愛情-插曲)`。
 *
 * 後果：
 *   - Vercel/Next.js 喺 `[id].js` 收到 `%2F` 會 throw（doc 路徑分隔符衝突）→ 404。
 *   - 即使 slug query fallback，亦因 throw 喺前面而入唔到。
 *
 * 修復步驟：
 *   1. 掃描所有 tabs。
 *   2. 搵出 slug 含 `[?!.,;:'"()\[\]{}@#$%^&*+=|\\/<>~`]` 嘅文檔。
 *   3. 用 `lib/tabs.js` 同款 sanitize 規則重新生成 slug。
 *   4. 將舊 slug 寫入 `previousSlugs` 陣列（方便將來 redirect 用），新 slug 寫入 `slug`。
 *   5. 衝突時加 docId 後 4 位作後綴。
 *
 * Usage:
 *   node scripts/fix-bad-tab-slugs.js --dry-run     # 預覽變更
 *   node scripts/fix-bad-tab-slugs.js --write        # 寫入
 *   node scripts/fix-bad-tab-slugs.js --write --limit=50
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in .env.local
 */

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
require('dotenv').config({ path: '.env.local' })

const path = require('path')

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
if (!serviceAccountPath) {
  console.error('需要 FIREBASE_SERVICE_ACCOUNT 環境變數')
  process.exit(1)
}

const rootDir = path.resolve(__dirname, '..')
const fullPath = path.resolve(rootDir, serviceAccountPath)
const serviceAccount = require(fullPath)

const dryRun = !process.argv.includes('--write')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null

const app = initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

// 必須同 lib/tabs.js generateTabSlug 完全一致
const BAD_CHAR_RE = /[?!.,;:'"()\[\]{}@#$%^&*+=|\\/<>~`]/

function generateTabSlug(artistName, title) {
  const slugify = (s) =>
    (s || '')
      .trim()
      .replace(/[?!.,;:'"()\[\]{}@#$%^&*+=|\\/<>~`]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  const a = slugify(artistName)
  const t = slugify(title)
  if (a && t) return `${a}-${t}`
  return a || t || ''
}

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`)
  if (limit) console.log(`Limit: ${limit}`)

  console.log('Fetching all artists...')
  const artistSnap = await db.collection('artists').get()
  const artistMap = new Map()
  for (const d of artistSnap.docs) {
    const data = d.data()
    artistMap.set(d.id, data.name || d.id)
  }
  console.log(`Loaded ${artistMap.size} artists`)

  console.log('Fetching all tabs...')
  const allSnap = await db.collection('tabs').get()
  console.log(`Total tabs: ${allSnap.docs.length}`)

  // 全 slug map（包括 good slug），用嚟避免 collision
  const slugMap = new Map()
  for (const d of allSnap.docs) {
    const slug = d.data().slug
    if (slug) slugMap.set(slug, d.id)
  }

  // 篩出 bad slug
  const bad = allSnap.docs.filter((d) => {
    const slug = d.data().slug
    return slug && BAD_CHAR_RE.test(slug)
  })
  console.log(`Tabs with bad slug: ${bad.length}`)

  if (bad.length === 0) {
    console.log('Nothing to fix. ✅')
    process.exit(0)
  }

  const toProcess = limit ? bad.slice(0, limit) : bad

  let written = 0
  let skipped = 0
  let conflicts = 0

  for (const d of toProcess) {
    const data = d.data()
    const oldSlug = data.slug

    // Resolve primary artist name
    let artistName = ''
    if (Array.isArray(data.artists) && data.artists[0]) {
      const first = data.artists[0]
      artistName = first.name || artistMap.get(first.id) || first.id || ''
    } else if (Array.isArray(data.artistIds) && data.artistIds[0]) {
      artistName = artistMap.get(data.artistIds[0]) || data.artistIds[0] || ''
    } else if (data.artistId) {
      artistName = artistMap.get(data.artistId) || data.artistId || ''
    } else if (data.artist) {
      artistName = data.artist
    }

    const title = data.title || ''
    const baseSlug = generateTabSlug(artistName, title)
    if (!baseSlug) {
      console.log(`  SKIP ${d.id} — could not generate slug (artist="${artistName}", title="${title}")`)
      skipped++
      continue
    }

    let newSlug = baseSlug
    if (slugMap.has(baseSlug) && slugMap.get(baseSlug) !== d.id) {
      newSlug = `${baseSlug}-${d.id.slice(-4)}`
      conflicts++
      if (slugMap.has(newSlug) && slugMap.get(newSlug) !== d.id) {
        newSlug = `${baseSlug}-${d.id.slice(-6)}`
      }
    }

    if (newSlug === oldSlug) {
      console.log(`  NOOP ${d.id} — slug unchanged ("${oldSlug}")`)
      skipped++
      continue
    }

    // 釋放舊 slug，註冊新 slug
    if (slugMap.get(oldSlug) === d.id) slugMap.delete(oldSlug)
    slugMap.set(newSlug, d.id)

    if (dryRun) {
      console.log(`  [DRY] ${d.id}\n      old: "${oldSlug}"\n      new: "${newSlug}"`)
    } else {
      await db.collection('tabs').doc(d.id).update({
        slug: newSlug,
        previousSlugs: FieldValue.arrayUnion(oldSlug),
      })
      console.log(`  [WRITE] ${d.id}\n      old: "${oldSlug}"\n      new: "${newSlug}"`)
    }
    written++
  }

  console.log(`\nDone. Processed: ${toProcess.length}, Written: ${written}, Skipped: ${skipped}, Conflicts resolved: ${conflicts}`)
  if (dryRun) console.log('(Dry run — no changes made. Run with --write to apply.)')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
