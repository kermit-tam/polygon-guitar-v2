import { useState } from 'react'
import { analyzeDifficulty } from '@/lib/tabAnalysis'

/**
 * 多版本比較組件
 * 顯示同一首歌嘅唔同版本，幫用戶揀選
 */

export default function TabVersionComparison({ versions }) {
  const [sortBy, setSortBy] = useState('recommended')
  const [filterLevel, setFilterLevel] = useState('all')

  if (!versions || versions.length === 0) return null

  // 排序邏輯
  const sortedVersions = [...versions].sort((a, b) => {
    switch (sortBy) {
      case 'popular':
        return (b.viewCount || 0) - (a.viewCount || 0)
      case 'likes':
        return (b.likes || 0) - (a.likes || 0)
      case 'newest':
        return new Date(b.createdAt) - new Date(a.createdAt)
      case 'easiest':
        const difficultyOrder = { beginner: 0, intermediate: 1, advanced: 2 }
        return difficultyOrder[a.autoAnalysis?.level] - difficultyOrder[b.autoAnalysis?.level]
      case 'hardest':
        return difficultyOrder[b.autoAnalysis?.level] - difficultyOrder[a.autoAnalysis?.level]
      default: // recommended
        return calculateScore(b) - calculateScore(a)
    }
  })

  // 篩選
  const filteredVersions = sortedVersions.filter(v => {
    if (filterLevel === 'all') return true
    return v.autoAnalysis?.level === filterLevel
  })

  // 計算推薦分數
  function calculateScore(version) {
    let score = 0
    score += (version.viewCount || 0) * 0.3
    score += (version.likes || 0) * 2
    score += (version.userVotes?.goodForBeginners || 0) * 1.5
    score += (version.userVotes?.soundsLikeOriginal || 0) * 1.5
    return score
  }

  return (
    <div className="bg-[#121212] rounded-xl border border-neutral-800">
      {/* 標題同控制 */}
      <div className="p-4 border-b border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-white">
            多個版本（{versions.length}）
          </h3>
          
          {/* 篩選器 */}
          <div className="flex flex-wrap gap-2">
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="bg-neutral-800 text-white px-3 py-1.5 rounded-lg text-sm border border-neutral-700"
            >
              <option value="all">全部難度</option>
              <option value="beginner">初階</option>
              <option value="intermediate">中級</option>
              <option value="advanced">進階</option>
            </select>
            
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-neutral-800 text-white px-3 py-1.5 rounded-lg text-sm border border-neutral-700"
            >
              <option value="recommended">推薦排序</option>
              <option value="popular">最熱門</option>
              <option value="likes">最多讚好</option>
              <option value="easiest">最簡單</option>
              <option value="hardest">最進階</option>
              <option value="newest">最新</option>
            </select>
          </div>
        </div>
      </div>

      {/* 版本列表 */}
      <div className="divide-y divide-neutral-800">
        {filteredVersions.map((version, index) => (
          <VersionCard 
            key={version.id} 
            version={version} 
            rank={index + 1}
            isTop={index < 3}
          />
        ))}
      </div>
    </div>
  )
}

function VersionCard({ version, rank, isTop }) {
  const analysis = version.autoAnalysis || {}
  const votes = version.userVotes || {}
  
  // 標籤顯示
  const allTags = [
    ...(analysis.autoTags || []),
    ...(version.manualTags?.style || []),
    ...(version.manualTags?.audience || [])
  ]

  return (
    <a
      href={`/tabs/${version.slug ?? version.id}`}
      className={`block p-4 hover:bg-neutral-800/50 transition ${isTop ? 'bg-neutral-800/20' : ''}`}
    >
      <div className="flex items-start gap-4">
        {/* 排名 */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
          rank === 1 ? 'bg-yellow-500 text-black' :
          rank === 2 ? 'bg-neutral-300 text-black' :
          rank === 3 ? 'bg-amber-600 text-white' :
          'bg-neutral-700 text-neutral-400'
        }`}>
          {rank}
        </div>

        {/* 內容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* 編輯推薦標記 */}
            {version.isEditorPick && (
              <span className="px-2 py-0.5 bg-[#FFD700] text-black text-xs rounded font-bold">
                編輯推薦
              </span>
            )}
            
            {/* 熱門標記 */}
            {(version.viewCount || 0) > 1000 && (
              <span className="px-2 py-0.5 bg-red-600 text-white text-xs rounded">
                熱門
              </span>
            )}
            
            {/* 新手首選 */}
            {(votes.goodForBeginners || 0) > 20 && (
              <span className="px-2 py-0.5 bg-green-600 text-white text-xs rounded">
                新手首選
              </span>
            )}
            
            {/* 原汁原味 */}
            {(votes.soundsLikeOriginal || 0) > 15 && (
              <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded">
                最似原曲
              </span>
            )}
          </div>

          {/* 標題同資訊 */}
          <h4 className="text-white font-medium truncate mb-2">
            {version.title}
            {version.manualTags?.style?.includes('original') && (
              <span className="text-[#FFD700] ml-2 text-sm">[原汁原味]</span>
            )}
          </h4>

          {/* 難度同資訊 */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-400">
            <DifficultyBadge level={analysis.level} />
            
            <span>{analysis.chordCount}個和弦</span>
            {analysis.barreCount > 0 && (
              <span>{analysis.barreCount}個橫按</span>
            )}
            
            <span className="text-neutral-600">|</span>
            
            <span>{version.viewCount || 0}</span>
            <span>{version.likes || 0}</span>
            
            {/* 投票數 */}
            {(votes.goodForBeginners || votes.soundsLikeOriginal) && (
              <>
                <span className="text-neutral-600">|</span>
                {votes.goodForBeginners > 0 && (
                  <span className="text-green-400">{votes.goodForBeginners}</span>
                )}
                {votes.soundsLikeOriginal > 0 && (
                  <span className="text-blue-400">{votes.soundsLikeOriginal}</span>
                )}
              </>
            )}
          </div>

          {/* 標籤 */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {allTags.slice(0, 4).map((tag, i) => (
                <span key={i} className="px-2 py-0.5 bg-neutral-700 text-neutral-300 text-xs rounded">
                  {tag}
                </span>
              ))}
              {allTags.length > 4 && (
                <span className="text-neutral-500 text-xs">+{allTags.length - 4}</span>
              )}
            </div>
          )}

          {/* 摘要 */}
          {analysis.summary && (
            <p className="text-neutral-500 text-xs mt-2">
              {analysis.summary}
            </p>
          )}
        </div>

        {/* 箭頭 */}
        <div className="text-neutral-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </a>
  )
}

function DifficultyBadge({ level }) {
  const config = {
    beginner: { color: 'text-green-400', bg: 'bg-green-400/10', label: '初階' },
    intermediate: { color: 'text-yellow-400', bg: 'bg-yellow-400/10', label: '中級' },
    advanced: { color: 'text-red-400', bg: 'bg-red-400/10', label: '進階' }
  }
  
  const { color, bg, label } = config[level] || config.beginner
  
  return (
    <span className={`px-2 py-0.5 ${bg} ${color} rounded text-xs font-medium`}>
      {label}
    </span>
  )
}
