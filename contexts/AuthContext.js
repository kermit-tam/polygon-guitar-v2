import { createContext, useContext, useEffect, useState } from 'react'
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth'
import { auth, googleProvider, db } from '@/lib/firebase'
import { doc, setDoc, getDoc } from '@/lib/firestore-tracked'

const AuthContext = createContext()

const VIEW_AS_STORAGE_KEY = 'pg_admin_view_as' // 'admin' | 'user' | 'guest'
const VIEW_AS_BUTTON_VISIBLE_KEY = 'pg_admin_view_as_button_visible' // '1' | '0'

function getStoredViewAsButtonVisible() {
  if (typeof window === 'undefined') return true
  try {
    const v = localStorage.getItem(VIEW_AS_BUTTON_VISIBLE_KEY)
    if (v === '0' || v === 'false') return false
  } catch (_) {}
  return true
}

function getStoredViewAs() {
  if (typeof window === 'undefined') return 'admin'
  try {
    const v = localStorage.getItem(VIEW_AS_STORAGE_KEY)
    if (v === 'guest' || v === 'user' || v === 'admin') return v
  } catch (_) {}
  return 'admin'
}

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [viewAsMode, setViewAsModeState] = useState('admin')
  const [showAdminViewAsButton, setShowAdminViewAsButtonState] = useState(true)

  // Handle redirect result on mount
  useEffect(() => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          await createOrUpdateUser(result.user)
        }
      })
      .catch((error) => {
        console.error('Redirect result error:', error)
      })
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        // 先顯示 Firebase 用戶，避免等 Firestore 拖慢首屏
        setUser(firebaseUser)
        setLoading(false)
        // 背景載入 Firestore 資料再合併
        getDoc(doc(db, 'users', firebaseUser.uid))
          .then((userDoc) => {
            if (userDoc.exists()) {
              setUser((prev) => (prev ? { ...prev, ...userDoc.data() } : prev))
            }
          })
          .catch(() => {})
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => unsubscribe()
  }, [])

  const createOrUpdateUser = async (firebaseUser) => {
    const userRef = doc(db, 'users', firebaseUser.uid)
    const userData = {
      uid: firebaseUser.uid,
      displayName: firebaseUser.displayName,
      email: firebaseUser.email,
      photoURL: firebaseUser.photoURL,
      provider: firebaseUser.providerData[0]?.providerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    const userDoc = await getDoc(userRef)
    if (!userDoc.exists()) {
      // 新帳號：自動生成出譜者名稱（displayName > email 前段 > 結他友）
      const generatedPenName = (firebaseUser.displayName || '').trim() ||
        (firebaseUser.email || '').split('@')[0]?.trim() || '結他友'
      await setDoc(userRef, { ...userData, penName: generatedPenName })
    } else {
      await setDoc(userRef, {
        ...userData,
        createdAt: userDoc.data().createdAt
      }, { merge: true })
    }
  }

  const signInWithGoogle = async () => {
    // In-app browsers (Instagram, Facebook, Line) block popups and partition sessionStorage,
    // causing both signInWithPopup and signInWithRedirect to fail.
    // Tell the user to open in their real browser instead.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const isInAppBrowser = /Instagram|FBAN|FBAV|Line\/|Musical\.ly|TikTok/i.test(ua)
    if (isInAppBrowser) {
      throw Object.assign(new Error('in-app-browser'), { code: 'auth/in-app-browser' })
    }

    try {
      const result = await signInWithPopup(auth, googleProvider)
      await createOrUpdateUser(result.user)
      return result.user
    } catch (error) {
      if (error.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, googleProvider)
      } else {
        throw error
      }
    }
  }

  const logout = async () => {
    await signOut(auth)
    setUser(null)
  }

  // 管理員檢查 - 只從 Firestore user 資料讀取（role / isAdmin），無硬編碼 email
  const realIsAdmin = user?.isAdmin === true || !!user?.role

  // Admin 可切換「以誰身份瀏覽」：admin（正常）、user（一般登入用戶）、guest（未登入）
  // 非管理員：未登入用 guest、已登入用 user，這樣 isAdmin 只會對真正 admin 為 true
  const effectiveViewAs = realIsAdmin ? viewAsMode : (user ? 'user' : 'guest')
  const effectiveUser = effectiveViewAs === 'guest' ? null : user
  const isAdmin = effectiveViewAs === 'admin'

  const setViewAsMode = (mode) => {
    if (mode !== 'admin' && mode !== 'user' && mode !== 'guest') return
    setViewAsModeState(mode)
    try { localStorage.setItem(VIEW_AS_STORAGE_KEY, mode) } catch (_) {}
  }

  const setShowAdminViewAsButton = (show) => {
    const on = !!show
    setShowAdminViewAsButtonState(on)
    try { localStorage.setItem(VIEW_AS_BUTTON_VISIBLE_KEY, on ? '1' : '0') } catch (_) {}
  }

  // 登入後若為 admin，從 localStorage 還原 viewAs
  useEffect(() => {
    if (realIsAdmin && user) setViewAsModeState(getStoredViewAs())
  }, [realIsAdmin, !!user])

  useEffect(() => {
    if (realIsAdmin && user) setShowAdminViewAsButtonState(getStoredViewAsButtonVisible())
  }, [realIsAdmin, !!user])

  // 獲取用戶角色（以 effective 身份計，只來自 Firestore）
  const userRole = effectiveUser?.role || null

  const value = {
    user: effectiveUser,
    loading,
    signInWithGoogle,
    logout,
    isAuthenticated: !!effectiveUser,
    isAdmin,
    userRole,
    // Admin 專用：實際身份與切換「以誰身份瀏覽」
    realUser: user,
    realIsAdmin: !!realIsAdmin,
    viewAsMode: effectiveViewAs,
    setViewAsMode,
    showAdminViewAsButton,
    setShowAdminViewAsButton
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
