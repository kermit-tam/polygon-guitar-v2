/**
 * 解析站內結他譜連結 → `/tabs/` 後嘅 segment（Firestore doc id 或 slug，可含中文）
 * 與求譜「出譜」、叱咤「出譜」驗證一致
 */
export function parsePolygonTabLink(url) {
  const s = (url || '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    let pathname = u.pathname
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
    const pathMatch = pathname.match(/^\/tabs\/([^/?#]+)$/)
    if (!pathMatch) return null
    const host = u.hostname.toLowerCase()
    if (host === 'polygon.guitars' || host.endsWith('.polygon.guitars') || host === 'localhost' || host.startsWith('192.168.') || host.startsWith('127.0.0.1')) {
      return pathMatch[1]
    }
    return null
  } catch {
    return null
  }
}
