import { useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import TablatureUploader from '@/components/TablatureUploader';
import TablatureViewer from '@/components/TablatureViewer';
import { createTab } from '@/lib/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { auth } from '@/lib/firebase';

/**
 * 上傳六線譜頁面
 * 支援 Guitar Pro / MIDI / MusicXML 格式
 */
export default function NewTablaturePage() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [uploadError, setUploadError] = useState(null);
  
  // 表單數據
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    originalKey: 'C',
    description: '',
    youtubeUrl: '',
    isPublic: true
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // 文件載入回調
  const handleFileLoaded = useCallback((data, name) => {
    setFileData(data);
    setFileName(name);
    setUploadError(null);
    
    // 嘗試從檔名提取歌名
    if (name) {
      const songName = name.replace(/\.[^/.]+$/, ''); // 移除副檔名
      setFormData(prev => ({ ...prev, title: songName }));
    }
  }, []);

  // 表單變更
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // 上傳到 Firebase Storage
  const uploadToStorage = async (data, fileName) => {
    // 這裡需要實際的 Firebase Storage 上傳邏輯
    // 為示例，我們模擬一個上傳過程
    return new Promise((resolve) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        setUploadProgress(progress);
        if (progress >= 100) {
          clearInterval(interval);
          // 返回模擬的 URL
          resolve(`https://storage.example.com/tablatures/${Date.now()}_${fileName}`);
        }
      }, 100);
    });
  };

  // 提交表單
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!fileData) {
      alert('請先上傳六線譜文件');
      return;
    }
    
    if (!formData.title || !formData.artist) {
      alert('請填寫歌名和歌手');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // 上傳文件到 Storage
      const fileUrl = await uploadToStorage(fileData, fileName);
      
      // 創建樂譜記錄
      const tabData = {
        ...formData,
        fileUrl,                    // 六線譜文件 URL
        fileType: fileName.split('.').pop().toLowerCase(),
        contentType: 'tablature',    // 標記為六線譜類型
        content: '',                 // 文字譜內容為空
        createdBy: user?.uid,
        createdAt: new Date().toISOString()
      };
      
      const newTab = await createTab(tabData, user.uid);
      router.push(`/tabs/${newTab.slug ?? newTab.id}`);
      // Patch caches in background (do not await — quota can block; save must not wait)
      auth.currentUser?.getIdToken?.().then((token) => {
        if (token) {
          return fetch('/api/patch-caches-on-new-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tab: newTab, action: 'create' })
          });
        }
      }).catch(() => {}).then((patchRes) => {
        if (patchRes && !patchRes.ok) {
          console.warn('[patch-caches] failed:', patchRes.status);
        }
      });
      
    } catch (error) {
      console.error('上傳失敗:', error);
      alert('上傳失敗: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">上傳六線譜</h1>
          <p className="text-neutral-400">
            支援 Guitar Pro、MIDI、MusicXML 格式，可在線播放與學習
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* 左側：上傳與表單 */}
          <div className="space-y-6">
            {/* 文件上傳 */}
            <div className="bg-[#121212] rounded-xl border border-neutral-800 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                1. 選擇文件
              </h2>
              <TablatureUploader
                onFileLoaded={handleFileLoaded}
                onError={setUploadError}
              />
              {uploadError && (
                <p className="mt-3 text-red-400 text-sm">{uploadError.message}</p>
              )}
            </div>

            {/* 基本資訊表單 */}
            <form onSubmit={handleSubmit} className="bg-[#121212] rounded-xl border border-neutral-800 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                2. 填寫資訊
              </h2>

              <div>
                <label className="block text-sm text-white mb-1">歌名 <span className="text-[#FFD700]">*</span></label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-black border border-neutral-700 rounded-lg text-white outline-none"
                  placeholder="例如：海闊天空"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-white mb-1">歌手 <span className="text-[#FFD700]">*</span></label>
                <input
                  type="text"
                  name="artist"
                  value={formData.artist}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-black border border-neutral-700 rounded-lg text-white outline-none"
                  placeholder="例如：Beyond"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-white mb-1">原調</label>
                <select
                  name="originalKey"
                  value={formData.originalKey}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-black border border-neutral-700 rounded-lg text-white outline-none"
                >
                  {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(key => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-white mb-1">描述</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-black border border-neutral-700 rounded-lg text-white outline-none"
                  placeholder="簡介這份譜的難度、適合程度..."
                />
              </div>

              <div>
                <label className="block text-sm text-white mb-1">YouTube 連結</label>
                <input
                  type="url"
                  name="youtubeUrl"
                  value={formData.youtubeUrl}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-black border border-neutral-700 rounded-lg text-white outline-none"
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isPublic"
                  checked={formData.isPublic}
                  onChange={handleChange}
                  className="w-4 h-4 rounded border-neutral-700 bg-black text-[#FFD700]"
                />
                <span className="text-white text-sm">公開分享這份譜</span>
              </div>

              {/* 提交按 */}
              <button
                type="submit"
                disabled={isSubmitting || !fileData}
                className="w-full py-3 bg-[#FFD700] hover:bg-yellow-400 disabled:bg-neutral-700 disabled:text-neutral-500 text-black font-semibold rounded-lg transition flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    上傳中... {uploadProgress}%
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    上傳六線譜
                  </>
                )}
              </button>
            </form>
          </div>

          {/* 右側：預覽 */}
          <div>
            <div className="bg-[#121212] rounded-xl border border-neutral-800 p-6 sticky top-24">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#FFD700]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                3. 預覽
              </h2>
              
              {fileData ? (
                <TablatureViewer
                  fileData={fileData}
                  height={500}
                  onReady={(score) => console.log('樂譜載入完成:', score)}
                  onError={(err) => console.error('載入失敗:', err)}
                />
              ) : (
                <div className="h-[500px] bg-black rounded-lg flex items-center justify-center border border-neutral-800 border-dashed">
                  <div className="text-center text-neutral-500">
                    <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    <p>上傳文件後即可預覽</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
