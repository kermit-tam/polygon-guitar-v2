import { useState, useEffect, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import Link from '@/components/Link'
import { getTab, updateTab, deleteTab, parseCollaborators, normalizeArtistId, clearTabCache, invalidateArtistCaches, invalidateArtistTabsCache, getTabArtistId } from '@/lib/tabs'
import { parseCreditBlock } from '@/lib/tabCredits'
import { useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/Layout'
import NotationEditorModal from '@/components/NotationEditor/NotationEditorModal'
import ArtistAutoFill from '@/components/ArtistAutoFill'
import ArtistInputSimple, { RELATION_OPTIONS } from '@/components/ArtistInputSimple'
import GpSegmentUploader, { SEGMENT_TYPES } from '@/components/GpSegmentUploader'
import YouTubeSearchModal from '@/components/YouTubeSearchModal'
import SpotifyTrackSearch from '@/components/SpotifyTrackSearch'
import { extractYouTubeVideoId } from '@/lib/wikipedia'
import { processTabContent, autoFixTabFormatWithFactor, cleanPastedText } from '@/lib/tabFormatter'
import { uploadToCloudinary, validateImageFile } from '@/lib/cloudinary'
import { auth, db } from '@/lib/firebase'
import { clearArtistMapCache } from '@/lib/useArtistMap'
import { doc, getDoc, updateDoc } from '@/lib/firestore-tracked'
import { ArrowLeft, Music, Moon, Sun, Loader2 } from 'lucide-react'
import {
  peekPendingNotationTex,
  clearPendingNotationTex,
  peekPendingNotationStaffSnapshot,
  clearPendingNotationStaffSnapshot,
  NOTATION_PENDING_BLOCK_ID_SESSION_KEY,
  consumeNotationReturnHandoff,
} from '@/lib/notationEditorBridge'
import { buildNotationEditorSeedFromForm } from '@/lib/notationEditorSeed'
import {
  newNotationBlockId,
  blocksFromTabDoc,
  firstNotationFromBlocks,
  hasAnyNotationTex,
  mergeServerNotationWithClientOnly,
  mergePendingNotationIntoBlocks,
  mergeCachedAndPrevNotationBlocks,
} from '@/lib/notationBlocks'
import {
  readTabEditNotationCache,
  writeTabEditNotationCache,
  clearTabEditNotationCache,
} from '@/lib/tabEditNotationCache'

const NotationAlphaTabPreview = dynamic(
  () => import('@/components/NotationEditor/NotationAlphaTabPreview'),
  { ssr: false }
)

function readPendingNotationBlockIdFromSession() {
  if (typeof window === 'undefined') return null
  try {
    const v = sessionStorage.getItem(NOTATION_PENDING_BLOCK_ID_SESSION_KEY)
    return v != null && v !== '' ? v : null
  } catch (_) {
    return null
  }
}

function clearPendingNotationBlockIdFromSession() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(NOTATION_PENDING_BLOCK_ID_SESSION_KEY)
  } catch (_) {}
}

// Key 對應的 semitone 位置 (C = 0)
const KEY_TO_SEMITONE = {
  'C': 0, 'Db': 1, 'C#': 1, 'D': 2, 'Eb': 3, 'D#': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'Ab': 8, 'G#': 8,
  'A': 9, 'Bb': 10, 'A#': 10, 'B': 11,
  'Cm': 0, 'C#m': 1, 'Dm': 2, 'D#m': 3, 'Ebm': 3, 'Em': 4,
  'Fm': 5, 'F#m': 6, 'Gm': 7, 'G#m': 8, 'Am': 9, 'Bbm': 10, 'Bm': 11
}

// Semitone 對應的 Key (優先使用 flat 給 Major，sharp 給 Minor)
const SEMITONE_TO_KEY_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const SEMITONE_TO_KEY_MINOR = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

const REGIONS = [
  { value: '', label: '請選擇...' },
  { value: 'hongkong', label: '香港' },
  { value: 'taiwan', label: '台灣' },
  { value: 'china', label: '中國' },
  { value: 'asia', label: '亞洲' },
  { value: 'foreign', label: '外國' }
]

const ARTIST_TYPES = [
  { value: 'male', label: '男歌手' },
  { value: 'female', label: '女歌手' },
  { value: 'group', label: '組合' }
]

const KEY_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const KEY_MINOR = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

// 計算 原 Key / Capo / 彈奏 Key：任填兩項，第三項自動算出
// userSetField：用戶剛改的欄位，據此用其餘兩項推算第三項
function calculateKeyAndCapo(originalKey, capo, playKey, userSetField) {
  const capoNum = capo !== '' && capo !== undefined ? parseInt(capo) : NaN
  const validCapo = !isNaN(capoNum) && capoNum >= 0 && capoNum <= 11
  const originalIndex = originalKey ? KEY_TO_SEMITONE[originalKey] : undefined
  const playIndex = playKey ? KEY_TO_SEMITONE[playKey] : undefined

  if (userSetField === 'playKey' && validCapo && playIndex !== undefined) {
    const isMinor = playKey.endsWith('m')
    const semitoneToKey = isMinor ? SEMITONE_TO_KEY_MINOR : SEMITONE_TO_KEY_MAJOR
    const computedOriginalIndex = (playIndex + capoNum) % 12
    const computedOriginal = semitoneToKey[computedOriginalIndex]
    return { originalKey: computedOriginal, capo: capoNum.toString(), playKey }
  }

  if (userSetField === 'capo' && originalIndex !== undefined) {
    if (validCapo) {
      const isMinor = originalKey.endsWith('m')
      const semitoneToKey = isMinor ? SEMITONE_TO_KEY_MINOR : SEMITONE_TO_KEY_MAJOR
      const computedPlayIndex = (originalIndex - capoNum + 12) % 12
      const computedPlayKey = semitoneToKey[computedPlayIndex]
      return { originalKey, capo: capoNum.toString(), playKey: computedPlayKey }
    }
    return { originalKey, capo: '', playKey: originalKey }
  }

  if (userSetField === 'originalKey' && originalIndex !== undefined) {
    const isMinor = originalKey.endsWith('m')
    const semitoneToKey = isMinor ? SEMITONE_TO_KEY_MINOR : SEMITONE_TO_KEY_MAJOR
    if (playKey && playIndex !== undefined) {
      let capoNumComputed = (originalIndex - playIndex + 12) % 12
      return { originalKey, capo: capoNumComputed === 0 ? '' : String(capoNumComputed), playKey }
    }
    if (validCapo) {
      const computedPlayIndex = (originalIndex - capoNum + 12) % 12
      return { originalKey, capo: capoNum.toString(), playKey: semitoneToKey[computedPlayIndex] }
    }
  }

  return { originalKey: originalKey || '', capo: validCapo ? capoNum.toString() : (capo ?? ''), playKey: playKey ?? '' }
}

function FormSection({ title, children, className = '' }) {
  return (
    <section className={`rounded-xl bg-[#121212] border border-neutral-800 overflow-visible ${className}`}>
      {title && (
        <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-neutral-800">
          {title}
        </h2>
      )}
      <div className="px-4 py-5">
        {children}
      </div>
    </section>
  )
}

export default function EditTab() {
  const router = useRouter()
  const rawId = router.query.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const { user, isAuthenticated, isAdmin } = useAuth()
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    artists: [{ name: '', id: null, relation: null }], // 新多歌手系統
    artistType: '',
    originalKey: 'C',
    capo: '',
    playKey: '',
    content: '',
    // 歌手資料
    artistPhoto: '',
    artistBio: '',
    artistYear: '',
    artistBirthYear: '',
    artistDebutYear: '',
    region: '',
    // 歌曲資訊
    songYear: '',
    composer: '',
    lyricist: '',
    arranger: '',
    producer: '',
    album: '',
    bpm: '',
    // 上傳者資料
    uploaderPenName: '', // 出譜者名稱
    remark: '', // 備註（顯示在譜上方）
    // YouTube
    youtubeUrl: '',
    youtubeVideoId: '',
    youtubeVideoTitle: '',
    youtubeChannelTitle: '',
    // 封面圖片
    albumImage: '',
    coverImage: '',
    // 顯示字體 - 默認等寬字體（傳統結他譜格式）
    displayFont: 'mono',
    // GP 段落
    gpSegments: [],
    // GP 顯示主題
    gpTheme: 'dark',
    // Spotify 資訊
    spotifyTrackId: null,
    spotifyAlbumId: null,
    spotifyArtistId: null,
    spotifyUrl: null,
    notationBlocks: []
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [computedKeyField, setComputedKeyField] = useState(null)
  const computedKeyFieldRef = useRef(null)
  const [regionMenuOpenIndex, setRegionMenuOpenIndex] = useState(null)
  const regionMenuRef = useRef(null)
  const [typeMenuOpenIndex, setTypeMenuOpenIndex] = useState(null)
  const typeMenuRef = useRef(null)
  const [originalKeyMenuOpen, setOriginalKeyMenuOpen] = useState(false)
  const originalKeyMenuRef = useRef(null)
  const [capoMenuOpen, setCapoMenuOpen] = useState(false)
  const capoMenuRef = useRef(null)
  const [playKeyMenuOpen, setPlayKeyMenuOpen] = useState(false)
  const playKeyMenuRef = useRef(null)
  const [relationMenuOpen, setRelationMenuOpen] = useState(false)
  const relationMenuRef = useRef(null)
  // 出譜者名稱 autocomplete（僅 Admin 可編輯時顯示）
  const [penNameSuggestions, setPenNameSuggestions] = useState([])
  const [penNameShowDropdown, setPenNameShowDropdown] = useState(false)
  const [penNameSelectedIndex, setPenNameSelectedIndex] = useState(-1)
  const penNameDropdownRef = useRef(null)
  // 歌名／歌手變更時：清空或還原 Spotify 擷取資料（key = artist|||title）
  const spotifySnapshotByKeyRef = useRef({})
  // 撳「獲取歌曲資訊」後，未成功獲取資料嘅輸入欄閃紅框
  const [spotifyFlashRedFields, setSpotifyFlashRedFields] = useState(new Set())
  const spotifyJustAppliedRef = useRef(false)
  /** 防止 loadTab 並行時搶先 consume 記譜 handoff */
  const loadTabGenerationRef = useRef(0)

  // Spotify 歌曲搜尋狀態
  const [isSpotifyModalOpen, setIsSpotifyModalOpen] = useState(false)
  
  // YouTube Modal 狀態
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false)
  const [youTubeAutoSelect, setYouTubeAutoSelect] = useState(false) // 自動選擇第一個結果

  const [notationEditorOpen, setNotationEditorOpen] = useState(false)
  const [notationEditorBlockId, setNotationEditorBlockId] = useState(null)

  const notationEditorSeed = useMemo(() => {
    if (!notationEditorOpen || !notationEditorBlockId) return null
    const block = (formData.notationBlocks || []).find((b) => b.id === notationEditorBlockId)
    return buildNotationEditorSeedFromForm({
      notationStaffSnapshot: block?.notationStaffSnapshot,
      notationAlphaTex: block?.notationAlphaTex,
    })
  }, [notationEditorOpen, notationEditorBlockId, formData.notationBlocks])

  // 相似歌手狀態
  const [similarArtists, setSimilarArtists] = useState([])
  const [useExistingArtistSelected, setUseExistingArtistSelected] = useState(false)
  
  // 歌手列表來自 search-data API（1 cache read），供相似歌手匹配與頭像解析用
  const [artistListFromSearch, setArtistListFromSearch] = useState([])

  // 對齊參數（從 localStorage 讀取或預設 1.1）
  const [alignFactor, setAlignFactor] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tabAlignFactor');
      return saved ? parseFloat(saved) : 1.1;
    }
    return 1.1;
  })
  
  // 解析多歌手（使用 useMemo 確保正確更新）
  const { collaborators } = useMemo(() => parseCollaborators(formData.artist), [formData.artist])
  
  // 檢查相似歌手並自動獲取相片（使用 search-data API，1 cache read，不讀全表 artists）
  useEffect(() => {
    const checkSimilarArtists = async () => {
      if (!formData.artist?.trim() || formData.artist.length < 2) {
        setSimilarArtists([])
        return
      }
      
      try {
        let list = artistListFromSearch
        if (list.length === 0) {
          const res = await fetch('/api/search-data?only=artists')
          const data = await res.json()
          list = data?.artists || []
          setArtistListFromSearch(list)
        }
        
        // 解析多歌手，為每個合作歌手檢查相似
        const { collaborators } = parseCollaborators(formData.artist)
        const foundArtists = []
        
        for (const collabName of collaborators) {
          const inputName = collabName.toLowerCase().replace(/\s+/g, '')
          const inputCore = inputName.match(/[\u4e00-\u9fa5]{2,}/)?.[0] || inputName
          
          for (const artist of list) {
            const artistName = (artist.name || '').toLowerCase().replace(/\s+/g, '')
            const artistCore = artistName.match(/[\u4e00-\u9fa5]{2,}/)?.[0] || artistName
            
            const isMatch = artistCore === inputCore ||
              artistName.includes(inputName) ||
              inputName.includes(artistName) ||
              (inputCore && artistCore && (artistCore.includes(inputCore) || inputCore.includes(artistCore)))
            
            if (isMatch && !foundArtists.find(a => a.id === artist.id)) {
              foundArtists.push(artist)
            }
          }
        }
        
        setSimilarArtists(foundArtists.slice(0, 5))

        if (foundArtists.length > 0 && !formData.artistPhoto && !useExistingArtistSelected) {
          const firstMatch = foundArtists[0]
          const photo = firstMatch.photo || ''
          if (photo) {
            setFormData(prev => ({ ...prev, artistPhoto: photo }))
          }
        }
      } catch (err) {
        console.error('檢查相似歌手失敗:', err)
      }
    }
    
    const timer = setTimeout(checkSimilarArtists, 500)
    return () => clearTimeout(timer)
  }, [formData.artist, artistListFromSearch])

  useEffect(() => {
    if (id && isAuthenticated) {
      loadTab()
    }
    // 唔好將 user?.penName 放依度：會觸發第二次 loadTab，搶先 consume session handoff 後再用 server-only 覆寫 form
  }, [id, isAuthenticated])

  /**
   * 未寫入 Firestore 嘅六線譜段落：全頁重新整理時 prev 會清空，要靠 session 保留。
   * 記譜器已改為頁內 Modal，唔再靠呢個做 edit↔記譜器導航。
   * 必須等 loadTab 完成（!isLoading）；否則初次 render 時 notationBlocks 仍係 [] 會覆寫掉之前 cache 入面嘅第二段。
   */
  useEffect(() => {
    if (!id || typeof window === 'undefined' || isLoading) return
    try {
      writeTabEditNotationCache(id, formData.notationBlocks || [])
    } catch (_) {}
  }, [id, formData.notationBlocks, isLoading])

  // 點擊外部關閉類型、地區、Key 下拉
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (regionMenuRef.current && !regionMenuRef.current.contains(e.target)) setRegionMenuOpenIndex(null)
      if (typeMenuRef.current && !typeMenuRef.current.contains(e.target)) setTypeMenuOpenIndex(null)
      if (originalKeyMenuRef.current && !originalKeyMenuRef.current.contains(e.target)) setOriginalKeyMenuOpen(false)
      if (capoMenuRef.current && !capoMenuRef.current.contains(e.target)) setCapoMenuOpen(false)
      if (playKeyMenuRef.current && !playKeyMenuRef.current.contains(e.target)) setPlayKeyMenuOpen(false)
      if (relationMenuRef.current && !relationMenuRef.current.contains(e.target)) setRelationMenuOpen(false)
      if (penNameDropdownRef.current && !penNameDropdownRef.current.contains(e.target)) setPenNameShowDropdown(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 出譜者名稱 autocomplete：僅 Admin 時依輸入拉取現有名稱
  useEffect(() => {
    if (!isAdmin) return
    const q = (formData.uploaderPenName || '').trim()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pen-names?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        const list = data?.penNames || []
        setPenNameSuggestions(list)
        setPenNameSelectedIndex(-1)
        if (list.length > 0) setPenNameShowDropdown(true)
      } catch (_) {
        setPenNameSuggestions([])
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [isAdmin, formData.uploaderPenName])

  const loadTab = async () => {
    const gen = ++loadTabGenerationRef.current
    try {
      const data = await getTab(id, { skipCache: true })
      if (gen !== loadTabGenerationRef.current) return
      if (!data) {
        router.push('/')
        return
      }

      // Check ownership：createdBy 或 出譜者名稱與 uploaderPenName 一致；admin 可編輯
      const { canUserEditTab, tabUploaderPenNameMatchesUser } = await import('@/lib/tabEditPermission')
      const allowed = canUserEditTab(data, user?.uid, user?.penName, isAdmin)
      if (!allowed) {
        alert('你無權編輯這個譜')
        router.push(`/tabs/${id}`)
        return
      }
      if (gen !== loadTabGenerationRef.current) return

      setIsAuthorized(true)
      setIsOwner(
        data.createdBy === user?.uid || tabUploaderPenNameMatchesUser(data, user?.penName)
      )

      // 歌手名：樂譜可能只存 artistIds/artists（無 artistId），用 getTabArtistId 統一取得主歌手 id，再從 artist/artistName 或 search-data 解析名
      const effectiveArtistId = getTabArtistId(data)
      let resolvedArtistName = (data.artist || data.artistName || '').trim()

      // 歌手相片、類型、地區：缺則用 search-data API 依 effectiveArtistId 解析（1 cache read）；同一 API 用於解析所有歌手（含第二位）的 display name 與 relation
      let artistPhoto = data.artistPhoto || ''
      let fallbackRegion = data.region || ''
      let fallbackArtistType = data.artistType || ''
      let searchDataArtists = []
      const needSearchData = effectiveArtistId || (Array.isArray(data.artists) && data.artists.some(a => a?.id))
      if (needSearchData) {
        try {
          const res = await fetch('/api/search-data?only=artists')
          const apiData = await res.json()
          const artists = apiData?.artists || []
          searchDataArtists = artists
          const match = artists.find(a => a.id === effectiveArtistId || (a.id && a.id.toLowerCase() === effectiveArtistId.toLowerCase()))
          if (match) {
            if (match.photo) artistPhoto = match.photo
            if (!resolvedArtistName && match.name) resolvedArtistName = (match.name || '').trim()
            // 若樂譜冇存地區／類型，用歌手檔案補上（避免顯示 —）
            if (!fallbackRegion && (match.regions?.length || match.region)) {
              const rawRegions = Array.isArray(match.regions) && match.regions.length > 0
                ? match.regions
                : (match.region ? [match.region] : [])
              const resolved = rawRegions
                .map(r => REGIONS.find(x => x.value && (x.value === r || x.label === r)))
                .filter(Boolean)
              fallbackRegion = resolved.length === 0 ? '' : resolved.length === 1 ? resolved[0].value : resolved.map(r => r.value).join('／')
            }
            const validTypes = ['male', 'female', 'group']
            const rawType = match.artistType ?? match.type
            if (!fallbackArtistType && validTypes.includes(rawType)) fallbackArtistType = rawType
          }
          if (artists.length > 0) setArtistListFromSearch(artists)
        } catch (e) {
          console.log('獲取歌手相片失敗:', e)
        }
      }
      if (gen !== loadTabGenerationRef.current) return

      // 將舊資料轉換為新多歌手格式：每位歌手用 search-data 解析 display name；stored role → form relation（feat → 合唱/featuring 下拉）
      const resolveRegionFromMatch = (m) => {
        const rawRegions = Array.isArray(m.regions) && m.regions.length > 0 ? m.regions : (m.region ? [m.region] : [])
        const resolved = rawRegions
          .map(r => REGIONS.find(x => x.value && (x.value === r || x.label === r)))
          .filter(Boolean)
        return resolved.length === 0 ? '' : resolved.length === 1 ? resolved[0].value : resolved.map(r => r.value).join('／')
      }
      const validTypes = ['male', 'female', 'group']
      let parsedArtists = data.artists || [
        {
          name: resolvedArtistName,
          id: effectiveArtistId || null,
          relation: null,
          photo: artistPhoto || data.artistPhoto || ''
        }
      ]
      if (parsedArtists.length > 0) {
        parsedArtists = parsedArtists.map((a, i) => {
          const nameMatch = searchDataArtists.find(x => x.id === a.id || (x.id && a.id && x.id.toLowerCase() === a.id.toLowerCase()))
          const resolvedName = (nameMatch?.name || a.name || '').trim() || (i === 0 ? resolvedArtistName : '')
          const relation = i === 0 ? (a.relation ?? null) : (a.relation ?? (a.role === 'feat' ? 'feat' : 'slash'))
          const photo = i === 0
            ? (artistPhoto || data.artistPhoto || a.photo || '')
            : (nameMatch?.photo || nameMatch?.photoURL || a.photo || '')
          const artistType = i === 0
            ? (a.artistType || fallbackArtistType)
            : (a.artistType ?? (nameMatch ? (validTypes.includes(nameMatch.artistType ?? nameMatch.type) ? (nameMatch.artistType ?? nameMatch.type) : '') : ''))
          const region = i === 0
            ? (a.region || fallbackRegion)
            : (a.region ?? (nameMatch ? resolveRegionFromMatch(nameMatch) : ''))
          return { ...a, name: resolvedName, relation, photo, artistType, region }
        })
      }

      if (gen !== loadTabGenerationRef.current) return

      /** 單一 atomic handoff（獨立 /notation-editor 頁 Save 返回）— Modal 路徑唔用；必須喺 setFormData 之前、全部 await 之後先讀 */
      let notationHandoff = null
      if (typeof window !== 'undefined') {
        const atomic = consumeNotationReturnHandoff()
        if (atomic && atomic.v === 1 && (atomic.alphaTex || atomic.staffSnapshot)) {
          notationHandoff = {
            tex: atomic.alphaTex ?? '',
            staff: atomic.staffSnapshot ?? null,
            blockId: atomic.blockId ?? null,
          }
          clearPendingNotationTex()
          clearPendingNotationStaffSnapshot()
          clearPendingNotationBlockIdFromSession()
        } else {
          const pendingTex = peekPendingNotationTex()
          const pendingStaff = peekPendingNotationStaffSnapshot()
          const pendingBlockId = readPendingNotationBlockIdFromSession()
          if (pendingTex || pendingStaff) {
            notationHandoff = { tex: pendingTex || '', staff: pendingStaff, blockId: pendingBlockId }
            clearPendingNotationTex()
            clearPendingNotationStaffSnapshot()
            clearPendingNotationBlockIdFromSession()
          }
        }
      }

      if (gen !== loadTabGenerationRef.current) return

      setFormData((prev) => {
        if (gen !== loadTabGenerationRef.current) return prev
        const serverBlocks = blocksFromTabDoc(data)
        const cachedBlocks = readTabEditNotationCache(id)
        const clientMerged = mergeCachedAndPrevNotationBlocks(cachedBlocks, prev.notationBlocks)
        let notationBlocks = mergeServerNotationWithClientOnly(serverBlocks, clientMerged)
        if (notationHandoff && (notationHandoff.tex || notationHandoff.staff)) {
          notationBlocks = mergePendingNotationIntoBlocks(
            notationBlocks,
            notationHandoff.tex,
            notationHandoff.staff,
            notationHandoff.blockId
          )
        }
        return {
          title: data.title,
          artist: resolvedArtistName || (parsedArtists[0]?.name) || data.artist || data.artistName || '',
          artists: parsedArtists,
          artistType: fallbackArtistType,
          originalKey: data.originalKey || 'C',
          capo: data.capo || '',
          playKey: (() => {
            const o = data.originalKey || 'C'
            const p = data.playKey || ''
            if (!p) return ''
            if (o.endsWith('m') !== p.endsWith('m')) return '' // major/minor 唔一致時當「同原調」
            return p
          })(),
          content: data.content,
          artistPhoto: artistPhoto || data.artistPhoto || '',
          artistBio: data.artistBio || '',
          artistYear: data.artistYear || '',
          artistBirthYear: data.artistBirthYear || '',
          artistDebutYear: data.artistDebutYear || '',
          region: fallbackRegion,
          songYear: data.songYear || '',
          composer: data.composer || '',
          lyricist: data.lyricist || '',
          arranger: data.arranger || '',
          producer: data.producer || '',
          album: data.album || '',
          bpm: data.bpm || '',
          youtubeUrl: data.youtubeUrl || '',
          youtubeVideoId: data.youtubeVideoId || '',
          youtubeVideoTitle: data.youtubeVideoTitle || '',
          youtubeChannelTitle: data.youtubeChannelTitle || '',
          uploaderPenName: data.uploaderPenName || '',
          remark: data.remark || '',
          viewCount: data.viewCount || 0,
          createdAt: data.createdAt,
          albumImage: data.albumImage || '',
          coverImage: data.coverImage || '',
          displayFont: data.displayFont || 'mono',
          inputFont: data.displayFont || 'mono', // 統一使用 displayFont 作為輸入字體
          gpSegments: data.gpSegments || [],
          gpTheme: data.gpTheme || 'dark',
          // Spotify 資訊（載入時帶入 spotifyFilled* 以便歌曲年份／專輯顯示綠色框）
          spotifyTrackId: data.spotifyTrackId || null,
          spotifyAlbumId: data.spotifyAlbumId || null,
          spotifyArtistId: data.spotifyArtistId || null,
          spotifyUrl: data.spotifyUrl || null,
          spotifyFilledSongYear: data.spotifyTrackId ? (data.songYear ?? '') : '',
          spotifyFilledAlbum: data.spotifyTrackId ? (data.album ?? '') : '',
          notationBlocks,
        }
      })
      if (data.spotifyTrackId) {
        const artist = (data.artist || '').trim()
        const title = (data.title || '').trim()
        const key = `${artist}|||${title}`
        spotifySnapshotByKeyRef.current[key] = {
          songYear: data.songYear ?? '',
          album: data.album ?? '',
          spotifyTrackId: data.spotifyTrackId,
          spotifyAlbumId: data.spotifyAlbumId || null,
          spotifyArtistId: data.spotifyArtistId || null,
          spotifyUrl: data.spotifyUrl || null,
          albumImage: data.albumImage || null,
          spotifyFilledSongYear: data.songYear ?? '',
          spotifyFilledAlbum: data.album ?? ''
        }
      }
      if (effectiveArtistId) setUseExistingArtistSelected(true)
    } catch (error) {
      console.error('Error loading tab:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // 獲取 Spotify 後：空嘅輸入欄閃一下紅框（必須在下方 early return 之前）
  const SPOTIFY_META_FIELDS_EDIT = ['songYear', 'album', 'composer', 'lyricist', 'arranger', 'producer', 'bpm']
  useEffect(() => {
    if (!spotifyJustAppliedRef.current || !formData.spotifyTrackId) return
    spotifyJustAppliedRef.current = false
    const empty = SPOTIFY_META_FIELDS_EDIT.filter(f => !String(formData[f] ?? '').trim())
    if (empty.length === 0) return
    setSpotifyFlashRedFields(new Set(empty))
    const t = setTimeout(() => setSpotifyFlashRedFields(new Set()), 1000)
    return () => clearTimeout(t)
  }, [formData.spotifyTrackId, formData.songYear, formData.album, formData.composer, formData.lyricist, formData.arranger, formData.producer, formData.bpm])

  // Redirect if not logged in
  if (!isAuthenticated && !isLoading) {
    if (typeof window !== 'undefined') {
      router.push('/login')
    }
    return null
  }

  // 從 artists 陣列組出顯示用歌手字串（與 ArtistInputSimple 一致），用於驗證／提交
  const getArtistDisplayName = (artists) => {
    if (!artists?.length) return ''
    const first = (artists[0]?.name ?? '').trim()
    if (artists.length === 1) return first
    return first + artists.slice(1).map(a => {
      const sep = RELATION_OPTIONS.find(o => o.value === (a?.relation || 'slash'))?.separator || ' / '
      return sep + (a?.name ?? '').trim()
    }).join('')
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.title.trim()) {
      newErrors.title = '請輸入歌名'
    }
    const artistName = (formData.artist || getArtistDisplayName(formData.artists) || '').trim()
    if (!artistName) {
      newErrors.artist = '請輸入歌手名'
    }
    const hasText = !!formData.content.trim()
    const hasNotation = hasAnyNotationTex(formData.notationBlocks)
    if (!hasText && !hasNotation) {
      newErrors.content = '請輸入譜內容或加入六線譜'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const prepareSubmitPayload = async () => {
    let penNameToUse = (formData.uploaderPenName || '').trim() || '結他友'
    if (!isAdmin) {
      try {
        const userRef = doc(db, 'users', user.uid)
        const userSnap = await getDoc(userRef)
        if (userSnap.exists()) {
          const userData = userSnap.data()
          const fromProfile = (userData.penName || '').trim()
          if (fromProfile) {
            penNameToUse = fromProfile
          } else {
            penNameToUse = (userData.displayName || '').trim() || (userData.email || '').split('@')[0]?.trim() || '結他友'
            await updateDoc(userRef, { penName: penNameToUse, updatedAt: new Date().toISOString() })
          }
        }
      } catch (_) {}
    }
    const artistDisplay = (formData.artist || getArtistDisplayName(formData.artists) || '').trim()
    const firstNotation = firstNotationFromBlocks(formData.notationBlocks)
    const rawData = {
      ...formData,
      artist: artistDisplay,
      artists: formData.artists,
      uploaderPenName: penNameToUse,
      inputFont: formData.displayFont,
      notationBlocks: formData.notationBlocks || [],
      notationAlphaTex: firstNotation.notationAlphaTex,
      notationStaffSnapshot: firstNotation.notationStaffSnapshot,
    }

    const content = (rawData.content || '').trim()
    const parsedCredits = content ? parseCreditBlock(content) : null
    if (parsedCredits) {
      const empty = (v) => (v === undefined || v === null || String(v).trim() === '')
      if (empty(rawData.composer) && parsedCredits.composer) rawData.composer = parsedCredits.composer
      if (empty(rawData.lyricist) && parsedCredits.lyricist) rawData.lyricist = parsedCredits.lyricist
      if (empty(rawData.arranger) && parsedCredits.arranger) rawData.arranger = parsedCredits.arranger
      if (empty(rawData.producer) && parsedCredits.producer) rawData.producer = parsedCredits.producer
    }

    const submitData = Object.fromEntries(Object.entries(rawData).filter(([_, v]) => v !== undefined))

    if (submitData.gpSegments) {
      submitData.gpSegments = submitData.gpSegments.map((seg) => {
        const cleanSeg = { ...seg }
        Object.keys(cleanSeg).forEach((key) => {
          if (cleanSeg[key] === undefined) delete cleanSeg[key]
        })
        return cleanSeg
      })
    }

    return submitData
  }

  const runTabUpdatePipeline = async (submitData) => {
    const updatedTab = await updateTab(id, submitData, user.uid, isAdmin, user?.penName || '')
    try { sessionStorage.setItem('pg_tab_just_updated', id) } catch (e) {}
    if (typeof window !== 'undefined') {
      clearTabCache(id)
      invalidateArtistCaches()
      const primaryName = (formData.artists?.[0]?.name || formData.artist || '').trim()
      const artistId = formData.artists?.[0]?.id || updatedTab?.artistId || (primaryName && normalizeArtistId(primaryName))
      if (artistId) {
        try { localStorage.removeItem(`pg_artist_${artistId}`) } catch (e) {}
        invalidateArtistTabsCache(artistId)
      }
      try {
        await fetch('/api/search-data?bust=1')
      } catch (e) {}
      try {
        const token = await auth.currentUser?.getIdToken?.()
        if (token) {
          const patchRes = await fetch('/api/patch-caches-on-new-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tab: updatedTab || { id, ...submitData }, action: 'update' })
          })
          if (!patchRes.ok) {
            const j = await patchRes.json().catch(() => ({}))
            console.warn('[patch-caches] update failed:', patchRes.status, j)
          }
        }
      } catch (e) {
        console.warn('[patch-caches] update patch error:', e)
      }
      try {
        await fetch(`/api/revalidate-tab?id=${id}`)
      } catch (e) {}
      clearArtistMapCache()
    }
    return updatedTab
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!validate()) return

    setIsSubmitting(true)
    try {
      const submitData = await prepareSubmitPayload()
      console.log('Submitting data:', submitData)
      await runTabUpdatePipeline(submitData)
      try {
        clearTabEditNotationCache(id)
      } catch (_) {}
      router.push(`/tabs/${id}?updated=1`)
    } catch (error) {
      console.error('Update tab error:', error)
      alert('更新失敗：' + error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const openNotationEditorForBlock = (blockId) => {
    setNotationEditorBlockId(blockId)
    setNotationEditorOpen(true)
  }

  const handleNotationEditorSave = ({ notationAlphaTex, notationStaffSnapshot, blockId }) => {
    const bid = blockId || notationEditorBlockId
    if (!bid) return
    setFormData((prev) => ({
      ...prev,
      notationBlocks: (prev.notationBlocks || []).map((b) =>
        b.id === bid ? { ...b, notationAlphaTex, notationStaffSnapshot } : b
      ),
    }))
  }

  const closeNotationEditor = () => {
    setNotationEditorOpen(false)
    setNotationEditorBlockId(null)
  }

  const handleAddNotationBlock = () => {
    const nid = newNotationBlockId()
    setFormData((prev) => {
      const prevBlocks = prev.notationBlocks || []
      const nextBlocks = [
        ...prevBlocks,
        { id: nid, notationAlphaTex: '', notationStaffSnapshot: null },
      ]
      return {
        ...prev,
        notationBlocks: nextBlocks,
      }
    })
  }

  const removeNotationBlock = (blockId) => {
    setFormData((prev) => ({
      ...prev,
      notationBlocks: (prev.notationBlocks || []).filter((b) => b.id !== blockId),
    }))
  }

  // 刪除樂譜
  const [isDeleting, setIsDeleting] = useState(false)
  const handleDeleteTab = async () => {
    if (!confirm(`確定要刪除「${formData.title}」嗎？\n\n此操作無法復原。`)) {
      return
    }
    
    setIsDeleting(true)
    try {
      const deletedTab = { id, artistId: formData.artists?.[0]?.id }
      await deleteTab(id, user.uid, isAdmin, user?.penName || '')
      try {
        const token = await auth.currentUser?.getIdToken?.()
        if (token) {
          await fetch('/api/patch-caches-on-new-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tab: deletedTab, action: 'delete' })
          })
        }
      } catch (e) { console.warn('[patch-caches] delete patch failed:', e) }
      try {
        clearTabEditNotationCache(id)
      } catch (_) {}
      alert('✅ 樂譜已刪除')
      router.push('/')
    } catch (error) {
      console.error('Delete tab error:', error)
      alert('刪除失敗：' + error.message)
      setIsDeleting(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    // 歌名或歌手變更：清空 Spotify 擷取資料，若改回曾擷取過的歌則還原
    if (name === 'title' || name === 'artist') {
      setFormData(prev => {
        const next = { ...prev, [name]: value }
        const nextArtist = (next.artist || '').trim()
        const nextTitle = (next.title || '').trim()
        const key = `${nextArtist}|||${nextTitle}`
        const snapshot = spotifySnapshotByKeyRef.current[key]
        if (snapshot) {
          return {
            ...next,
            songYear: snapshot.songYear,
            album: snapshot.album,
            spotifyTrackId: snapshot.spotifyTrackId,
            spotifyFilledSongYear: snapshot.spotifyFilledSongYear,
            spotifyFilledAlbum: snapshot.spotifyFilledAlbum,
            albumImage: snapshot.albumImage ?? prev.albumImage,
            coverImage: snapshot.albumImage ? snapshot.albumImage : prev.coverImage,
            spotifyAlbumId: snapshot.spotifyAlbumId ?? prev.spotifyAlbumId,
            spotifyArtistId: snapshot.spotifyArtistId ?? prev.spotifyArtistId,
            spotifyUrl: snapshot.spotifyUrl ?? prev.spotifyUrl
          }
        }
        return {
          ...next,
          songYear: '',
          album: '',
          spotifyTrackId: null,
          spotifyFilledSongYear: '',
          spotifyFilledAlbum: '',
          albumImage: ''
        }
      })
      if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
      if (name === 'artist') setUseExistingArtistSelected(false)
      return
    }

    // 處理 原 Key / Capo / 彈奏 Key：任填兩項，第三項自動算出；被計出的欄位外框轉黃
    if (name === 'originalKey' || name === 'capo' || name === 'playKey') {
      setFormData(prev => {
        const newData = { ...prev, [name]: value }
        const resolved = calculateKeyAndCapo(
          name === 'originalKey' ? value : newData.originalKey,
          name === 'capo' ? value : newData.capo,
          name === 'playKey' ? value : newData.playKey,
          name
        )
        let computed = null
        if (name !== 'originalKey' && resolved.originalKey !== prev.originalKey) computed = 'originalKey'
        else if (name !== 'capo' && String(resolved.capo) !== String(prev.capo)) computed = 'capo'
        else if (name !== 'playKey' && resolved.playKey !== prev.playKey) computed = 'playKey'
        computedKeyFieldRef.current = computed
        return { ...newData, ...resolved }
      })
      setTimeout(() => setComputedKeyField(computedKeyFieldRef.current), 0)
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }))
    }

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }

    // YouTube URL 處理
    if (name === 'youtubeUrl') {
      const videoId = extractYouTubeVideoId(value);
      setFormData(prev => ({
        ...prev,
        youtubeUrl: value,
        youtubeVideoId: videoId
      }));
    }

    // 重置使用現有歌手狀態
    if (name === 'artist') {
      setUseExistingArtistSelected(false)
    }
  }

  // 處理 Wikipedia 自動填入的歌手資料
  const handleArtistFill = (data) => {
    setFormData(prev => ({
      ...prev,
      // 不更新歌手名（保留用戶原始輸入）
      artistPhoto: data.photo || '',
      artistBio: data.bio || '',
      artistYear: data.year || '',
      artistBirthYear: data.birthYear || '',
      artistDebutYear: data.debutYear || '',
      artistType: data.artistType !== 'unknown' ? data.artistType : prev.artistType
    }))
  }

  // 使用現有歌手
  const useExistingArtist = (artist) => {
    const rawRegions = Array.isArray(artist.regions) && artist.regions.length > 0
      ? artist.regions
      : (artist.region ? [artist.region] : [])
    const resolved = rawRegions
      .map(r => REGIONS.find(x => x.value && (x.value === r || x.label === r)))
      .filter(Boolean)
    const regionValue = resolved.length === 0 ? '' : resolved.length === 1 ? resolved[0].value : resolved.map(r => r.value).join('／')
    setFormData(prev => ({
      ...prev,
      artist: artist.name,
      artistType: artist.artistType || '',
      artistPhoto: artist.photoURL || artist.wikiPhotoURL || '',
      artistBio: artist.bio || '',
      artistYear: artist.year || '',
      region: regionValue
    }))
    setSimilarArtists([])
    setUseExistingArtistSelected(true)
  }

  // 開啟 Spotify 搜尋
  const handleSearchSpotify = () => {
    if (!formData.artist?.trim() && !formData.title?.trim()) {
      alert('請先輸入歌手名或歌名')
      return
    }
    setIsSpotifyModalOpen(true)
  }

  // 使用 Spotify 歌曲資料
  const handleUseSpotifyTrack = (trackData) => {
    const artist = (formData.artist || '').trim()
    const title = (formData.title || '').trim()
    const key = `${artist}|||${title}`
    spotifySnapshotByKeyRef.current[key] = {
      songYear: trackData.songYear ?? '',
      album: trackData.album ?? '',
      spotifyTrackId: trackData.spotifyTrackId || null,
      spotifyAlbumId: trackData.spotifyAlbumId || null,
      spotifyArtistId: trackData.spotifyArtistId || null,
      spotifyUrl: trackData.spotifyUrl || null,
      albumImage: trackData.albumImage || null,
      spotifyFilledSongYear: trackData.songYear ?? '',
      spotifyFilledAlbum: trackData.album ?? ''
    }
    spotifyJustAppliedRef.current = true
    setFormData(prev => ({
      ...prev,
      songYear: trackData.songYear || prev.songYear,
      album: trackData.album || prev.album,
      spotifyTrackId: trackData.spotifyTrackId || null,
      spotifyAlbumId: trackData.spotifyAlbumId || null,
      spotifyArtistId: trackData.spotifyArtistId || null,
      spotifyUrl: trackData.spotifyUrl || null,
      albumImage: trackData.albumImage || null,
      coverImage: trackData.albumImage || prev.coverImage,
      spotifyFilledSongYear: trackData.songYear ?? '',
      spotifyFilledAlbum: trackData.album ?? ''
    }))
  }

  // 作曲／填詞／編曲／監製：貼上含「作曲：」「曲：」等嘅文字時自動解析並填入四欄
  const handleCreditPaste = (e) => {
    const pasted = e.clipboardData?.getData?.('text') || ''
    const parsed = parseCreditBlock(pasted)
    if (parsed) {
      e.preventDefault()
      setFormData(prev => ({
        ...prev,
        composer: parsed.composer || prev.composer,
        lyricist: parsed.lyricist || prev.lyricist,
        arranger: parsed.arranger || prev.arranger,
        producer: parsed.producer || prev.producer,
      }))
    }
  }

  // 地區多選：切換某個地區的勾選，儲存為 "hongkong／taiwan" 格式
  const handleRegionToggle = (value) => {
    if (!value) return
    const current = (formData.region || '').split('／').filter(Boolean)
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value]
    setFormData(prev => ({ ...prev, region: next.join('／') }))
    if (errors.region) setErrors(prev => ({ ...prev, region: '' }))
  }

  const insertTemplate = () => {
    const template = `e|----------------------------------------------------------------|
B|----------------------------------------------------------------|
G|----------------------------------------------------------------|
D|----------------------------------------------------------------|
A|----------------------------------------------------------------|
E|----------------------------------------------------------------|

在這裡輸入你的結他譜...`
    setFormData(prev => ({ ...prev, content: template }))
  }

  const setKeyField = (name, value) => {
    setFormData(prev => {
      const newData = { ...prev, [name]: value }
      // 原 Key 與彈奏 Key 必須同類型（major vs minor）；切換原 Key 類型時清空彈奏 Key
      if (name === 'originalKey' && prev.playKey) {
        const newIsMinor = (value || '').toString().endsWith('m')
        const playIsMinor = (prev.playKey || '').toString().endsWith('m')
        if (newIsMinor !== playIsMinor) newData.playKey = ''
      }
      const resolved = calculateKeyAndCapo(
        name === 'originalKey' ? value : newData.originalKey,
        name === 'capo' ? value : newData.capo,
        name === 'playKey' ? value : newData.playKey,
        name
      )
      let computed = null
      if (name !== 'originalKey' && resolved.originalKey !== prev.originalKey) computed = 'originalKey'
      else if (name !== 'capo' && String(resolved.capo) !== String(prev.capo)) computed = 'capo'
      else if (name !== 'playKey' && resolved.playKey !== prev.playKey) computed = 'playKey'
      computedKeyFieldRef.current = computed
      return { ...newData, ...resolved }
    })
    setTimeout(() => setComputedKeyField(computedKeyFieldRef.current), 0)
  }

  // 獲取可用的封面圖片選項
  const getCoverImageOptions = () => {
    const options = []
    
    // 1. Spotify 專輯圖
    if (formData.albumImage) {
      options.push({
        url: formData.albumImage,
        type: 'spotify',
        label: 'Spotify 專輯封面'
      })
    }
    
    // 2. YouTube 縮圖
    if (formData.youtubeVideoId) {
      options.push({
        url: `https://img.youtube.com/vi/${formData.youtubeVideoId}/hqdefault.jpg`,
        type: 'youtube',
        label: 'YouTube 影片縮圖'
      })
      // 高品質版本
      options.push({
        url: `https://img.youtube.com/vi/${formData.youtubeVideoId}/maxresdefault.jpg`,
        type: 'youtube',
        label: 'YouTube 高清縮圖'
      })
    }
    
    // 3. 歌手相片 - 檢查多個來源
    let artistPhotoUrl = formData.artistPhoto
    
    // 如果冇 artistPhoto，檢查 artists 數組中的第一個歌手
    if (!artistPhotoUrl && formData.artists?.length > 0) {
      const primaryArtist = formData.artists[0]
      if (primaryArtist?.photo) {
        artistPhotoUrl = primaryArtist.photo
      }
    }
    
    // 如果仍然冇，嘗試從主歌手 id（artists[0].id）獲取
    if (!artistPhotoUrl && formData.artists?.[0]?.id) {
      // 這個會在 useEffect 中異步獲取，但為了即時顯示，我們先檢查緩存
    }
    
    if (artistPhotoUrl) {
      options.push({
        url: artistPhotoUrl,
        type: 'artist',
        label: '歌手相片'
      })
    }
    
    return options
  }

  // 選擇封面圖
  const handleSelectCover = (url) => {
    setFormData(prev => ({ ...prev, coverImage: url }))
  }
  
  // 上傳自訂封面
  const [isUploadingCover, setIsUploadingCover] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  
  const handleUploadCover = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // 驗證檔案
    const validation = validateImageFile(file)
    if (!validation.valid) {
      setUploadError(validation.error)
      return
    }
    
    setIsUploadingCover(true)
    setUploadError(null)
    
    try {
      const artistName = formData.artist || 'unknown'
      const songTitle = formData.title || 'song'
      const folder = 'tab_covers'
      const name = `${artistName}_${songTitle}_cover`
      
      const url = await uploadToCloudinary(file, name, folder)
      setFormData(prev => ({ ...prev, coverImage: url }))
    } catch (error) {
      console.error('Upload error:', error)
      setUploadError(error.message || '上傳失敗，請重試')
    } finally {
      setIsUploadingCover(false)
      // 清空 input 以便可以再次選擇同一個檔案
      e.target.value = ''
    }
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto px-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-neutral-800 rounded w-1/3"></div>
            <div className="h-12 bg-neutral-800 rounded"></div>
            <div className="h-12 bg-neutral-800 rounded"></div>
            <div className="h-64 bg-neutral-800 rounded"></div>
          </div>
        </div>
      </Layout>
    )
  }

  if (!isAuthorized) return null

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 pb-8">
        {/* Header - Sticky */}
        <div className="sticky top-0 z-30 bg-black/95 backdrop-blur-md border-b border-[#1a1a1a] -mx-4 px-4 pt-2 pb-2 mb-2 flex items-center justify-between">
          <div className="flex items-center">
            <Link
              href={`/tabs/${id}`}
              className="inline-flex items-center text-[#B3B3B3] hover:text-white mr-4 transition"
              aria-label="返回"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold text-white">編輯譜</h1>
          </div>
          
          {/* 頂部保存按鈕 */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#FFD700] text-black rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                <span>保存中，多謝耐心等候</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>保存更改</span>
              </>
            )}
          </button>
        </div>

        {/* Metadata Info */}
        <div className="mb-4 px-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#B3B3B3]">
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {(formData.viewCount || 0).toLocaleString()} 次瀏覽
            </span>
            <span className="text-neutral-600">|</span>
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
              </svg>
              Key: {formData.originalKey || 'C'}
            </span>
            <span className="text-neutral-600">|</span>
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {new Date(formData.createdAt || Date.now()).toLocaleDateString('zh-HK')}
            </span>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormSection>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
            {/* Row 1: 歌名* | 出譜者名稱 — 與 new 一致 */}
            <div>
              <label htmlFor="title" className="block pl-1 text-[13px] font-medium text-white mb-1">
                歌名 <span className="text-[#FFD700]">*</span>
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="例如：海闊天空"
                className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${
                  errors.title ? 'border-red-500' : 'border-neutral-700'
                }`}
              />
              {errors.title && (
                <p className="mt-1 text-sm text-red-400">{errors.title}</p>
              )}
            </div>
            <div ref={penNameDropdownRef} className="relative">
              <label className="block pl-1 text-[13px] font-medium text-white mb-1">
                出譜者名稱 <span className="text-[#737373] font-normal text-xs ml-1">會使用你個人主頁嘅設定</span>
              </label>
              <input
                type="text"
                name="uploaderPenName"
                value={formData.uploaderPenName}
                onChange={handleChange}
                onFocus={() => isAdmin && setPenNameShowDropdown(true)}
                onKeyDown={(e) => {
                  if (!isAdmin || !penNameShowDropdown) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setPenNameSelectedIndex(prev => prev < penNameSuggestions.length - 1 ? prev + 1 : prev)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setPenNameSelectedIndex(prev => prev > 0 ? prev - 1 : -1)
                  } else if (e.key === 'Enter' && penNameSelectedIndex >= 0 && penNameSuggestions[penNameSelectedIndex]) {
                    e.preventDefault()
                    setFormData(prev => ({ ...prev, uploaderPenName: penNameSuggestions[penNameSelectedIndex] }))
                    setPenNameShowDropdown(false)
                  } else if (e.key === 'Escape') {
                    setPenNameShowDropdown(false)
                  }
                }}
                readOnly={!isAdmin}
                placeholder="結他友"
                className={`w-full px-4 py-2 border rounded-lg text-[13px] placeholder:text-[13px] placeholder-[#525252] ${
                  isAdmin ? 'bg-black border-neutral-700 text-white' : 'bg-[#1a1a1a] border-[#B8860B] cursor-not-allowed opacity-90 text-[#737373]'
                }`}
              />
              {isAdmin && penNameShowDropdown && penNameSuggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-[#1a1a1a] border border-neutral-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                  {penNameSuggestions.map((name, idx) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, uploaderPenName: name }))
                        setPenNameShowDropdown(false)
                      }}
                      className={`w-full px-4 py-2.5 text-left text-[13px] hover:bg-neutral-800 transition ${idx === penNameSelectedIndex ? 'bg-neutral-800 text-white' : 'text-[#E5E5E5]'}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Row 2: 歌手* | 關係選單、＋歌手 */}
            <div>
              <ArtistInputSimple
                value={{ artists: formData.artists }}
                hidePreview={useExistingArtistSelected}
                twoColumnLayout
                onChange={({ artists, displayName, primaryArtist }) => {
                  const isConfirmed = !!primaryArtist?.id
                  const validTypes = ['male', 'female', 'group']
                  const normalizedArtists = artists.map(a => {
                    const rawRegions = Array.isArray(a?.regions) && a.regions.length > 0
                      ? a.regions
                      : (a?.region ? [a.region] : [])
                    const resolved = rawRegions
                      .map(r => REGIONS.find(x => x.value && (x.value === r || x.label === r)))
                      .filter(Boolean)
                    const regionStr = resolved.length === 0 ? (a?.region ?? '') : resolved.length === 1 ? resolved[0].value : resolved.map(r => r.value).join('／')
                    const rawType = a?.artistType ?? a?.type
                    const artistType = validTypes.includes(rawType) ? rawType : (a?.artistType ?? '')
                    return { ...a, region: regionStr, artistType, regions: undefined }
                  })
                  setFormData(prev => ({
                    ...prev,
                    artists: normalizedArtists,
                    artist: displayName,
                    artistId: primaryArtist?.id || null,
                    artistPhoto: primaryArtist?.photo || '',
                    artistType: normalizedArtists[0]?.artistType ?? prev.artistType,
                    region: normalizedArtists[0]?.region ?? prev.region,
                  }))
                  setUseExistingArtistSelected(isConfirmed)
                }}
              />
              {errors.artist && (
                <p className="mt-1 text-sm text-red-400">{errors.artist}</p>
              )}
              {formData.artists?.[0]?.id && !formData.artistPhoto && (
                <div className="mt-3">
                  <ArtistAutoFill artistName={formData.artists[0].name} onFill={handleArtistFill} autoApply={true} />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 sm:items-start pt-0 sm:pt-6">
              <div className="flex items-center gap-2 flex-wrap">
                {formData.artists?.length >= 2 && (
                  <div className="w-20 flex-shrink-0 relative" ref={relationMenuRef}>
                    <button
                      type="button"
                      onClick={() => setRelationMenuOpen(prev => !prev)}
                      className="w-full h-10 px-4 border border-neutral-700 rounded-lg bg-black text-[13px] text-left text-white flex items-center justify-between"
                    >
                      <span>{RELATION_OPTIONS.find(o => o.value === (formData.artists[1]?.relation || 'slash'))?.label ?? '/'}</span>
                      <svg className={`w-4 h-4 text-[#B3B3B3] transition-transform flex-shrink-0 ${relationMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {relationMenuOpen && (
                      <div className="absolute z-50 mt-1 w-full min-w-[80px] rounded-lg border border-neutral-700 bg-[#121212] py-1 shadow-xl">
                        {RELATION_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              const artists = formData.artists.map((a, i) => i === 1 ? { ...a, relation: opt.value } : a)
                              const displayName = (artists[0]?.name ?? '') + artists.slice(1).map(a => (RELATION_OPTIONS.find(o => o.value === (a.relation || 'slash'))?.separator || ' / ') + (a.name ?? '')).join('')
                              setFormData(prev => ({ ...prev, artists, artist: displayName }))
                              setRelationMenuOpen(false)
                            }}
                            className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${(formData.artists[1]?.relation || 'slash') === opt.value ? 'text-[#FFD700]' : 'text-white'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({
                    ...prev,
                    artists: [...(prev.artists || []), { name: '', id: null, relation: 'slash', artistType: '', region: '', isNew: true }]
                  }))}
                  className="inline-flex items-center justify-center gap-2 h-9 px-5 bg-[#282828] hover:bg-[#3E3E3E] text-white rounded-full transition text-[13px]"
                >
                  ＋歌手
                </button>
                <span className="text-[#737373] font-normal text-xs">合唱/featuring 適用</span>
              </div>
            </div>

            {/* Row 4+：每位歌手一列 類型* | 地區* */}
            {(formData.artists || []).map((artist, idx) => (
              <div key={idx} className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">
                    類型 <span className="text-[#FFD700]">*</span>
                    {(formData.artists.length > 1 && (artist.name || `第${idx + 1}位`)) && (
                      <span className="text-[#737373] font-normal text-xs ml-1">{artist.name || `第${idx + 1}位`}</span>
                    )}
                  </label>
                  {artist.id ? (
                    <div className="w-full h-10 px-4 flex items-center border rounded-lg text-[13px] text-[#737373] bg-[#1a1a1a] border-[#B8860B]">
                      {ARTIST_TYPES.find(t => t.value === (artist.artistType || formData.artistType))?.label ?? '—'}
                    </div>
                  ) : (
                    <div ref={typeMenuOpenIndex === idx ? typeMenuRef : undefined} className="relative">
                      <button
                        type="button"
                        onClick={() => setTypeMenuOpenIndex(prev => prev === idx ? null : idx)}
                        className="w-full h-10 px-4 border border-neutral-700 rounded-lg bg-black text-[13px] text-left text-white flex items-center justify-between"
                      >
                        <span className={!(artist.artistType || formData.artistType) ? 'text-[#737373]' : ''}>
                          {(artist.artistType || formData.artistType) ? ARTIST_TYPES.find(t => t.value === (artist.artistType || formData.artistType))?.label : '請選擇...'}
                        </span>
                        <svg className={`w-4 h-4 text-[#737373] transition-transform ${typeMenuOpenIndex === idx ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {typeMenuOpenIndex === idx && (
                        <div className="absolute z-50 mt-1 w-full rounded-lg border border-neutral-700 bg-[#121212] py-1 shadow-xl">
                          {ARTIST_TYPES.map(t => {
                            const currentType = idx === 0 ? formData.artistType : (formData.artists[idx]?.artistType ?? '')
                            const selected = currentType === t.value
                            return (
                              <button
                                key={t.value}
                                type="button"
                                onClick={() => {
                                  const nextArtists = formData.artists.map((a, i) => i === idx ? { ...a, artistType: selected ? '' : t.value } : a)
                                  setFormData(prev => ({
                                    ...prev,
                                    artists: nextArtists,
                                    ...(idx === 0 ? { artistType: selected ? '' : t.value } : {})
                                  }))
                                  setTypeMenuOpenIndex(null)
                                  if (errors.artistType) setErrors(prev => ({ ...prev, artistType: '' }))
                                }}
                                className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${selected ? 'text-[#FFD700]' : 'text-white'}`}
                              >
                                {t.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">
                    地區 <span className="text-[#FFD700]">*</span>
                  </label>
                  {artist.id ? (
                    <div className="w-full h-10 px-4 flex items-center border rounded-lg text-[13px] text-[#737373] bg-[#1a1a1a] border-[#B8860B]">
                      {(artist.region || formData.region) ? (artist.region || formData.region).split('／').map(v => REGIONS.find(r => r.value === v)?.label ?? v).join('／') : '—'}
                    </div>
                  ) : (
                    <div ref={regionMenuOpenIndex === idx ? regionMenuRef : undefined} className="relative">
                      <button
                        type="button"
                        onClick={() => setRegionMenuOpenIndex(prev => prev === idx ? null : idx)}
                        className="w-full h-10 px-4 border border-neutral-700 rounded-lg bg-black text-[13px] text-left text-white flex items-center justify-between"
                      >
                        <span className={!(artist.region || formData.region) ? 'text-[#737373]' : ''}>
                          {(artist.region || formData.region) ? (artist.region || formData.region).split('／').map(v => REGIONS.find(r => r.value === v)?.label ?? v).join('／') : '請選擇...'}
                        </span>
                        <svg className={`w-4 h-4 text-[#737373] transition-transform ${regionMenuOpenIndex === idx ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {regionMenuOpenIndex === idx && (
                        <div className="absolute z-50 mt-1 w-full rounded-lg border border-neutral-700 bg-[#121212] py-1 shadow-xl">
                          {REGIONS.filter(r => r.value).map(r => {
                            const currentRegion = idx === 0 ? (formData.region || '') : (formData.artists[idx]?.region || '')
                            const selected = currentRegion.split('／').filter(Boolean).includes(r.value)
                            return (
                              <button
                                key={r.value}
                                type="button"
                                onClick={() => {
                                  const current = (idx === 0 ? formData.region : formData.artists[idx]?.region) || ''
                                  const arr = current.split('／').filter(Boolean)
                                  const next = arr.includes(r.value) ? arr.filter(v => v !== r.value) : [...arr, r.value]
                                  const regionStr = next.join('／')
                                  const nextArtists = formData.artists.map((a, i) => i === idx ? { ...a, region: regionStr } : a)
                                  setFormData(prev => ({
                                    ...prev,
                                    artists: nextArtists,
                                    ...(idx === 0 ? { region: regionStr } : {})
                                  }))
                                  setRegionMenuOpenIndex(null)
                                  if (errors.region) setErrors(prev => ({ ...prev, region: '' }))
                                }}
                                className={`w-full px-4 py-1.5 text-left text-[13px] flex items-center gap-2 hover:bg-neutral-800 ${selected ? 'text-[#FFD700]' : 'text-white'}`}
                              >
                                <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${selected ? 'bg-[#FFD700] border-[#FFD700] text-black' : 'border-neutral-600'}`}>
                                  {selected ? '✓' : ''}
                                </span>
                                {r.label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            </div>
            </FormSection>

            <FormSection>
            {/* Spotify 擷取 + 專輯／年份／作曲／填詞／編曲／監製／BPM（與 new 同款簡化區） */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSearchSpotify}
                  disabled={!formData.artist && !formData.title}
                  className="inline-flex items-center justify-center h-9 gap-2 px-4 bg-[#1DB954] text-white rounded-full hover:bg-[#1ed760] transition disabled:opacity-50 font-medium"
                >
                  <img src="/spotify-icon.svg" alt="" className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  獲取歌曲資訊
                </button>
                {formData.spotifyTrackId && (() => {
                  const yearMatch = String(formData.songYear ?? '') === String(formData.spotifyFilledSongYear ?? '')
                  const albumMatch = String(formData.album ?? '') === String(formData.spotifyFilledAlbum ?? '')
                  const label = yearMatch && albumMatch ? '年份／專輯' : yearMatch ? '年份' : albumMatch ? '專輯' : null
                  return label ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-[#1DB954]">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      已從 Spotify 擷取：{label}
                    </span>
                  ) : null
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">歌曲年份</label>
                  <input type="text" name="songYear" value={formData.songYear} onChange={handleChange}
                    placeholder="例如：1993"
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('songYear') ? 'animate-spotify-empty-flash' : formData.spotifyTrackId && String(formData.songYear ?? '') === String(formData.spotifyFilledSongYear ?? '') ? 'border-[#1DB954]' : 'border-neutral-700'}`} />
                </div>
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">專輯</label>
                  <input type="text" name="album" value={formData.album} onChange={handleChange}
                    placeholder="例如：樂與怒"
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('album') ? 'animate-spotify-empty-flash' : formData.spotifyTrackId && String(formData.album ?? '') === String(formData.spotifyFilledAlbum ?? '') ? 'border-[#1DB954]' : 'border-neutral-700'}`} />
                </div>
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">作曲</label>
                  <input type="text" name="composer" value={formData.composer} onChange={handleChange}
                    onPaste={(e) => handleCreditPaste(e)}
                    placeholder="例如：黃家駒"
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('composer') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
                </div>
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">填詞</label>
                  <input type="text" name="lyricist" value={formData.lyricist} onChange={handleChange}
                    onPaste={(e) => handleCreditPaste(e)}
                    placeholder="例如：黃家駒"
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('lyricist') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
                </div>
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">編曲</label>
                  <input type="text" name="arranger" value={formData.arranger} onChange={handleChange}
                    onPaste={(e) => handleCreditPaste(e)}
                    placeholder="例如：Beyond"
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('arranger') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
                </div>
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">監製</label>
                  <input type="text" name="producer" value={formData.producer} onChange={handleChange}
                    onPaste={(e) => handleCreditPaste(e)}
                    placeholder="例如：Beyond"
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('producer') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
                </div>
                <div>
                  <label className="block pl-1 text-[13px] font-medium text-white mb-1">BPM</label>
                  <input type="number" name="bpm" value={formData.bpm} onChange={handleChange}
                    placeholder="例如：120" min="1" max="300"
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('bpm') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#737373]">
                <svg className="w-4 h-4 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>可於作曲／填詞／編曲／監製任一欄貼上含「作曲：」「曲：」「作詞：」「詞：」「編：」「監：」等嘅文字，會自動填入四欄；填上資料有助結他譜搜尋</span>
              </div>
            </div>
            </FormSection>

            <FormSection>
            {/* YouTube 連結 — 與 new 同款簡化 UI */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setYouTubeAutoSelect(false); setIsYouTubeModalOpen(true); }}
                  disabled={!formData.artist || !formData.title}
                  className="inline-flex items-center justify-center h-10 gap-2 px-5 bg-red-600 text-white rounded-full hover:bg-red-700 transition disabled:opacity-50 text-sm font-medium flex-shrink-0"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                  </svg>
                  搜尋 YouTube 影片
                </button>
                <input
                  type="url"
                  id="youtubeUrl"
                  name="youtubeUrl"
                  value={formData.youtubeUrl}
                  onChange={handleChange}
                  placeholder="貼上 YouTube 連結"
                  className="flex-1 min-w-0 h-10 px-4 py-2 bg-black border border-neutral-700 rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] outline-none"
                />
              </div>
              {formData.youtubeVideoId && (
                <div className="rounded-lg overflow-hidden border border-neutral-700 bg-black w-48 sm:w-56">
                  <img
                    src={`https://img.youtube.com/vi/${formData.youtubeVideoId}/hqdefault.jpg`}
                    alt={formData.youtubeVideoTitle || 'YouTube 影片'}
                    className="w-full aspect-video object-cover"
                  />
                  {(formData.youtubeVideoTitle || formData.youtubeChannelTitle) && (
                    <div className="px-3 py-2">
                      {formData.youtubeVideoTitle && (
                        <p className="text-sm text-white line-clamp-2" title={formData.youtubeVideoTitle}>{formData.youtubeVideoTitle}</p>
                      )}
                      {formData.youtubeChannelTitle && (
                        <p className="text-xs text-neutral-500 mt-0.5">{formData.youtubeChannelTitle}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            </FormSection>

            <FormSection>
            {/* 封面圖片 — 與 new 同款簡化 UI：單行橫向選項 + 上傳 */}
            <div className="space-y-4">
              {(() => {
                const options = getCoverImageOptions()
                const boxSize = 'w-[100px] h-[100px]'
                const norm = (u) => (u || '').trim().replace(/\/+$/, '')
                const currentCover = norm(formData.coverImage)
                const selectedNotInOptions = formData.coverImage && !options.some(o => norm(o.url) === currentCover)
                const displayOptions = selectedNotInOptions
                  ? [{ url: formData.coverImage, label: '已選擇的封面' }, ...options]
                  : options
                const selectedLabel = !currentCover
                  ? '無'
                  : selectedNotInOptions
                    ? '已選擇的封面（自訂上傳）'
                    : options.find(o => norm(o.url) === currentCover)?.label || '自訂'
                return (
                  <div className="space-y-2">
                    <p className="text-xs text-[#B3B3B3]">目前選中的封面：<span className="text-[#FFD700]">{selectedLabel}</span></p>
                    <div className="flex items-center gap-3 overflow-x-auto pb-1">
                      {displayOptions.map((option, index) => {
                        const isSelected = currentCover && norm(option.url) === currentCover
                        return (
                        <button
                          key={option.url + index}
                          type="button"
                          onClick={() => handleSelectCover(option.url)}
                          className={`relative flex-shrink-0 ${boxSize} rounded-lg overflow-hidden border-2 transition ${
                            isSelected
                              ? 'border-[#FFD700] ring-2 ring-[#FFD700] ring-inset'
                              : 'border-neutral-700 hover:border-neutral-500'
                          }`}
                        >
                          <img 
                            src={option.url} 
                            alt={option.label}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.style.display = 'none'
                              if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'
                            }}
                          />
                          <div className="hidden w-full h-full absolute inset-0 flex items-center justify-center bg-neutral-800 text-neutral-500 text-xs">
                            載入失敗
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 py-0.5 px-1">
                            <p className="text-white text-[9px] truncate">{option.label}</p>
                          </div>
                          {isSelected && (
                            <div className="absolute top-0.5 right-0.5 w-5 h-5 bg-[#FFD700] rounded-full flex items-center justify-center" title="已選擇">
                              <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </button>
                        )
                      })}
                      <label className={`relative flex flex-col items-center justify-center flex-shrink-0 ${boxSize} rounded-lg border-2 border-dashed cursor-pointer transition px-1 ${
                        isUploadingCover 
                          ? 'border-neutral-600 bg-neutral-800/50' 
                          : 'border-neutral-600 hover:border-[#FFD700] hover:bg-[#FFD700]/5'
                      }`}>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleUploadCover}
                          disabled={isUploadingCover}
                          className="hidden"
                        />
                        {isUploadingCover ? (
                          <>
                            <svg className="w-5 h-5 text-neutral-400 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="text-[10px] text-neutral-400 mt-1">上傳中...</span>
                          </>
                        ) : (
                          <>
                            <span className="text-xl text-neutral-400 leading-none">+</span>
                            <span className="text-[10px] text-neutral-400 mt-0.5">上傳封面</span>
                            <span className="text-[8px] text-neutral-500 mt-0.5 text-center leading-tight">JPG/PNG/GIF/WebP<br />最大 1MB</span>
                          </>
                        )}
                      </label>
                    </div>
                    {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
                    {options.length === 0 && !formData.coverImage && (
                      <p className="text-neutral-500 text-sm">添加 YouTube 影片或從 Spotify 搜尋可獲取封面選項</p>
                    )}
                  </div>
                )
              })()}
            </div>
            </FormSection>

            {isAdmin && (
            <FormSection>
            {/* Guitar Pro Segments */}
            <div className="p-4 bg-neutral-900/50 rounded-lg border border-neutral-700">
              <h3 className="text-sm font-medium text-[#FFD700] mb-3 flex items-center gap-2"><Music className="w-4 h-4" /> Guitar Pro 段落</h3>
              
              {/* GP 主題選擇 */}
              <div className="mb-4 p-3 bg-black/30 rounded-lg">
                <label className="block text-sm text-neutral-400 mb-2">譜面顯示主題</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, gpTheme: 'dark' }))}
                    className={`flex-1 inline-flex items-center justify-center gap-1 py-2 px-3 rounded border transition text-sm ${
                      formData.gpTheme === 'dark' 
                        ? 'bg-[#FFD700] text-black border-[#FFD700]' 
                        : 'bg-neutral-800 text-white border-neutral-700'
                    }`}
                  >
                    <Moon className="w-4 h-4" /> 黑底黃字
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, gpTheme: 'light' }))}
                    className={`flex-1 inline-flex items-center justify-center gap-1 py-2 px-3 rounded border transition text-sm ${
                      formData.gpTheme === 'light' 
                        ? 'bg-white text-black border-neutral-300' 
                        : 'bg-neutral-800 text-white border-neutral-700'
                    }`}
                  >
                    <Sun className="w-4 h-4" /> 白底黑字
                  </button>
                </div>
              </div>
              
              <GpSegmentUploader
                songTitle={formData.title}
                onSegmentAdd={(segment) => {
                  setFormData(prev => ({
                    ...prev,
                    gpSegments: [...prev.gpSegments, segment]
                  }))
                }}
                existingSegments={formData.gpSegments}
                theme={formData.gpTheme}
              />
              
              {/* 已添加段落列表 */}
              {formData.gpSegments.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-medium text-neutral-400">已添加段落</h4>
                  {formData.gpSegments.map((seg, index) => (
                    <div key={seg.id} className="flex items-center justify-between p-3 bg-neutral-900/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-400 flex items-center">
                          {(() => { const t = SEGMENT_TYPES.find(x => x.value === seg.type); const Icon = t?.Icon || Music; return <Icon className="w-5 h-5" strokeWidth={1.5} />; })()}
                        </span>
                        <div>
                          <p className="text-white text-sm capitalize">{seg.type}</p>
                          <p className="text-xs text-neutral-500">
                            小節 {seg.startBar}-{seg.endBar} • {seg.originalFilename}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            gpSegments: prev.gpSegments.filter((_, i) => i !== index)
                          }))
                        }}
                        className="text-neutral-500 hover:text-red-400 transition p-1"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </FormSection>
            )}

            <FormSection>
            {/* 原 Key / Capo / 彈奏 Key — 自訂下拉 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block pl-1 text-[13px] font-medium text-white mb-1">原 Key <span className="text-[#FFD700]">*</span></label>
                <div ref={originalKeyMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => { setOriginalKeyMenuOpen(prev => !prev); setCapoMenuOpen(false); setPlayKeyMenuOpen(false); if (computedKeyField === 'originalKey') setComputedKeyField(null) }}
                    className={`w-full h-10 px-4 border rounded-lg bg-black text-[13px] text-left text-white flex items-center justify-between ${computedKeyField === 'originalKey' ? 'border-[#FFD700]' : 'border-neutral-700'}`}
                  >
                    <span>{formData.originalKey || '—'}</span>
                    <svg className={`w-4 h-4 text-[#737373] transition-transform ${originalKeyMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {originalKeyMenuOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-lg border border-neutral-700 bg-[#121212] py-1 shadow-xl max-h-60 overflow-y-auto">
                      <p className="px-4 py-1.5 text-[11px] text-[#737373] uppercase tracking-wide">Major</p>
                      {KEY_MAJOR.map(k => (
                        <button key={k} type="button" onClick={() => { setKeyField('originalKey', k); setOriginalKeyMenuOpen(false) }}
                          className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${formData.originalKey === k ? 'text-[#FFD700]' : 'text-white'}`}>
                          {k}
                        </button>
                      ))}
                      <p className="px-4 py-1.5 text-[11px] text-[#737373] uppercase tracking-wide mt-1">Minor</p>
                      {KEY_MINOR.map(k => (
                        <button key={k} type="button" onClick={() => { setKeyField('originalKey', k); setOriginalKeyMenuOpen(false) }}
                          className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${formData.originalKey === k ? 'text-[#FFD700]' : 'text-white'}`}>
                          {k}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block pl-1 text-[13px] font-medium text-white mb-1">Capo</label>
                <div ref={capoMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => { setCapoMenuOpen(prev => !prev); setOriginalKeyMenuOpen(false); setPlayKeyMenuOpen(false); if (computedKeyField === 'capo') setComputedKeyField(null) }}
                    className={`w-full h-10 px-4 border rounded-lg bg-black text-[13px] text-left text-white flex items-center justify-between ${computedKeyField === 'capo' ? 'border-[#FFD700]' : 'border-neutral-700'}`}
                  >
                    <span>{formData.capo === '' ? '唔用' : `Capo ${formData.capo}`}</span>
                    <svg className={`w-4 h-4 text-[#737373] transition-transform ${capoMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {capoMenuOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-lg border border-neutral-700 bg-[#121212] py-1 shadow-xl">
                      {[{ value: '', label: '唔用' }, ...([1,2,3,4,5,6,7,8,9,10,11].map(n => ({ value: String(n), label: `Capo ${n}` })))].map(opt => {
                        const selected = String(formData.capo ?? '') === opt.value
                        return (
                          <button key={opt.value || 'none'} type="button" onClick={() => { setKeyField('capo', opt.value === '' ? '' : Number(opt.value)); setCapoMenuOpen(false) }}
                            className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${selected ? 'text-[#FFD700]' : 'text-white'}`}>
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block pl-1 text-[13px] font-medium text-white mb-1">彈奏 Key</label>
                <div ref={playKeyMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => { setPlayKeyMenuOpen(prev => !prev); setOriginalKeyMenuOpen(false); setCapoMenuOpen(false); if (computedKeyField === 'playKey') setComputedKeyField(null) }}
                    className={`w-full h-10 px-4 border rounded-lg bg-black text-[13px] text-left text-white flex items-center justify-between ${computedKeyField === 'playKey' ? 'border-[#FFD700]' : 'border-neutral-700'}`}
                  >
                    <span>{formData.playKey === '' ? '同原調' : formData.playKey}</span>
                    <svg className={`w-4 h-4 text-[#737373] transition-transform ${playKeyMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {playKeyMenuOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-lg border border-neutral-700 bg-[#121212] py-1 shadow-xl max-h-60 overflow-y-auto">
                      <button type="button" onClick={() => { setKeyField('playKey', ''); setPlayKeyMenuOpen(false) }}
                        className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${formData.playKey === '' ? 'text-[#FFD700]' : 'text-white'}`}>
                        同原調
                      </button>
                      {(() => {
                        const origMinor = (formData.originalKey || '').endsWith('m')
                        const playKeyOptions = origMinor ? KEY_MINOR : KEY_MAJOR
                        const sectionLabel = origMinor ? 'Minor' : 'Major'
                        return (
                          <>
                            <p className="px-4 py-1.5 text-[11px] text-[#737373] uppercase tracking-wide mt-1">{sectionLabel}</p>
                            {playKeyOptions.map(k => (
                              <button key={k} type="button" onClick={() => { setKeyField('playKey', k); setPlayKeyMenuOpen(false) }}
                                className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${formData.playKey === k ? 'text-[#FFD700]' : 'text-white'}`}>
                                {k}
                              </button>
                            ))}
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            </FormSection>

            <FormSection>
            <div className="mb-4">
              <label className="block pl-1 text-[13px] font-medium text-white mb-1">備註 <span className="text-[#737373] font-normal text-xs ml-1">會在結他譜上方顯示</span></label>
              <textarea
                id="remark"
                name="remark"
                value={formData.remark}
                onChange={handleChange}
                placeholder="可填掃弦節奏、指法提示、個人感想⋯⋯"
                rows={3}
                className="w-full px-4 py-2 bg-black border border-neutral-700 rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252]"
              />
            </div>
            {/* 譜內容 — 與 new 同款：同一行標題+工具列、精簡字體、相同 placeholder 與底部提示 */}
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="content" className="pl-1 text-[13px] font-medium text-white">譜內容 <span className="text-[#FFD700]">*</span></label>
                    <div className="flex items-center gap-1 bg-black rounded-full p-0.5 border border-neutral-700">
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, displayFont: 'mono' }))}
                        className={`h-6 px-2.5 flex items-center justify-center rounded-full text-[11px] font-medium transition ${formData.displayFont === 'mono' ? 'bg-[#FFD700] text-black' : 'text-[#737373] hover:text-white'}`}>
                        自動追蹤( )對位
                      </button>
                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, displayFont: 'manual' }))}
                        className={`h-6 px-2.5 flex items-center justify-center rounded-full text-[11px] font-medium transition ${formData.displayFont === 'manual' ? 'bg-[#FFD700] text-black' : 'text-[#737373] hover:text-white'}`}>
                        人手空格對位
                      </button>
                      {isAdmin && (
                        <button type="button" onClick={() => setFormData(prev => ({ ...prev, displayFont: 'arial' }))}
                          className={`h-6 px-2.5 flex items-center justify-center rounded-full text-[11px] font-medium transition ${formData.displayFont === 'arial' ? 'bg-[#FFD700] text-black' : 'text-[#737373] hover:text-white'}`}>
                          CHORD LOG
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button"
                      onClick={() => {
                        if (!formData.content) return
                        const cleaned = formData.content.split('\n').filter(line => line.trim()).join('\n')
                        setFormData(prev => ({ ...prev, content: cleaned }))
                      }}
                      disabled={!formData.content}
                      className="text-xs text-[#FFD700] hover:text-yellow-300 disabled:opacity-50"
                    >
                      移除所有空行
                    </button>
                    {isAdmin && (
                      <button type="button" onClick={insertTemplate} className="text-xs text-[#FFD700] hover:text-yellow-300">
                        插入空白模板
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <textarea
                    id="content"
                    name="content"
                    value={formData.content}
                    onChange={handleChange}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPaste={(e) => {
                      e.preventDefault()
                      const pastedText = e.clipboardData.getData('text')
                      const cleaned = cleanPastedText(pastedText)
                      const processed = formData.displayFont === 'manual' ? cleaned : autoFixTabFormatWithFactor(cleaned, alignFactor, formData.displayFont !== 'arial')
                      const textarea = e.target
                      const start = textarea.selectionStart
                      const end = textarea.selectionEnd
                      const currentValue = formData.content
                      const newValue = currentValue.substring(0, start) + processed + currentValue.substring(end)
                      setFormData(prev => ({ ...prev, content: newValue }))
                    }}
                    placeholder={formData.displayFont === 'arial' ? '' : formData.displayFont === 'manual' ? `在此輸入／貼上結他譜...

提示：輸入結他譜後

用戶"手動加空格"對位
輸入結他譜 和 網站結他譜 會顯示一致` : `在此輸入／貼上結他譜...

提示：輸入結他譜後
Chord會自動追蹤歌詞中( )位置
用戶不用自己加空格對位

例如輸入：
|C G/B |Am Am7/G
(就)這樣講 (沒)當初的(感)覺()

譜會自動生成：
|C        G/B      |Am   Am7/G
(就)這樣講 (沒)當初的(感)覺 ()`}
                    rows={15}
                    className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] tab-content-input ${formData.displayFont === 'arial' ? 'tab-content-input--arial' : 'tab-content-input--mono'} ${errors.content ? 'border-red-500' : 'border-neutral-700'}`}
                  />
                  {errors.content && <p className="mt-1 text-sm text-red-400">{errors.content}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#737373]">
                <svg className="w-4 h-4 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{formData.displayFont === 'mono' ? 'Chord會自動追蹤歌詞中( )位置，用戶不用自己加空格對位' : formData.displayFont === 'manual' ? '人手在結他譜輸入的空格 和 網站結他譜空格顯示會一致' : 'for copy CHORD LOG 結他譜 only'}</span>
              </div>
            </div>
            </FormSection>

            <FormSection title="六線譜">
              <div className="space-y-4">
                <p className="pl-1 text-xs text-[#B3B3B3] leading-relaxed">
                  每份六線譜會有一個 ID 如{' '}
                  <span className="text-[#FFD700] font-mono text-[12px]">[六線譜 1]</span>
                  ，ID 連括號放進譜內容中。
                </p>
                <div className="flex justify-start w-full">
                  <button
                    type="button"
                    onClick={handleAddNotationBlock}
                    disabled={!id}
                    className="inline-flex items-center gap-1 text-xs text-[#FFD700] hover:text-yellow-300 disabled:opacity-40"
                  >
                    <span className="text-sm font-medium leading-none" aria-hidden>+</span>
                    加入六線譜
                  </button>
                </div>
                {id && (formData.notationBlocks || []).length > 0 && (
                  <div className="space-y-3 w-full">
                    {(formData.notationBlocks || []).map((block, index) => (
                      <div
                        key={`${block.id}-${index}`}
                        className="w-full rounded-lg border border-neutral-700 bg-black shadow-lg overflow-hidden"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 pl-3 pr-[0.5rem] py-2 border-b border-neutral-800 bg-neutral-900/40">
                          <span className="text-md font-medium text-[#B3B3B3]">[六線譜 {index + 1}]</span>
                          <div className="flex flex-wrap gap-2 justify-end shrink-0">
                            <button
                              type="button"
                              onClick={() => openNotationEditorForBlock(block.id)}
                              className="px-[0.6rem] py-2 rounded-lg bg-[#FFD700] text-black text-sm font-semibold leading-4 hover:bg-yellow-400 shadow-md"
                            >
                              編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => removeNotationBlock(block.id)}
                              className="px-[0.6rem] py-2 rounded-lg bg-[#282828] text-white text-sm font-medium leading-4 border border-neutral-600 hover:bg-[#3E3E3E]"
                            >
                              移除
                            </button>
                          </div>
                        </div>
                        {(block.notationAlphaTex || '').trim() ? (
                          <div className="px-4">
                            <NotationAlphaTabPreview
                              alphaTex={block.notationAlphaTex}
                              transparent
                              noTopMargin
                            />
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-3 p-3">
                            <img
                              src="/notation-editor.png"
                              alt=""
                              className="h-[80px] w-auto object-contain block shrink-0"
                              draggable={false}
                            />
                            <p className="text-sm text-[#737373]">尚未編輯 — 按「編輯」開啟記譜器</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </FormSection>

            {/* Submit */}
            <div className="flex items-center pt-0">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 min-h-11 py-3 flex items-center justify-center gap-2 bg-[#FFD700] text-black px-6 rounded-lg font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                    <span>保存中，多謝耐心等候</span>
                  </>
                ) : (
                  '保存更改'
                )}
              </button>
            </div>

            {/* 刪除按鈕 - 管理員或譜主可見 */}
            {(isAdmin || isOwner) && (
              <div className="pt-6 mt-6 border-t border-[#1a1a1a]">
                <button
                  type="button"
                  onClick={handleDeleteTab}
                  disabled={isDeleting}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-red-900/30 border border-red-700 text-red-400 rounded-lg hover:bg-red-900/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      刪除中⋯ 多謝耐心等候
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      刪除樂譜
                    </>
                  )}
                </button>
                <p className="mt-2 text-xs text-neutral-500 text-center">
                  警告：刪除後無法復原。
                </p>
              </div>
            )}
          </form>
        </div>
      </div>
      
      {/* YouTube 搜尋 Modal */}
      <YouTubeSearchModal
        isOpen={isYouTubeModalOpen}
        onClose={() => setIsYouTubeModalOpen(false)}
        artistName={formData.artist}
        songTitle={formData.title}
        autoSelectFirst={youTubeAutoSelect}
        onSelect={(payload) => {
          const url = typeof payload === 'string' ? payload : payload.url;
          const videoId = typeof payload === 'string' ? extractYouTubeVideoId(payload) : (payload.videoId || extractYouTubeVideoId(url));
          const title = typeof payload === 'string' ? '' : (payload.title || '');
          const channelTitle = typeof payload === 'string' ? '' : (payload.channelTitle || '');
          setFormData(prev => ({ ...prev, youtubeUrl: url, youtubeVideoId: videoId, youtubeVideoTitle: title, youtubeChannelTitle: channelTitle }));
        }}
      />
      
      {/* Spotify 歌曲搜尋 Modal */}
      <SpotifyTrackSearch
        isOpen={isSpotifyModalOpen}
        onClose={() => setIsSpotifyModalOpen(false)}
        artistName={formData.artist}
        songTitle={formData.title}
        onSelect={handleUseSpotifyTrack}
      />

      {notationEditorOpen && notationEditorBlockId && (
        <NotationEditorModal
          open
          onClose={closeNotationEditor}
          draftScopeId={notationEditorBlockId}
          initialSeed={notationEditorSeed}
          onSave={handleNotationEditorSave}
        />
      )}
    </Layout>
  )
}
