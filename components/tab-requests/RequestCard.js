import { useRouter } from 'next/router'
import HandRaiseIcon from '@/components/icons/HandRaiseIcon'
import MusicNoteIcon from '@/components/icons/MusicNoteIcon'

export default function RequestCard({
  request,
  isAdmin,
  user,
  editingRequest,
  editFormData,
  setEditFormData,
  saveEdit,
  cancelEdit,
  justCancelledId,
  displayAsUnvotedId,
  hasVoted,
  onVote,
  onFulfill,
  onDelete,
  onShowRequestFulfillers,
}) {
  const router = useRouter()
  const isFulfilled = request.status === 'fulfilled'
  const hasTab = isFulfilled && request.tabId

  return (
    <div
      key={request.id}
      role={hasTab ? 'link' : undefined}
      tabIndex={hasTab ? 0 : undefined}
      onClick={hasTab ? () => router.push(`/tabs/${request.tabId}`) : undefined}
      onKeyDown={hasTab ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/tabs/${request.tabId}`); } } : undefined}
      className={`rounded-xl p-3 flex items-center gap-3 relative ${isFulfilled ? 'bg-[#0f2418] opacity-75' : 'bg-[#121212]'} ${hasTab ? 'cursor-pointer' : ''}`}
    >
      {(isAdmin || (user?.uid && request.requestedBy === user.uid && (request.voteCount || 0) <= 1)) && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(request.id); }}
          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 shadow-md border-2 border-[#121212] transition touch-manipulation"
          title="刪除"
          aria-label="刪除此求譜"
        >
          <span className="block w-2.5 h-0.5 bg-current rounded-full" aria-hidden />
        </button>
      )}

      {/* Thumbnail */}
      <div className="w-12 h-12 bg-[#1a1a1a] rounded-lg overflow-hidden flex-shrink-0">
        {request.albumImage ? (
          <img src={request.albumImage} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <MusicNoteIcon />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 shrink">
        {editingRequest?.id === request.id ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editFormData.songTitle}
              onChange={(e) => setEditFormData({ ...editFormData, songTitle: e.target.value })}
              className="w-full bg-[#1a1a1a] border border-[#FFD700]/50 rounded px-2 py-1 text-white text-sm"
              placeholder="歌名"
            />
            <input
              type="text"
              value={editFormData.artistName}
              onChange={(e) => setEditFormData({ ...editFormData, artistName: e.target.value })}
              className="w-full bg-[#1a1a1a] border border-[#FFD700]/50 rounded px-2 py-1 text-neutral-300 text-sm"
              placeholder="歌手"
            />
            <div className="flex gap-2">
              <button onClick={saveEdit} className="px-2 py-1 bg-[#FFD700] text-black rounded text-xs font-medium">保存</button>
              <button onClick={cancelEdit} className="px-2 py-1 bg-[#282828] text-neutral-400 rounded text-xs">取消</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="font-medium truncate text-white">{request.songTitle}</div>
            </div>
            <div className="text-neutral-500 text-sm truncate">{request.artistName}</div>
            <div className="text-[#FFD700] text-xs mt-0.5 flex items-center gap-2 min-w-0">
              {(() => {
                const voteCount = request.voteCount ?? 0
                // Admin 點擊「N 人求譜 / N 人求譜成功」都顯示彈窗（求譜用戶 + 出譜者）
                const clickable = isAdmin && typeof onShowRequestFulfillers === 'function'
                const label = isFulfilled ? `${voteCount} 人求譜成功` : `${voteCount} 人求譜`

                if (!clickable) {
                  return isFulfilled ? (
                    <span className="text-green-400 truncate min-w-0">{label}</span>
                  ) : (
                    <span>{label}</span>
                  )
                }

                return isFulfilled ? (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShowRequestFulfillers(request) }}
                    className="text-green-400 truncate min-w-0 hover:opacity-90 text-left"
                    aria-label="查看求譜用戶"
                    title="查看求譜用戶"
                  >
                    {label}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShowRequestFulfillers(request) }}
                    className="truncate min-w-0 hover:opacity-90 text-left"
                    aria-label="查看求譜用戶"
                    title="查看求譜用戶"
                  >
                    {label}
                  </button>
                )
              })()}
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className={`flex items-center gap-2 min-w-0 ${isFulfilled ? '' : 'flex-shrink-0'}`} style={isFulfilled ? { flexShrink: 2 } : undefined}>
        {isFulfilled ? (
          <div className="flex flex-col items-end text-right min-w-0 w-full">
            <span className="text-white text-xs truncate w-full text-right">感謝 {request.fulfilledByName || '結他友'} 出譜</span>
          </div>
        ) : (
          <>
            <button
              onClick={() => onVote(request.id)}
              className={`rounded-full flex items-center justify-center gap-1.5 h-9 transition-all duration-300 ease-out ${
                justCancelledId === request.id
                  ? 'bg-[#282828] text-neutral-400 cursor-default px-3 py-2 min-w-[2.5rem] w-28'
                  : displayAsUnvotedId === request.id
                    ? 'w-9 bg-[#FFD700] text-black cursor-default'
                    : hasVoted(request)
                      ? 'h-9 px-3 py-1.5 rounded-full bg-[#282828] text-[#FFD700] cursor-default text-sm font-medium'
                      : 'w-9 bg-[#FFD700] text-black hover:opacity-90 rounded-full'
              }`}
              title={justCancelledId === request.id ? '已取消求譜' : displayAsUnvotedId === request.id ? '我要求譜' : hasVoted(request) ? '取消求譜' : '我要求譜'}
            >
              {justCancelledId === request.id ? (
                <span className="text-neutral-400 text-sm whitespace-nowrap">已取消求譜</span>
              ) : displayAsUnvotedId === request.id ? (
                <HandRaiseIcon />
              ) : hasVoted(request) ? (
                <span className="text-[#FFD700] text-sm font-medium whitespace-nowrap">已求譜</span>
              ) : (
                <HandRaiseIcon />
              )}
            </button>
            <button
              type="button"
              onClick={() => onFulfill(request)}
              className={`h-9 px-3 py-1.5 rounded-full flex items-center justify-center transition text-sm font-medium ${
                hasVoted(request)
                  ? 'bg-[#1a1a1a] text-neutral-500 cursor-default opacity-70'
                  : 'bg-[#282828] text-[#FFD700] hover:bg-[#FFD700] hover:text-black'
              }`}
              title="出譜"
            >
              出譜
            </button>
          </>
        )}
      </div>
    </div>
  )
}
