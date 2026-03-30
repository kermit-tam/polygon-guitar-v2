import { useState, useRef } from 'react'
import Head from 'next/head'
import Link from '@/components/Link'
import { ArrowLeft, Upload, Check, Copy } from 'lucide-react'
import { uploadToCloudinary, validateImageFile } from '@/lib/cloudinary'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'

function SiteLogoAdmin() {
  const [uploading, setUploading] = useState(false)
  const [uploadedUrl, setUploadedUrl] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)

  const handleFile = async (file) => {
    setError(null)
    setUploadedUrl(null)
    setCopied(false)

    const { valid, error: validErr } = validateImageFile(file)
    if (!valid) { setError(validErr); return }

    setPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      const url = await uploadToCloudinary(file, 'site_logo')
      setUploadedUrl(url)
    } catch (e) {
      setError(e.message || '上傳失敗')
    } finally {
      setUploading(false)
    }
  }

  const handleInputChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleCopy = () => {
    if (!uploadedUrl) return
    navigator.clipboard.writeText(uploadedUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Head><title>上傳網站 Logo</title></Head>
      <div className="max-w-xl mx-auto px-4 py-8">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> 返回管理員
        </Link>
        <h1 className="text-2xl font-bold mb-6">上傳網站 Logo</h1>

        {/* Drop zone */}
        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-blue-400 transition-colors bg-white"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <Upload className="w-8 h-8 text-gray-400" />
          <p className="text-gray-600 text-sm text-center">
            點擊或拖拉圖片到此處上傳<br />
            <span className="text-gray-400 text-xs">JPG、PNG、WebP，最大 2MB</span>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>

        {/* Preview */}
        {preview && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <p className="text-sm text-gray-500">預覽</p>
            <img src={preview} alt="preview" className="max-h-32 object-contain rounded shadow" />
          </div>
        )}

        {/* Uploading state */}
        {uploading && (
          <p className="mt-4 text-sm text-blue-600 text-center animate-pulse">上傳中…</p>
        )}

        {/* Error */}
        {error && (
          <p className="mt-4 text-sm text-red-600 text-center">{error}</p>
        )}

        {/* Result */}
        {uploadedUrl && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4 flex flex-col gap-3">
            <p className="text-sm font-medium text-green-800 flex items-center gap-1">
              <Check className="w-4 h-4" /> 上傳成功
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={uploadedUrl}
                className="flex-1 text-xs bg-white border border-gray-200 rounded px-2 py-1.5 font-mono text-gray-700 truncate"
              />
              <button
                onClick={handleCopy}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? '已複製' : '複製'}
              </button>
            </div>
            <p className="text-xs text-green-700">
              複製上面的 URL，然後貼到 <code className="bg-green-100 px-1 rounded">components/Navbar.js</code> 的 <code className="bg-green-100 px-1 rounded">SITE_LOGO_URL</code>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SiteLogoPage() {
  return (
    <AdminGuard>
      <Layout>
        <SiteLogoAdmin />
      </Layout>
    </AdminGuard>
  )
}
