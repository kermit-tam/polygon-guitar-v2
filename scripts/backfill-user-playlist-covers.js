#!/usr/bin/env node
/**
 * 補齊 userPlaylists.coverImage（只處理非 customCover）。
 *
 * 規則：
 * - customCover === true：跳過（保留手動封面）
 * - 預設只更新「coverImage 為空」的歌單
 * - --all：全部非 customCover 都重算（就算已有 coverImage）
 * - 封面來源：songIds 第一首 tab 的 coverImage > albumImage > thumbnail > YouTube
 *
 * 用法：
 *   node scripts/backfill-user-playlist-covers.js --dry-run
 *   node scripts/backfill-user-playlist-covers.js
 *   node scripts/backfill-user-playlist-covers.js --all
 */

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
require('dotenv').config({ path: '.env.local' })
const path = require('path')
const fs = require('fs')

const dryRun = process.argv.includes('--dry-run')
const includeAll = process.argv.includes('--all')

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
const rootDir = path.resolve(__dirname, '..')
const fullPath = path.resolve(rootDir, serviceAccountPath || '')

if (!serviceAccountPath || !fs.existsSync(fullPath)) {
  console.error('需要 FIREBASE_SERVICE_ACCOUNT（.env.local）指向 service account JSON')
  process.exit(1)
}

const serviceAccount = require(fullPath)
const app = initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

function resolveTabCoverImage(tab) {
  if (!tab) return null
  if (tab.coverImage) return tab.coverImage
  if (tab.albumImage) return tab.albumImage
  if (tab.thumbnail) return tab.thumbnail
  const vid = tab.youtubeVideoId || String(tab.youtubeUrl || '').match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1]
  if (vid) return `https://img.youtube.com/vi/${vid}/mqdefault.jpg`
  return null
}

async function main() {
  console.log(`開始掃描 userPlaylists（${dryRun ? 'dry-run' : 'write'}）...`)
  if (includeAll) console.log('模式：--all（重算所有非 customCover）')

  const snap = await db.collection('userPlaylists').get()
  let skippedCustom = 0
  let skippedHasCover = 0
  let skippedNoSongs = 0
  let skippedNoSource = 0
  let willUpdate = 0
  let updated = 0

  for (const docSnap of snap.docs) {
    const pl = docSnap.data() || {}
    if (pl.customCover === true) {
      skippedCustom += 1
      continue
    }

    const hasCover = !!String(pl.coverImage || '').trim()
    if (!includeAll && hasCover) {
      skippedHasCover += 1
      continue
    }

    const firstSongId = Array.isArray(pl.songIds) ? pl.songIds[0] : null
    if (!firstSongId) {
      skippedNoSongs += 1
      continue
    }

    const tabSnap = await db.collection('tabs').doc(firstSongId).get()
    if (!tabSnap.exists) {
      skippedNoSource += 1
      continue
    }

    const nextCover = resolveTabCoverImage(tabSnap.data())
    if (!nextCover) {
      skippedNoSource += 1
      continue
    }

    const currentCover = String(pl.coverImage || '').trim() || null
    if (currentCover === nextCover) continue

    willUpdate += 1
    if (dryRun) {
      console.log(`[dry-run] ${docSnap.id} "${pl.title || '未命名歌單'}" -> ${nextCover}`)
      continue
    }

    await docSnap.ref.update({
      coverImage: nextCover,
      updatedAt: FieldValue.serverTimestamp()
    })
    updated += 1
    console.log(`✓ ${docSnap.id} "${pl.title || '未命名歌單'}"`)
  }

  console.log('\n完成')
  console.log(`總歌單：${snap.size}`)
  console.log(`可更新：${willUpdate}`)
  console.log(`已更新：${updated}`)
  console.log(`跳過 customCover：${skippedCustom}`)
  console.log(`跳過（已有 cover）：${skippedHasCover}`)
  console.log(`跳過（無 songIds）：${skippedNoSongs}`)
  console.log(`跳過（第一首無可用封面）：${skippedNoSource}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

