import { useState, useEffect, useRef } from 'react'
import { Send, Check, Paperclip, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const FIELD = 'border border-white/10 bg-white/5 rounded-lg px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-white/30 w-full transition-colors'

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result) // data:image/...;base64,...
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ContactForm({ subject = '', extras = false }) {
  const { user } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', subject, message: '', link: '' })
  const [images, setImages] = useState([]) // [{ name, dataUrl }]
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (user) {
      setForm((f) => ({
        ...f,
        email: f.email || user.email || '',
        name: f.name || user.displayName || '',
      }))
    }
  }, [user])

  const [status, setStatus] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleImageChange = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const newImages = await Promise.all(files.map(async (file) => ({ name: file.name, dataUrl: await readFileAsBase64(file) })))
    setImages((prev) => [...prev, ...newImages])
    e.target.value = ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus('sending')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, images }),
      })
      if (res.ok) {
        setStatus('sent')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
          <Check className="w-6 h-6 text-green-400" />
        </div>
        <p className="text-white font-semibold">已收到你的訊息！</p>
        <p className="text-white/50 text-sm">我們會盡快回覆你。</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-white/60 text-xs">姓名</label>
          <input className={FIELD} placeholder="你的名字" value={form.name} onChange={set('name')} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-white/60 text-xs">電郵</label>
          <input className={FIELD} type="email" placeholder="your@email.com" value={form.email} onChange={set('email')} required />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-white/60 text-xs">主題</label>
        <input className={FIELD} placeholder="訊息主題" value={form.subject} onChange={set('subject')} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-white/60 text-xs">內容</label>
        <textarea className={`${FIELD} resize-none`} rows={6} placeholder="請輸入你的訊息…" value={form.message} onChange={set('message')} required />
      </div>
      {extras && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-white/60 text-xs">相關連結（選填）</label>
            <input className={FIELD} type="url" placeholder="https://…" value={form.link} onChange={set('link')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-white/60 text-xs">附上截圖（選填）</label>
            {images.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {images.map((img, i) => (
                  <div key={i} className="flex items-center gap-2 border border-white/10 bg-white/5 rounded-lg px-4 py-3">
                    <Paperclip className="w-4 h-4 text-white/40 shrink-0" />
                    <span className="text-white/70 text-sm truncate flex-1">{img.name}</span>
                    <button type="button" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} className="text-white/40 hover:text-white transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 border border-dashed border-white/20 hover:border-white/40 bg-white/5 rounded-lg px-4 py-3 text-white/50 hover:text-white/70 text-sm transition-colors text-left"
            >
              <Paperclip className="w-4 h-4 shrink-0" />
              {images.length > 0 ? '再加圖片' : '點擊上傳圖片'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageChange} />
          </div>
        </>
      )}
      {status === 'error' && (
        <p className="text-red-400 text-sm">發送失敗，請稍後再試。</p>
      )}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="flex items-center justify-center gap-2 px-6 py-3 bg-[#FFD700] hover:bg-yellow-400 disabled:opacity-60 text-black font-semibold rounded-lg text-sm transition-colors self-start"
      >
        <Send className="w-4 h-4" />
        {status === 'sending' ? '發送中…' : '發送'}
      </button>
    </form>
  )
}
