/**
 * 只畀 `pages/tabs/[id].js` 嘅 getStaticProps 用（唔放入 lib/tabs.js，以免 library 等頁 bundle 客戶端時拉入 firebase-admin）。
 * 優先 Admin 讀 tabs/{id}，再試 slug 查詢，最後 fallback getTab（Web SDK）。
 */
export async function getTabForStaticGeneration(idOrSlug) {
  if (!idOrSlug || typeof idOrSlug !== 'string') return null
  try {
    const { getAdminDb } = await import('@/lib/admin-db')
    const adminDb = getAdminDb()
    if (adminDb) {
      // Try as Firestore doc ID first
      const snap = await adminDb.collection('tabs').doc(idOrSlug).get()
      if (snap.exists) {
        return { id: snap.id, ...snap.data() }
      }
      // Try as slug field
      const slugSnap = await adminDb.collection('tabs').where('slug', '==', idOrSlug).limit(1).get()
      if (!slugSnap.empty) {
        const d = slugSnap.docs[0]
        return { id: d.id, ...d.data() }
      }
      const { getTab } = await import('@/lib/tabs')
      const fallback = await getTab(idOrSlug, { skipCache: true })
      return fallback || null
    }
  } catch (e) {
    console.warn('[getTabForStaticGeneration] admin read failed:', idOrSlug, e?.message)
  }
  const { getTab } = await import('@/lib/tabs')
  return getTab(idOrSlug, { skipCache: true })
}
