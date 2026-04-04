#!/usr/bin/env node
/**
 * Backfill `slug` field on all existing tab documents that are missing it.
 * Slug format: "{primary-artist-name}-{song-title}" (Chinese chars kept as-is, ASCII lowercased)
 * If the base slug is already taken, appends "-{docId.slice(-4)}" as a suffix.
 *
 * Usage:
 *   node scripts/backfill-tab-slugs.js --dry-run     # preview changes, no writes
 *   node scripts/backfill-tab-slugs.js --write        # apply changes
 *   node scripts/backfill-tab-slugs.js --write --limit=50
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
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null

const app = initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore(app)

function generateTabSlug(artistName, title) {
  const slugify = (s) =>
    (s || '')
      .trim()
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

  // Pre-fetch all artists for name resolution
  console.log('Fetching all artists...')
  const artistSnap = await db.collection('artists').get()
  const artistMap = new Map()
  for (const d of artistSnap.docs) {
    const data = d.data()
    artistMap.set(d.id, data.name || d.id)
  }
  console.log(`Loaded ${artistMap.size} artists`)

  // Load all existing tabs
  console.log('Fetching all tabs...')
  const allSnap = await db.collection('tabs').get()
  console.log(`Total tabs: ${allSnap.docs.length}`)

  // Build a map of slug → docId for existing slugs
  const slugMap = new Map()
  for (const d of allSnap.docs) {
    const slug = d.data().slug
    if (slug) slugMap.set(slug, d.id)
  }
  console.log(`Tabs already with slug: ${slugMap.size}`)

  // Find tabs without slugs
  const missing = allSnap.docs.filter(d => !d.data().slug)
  console.log(`Tabs needing slug: ${missing.length}`)

  const toProcess = limit ? missing.slice(0, limit) : missing

  let written = 0
  let skipped = 0
  let conflicts = 0

  for (const d of toProcess) {
    const data = d.data()

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

    if (!artistName && !title) {
      console.log(`  SKIP ${d.id} — no artist or title`)
      skipped++
      continue
    }

    const baseSlug = generateTabSlug(artistName, title)
    if (!baseSlug) {
      console.log(`  SKIP ${d.id} — could not generate slug (artist="${artistName}", title="${title}")`)
      skipped++
      continue
    }

    let slug = baseSlug
    if (slugMap.has(baseSlug) && slugMap.get(baseSlug) !== d.id) {
      slug = `${baseSlug}-${d.id.slice(-4)}`
      conflicts++
      // If still conflicts (very unlikely), use longer suffix
      if (slugMap.has(slug) && slugMap.get(slug) !== d.id) {
        slug = `${baseSlug}-${d.id.slice(-6)}`
      }
    }

    // Register slug in map to prevent subsequent docs from using it
    slugMap.set(slug, d.id)

    if (dryRun) {
      console.log(`  [DRY] ${d.id} → "${slug}" (artist="${artistName}", title="${title}")`)
    } else {
      await db.collection('tabs').doc(d.id).update({ slug })
      console.log(`  [WRITE] ${d.id} → "${slug}"`)
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
