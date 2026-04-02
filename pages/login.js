import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from '@/components/Link'
import { useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/Layout'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '@/lib/firebase'

export default function Login() {
  const router = useRouter()
  const { signInWithGoogle, isAuthenticated, createOrUpdateUser } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // Handle custom token from server-side OAuth flow (in-app browser fix)
  useEffect(() => {
    const { customToken, returnTo, error } = router.query
    if (error) {
      setErrorMsg('登入失敗，請再試一次。')
      return
    }
    if (!customToken) return
    setIsLoading(true)
    signInWithCustomToken(auth, customToken)
      .then(async (result) => {
        if (createOrUpdateUser) await createOrUpdateUser(result.user).catch(() => {})
        router.replace(returnTo && returnTo.startsWith('/') ? returnTo : '/')
      })
      .catch((e) => {
        console.error('customToken sign in error', e)
        setErrorMsg('登入失敗，請再試一次。')
        setIsLoading(false)
      })
  }, [router.query])

  // Redirect if already logged in
  if (isAuthenticated) {
    router.push('/')
    return null
  }

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    setErrorMsg(null)
    try {
      await signInWithGoogle()
      router.push('/')
    } catch (error) {
      console.error('Google sign in error:', error)
      if (error.code === 'auth/in-app-browser') {
        // Redirect to server-side OAuth flow which works in in-app browsers
        window.location.href = `/api/auth/google-start?returnTo=${encodeURIComponent(router.query.returnTo || '/')}`
        return
      } else if (error.code === 'auth/unauthorized-domain') {
        setErrorMsg(`Firebase 未授權此域名：${window.location.hostname}`)
      } else {
        setErrorMsg('Google 登入失敗：' + error.message)
      }
      setIsLoading(false)
    }
  }

  return (
    <Layout>
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="bg-[#121212] rounded-2xl w-full max-w-sm overflow-hidden border border-neutral-800">
          <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">請先登入</h2>
            <Link href="/" className="text-neutral-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Link>
          </div>
          <div className="p-4 space-y-4">
            {errorMsg && <p className="text-red-400 text-sm text-center">{errorMsg}</p>}
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 bg-[#121212] border-2 border-neutral-800 text-white py-3 px-4 rounded-lg font-medium hover:border-[#FFD700] transition disabled:opacity-50"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>{isLoading ? '登入中...' : '使用 Google 登入'}</span>
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}
