import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/contexts/AuthContext'
import { db } from '@/lib/firebase'
import { collection, query, orderBy, getDocs, where, doc, getDoc } from '@/lib/firestore-tracked'
import { format, startOfDay, endOfDay, subDays } from 'date-fns'
import { useArtistMap } from '@/lib/useArtistMap'

export default function DailyUploads() {
  const router = useRouter()
  const { user, isAdmin } = useAuth()
  const { getArtistName } = useArtistMap()
  const [uploads, setUploads] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [userCache, setUserCache] = useState({})

  useEffect(() => {
    if (isAdmin) {
      loadUploads()
    }
  }, [selectedDate, isAdmin])

  const loadUploads = async () => {
    setLoading(true)
    try {
      const start = startOfDay(new Date(selectedDate))
      const end = endOfDay(new Date(selectedDate))
      
      // 獲取所有譜
      const q = query(
        collection(db, 'tabs'),
        orderBy('createdAt', 'desc')
      )
      
      const snapshot = await getDocs(q)
      const allTabs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      
      // 過濾當日
      const dayUploads = allTabs.filter(tab => {
        const tabDate = tab.createdAt?.toDate ? tab.createdAt.toDate() : new Date(tab.createdAt)
        return tabDate >= start && tabDate <= end
      })
      
      // 獲取用戶資料
      const userIds = [...new Set(dayUploads.map(t => t.createdBy).filter(Boolean))]
      const newCache = { ...userCache }
      
      for (const userId of userIds) {
        if (!newCache[userId]) {
          try {
            const userDoc = await getDoc(doc(db, 'users', userId))
            if (userDoc.exists()) {
              newCache[userId] = userDoc.data()
            } else {
              newCache[userId] = { displayName: '未知用戶', email: '' }
            }
          } catch (e) {
            newCache[userId] = { displayName: '未知用戶', email: '' }
          }
        }
      }
      
      setUserCache(newCache)
      setUploads(dayUploads)
    } catch (error) {
      console.error('載入失敗:', error)
    } finally {
      setLoading(false)
    }
  }

  const getUserInfo = (userId) => {
    return userCache[userId] || { displayName: '載入中...', email: '' }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return '-'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return format(date, 'HH:mm')
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-8">
          <div className="bg-[#121212] rounded-xl p-8 text-center">
            <p className="text-neutral-400">請以管理員身份登入</p>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        <h1 className="text-2xl font-bold text-white mb-6">每日上傳監控</h1>
        
        {/* 日期選擇 */}
        <div className="bg-[#121212] rounded-xl p-4 border border-neutral-800 mb-6">
          <div className="flex items-center gap-4">
            <label className="text-neutral-400">選擇日期：</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-[#1a1a1a] text-white px-4 py-2 rounded-lg border border-neutral-700"
            />
            <button
              onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
              className="px-4 py-2 bg-[#FFD700] text-black rounded-lg font-medium hover:bg-yellow-400"
            >
              今日
            </button>
            <button
              onClick={() => setSelectedDate(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}
              className="px-4 py-2 bg-[#282828] text-white rounded-lg hover:bg-[#3E3E3E]"
            >
              昨日
            </button>
            <span className="text-neutral-400 ml-4">
              共 {uploads.length} 份新譜
            </span>
          </div>
        </div>

        {/* 上傳列表 */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : uploads.length === 0 ? (
          <div className="bg-[#121212] rounded-xl p-8 text-center border border-neutral-800">
            <p className="text-neutral-400">當日沒有新上傳</p>
          </div>
        ) : (
          <div className="bg-[#121212] rounded-xl border border-neutral-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#1a1a1a]">
                <tr>
                  <th className="px-4 py-3 text-left text-neutral-400 font-medium">時間</th>
                  <th className="px-4 py-3 text-left text-neutral-400 font-medium">Google 帳戶</th>
                  <th className="px-4 py-3 text-left text-neutral-400 font-medium">出譜者名稱</th>
                  <th className="px-4 py-3 text-left text-neutral-400 font-medium">歌曲</th>
                  <th className="px-4 py-3 text-left text-neutral-400 font-medium">歌手</th>
                  <th className="px-4 py-3 text-left text-neutral-400 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {uploads.map((tab) => {
                  const userInfo = getUserInfo(tab.createdBy)
                  return (
                    <tr key={tab.id} className="hover:bg-[#1a1a1a]">
                      <td className="px-4 py-3 text-neutral-400">
                        {formatTime(tab.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-white">
                        {userInfo.displayName}
                        <div className="text-xs text-neutral-500">{userInfo.email}</div>
                      </td>
                      <td className="px-4 py-3 text-[#FFD700]">
                        {tab.uploaderPenName || '-'}
                      </td>
                      <td className="px-4 py-3 text-white">
                        {tab.title}
                      </td>
                      <td className="px-4 py-3 text-neutral-400">
                        {getArtistName(tab)}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={`/tabs/${tab.slug ?? tab.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 mr-3"
                        >
                          查看
                        </a>
                        <a
                          href={`/tabs/${tab.id}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#FFD700] hover:text-yellow-300"
                        >
                          編輯
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  )
}
