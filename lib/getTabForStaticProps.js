/**
 * 只畀 `pages/tabs/[id].js` 嘅 getStaticProps 用（唔放入 lib/tabs.js，以免 library 等頁 bundle 客戶端時拉入 firebase-admin）。
 * 優先 Admin 讀 tabs/{id}，再 fallback getTab（Web SDK）。
 */
export async function getTabForStaticGeneration(id) {
  if (!id || typeof id !== 'string') return null
  try {
    const { getAdminDb } = await import('@/lib/admin-db')
    const adminDb = getAdminDb()
    if (adminDb) {
      const snap = await adminDb.collection('tabs').doc(id).get()
      if (snap.exists) {
        return { id: snap.id, ...snap.data() }
      }
      const { getTab } = await import('@/lib/tabs')
      const fallback = await getTab(id, { skipCache: true })
      return fallback || null
    }
  } catch (e) {
    console.warn('[getTabForStaticGeneration] admin read failed:', id, e?.message)
  }
  const { getTab } = await import('@/lib/tabs')
  return getTab(id, { skipCache: true })
}
