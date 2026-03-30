import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { User, UserX, Shield } from 'lucide-react'

// 頂欄高度與 Navbar 一致：4.4rem + safe area，Admin 掣放喺正下方
const NAV_BAR_TOP = 'calc(4.4rem + env(safe-area-inset-top, 0px) + 4px)'

export default function AdminViewAsButton() {
  const { realIsAdmin, viewAsMode, setViewAsMode, showAdminViewAsButton } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  if (!realIsAdmin || !showAdminViewAsButton) return null

  const options = [
    { value: 'admin', label: 'Admin', icon: Shield },
    { value: 'user', label: '一般用戶', icon: User },
    { value: 'guest', label: '未登入', icon: UserX }
  ]
  const current = options.find((o) => o.value === viewAsMode) || options[0]

  return (
    <div ref={ref} className="fixed right-4 z-[9998]" style={{ top: NAV_BAR_TOP }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#282828] border border-[#444] text-white text-xs font-medium shadow-lg hover:bg-[#3E3E3E] transition"
        title="以不同身份瀏覽"
        aria-label="切換瀏覽身份"
      >
        {current.value === 'admin' && <Shield className="w-3.5 h-3.5 text-[#FFD700]" />}
        {current.value === 'user' && <User className="w-3.5 h-3.5" />}
        {current.value === 'guest' && <UserX className="w-3.5 h-3.5" />}
        <span className="max-w-[72px] truncate">{current.label}</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 py-1 rounded-xl bg-[#121212] border border-[#333] shadow-xl min-w-[120px]">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setViewAsMode(opt.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition ${viewAsMode === opt.value ? 'bg-[#FFD700]/20 text-[#FFD700]' : 'text-white hover:bg-white/5'}`}
            >
              <opt.icon className="w-4 h-4 shrink-0" />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
