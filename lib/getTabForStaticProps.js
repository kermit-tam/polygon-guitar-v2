/**
 * 只畀 `pages/tabs/[id].js` 嘅 getStaticProps 用（唔放入 lib/tabs.js，以免 library 等頁 bundle 客戶端時拉入 firebase-admin）。
 * 優先 Admin 讀 tabs/{id}，再試 slug 查詢，最後 fallback getTab（Web SDK）。
 *
 * 額外：
 *   - 包 try/catch 喺 `.doc()` 呼叫，因為含 `/` 嘅 slug（早期 bad slug）會令 Firestore 路徑解析 throw。
 *   - 加 `previousSlugs` array-contains 查詢，畀已分享出去嘅舊 slug 都搵到對應 tab（之後 page 會 redirect 去 canonical slug）。
 */

// 必須同 lib/tabs.js generateTabSlug 嘅 sanitize 規則一致
const BAD_CHAR_RE = /[?!.,;:'"()\[\]{}@#$%^&*+=|\\/<>~`]/g

function sanitizeSlug(s) {
  if (!s || typeof s !== 'string') return ''
  return s
    .trim()
    .replace(BAD_CHAR_RE, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

async function tryDocId(adminDb, idOrSlug) {
  // Firestore admin doc ID 不能含 `/`，否則會被當路徑分隔符 throw。包 try/catch 安全 short-circuit。
  try {
    const snap = await adminDb.collection('tabs').doc(idOrSlug).get()
    if (snap.exists) return { id: snap.id, ...snap.data() }
  } catch (_) {}
  return null
}

async function trySlugLookup(adminDb, slug) {
  if (!slug) return null
  try {
    const slugSnap = await adminDb.collection('tabs').where('slug', '==', slug).limit(1).get()
    if (!slugSnap.empty) {
      const d = slugSnap.docs[0]
      return { id: d.id, ...d.data() }
    }
  } catch (_) {}
  return null
}

async function tryPreviousSlugLookup(adminDb, slug) {
  if (!slug) return null
  try {
    const snap = await adminDb
      .collection('tabs')
      .where('previousSlugs', 'array-contains', slug)
      .limit(1)
      .get()
    if (!snap.empty) {
      const d = snap.docs[0]
      return { id: d.id, ...d.data() }
    }
  } catch (_) {}
  return null
}

export async function getTabForStaticGeneration(idOrSlug) {
  if (!idOrSlug || typeof idOrSlug !== 'string') return null
  try {
    const { getAdminDb } = await import('@/lib/admin-db')
    const adminDb = getAdminDb()
    if (adminDb) {
      // 1) 直接當 doc ID 試
      const byId = await tryDocId(adminDb, idOrSlug)
      if (byId) return byId

      // 2) 當 slug field 試（exact match）
      const bySlug = await trySlugLookup(adminDb, idOrSlug)
      if (bySlug) return bySlug

      // 3) 當 previousSlugs（已分享出去嘅舊 slug）試
      const byPrev = await tryPreviousSlugLookup(adminDb, idOrSlug)
      if (byPrev) return byPrev

      // 4) 試 sanitize 後再查（針對含 `/` `(` `)` 等 URL 不安全字符嘅舊 slug）
      const sanitized = sanitizeSlug(idOrSlug)
      if (sanitized && sanitized !== idOrSlug) {
        const bySanitized = await trySlugLookup(adminDb, sanitized)
        if (bySanitized) return bySanitized
        const byPrevSanitized = await tryPreviousSlugLookup(adminDb, sanitized)
        if (byPrevSanitized) return byPrevSanitized
      }

      // 5) 最後 fallback Web SDK（已包 try/catch 喺 lib/tabs.js getTab）
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
