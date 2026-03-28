/**
 * 解析站內結他譜連結 → tab id（與求譜「出譜」驗證一致）
 */
export function parsePolygonTabLink(url) {
  const s = (url || '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    const pathMatch = u.pathname.match(/^\/tabs\/([a-zA-Z0-9_-]+)$/)
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
