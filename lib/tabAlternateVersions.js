import { getGroupKeys } from '@/lib/tabGrouping'
import { getTabArtistId, getTabArtistIds } from '@/lib/tabs'

function titlesOverlap(titleA, titleB) {
  const keysA = new Set(getGroupKeys(titleA || '', ''))
  for (const k of getGroupKeys(titleB || '', '')) {
    if (k && keysA.has(k)) return true
  }
  return false
}

function catalogArtistMatchesTab(catalogArtistId, currentTab) {
  if (!catalogArtistId || !currentTab) return false
  if (catalogArtistId === getTabArtistId(currentTab)) return true
  if (catalogArtistId === currentTab.artistId) return true
  return getTabArtistIds(currentTab).includes(catalogArtistId)
}

/**
 * 搜尋快取內嘅 slim tab（id, title, artistId, uploaderPenName）當中，同歌、同主歌手、唔同出譜筆名嘅其他版本。
 * @param {object} currentTab - Firestore 載入嘅完整 tab
 * @param {Array<{ id: string, title?: string, artistId?: string, uploaderPenName?: string }>} catalogTabs
 * @returns {typeof catalogTabs}
 */
export function findAlternateUploaderVersions(currentTab, catalogTabs) {
  if (!currentTab?.id || !Array.isArray(catalogTabs)) return []
  const curId = currentTab.id
  const curPen = (currentTab.uploaderPenName || '').trim()

  const out = catalogTabs.filter((t) => {
    if (!t?.id || t.id === curId) return false
    if (!catalogArtistMatchesTab(t.artistId, currentTab)) return false
    if (!titlesOverlap(currentTab.title, t.title)) return false
    return (t.uploaderPenName || '').trim() !== curPen
  })

  return out.sort((a, b) => {
    const pa = (a.uploaderPenName || '').localeCompare(b.uploaderPenName || '', 'zh-HK')
    if (pa !== 0) return pa
    return (a.title || '').localeCompare(b.title || '', 'zh-HK')
  })
}
