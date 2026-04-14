/**
 * POST /api/admin/backfill-uploaded-at
 *
 * One-time backfill: sets `uploadedAt` (Timestamp) on every tab that is missing it.
 * Uses the tab's existing `createdAt` value (Timestamp or ISO string) as the source.
 * Tabs that already have `uploadedAt` are skipped.
 *
 * Processes in pages of 500 and writes in batches of 500.
 * Auth: Bearer <idToken> (super admin).
 */

import { verifyAdmin } from '@/lib/firebase-admin'
import { getAdminDb } from '@/lib/admin-db'

const BATCH_SIZE = 500
const PAGE_SIZE = 500

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const decoded = await verifyAdmin(authHeader.slice(7))
  if (!decoded) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const adminDb = getAdminDb()
  if (!adminDb) {
    return res.status(500).json({ error: 'Admin DB not available' })
  }

  const { Timestamp } = await import('firebase-admin/firestore')

  let lastDoc = null
  let totalScanned = 0
  let totalUpdated = 0
  let totalSkipped = 0

  try {
    while (true) {
      let q = adminDb.collection('tabs').orderBy('__name__').limit(PAGE_SIZE)
      if (lastDoc) q = q.startAfter(lastDoc)

      const snap = await q.get()
      if (snap.empty) break

      // Collect docs that need uploadedAt
      const toUpdate = []
      for (const doc of snap.docs) {
        const data = doc.data()
        if (data.uploadedAt != null) {
          totalSkipped++
          continue
        }

        // Derive uploadedAt from createdAt
        let uploadedAt = null
        const ca = data.createdAt
        if (ca && typeof ca.toDate === 'function') {
          // Already a Firestore Timestamp
          uploadedAt = ca
        } else if (ca && typeof ca === 'string') {
          const parsed = new Date(ca)
          if (!isNaN(parsed.getTime())) {
            uploadedAt = Timestamp.fromDate(parsed)
          }
        } else if (ca && typeof ca === 'object' && ca.seconds != null) {
          // Plain {seconds, nanoseconds} object
          uploadedAt = new Timestamp(ca.seconds, ca.nanoseconds ?? 0)
        }

        if (!uploadedAt) {
          // No usable createdAt — fall back to updatedAt, then epoch so it sorts last
          const ua = data.updatedAt
          if (ua && typeof ua.toDate === 'function') {
            uploadedAt = ua
          } else {
            uploadedAt = Timestamp.fromDate(new Date(0))
          }
        }

        toUpdate.push({ ref: doc.ref, uploadedAt })
      }

      // Batch write in groups of BATCH_SIZE
      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = adminDb.batch()
        for (const { ref, uploadedAt } of toUpdate.slice(i, i + BATCH_SIZE)) {
          batch.update(ref, { uploadedAt })
        }
        await batch.commit()
      }

      totalScanned += snap.docs.length
      totalUpdated += toUpdate.length
      lastDoc = snap.docs[snap.docs.length - 1]

      if (snap.docs.length < PAGE_SIZE) break
    }

    return res.status(200).json({
      ok: true,
      totalScanned,
      totalUpdated,
      totalSkipped,
      message: `Backfill complete. ${totalUpdated} tabs updated, ${totalSkipped} already had uploadedAt.`
    })
  } catch (e) {
    console.error('[backfill-uploaded-at]', e?.message)
    return res.status(500).json({ error: e?.message || 'Backfill failed' })
  }
}
