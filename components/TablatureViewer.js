import { useState, useEffect, useRef } from 'react';
import * as AlphaTab from '@coderline/alphatab';

/**
 * 六線譜顯示組件
 * 支援 Guitar Pro / MusicXML / MIDI 格式
 * 
 * 使用 AlphaTab 開源庫 (MIT License)
 * 官網: https://www.alphatab.net/
 * GitHub: https://github.com/CoderLine/alphaTab
 */
export default function TablatureViewer({ 
  fileUrl,           // 樂譜檔案 URL
  fileData,          // 或直接傳入 ArrayBuffer
  width = '100%',    // 寬度
  height = 600,      // 高度
  showControls = true, // 顯示控制按鈕
  onReady,           // 載入完成回調
  onError            // 錯誤回調
}) {
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(null);

  // 初始化 AlphaTab
  useEffect(() => {
    if (!containerRef.current) return;

    const initAlphaTab = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 創建 AlphaTab 實例
        const settings = {
          file: fileUrl || fileData,
          core: {
            engine: 'svg',           // 使用 SVG 渲染（清晰可縮放）
            logLevel: 'warning'
          },
          display: {
            width: width,
            scale: 1,
            staveProfile: 'Default',  // 六線譜 + 五線譜
            resources: {
              // 自訂顏色主題（Spotify 風格）
              staffLineColor: '#333333',
              barSeparatorColor: '#666666',
              barNumberColor: '#FFD700',  // 黃色小節編號
              infoColor: '#B3B3B3',
              markerColor: '#FFD700'
            }
          },
          notation: {
            elements: {
              scoreTitle: true,
              scoreSubTitle: true,
              scoreArtist: true,
              scoreAlbum: true,
              scoreWords: true,
              scoreMusic: true,
              scoreWordsAndMusic: true,
              scoreCopyright: true
            }
          },
          player: {
            enablePlayer: true,       // 啟用播放器
            enableCursor: true,       // 顯示播放游標
            enableUserInteraction: true, // 允許點擊定位
            soundFont: '/soundfonts/guitar-acoustic.sf2' // 結他音色
          }
        };

        // 初始化
        apiRef.current = new AlphaTab.AlphaTabApi(containerRef.current, settings);

        // 事件監聽
        apiRef.current.scoreLoaded.on((score) => {
          setIsLoading(false);
          setDuration(score.duration);
          if (score?.tempo != null) setBpm(score.tempo);
          onReady?.(score);
        });

        apiRef.current.playerStateChanged.on((state) => {
          setIsPlaying(state === 'playing');
        });

        apiRef.current.playerPositionChanged.on((e) => {
          setCurrentTime(e.currentTime);
        });

        apiRef.current.error.on((e) => {
          setError(e.message);
          setIsLoading(false);
          onError?.(e);
        });

      } catch (err) {
        setError('初始化六線譜失敗: ' + err.message);
        setIsLoading(false);
        onError?.(err);
      }
    };

    initAlphaTab();

    // 清理
    return () => {
      if (apiRef.current) {
        apiRef.current.destroy();
      }
    };
  }, [fileUrl, fileData]);

  // 播放控制
  const handlePlay = () => apiRef.current?.play();
  const handlePause = () => apiRef.current?.pause();
  const handleStop = () => apiRef.current?.stop();
  
  // 速度控制
  const handleSpeedChange = (speed) => {
    if (apiRef.current) {
      apiRef.current.playbackSpeed = speed;
    }
  };

  // 循環控制
  const [loopEnabled, setLoopEnabled] = useState(false);
  const handleToggleLoop = () => {
    const newState = !loopEnabled;
    setLoopEnabled(newState);
    if (apiRef.current) {
      apiRef.current.isLooping = newState;
    }
  };

  // 格式時間
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 text-center">
        <svg className="w-12 h-12 mx-auto mb-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-red-400">{error}</p>
        <p className="text-red-500 text-sm mt-2">請確保檔案格式正確（支援 .gp3/4/5 .gpx .mid）</p>
      </div>
    );
  }

  return (
    <div className="bg-[#121212] rounded-xl border border-neutral-800 overflow-hidden">
      {/* 載入中 */}
      {isLoading && (
        <div className="flex items-center justify-center h-[400px]">
          <div className="text-center">
            <svg className="w-10 h-10 mx-auto mb-3 text-[#FFD700] animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-neutral-400">載入六線譜...</p>
          </div>
        </div>
      )}

      {/* 控制欄 */}
      {showControls && !isLoading && (
        <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a1a] border-b border-neutral-800">
          {/* 播放控制 */}
          <div className="flex items-center gap-2">
            <button
              onClick={isPlaying ? handlePause : handlePlay}
              className="w-10 h-10 bg-[#FFD700] hover:bg-yellow-400 rounded-full flex items-center justify-center text-black transition"
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            
            <button
              onClick={handleStop}
              className="w-8 h-8 hover:bg-neutral-700 rounded-full flex items-center justify-center text-neutral-400 hover:text-white transition"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            </button>

            {bpm != null && (
              <span className="text-xs font-semibold tabular-nums" style={{ color: '#FFD700' }}>
                {bpm} BPM
              </span>
            )}

            <button
              onClick={handleToggleLoop}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                loopEnabled ? 'bg-green-900/50 text-green-400' : 'hover:bg-neutral-700 text-neutral-400 hover:text-white'
              }`}
              title="循環播放"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* 進度條 */}
          <div className="flex-1 mx-6">
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-500 w-10 text-right">{formatTime(currentTime)}</span>
              <div className="flex-1 h-1 bg-neutral-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#FFD700] transition-all"
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs text-neutral-500 w-10">{formatTime(duration)}</span>
            </div>
          </div>

          {/* 速度控制 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">速度:</span>
            <select 
              onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              className="bg-black border border-neutral-700 rounded px-2 py-1 text-sm text-white"
              defaultValue="1"
            >
              <option value="0.25">0.25x</option>
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="1">1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </div>

          {/* 顯示設定 */}
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => {
                if (apiRef.current) {
                  apiRef.current.renderProperties.showChordDiagrams = !apiRef.current.renderProperties.showChordDiagrams;
                }
              }}
              className="text-xs px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition"
            >
              和弦圖
            </button>
            <button
              onClick={() => {
                if (apiRef.current) {
                  apiRef.current.renderProperties.showTablature = !apiRef.current.renderProperties.showTablature;
                }
              }}
              className="text-xs px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition"
            >
              六線譜
            </button>
            <button
              onClick={() => {
                if (apiRef.current) {
                  apiRef.current.renderProperties.showStandardNotation = !apiRef.current.renderProperties.showStandardNotation;
                }
              }}
              className="text-xs px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition"
            >
              五線譜
            </button>
          </div>
        </div>
      )}

      {/* 六線譜容器 */}
      <div 
        ref={containerRef}
        className={`${isLoading ? 'hidden' : 'block'}`}
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      />
    </div>
  );
}
