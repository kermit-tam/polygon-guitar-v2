#!/usr/bin/env node
/**
 * Backfill `slug` field on all existing playlist documents that are missing it.
 * Slug format: title slugified (Chinese chars kept as-is, ASCII lowercased).
 * If the base slug is already taken, appends "-{docId.slice(-4)}" as a suffix.
 *
 * Usage:
 *   node scripts/backfill-playlist-slugs.js --dry-run     # preview changes, no writes
 *   node scripts/backfill-playlist-slugs.js --write        # apply changes
 *
 * Requires FIREBASE_SERVICE_ACCOUNT in .env.local
 */

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
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

const app = initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

function generatePlaylistSlug(title) {
  return (title || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`)

  console.log('Fetching all playlists...')
  const allSnap = await db.collection('playlists').get()
  console.log(`Total playlists: ${allSnap.docs.length}`)

  // Build slug → docId map for existing slugs
  const slugMap = new Map()
  for (const d of allSnap.docs) {
    const slug = d.data().slug
    if (slug) slugMap.set(slug, d.id)
  }
  console.log(`Playlists already with slug: ${slugMap.size}`)

  const missing = allSnap.docs.filter(d => !d.data().slug)
  console.log(`Playlists needing slug: ${missing.length}`)

  let written = 0
  let skipped = 0
  let conflicts = 0

  for (const d of missing) {
    const data = d.data()
    const title = data.title || ''

    if (!title) {
      console.log(`  SKIP ${d.id} — no title`)
      skipped++
      continue
    }

    const baseSlug = generatePlaylistSlug(title)
    if (!baseSlug) {
      console.log(`  SKIP ${d.id} — could not generate slug (title="${title}")`)
      skipped++
      continue
    }

    let slug = baseSlug
    if (slugMap.has(baseSlug) && slugMap.get(baseSlug) !== d.id) {
      slug = `${baseSlug}-${d.id.slice(-4)}`
      conflicts++
      if (slugMap.has(slug) && slugMap.get(slug) !== d.id) {
        slug = `${baseSlug}-${d.id.slice(-6)}`
      }
    }

    slugMap.set(slug, d.id)

    if (dryRun) {
      console.log(`  [DRY] ${d.id} → "${slug}" (title="${title}")`)
    } else {
      await db.collection('playlists').doc(d.id).update({ slug })
      console.log(`  [WRITE] ${d.id} → "${slug}"`)
    }
    written++
  }

  console.log(`\nDone. Processed: ${missing.length}, Written: ${written}, Skipped: ${skipped}, Conflicts resolved: ${conflicts}`)
  if (dryRun) console.log('(Dry run — no changes made. Run with --write to apply.)')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
