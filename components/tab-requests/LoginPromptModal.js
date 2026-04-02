import { useState } from 'react'

const GOOGLE_ICON = (
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
)

export default function LoginPromptModal({ onClose, signInWithGoogle }) {
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    try {
      await signInWithGoogle()
      onClose()
    } catch (e) {
      console.error(e)
      if (e.code === 'auth/in-app-browser') {
        alert('請用 Safari 或 Chrome 開啟此頁面後再登入。\n\n（Instagram / Facebook 內置瀏覽器不支援 Google 登入）')
      } else if (e.code === 'auth/unauthorized-domain') {
        alert(`Firebase 未授權此域名，請聯繫管理員添加：${window.location.hostname}`)
      } else {
        alert('Google 登入失敗：' + (e.message || e))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4 pointer-events-auto">
      <div className="bg-[#121212] rounded-2xl w-full max-w-sm overflow-hidden border border-neutral-800">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">請先登入</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-4">
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-[#121212] border-2 border-neutral-800 text-white py-3 px-4 rounded-lg font-medium hover:border-[#FFD700] transition disabled:opacity-50"
          >
            {GOOGLE_ICON}
            <span>{loading ? '登入中...' : '使用 Google 登入'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
