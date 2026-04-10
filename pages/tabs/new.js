import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from '@/components/Link'
import { createTab, parseCollaborators } from '@/lib/tabs'
import { parseCreditBlock } from '@/lib/tabCredits'
import { useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/Layout'
import NotationBlocksManager from '@/components/NotationBlocksManager'
import ArtistAutoFill from '@/components/ArtistAutoFill'
import ArtistInputSimple, { RELATION_OPTIONS } from '@/components/ArtistInputSimple'
import GpSegmentUploader, { SEGMENT_TYPES } from '@/components/GpSegmentUploader'
import YouTubeSearchModal from '@/components/YouTubeSearchModal'
import SpotifyTrackSearch from '@/components/SpotifyTrackSearch'
import { extractYouTubeVideoId } from '@/lib/wikipedia'
import { processTabContent, autoFixTabFormatWithFactor, cleanPastedText } from '@/lib/tabFormatter'
import { getTabDraftById, removeTabDraft, upsertTabDraft } from '@/lib/tabDrafts'
import { doc, getDoc, updateDoc } from '@/lib/firestore-tracked'
import { db, auth } from '@/lib/firebase'
import { clearArtistMapCache } from '@/lib/useArtistMap'
import { uploadToCloudinary, validateImageFile } from '@/lib/cloudinary'
import { ArrowLeft, Music, Loader2 } from 'lucide-react'
import {
  peekPendingNotationTex,
  clearPendingNotationTex,
  peekPendingNotationStaffSnapshot,
  clearPendingNotationStaffSnapshot,
} from '@/lib/notationEditorBridge'
import { newNotationBlockId, hasAnyNotationTex } from '@/lib/notationBlocks'

const REGIONS = [
  { value: '', label: '請選擇...' },
  { value: 'hongkong', label: '香港' },
  { value: 'taiwan', label: '台灣' },
  { value: 'china', label: '中國' },
  { value: 'asia', label: '亞洲' },
  { value: 'foreign', label: '外國' }
]

const TAB_NEW_DRAFT_KEY = 'polygon-tab-new-draft'

const ARTIST_TYPES = [
  { value: 'male', label: '男歌手' },
  { value: 'female', label: '女歌手' },
  { value: 'group', label: '組合' }
]

const KEY_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const KEY_MINOR = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

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

// 計算 原 Key / Capo / 彈奏 Key：任填兩項，第三項自動算出
// userSetField：用戶剛改的欄位，據此用其餘兩項推算第三項
function calculateKeyAndCapo(originalKey, capo, playKey, userSetField) {
  const capoNum = capo !== '' && capo !== undefined ? parseInt(capo) : NaN
  const validCapo = !isNaN(capoNum) && capoNum >= 0 && capoNum <= 11
  const originalIndex = originalKey ? KEY_TO_SEMITONE[originalKey] : undefined
  const playIndex = playKey ? KEY_TO_SEMITONE[playKey] : undefined

  // 用戶剛選「彈奏 Key」→ 用 capo + playKey 推算 原 Key
  if (userSetField === 'playKey' && validCapo && playIndex !== undefined) {
    const isMinor = playKey.endsWith('m')
    const semitoneToKey = isMinor ? SEMITONE_TO_KEY_MINOR : SEMITONE_TO_KEY_MAJOR
    const computedOriginalIndex = (playIndex + capoNum) % 12
    const computedOriginal = semitoneToKey[computedOriginalIndex]
    return { originalKey: computedOriginal, capo: capoNum.toString(), playKey }
  }

  // 用戶剛選「Capo」→ 用 原 Key + capo 推算 彈奏 Key（Capo 唔用則彈奏 Key = 原調）
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

  // 用戶剛選「原 Key」→ 用 原 Key + playKey 推算 capo（若有 playKey），否則用 原 Key + capo 推算 playKey
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

// 區塊卡片（大改 UI 用）
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

export default function NewTab() {
  const router = useRouter()
  const { user, isAuthenticated, loading: authLoading, isAdmin, signInWithGoogle } = useAuth()
  const [loginLoading, setLoginLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    artistType: '',
    artists: [{ name: '', id: null, relation: null }], // 新多歌手系統
    originalKey: 'C',
    capo: '',
    playKey: '',
    content: '',
    artistPhoto: '',
    artistBio: '',
    artistYear: '',
    artistBirthYear: '',
    artistDebutYear: '',
    songYear: '',
    composer: '',
    lyricist: '',
    arranger: '',
    producer: '',
    album: '',
    bpm: '',
    uploaderPenName: '',
    youtubeUrl: '',
    youtubeVideoId: '',
    youtubeVideoTitle: '',
    youtubeChannelTitle: '',
    remark: '', // 備註
    albumImage: '',
    coverImage: '',
    displayFont: 'mono', // 預設等寬字體，傳統結他譜格式
    gpSegments: [], // GP 段落陣列
    gpTheme: 'dark', // GP 顯示主題：dark (黑底黃字) / light (白底黑字)
    region: '', // 地區（與設計圖一致）
    notationBlocks: [],
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const [isSpotifyModalOpen, setIsSpotifyModalOpen] = useState(false)
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false)
  const [youTubeAutoSelect, setYouTubeAutoSelect] = useState(false)
  const [similarArtists, setSimilarArtists] = useState([])
  const [useExistingArtistSelected, setUseExistingArtistSelected] = useState(false)
  const [artistListFromSearch, setArtistListFromSearch] = useState([])
  const [regionMenuOpenIndex, setRegionMenuOpenIndex] = useState(null) // 哪一欄歌手的地區選單打開（null = 無）
  const regionMenuRef = useRef(null)
  const [typeMenuOpenIndex, setTypeMenuOpenIndex] = useState(null) // 哪一欄歌手的類型選單打開（null = 無）
  const typeMenuRef = useRef(null)
  const [originalKeyMenuOpen, setOriginalKeyMenuOpen] = useState(false)
  const originalKeyMenuRef = useRef(null)
  const [capoMenuOpen, setCapoMenuOpen] = useState(false)
  const capoMenuRef = useRef(null)
  const [playKeyMenuOpen, setPlayKeyMenuOpen] = useState(false)
  const playKeyMenuRef = useRef(null)
  const [relationMenuOpen, setRelationMenuOpen] = useState(false)
  const relationMenuRef = useRef(null)
  const [computedKeyField, setComputedKeyField] = useState(null) // 剛被自動計出的欄位，外框顯示黃色
  const computedKeyFieldRef = useRef(null)
  const formDataRef = useRef(formData)
  const clearDraftRef = useRef(false)
  const activeDraftIdRef = useRef(null)
  // 歌名／歌手變更時：清空或還原 Spotify 擷取資料（key = artist|||title）
  const spotifySnapshotByKeyRef = useRef({})
  // 撳「獲取歌曲資訊」後，未成功獲取資料嘅輸入欄閃紅框
  const [spotifyFlashRedFields, setSpotifyFlashRedFields] = useState(new Set())
  const spotifyJustAppliedRef = useRef(false)
  // 出譜者名稱 autocomplete（僅 Admin）
  const [penNameSuggestions, setPenNameSuggestions] = useState([])
  const [penNameShowDropdown, setPenNameShowDropdown] = useState(false)
  const [penNameSelectedIndex, setPenNameSelectedIndex] = useState(-1)
  const penNameDropdownRef = useRef(null)
  // 對齊參數（從 localStorage 讀取或預設 1.1）
  const [alignFactor, setAlignFactor] = useState(1.1)
  
  formDataRef.current = formData

  // 在客戶端載入後讀取 localStorage（對齊參數 + 出譜草稿）；記譜編輯器返回嘅 alphaTex 最後合併（優先於草稿）
  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedFactor = localStorage.getItem('tabAlignFactor')
    if (savedFactor) setAlignFactor(parseFloat(savedFactor))
    const hydrateDraft = async () => {
      const draftIdFromQuery = router.query?.draft
      const draftId = Array.isArray(draftIdFromQuery) ? draftIdFromQuery[0] : draftIdFromQuery
      if (draftId) {
        const savedDraft = await getTabDraftById(user?.uid, draftId)
        if (savedDraft?.mode === 'new' && savedDraft?.data) {
          activeDraftIdRef.current = savedDraft.id
          setFormData(prev => ({ ...prev, ...savedDraft.data }))
        }
      }
      const legacyDraft = localStorage.getItem(TAB_NEW_DRAFT_KEY)
      if (legacyDraft) {
        try {
          const parsed = JSON.parse(legacyDraft)
          if (parsed && typeof parsed === 'object') {
            if (!activeDraftIdRef.current) {
              const saved = await upsertTabDraft(user?.uid, { mode: 'new', data: parsed })
              activeDraftIdRef.current = saved?.id || null
            }
            setFormData(prev => ({ ...prev, ...parsed }))
            // 若草稿有已確認歌手（artists[0].id），還原「已揀選歌手」狀態，類型／地區會顯示為唯讀並自動帶出
            if (parsed.artists?.[0]?.id) {
              setUseExistingArtistSelected(true)
            }
          }
        } catch (e) {
          console.warn('[tab-new] draft parse error', e)
        }
        try { localStorage.removeItem(TAB_NEW_DRAFT_KEY) } catch (_) {}
      }
    }
    hydrateDraft()
    const tex = peekPendingNotationTex()
    const pendingStaff = peekPendingNotationStaffSnapshot()
    if (tex || pendingStaff) {
      setFormData((prev) => {
        const existing = prev.notationBlocks || []
        if (existing.length > 0) {
          return { ...prev, notationBlocks: existing.map((b, i) => i === 0 ? { ...b, ...(tex ? { notationAlphaTex: tex } : {}), ...(pendingStaff ? { notationStaffSnapshot: pendingStaff } : {}) } : b) }
        }
        return { ...prev, notationBlocks: [{ id: newNotationBlockId(), notationAlphaTex: tex || '', notationStaffSnapshot: pendingStaff || null, label: 'Intro' }] }
      })
    }
    const clearLater = setTimeout(() => {
      clearPendingNotationTex()
      clearPendingNotationStaffSnapshot()
    }, 5000)
    return () => clearTimeout(clearLater)
  }, [router.query?.draft, user?.uid])

  // 離開頁面時保存草稿（除非按了出譜或取消）
  useEffect(() => {
    const saveDraft = () => {
      if (clearDraftRef.current) return
      try {
        localStorage.setItem(TAB_NEW_DRAFT_KEY, JSON.stringify(formDataRef.current))
        upsertTabDraft(user?.uid, {
          id: activeDraftIdRef.current,
          mode: 'new',
          data: formDataRef.current
        }).then((saved) => {
          if (saved?.id) activeDraftIdRef.current = saved.id
        }).catch(() => {})
      } catch (e) {
        console.warn('[tab-new] draft save error', e)
      }
    }
    window.addEventListener('beforeunload', saveDraft)
    router.events.on('routeChangeStart', saveDraft)
    return () => {
      window.removeEventListener('beforeunload', saveDraft)
      router.events.off('routeChangeStart', saveDraft)
    }
  }, [router.events])

  // 所有下拉選單：點擊外部關閉
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

  const [isUploadingCover, setIsUploadingCover] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  
  // 解析多歌手（使用 useMemo 確保正確更新）
  const { collaborators } = useMemo(() => parseCollaborators(formData.artist), [formData.artist])
  
  // 檢查相似歌手（使用 search-data API，1 cache read，不讀全表 artists）
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
  }, [formData.artist, useExistingArtistSelected, artistListFromSearch])
  
  // 載入用戶的出譜者名稱
  useEffect(() => {
    const loadUserPenName = async () => {
      if (user?.uid) {
        try {
          const userRef = doc(db, 'users', user.uid)
          const userSnap = await getDoc(userRef)
          if (userSnap.exists()) {
            const userData = userSnap.data()
            const penName = (userData.penName || '').trim() || (userData.displayName || '').trim() || (userData.email || '').split('@')[0]?.trim() || '結他友'
            setFormData(prev => ({ ...prev, uploaderPenName: penName }))
          }
        } catch (error) {
          console.error('載入出譜者名稱失敗:', error)
        }
      }
    }
    loadUserPenName()
  }, [user])

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
        // 唔好喺度自動展開：只喺輸入欄 onFocus 先開（同 edit 頁）
      } catch (_) {
        setPenNameSuggestions([])
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [isAdmin, formData.uploaderPenName])

  // 從 URL query 參數預填數據（來自求譜區或後台快速導入）
  useEffect(() => {
    if (router.isReady) {
      const { 
        title, artist, youtube, 
        originalKey, capo, playKey, content,
        composer, lyricist, arranger, bpm, songYear,
        uploaderPenName, albumImage, album, displayFont,
        fromQuickImport
      } = router.query
      
      // 如果是從快速導入來的，從 sessionStorage 讀取 content
      let importedContent = content
      if (fromQuickImport === 'true' && typeof window !== 'undefined') {
        const storedContent = sessionStorage.getItem('quickImportContent')
        if (storedContent) {
          importedContent = storedContent
          // 讀取後清除，避免影響下次
          sessionStorage.removeItem('quickImportContent')
        }
      }
      
      if (title || artist || youtube || importedContent) {
        setFormData(prev => ({
          ...prev,
          title: title || prev.title,
          artist: artist !== undefined ? artist : prev.artist,
          artists: artist ? [{ name: artist, id: null, relation: null }] : (prev.artists || [{ name: '', id: null, relation: null }]),
          youtubeUrl: youtube || prev.youtubeUrl,
          originalKey: originalKey || prev.originalKey,
          capo: capo || prev.capo,
          playKey: playKey || prev.playKey,
          content: importedContent || prev.content,
          composer: composer || prev.composer,
          lyricist: lyricist || prev.lyricist,
          arranger: arranger || prev.arranger,
          bpm: bpm || prev.bpm,
          songYear: songYear || prev.songYear,
          uploaderPenName: uploaderPenName || prev.uploaderPenName,
          albumImage: albumImage || prev.albumImage,
          album: album || prev.album,
          displayFont: displayFont || prev.displayFont || 'mono'
        }))
      }
    }
  }, [router.isReady, router.query])

  // 獲取 Spotify 後：空嘅輸入欄閃一下紅框（必須在下方 early return 之前）
  const SPOTIFY_META_FIELDS = ['songYear', 'album', 'composer', 'lyricist', 'arranger', 'producer', 'bpm']
  useEffect(() => {
    if (!spotifyJustAppliedRef.current || !formData.spotifyTrackId) return
    spotifyJustAppliedRef.current = false
    const empty = SPOTIFY_META_FIELDS.filter(f => !String(formData[f] ?? '').trim())
    if (empty.length === 0) return
    setSpotifyFlashRedFields(new Set(empty))
    const t = setTimeout(() => setSpotifyFlashRedFields(new Set()), 1000)
    return () => clearTimeout(t)
  }, [formData.spotifyTrackId, formData.songYear, formData.album, formData.composer, formData.lyricist, formData.arranger, formData.producer, formData.bpm])

  // 等待 auth 載入完成 - 顯示 Loading 而非白屏
  if (authLoading) {
    return (
      <Layout>
        <div className="min-h-screen bg-black flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
            <p className="text-[#B3B3B3] text-sm">載入中...</p>
          </div>
        </div>
      </Layout>
    )
  }

  // 未登入時顯示登入提示（內嵌式，不阻擋其他按鈕）
  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="flex items-center justify-center px-4" style={{ minHeight: 'calc(100vh - 10rem)' }}>
          <div className="bg-[#121212] rounded-2xl w-full max-w-sm overflow-hidden border border-neutral-800">
            <div className="p-4 border-b border-neutral-800">
              <h2 className="text-lg font-bold text-white">請先登入</h2>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-neutral-400 text-sm">出譜需要先登入帳戶</p>
              <button
                onClick={async () => {
                  setLoginLoading(true)
                  try {
                    await signInWithGoogle()
                  } catch (e) {
                    console.error(e)
                    if (e.code === 'auth/unauthorized-domain') {
                      alert(`Firebase 未授權此域名，請聯繫管理員添加：${window.location.hostname}`)
                    } else {
                      alert('Google 登入失敗：' + (e.message || e))
                    }
                  } finally {
                    setLoginLoading(false)
                  }
                }}
                disabled={loginLoading}
                className="w-full flex items-center justify-center gap-3 h-9 bg-[#121212] border-2 border-neutral-800 text-white px-4 rounded-full font-medium hover:border-[#FFD700] transition disabled:opacity-50"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>{loginLoading ? '登入中...' : '使用 Google 登入'}</span>
              </button>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  const validate = () => {
    const newErrors = {}
    if (!formData.title.trim()) newErrors.title = '請輸入歌名'
    if (!formData.artist.trim()) newErrors.artist = '請輸入歌手名'
    const hasText = !!formData.content.trim()
    const hasNotation = hasAnyNotationTex(formData.notationBlocks)
    if (!hasText && !hasNotation) newErrors.content = '請輸入譜內容或加入六線譜'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    try {
      // 過濾 undefined 值，避免 Firestore 錯誤
      const cleanValue = (val, key = '') => {
        if (val === undefined) {
          console.log(`[cleanValue] ${key} is undefined, converting to empty string`)
          return ''
        }
        if (val === null) return null
        if (Array.isArray(val)) {
          return val.map((item, idx) => {
            if (typeof item === 'object' && item !== null) {
              const cleanItem = {}
              for (const [k, v] of Object.entries(item)) {
                if (v === undefined) {
                  console.log(`[cleanValue] ${key}[${idx}].${k} is undefined, converting to null`)
                }
                cleanItem[k] = v === undefined ? null : v
              }
              return cleanItem
            }
            return item === undefined ? '' : item
          })
        }
        return val
      }
      
      const cleanFormData = {}
      for (const [key, value] of Object.entries(formData)) {
        cleanFormData[key] = cleanValue(value, key)
      }
      
      // Debug: 檢查仲有冇 undefined
      const undefinedFields = []
      for (const [key, value] of Object.entries(cleanFormData)) {
        if (value === undefined) {
          undefinedFields.push(key)
        }
      }
      if (undefinedFields.length > 0) {
        console.error('[handleSubmit] Still has undefined fields:', undefinedFields)
      }
      
      // 若曲詞編監為空而譜內容有相關資料，自動從內容解析並填入
      const content = (cleanFormData.content || '').trim()
      const parsedCredits = content ? parseCreditBlock(content) : null
      if (parsedCredits) {
        const empty = (v) => (v === undefined || v === null || String(v).trim() === '')
        if (empty(cleanFormData.composer) && parsedCredits.composer) cleanFormData.composer = parsedCredits.composer
        if (empty(cleanFormData.lyricist) && parsedCredits.lyricist) cleanFormData.lyricist = parsedCredits.lyricist
        if (empty(cleanFormData.arranger) && parsedCredits.arranger) cleanFormData.arranger = parsedCredits.arranger
        if (empty(cleanFormData.producer) && parsedCredits.producer) cleanFormData.producer = parsedCredits.producer
      }

      // 一般用户：強制用個人主頁 penName（與個人主頁同步）。Admin 有填「出譜者名稱」則以表單為準，唔好覆蓋成自己帳號個名。
      const penNameFromForm = (formData.uploaderPenName || '').trim()
      let penNameToUse = penNameFromForm || '結他友'
      try {
        const userRef = doc(db, 'users', user.uid)
        const userSnap = await getDoc(userRef)
        if (userSnap.exists()) {
          const userData = userSnap.data()
          const fromProfile = (userData.penName || '').trim()
          const useProfilePenName = !isAdmin || !penNameFromForm
          if (useProfilePenName) {
            if (fromProfile) {
              penNameToUse = fromProfile
            } else {
              penNameToUse = (userData.displayName || '').trim() || (userData.email || '').split('@')[0]?.trim() || '結他友'
              await updateDoc(userRef, { penName: penNameToUse, updatedAt: new Date().toISOString() })
            }
          } else {
            penNameToUse = penNameFromForm
          }
        }
      } catch (_) {}
      if (!penNameToUse) penNameToUse = '結他友'
      const submitData = {
        ...cleanFormData,
        uploaderPenName: penNameToUse
      }
      const newTab = await createTab(submitData, user.uid)
      clearDraftRef.current = true
      try { localStorage.removeItem(TAB_NEW_DRAFT_KEY) } catch (_) {}
      if (activeDraftIdRef.current) await removeTabDraft(user?.uid, activeDraftIdRef.current)
      try {
        const token = await auth.currentUser?.getIdToken?.()
        if (token) {
          const patchRes = await fetch('/api/patch-caches-on-new-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tab: newTab, action: 'create' })
          })
          const patchJson = await patchRes.json().catch(() => ({}))
          if (!patchRes.ok || patchJson.ok === false) {
            console.warn('[patch-caches] create failed:', patchRes.status, patchJson)
          }
        }
      } catch (e) {
        console.warn('[patch-caches] create patch error:', e)
      }
      try {
        await fetch('/api/search-data?bust=1')
      } catch (e) {}
      clearArtistMapCache()
      router.push(`/tabs/${newTab.slug ?? newTab.id}`)
    } catch (error) {
      console.error('Create tab error:', error)
      alert(`上傳失敗：${error?.message || error?.code || '請重試'}`)
    } finally {
      setIsSubmitting(false)
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

    // 處理 原 Key / Capo / 彈奏 Key：任填兩項，第三項自動算出
    if (name === 'originalKey' || name === 'capo' || name === 'playKey') {
      setFormData(prev => {
        const newData = { ...prev, [name]: value }
        const resolved = calculateKeyAndCapo(
          name === 'originalKey' ? value : newData.originalKey,
          name === 'capo' ? value : newData.capo,
          name === 'playKey' ? value : newData.playKey,
          name
        )
        return { ...newData, ...resolved }
      })
    } else {
      setFormData(prev => ({ ...prev, [name]: value }))
    }

    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))

    if (name === 'artist') setUseExistingArtistSelected(false)

    if (name === 'youtubeUrl') {
      const videoId = extractYouTubeVideoId(value);
      setFormData(prev => ({ ...prev, youtubeUrl: value, youtubeVideoId: videoId, youtubeVideoTitle: '', youtubeChannelTitle: '' }));
    }
  }

  const handleSaveDraft = async () => {
    const saved = await upsertTabDraft(user?.uid, {
      id: activeDraftIdRef.current,
      mode: 'new',
      data: formData
    })
    if (saved?.id) {
      activeDraftIdRef.current = saved.id
      if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back()
      } else {
        router.push('/')
      }
    } else {
      alert('儲存草稿失敗，請重試')
    }
  }

  // 原 Key / Capo / 彈奏 Key：任填兩項，第三項自動算出；被計出的欄位外框轉黃
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

  const handleCreditPaste = (e, fieldName) => {
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

  const useExistingArtist = (artist) => {
    setFormData(prev => ({
      ...prev,
      artist: artist.name,
      artistType: artist.artistType || '',
      artistPhoto: artist.photoURL || artist.wikiPhotoURL || '',
      artistBio: artist.bio || '',
      artistYear: artist.year || ''
    }))
    setSimilarArtists([])
    setUseExistingArtistSelected(true)
  }
  
  const handleArtistFill = (data) => {
    setFormData(prev => ({
      ...prev,
      artistPhoto: data.photo || '',
      artistBio: data.bio || '',
      artistYear: data.year || '',
      artistBirthYear: data.birthYear || '',
      artistDebutYear: data.debutYear || '',
      artistType: data.artistType !== 'unknown' ? data.artistType : prev.artistType
    }))
  }

  const handleSearchSpotify = () => {
    if (!formData.artist?.trim() && !formData.title?.trim()) {
      alert('請先輸入歌手名或歌名')
      return
    }
    setIsSpotifyModalOpen(true)
  }

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
      coverImage: trackData.albumImage || prev.coverImage, // 預設揀選 Spotify 專輯封面
      spotifyFilledSongYear: trackData.songYear ?? '',
      spotifyFilledAlbum: trackData.album ?? ''
    }))
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

  // 獲取可用的封面圖片選項（必須在 sectionContents 之前定義）
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
    
    // 3. 歌手相片
    if (formData.artistPhoto) {
      options.push({
        url: formData.artistPhoto,
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

  // 各區塊內容
  const sectionContents = {
    basic: (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
        {/* Row 1: 歌名* | 出譜者名稱 */}
        <div>
          <label className="block pl-1 text-[13px] font-medium text-white mb-1">歌名 <span className="text-[#FFD700]">*</span></label>
          <input type="text" name="title" value={formData.title} onChange={handleChange}
            placeholder="例如：海闊天空"
            className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${errors.title ? 'border-red-500' : 'border-neutral-700'}`} />
          {errors.title && <p className="mt-1 text-sm text-red-400">{errors.title}</p>}
        </div>
        <div>
        <div ref={penNameDropdownRef} className="relative">
          <label className="block pl-1 text-[13px] font-medium text-white mb-1">
            出譜者名稱 {!isAdmin && <span className="text-[#737373] font-normal text-xs ml-1">會使用你個人主頁嘅設定</span>}
          </label>
          <input
            type="text"
            name="uploaderPenName"
            value={formData.uploaderPenName}
            onChange={isAdmin ? (e) => setFormData(prev => ({ ...prev, uploaderPenName: e.target.value })) : undefined}
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
        </div>

        {/* Row 2: 歌手* — 與歌名同欄同寬（1 col） */}
        <div>
          <ArtistInputSimple
            value={{ artists: formData.artists }}
            hidePreview={useExistingArtistSelected}
            twoColumnLayout
            onChange={({ artists, displayName, primaryArtist }) => {
              const isConfirmed = !!primaryArtist?.id
              const validTypes = ['male', 'female', 'group']
              // 為每位歌手正規化 region（regions 陣列 → 單一 region 字串）
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
          {errors.artist && <p className="mt-1 text-sm text-red-400">{errors.artist}</p>}
          {formData.artists?.[0]?.id && !formData.artistPhoto && (
            <div className="mt-3">
              <ArtistAutoFill artistName={formData.artists[0].name} onFill={handleArtistFill} autoApply={true} />
            </div>
          )}
        </div>
        {/* 第 2 行右欄：關係選單（/ 或 feat.）| 添加歌手掣；下方 合唱/featuring 適用 */}
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
    ),
    
    key: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* 原 Key — 與類型選單同款 */}
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
                  {KEY_MAJOR.map(k => {
                    const selected = formData.originalKey === k
                    return (
                      <button key={k} type="button" onClick={() => { setKeyField('originalKey', k); setOriginalKeyMenuOpen(false) }}
                        className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${selected ? 'text-[#FFD700]' : 'text-white'}`}>
                        {k}
                      </button>
                    )
                  })}
                  <p className="px-4 py-1.5 text-[11px] text-[#737373] uppercase tracking-wide mt-1">Minor</p>
                  {KEY_MINOR.map(k => {
                    const selected = formData.originalKey === k
                    return (
                      <button key={k} type="button" onClick={() => { setKeyField('originalKey', k); setOriginalKeyMenuOpen(false) }}
                        className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${selected ? 'text-[#FFD700]' : 'text-white'}`}>
                        {k}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {/* Capo — 與類型選單同款 */}
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
          {/* 彈奏 Key — 與類型選單同款 */}
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
                        {playKeyOptions.map(k => {
                          const selected = formData.playKey === k
                          return (
                            <button key={k} type="button" onClick={() => { setKeyField('playKey', k); setPlayKeyMenuOpen(false) }}
                              className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-neutral-800 ${selected ? 'text-[#FFD700]' : 'text-white'}`}>
                              {k}
                            </button>
                          )
                        })}
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    ),
    
    youtube: (
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
    ),

    notation: (
      <NotationBlocksManager
        blocks={formData.notationBlocks || []}
        onChange={(newBlocks) => setFormData((prev) => ({ ...prev, notationBlocks: newBlocks }))}
      />
    ),
    
    content: (
      <div className="space-y-4">
        <div>
          <label className="block pl-1 text-[13px] font-medium text-white mb-1">備註 <span className="text-[#737373] font-normal text-xs ml-1">會在結他譜上方顯示</span></label>
          <textarea
            name="remark"
            value={formData.remark}
            onChange={handleChange}
            placeholder="可填掃弦節奏、指法提示、個人感想⋯⋯"
            rows={3}
            className="w-full px-4 py-2 bg-black border border-neutral-700 rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252]"
          />
        </div>
        {/* 標題與輸入欄一組，距離同其他欄位（mb-1） */}
        <div className="space-y-1">
          {/* 同一行：左 譜內容 * + 對位選擇器，右 工具列 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="pl-1 text-[13px] font-medium text-white">譜內容 <span className="text-[#FFD700]">*</span></label>
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

          <div className="relative">
            {formData.displayFont !== 'arial' && (
              <div
                className="pointer-events-none absolute z-[2] top-2 bottom-2 border-l border-[#FFD700]/55"
                style={{ left: 'calc(1rem + 32ch)' }}
                aria-hidden
              >
                <span
                  className="absolute top-0 right-1 text-[11px] leading-none text-[#FFD700]/80 whitespace-nowrap"
                  style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                >
                  電話頁面闊度參考線
                </span>
              </div>
            )}
            <textarea name="content" value={formData.content} onChange={handleChange}
            onMouseDown={(e) => e.stopPropagation()}
            onPaste={(e) => {
              const pastedText = e.clipboardData?.getData('text');
              if (typeof pastedText !== 'string') return; // fallback to native paste
              e.preventDefault();
              const cleaned = cleanPastedText(pastedText);
              const processed = formData.displayFont === 'manual' ? cleaned : autoFixTabFormatWithFactor(cleaned, alignFactor, formData.displayFont !== 'arial');
              const textarea = e.target;
              const start = textarea.selectionStart ?? 0;
              const end = textarea.selectionEnd ?? start;
              if (typeof textarea.setRangeText === 'function') {
                textarea.setRangeText(processed, start, end, 'end');
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                return;
              }
              const currentValue = formData.content;
              const newValue = currentValue.substring(0, start) + processed + currentValue.substring(end);
              setFormData(prev => ({ ...prev, content: newValue }));
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
    ),
    
    uploader: (
      <div className="space-y-4">
        {isAdmin && (
          <p className="text-sm text-[#737373]">Admin 可於上方「基本資訊」修改出譜者名稱。</p>
        )}
      </div>
    ),
    
    gpSegments: (
      <div className="space-y-4">
        {/* GP 主題：黑底黃字 | 白底黑字 */}
        <div className="flex gap-3">
          <button type="button" onClick={() => setFormData(prev => ({ ...prev, gpTheme: 'dark' }))}
            className={`flex-1 h-9 flex items-center justify-center px-4 rounded-full border transition text-sm font-medium ${
              formData.gpTheme === 'dark' ? 'bg-[#FFD700] text-black border-[#FFD700]' : 'bg-[#282828] text-white border-neutral-700 hover:border-neutral-600'
            }`}>
            黑底黃字
          </button>
          <button type="button" onClick={() => setFormData(prev => ({ ...prev, gpTheme: 'light' }))}
            className={`flex-1 h-9 flex items-center justify-center px-4 rounded-full border transition text-sm font-medium ${
              formData.gpTheme === 'light' ? 'bg-white text-black border-neutral-300' : 'bg-[#282828] text-white border-neutral-700 hover:border-neutral-600'
            }`}>
            白底黑字
          </button>
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
        
        {/* 已添加段落列表（自定義顯示） */}
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
    ),
    
    cover: (
      <div className="space-y-4">
        {/* 封面圖片選擇：單行橫向，先顯示現有選項，最後為「上傳封面」 */}
        {(() => {
          const options = getCoverImageOptions()
          const boxSize = 'w-[100px] h-[100px]'
          const norm = (u) => (u || '').trim().replace(/\/+$/, '')
          const currentCover = norm(formData.coverImage)
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-3 overflow-x-auto pb-1">
                {/* 現有圖片選項 — 同排橫向，選中黃框+黃點 */}
                {options.map((option, index) => {
                  const isSelected = currentCover && norm(option.url) === currentCover
                  return (
                  <button
                    key={index}
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
                ); })}
                {/* 上傳封面方塊（排最後） */}
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
    ),
    
    spotify: (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleSearchSpotify}
            disabled={!formData.artist && !formData.title}
            className="inline-flex items-center justify-center h-9 gap-2 px-4 bg-[#1DB954] text-white rounded-full hover:bg-[#1ed760] transition disabled:opacity-50 font-medium">
            <img src="/spotify-icon.svg" alt="" className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            獲取歌曲資訊
          </button>
          <span className={`text-sm ${spotifyFlashRedFields.size > 0 ? 'animate-spotify-empty-flash-text' : 'text-[#B3B3B3]'}`}>或手動輸入歌曲資訊</span>
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
              placeholder="例如：1993" className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('songYear') ? 'animate-spotify-empty-flash' : formData.spotifyTrackId && String(formData.songYear ?? '') === String(formData.spotifyFilledSongYear ?? '') ? 'border-[#1DB954]' : 'border-neutral-700'}`} />
          </div>
          <div>
            <label className="block pl-1 text-[13px] font-medium text-white mb-1">專輯</label>
            <input type="text" name="album" value={formData.album} onChange={handleChange}
              placeholder="例如：樂與怒" className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('album') ? 'animate-spotify-empty-flash' : formData.spotifyTrackId && String(formData.album ?? '') === String(formData.spotifyFilledAlbum ?? '') ? 'border-[#1DB954]' : 'border-neutral-700'}`} />
          </div>
          <div>
            <label className="block pl-1 text-[13px] font-medium text-white mb-1">作曲</label>
            <input type="text" name="composer" value={formData.composer} onChange={handleChange}
              onPaste={(e) => handleCreditPaste(e)}
              placeholder="例如：黃家駒" className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('composer') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
          </div>
          <div>
            <label className="block pl-1 text-[13px] font-medium text-white mb-1">填詞</label>
            <input type="text" name="lyricist" value={formData.lyricist} onChange={handleChange}
              onPaste={(e) => handleCreditPaste(e)}
              placeholder="例如：黃家駒" className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('lyricist') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
          </div>
          <div>
            <label className="block pl-1 text-[13px] font-medium text-white mb-1">編曲</label>
            <input type="text" name="arranger" value={formData.arranger} onChange={handleChange}
              onPaste={(e) => handleCreditPaste(e)}
              placeholder="例如：Beyond" className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('arranger') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
          </div>
          <div>
            <label className="block pl-1 text-[13px] font-medium text-white mb-1">監製</label>
            <input type="text" name="producer" value={formData.producer} onChange={handleChange}
              onPaste={(e) => handleCreditPaste(e)}
              placeholder="例如：Beyond" className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('producer') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
          </div>
          <div>
            <label className="block pl-1 text-[13px] font-medium text-white mb-1">BPM</label>
            <input type="number" name="bpm" value={formData.bpm} onChange={handleChange}
              placeholder="例如：120" min="1" max="300" className={`w-full px-4 py-2 bg-black border rounded-lg text-[13px] text-white placeholder:text-[13px] placeholder-[#525252] ${spotifyFlashRedFields.has('bpm') ? 'animate-spotify-empty-flash' : 'border-neutral-700'}`} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#737373]">
          <svg className="w-4 h-4 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>可於作曲／填詞／編曲／監製任一欄貼上含「作曲：」「曲：」「作詞：」「詞：」「編：」「監：」等嘅文字，會自動填入四欄；填上資料有助結他譜搜尋</span>
        </div>
      </div>
    )
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 pb-24">
        {/* Header */}
        <div className="flex items-center pt-2 mb-2">
          <Link href="/" className="inline-flex items-center text-[#737373] hover:text-white mr-4 transition" aria-label="返回">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold text-white">出譜</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormSection>{sectionContents.basic}</FormSection>
          <FormSection>{sectionContents.spotify}</FormSection>
          <FormSection>{sectionContents.youtube}</FormSection>
          <FormSection>{sectionContents.cover}</FormSection>
          {isAdmin && <FormSection>{sectionContents.gpSegments}</FormSection>}
          <FormSection>{sectionContents.key}</FormSection>
          <FormSection>{sectionContents.content}</FormSection>
          <FormSection title="六線譜">{sectionContents.notation}</FormSection>

          {/* Submit */}
          <div className="flex gap-3 -mt-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSubmitting}
              className="px-5 min-h-11 py-3 bg-[#282828] text-white rounded-lg font-semibold hover:bg-[#3E3E3E] transition disabled:opacity-50"
            >
              儲存草稿
            </button>
            <button type="submit" disabled={isSubmitting}
              className="flex-1 min-h-11 py-3 flex items-center justify-center gap-2 text-base bg-[#FFD700] text-black px-6 rounded-lg font-semibold hover:bg-yellow-400 transition disabled:opacity-50">
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                  <span>出譜中，多謝耐心等候</span>
                </>
              ) : (
                '出譜'
              )}
            </button>
          </div>
        </form>
      </div>
      
      {/* Modals */}
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
      
      <SpotifyTrackSearch
        isOpen={isSpotifyModalOpen}
        onClose={() => setIsSpotifyModalOpen(false)}
        artistName={formData.artist}
        songTitle={formData.title}
        onSelect={handleUseSpotifyTrack}
      />

    </Layout>
  )
}
