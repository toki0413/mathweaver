import { useState, useEffect, useCallback } from 'react'
import { STORY_SCENES, t } from '../utils/ageAdapt'
import type { AgeLevel } from '../utils/ageAdapt'

/**
 * 数学故事面板 — 用可视化故事场景教授群论概念
 *
 * AI 时代的新数学运动：把抽象概念翻译成「能玩、能看」的叙事。
 * 每个故事由若干场景组成，每个场景包含：
 *   - visual: ASCII / emoji 可视化艺术（等宽对齐）
 *   - text:   年龄自适应的解说文字
 *
 * 功能：
 *   - 故事选择器（水平卡片）
 *   - 场景查看器（一次显示一个场景）
 *   - 上一个 / 下一个 + 进度点
 *   - 场景切换滑入动画（方向感知）
 *   - 自动播放（每 5 秒推进，循环）
 *   - 概念标签（年龄适配术语 + 概念键）
 */

interface MathStoryPanelProps {
  ageLevel: AgeLevel
}

/** 自动播放推进间隔（毫秒） */
const AUTO_ADVANCE_MS = 5000

export function MathStoryPanel({ ageLevel }: MathStoryPanelProps) {
  const [selectedStoryId, setSelectedStoryId] = useState<string>(STORY_SCENES[0].id)
  const [sceneIdx, setSceneIdx] = useState(0)
  const [autoPlay, setAutoPlay] = useState(false)
  /** 切换方向：1 = 前进，-1 = 后退（控制滑入动画方向） */
  const [dir, setDir] = useState<1 | -1>(1)

  const story = STORY_SCENES.find(s => s.id === selectedStoryId) ?? STORY_SCENES[0]
  const scenes = story.scenes
  const scene = scenes[sceneIdx] ?? scenes[0]
  const isFirst = sceneIdx === 0
  const isLast = sceneIdx === scenes.length - 1

  const selectStory = useCallback((id: string) => {
    setSelectedStoryId(id)
    setSceneIdx(0)
    setDir(1)
  }, [])

  const goNext = useCallback(() => {
    if (sceneIdx >= scenes.length - 1) return
    setDir(1)
    setSceneIdx(i => i + 1)
  }, [sceneIdx, scenes.length])

  const goPrev = useCallback(() => {
    if (sceneIdx <= 0) return
    setDir(-1)
    setSceneIdx(i => i - 1)
  }, [sceneIdx])

  const goTo = useCallback(
    (target: number) => {
      setDir(target >= sceneIdx ? 1 : -1)
      setSceneIdx(target)
    },
    [sceneIdx],
  )

  const toggleAutoPlay = useCallback(() => {
    setAutoPlay(p => !p)
  }, [])

  // 自动播放：每 AUTO_ADVANCE_MS 毫秒推进一个场景（循环回开头）
  useEffect(() => {
    if (!autoPlay) return
    const total = scenes.length
    const timer = window.setTimeout(() => {
      setDir(1)
      setSceneIdx(i => (i + 1) % total)
    }, AUTO_ADVANCE_MS)
    return () => window.clearTimeout(timer)
  }, [autoPlay, sceneIdx, scenes.length])

  // 切换故事后若索引越界则归零（安全保护）
  useEffect(() => {
    if (sceneIdx > scenes.length - 1) setSceneIdx(0)
  }, [scenes.length, sceneIdx])

  const conceptName = t(story.conceptKey, ageLevel)

  return (
    <>
      <style>{CSS}</style>
      <div className="msp-root">
        {/* 故事选择器 —— 水平可滚动卡片 */}
        <div className="msp-story-list" role="tablist" aria-label="选择故事">
          {STORY_SCENES.map(s => {
            const active = s.id === selectedStoryId
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={active}
                className={`msp-story-card${active ? ' active' : ''}`}
                onClick={() => selectStory(s.id)}
              >
                <span className="msp-story-card-icon">{s.icon}</span>
                <span className="msp-story-card-title">{s.title[ageLevel]}</span>
              </button>
            )
          })}
        </div>

        {/* 故事查看器 */}
        <div className="msp-viewer" role="tabpanel" aria-label={story.title[ageLevel]}>
          {/* 头部：故事标题 + 概念标签 */}
          <div className="msp-viewer-head">
            <span className="msp-story-title">
              <span className="msp-story-title-icon">{story.icon}</span>
              <span className="msp-story-title-text">{story.title[ageLevel]}</span>
            </span>
            <span className="msp-concept-tag" title={`concept key: ${story.conceptKey}`}>
              <span className="msp-concept-hash">#</span>
              <span className="msp-concept-label">{conceptName}</span>
              <code className="msp-concept-key">{story.conceptKey}</code>
            </span>
          </div>

          {/* 当前场景（带方向感知的滑入动画） */}
          <div
            key={`${selectedStoryId}-${sceneIdx}`}
            className={`msp-scene${dir === -1 ? ' dir-bwd' : ''}`}
          >
            <pre className="msp-scene-visual">{scene.visual}</pre>
            <div className="msp-scene-text">{scene.text[ageLevel]}</div>
          </div>

          {/* 导航栏：上一个 / 进度 / 播放 / 下一个 */}
          <div className="msp-nav">
            <button
              className="msp-nav-btn"
              onClick={goPrev}
              disabled={isFirst}
              aria-label="上一个场景"
            >
              ←
            </button>

            <div className="msp-progress-wrap">
              <div className="msp-progress" aria-label="场景进度">
                {scenes.map((_, i) => (
                  <button
                    key={i}
                    className={
                      'msp-dot' + (i === sceneIdx ? ' active' : '') + (i < sceneIdx ? ' done' : '')
                    }
                    onClick={() => goTo(i)}
                    aria-label={`第 ${i + 1} 个场景`}
                    aria-current={i === sceneIdx ? 'true' : undefined}
                  />
                ))}
              </div>
              <span className="msp-scene-counter">
                {sceneIdx + 1} / {scenes.length}
              </span>
            </div>

            <button
              className={`msp-nav-btn msp-play-btn${autoPlay ? ' playing' : ''}`}
              onClick={toggleAutoPlay}
              aria-label={autoPlay ? '暂停自动播放' : '开始自动播放'}
              title={autoPlay ? '暂停自动播放' : `自动播放（每 ${AUTO_ADVANCE_MS / 1000} 秒）`}
            >
              {autoPlay ? '⏸' : '▶'}
            </button>

            <button
              className="msp-nav-btn"
              onClick={goNext}
              disabled={isLast}
              aria-label="下一个场景"
            >
              →
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

const CSS = `
.msp-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 故事选择器（水平滚动） ── */
.msp-story-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 6px;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.msp-story-list::-webkit-scrollbar { height: 5px; }
.msp-story-list::-webkit-scrollbar-track { background: transparent; }
.msp-story-list::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.msp-story-card {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md, 10px);
  background: var(--bg2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--t-base, 180ms ease),
              color var(--t-base, 180ms ease),
              background var(--t-base, 180ms ease),
              transform var(--t-fast, 120ms ease),
              box-shadow var(--t-base, 180ms ease);
}
.msp-story-card:hover {
  border-color: var(--border-strong);
  color: var(--ink);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.msp-story-card:active { transform: translateY(0) scale(0.98); }
.msp-story-card.active {
  border-color: var(--accent);
  background: var(--accent-subtle);
  color: var(--accent);
  box-shadow: var(--shadow-accent);
}
.msp-story-card-icon { font-size: 16px; line-height: 1; flex-shrink: 0; }
.msp-story-card-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 故事查看器 ── */
.msp-viewer {
  border: 1px solid var(--border);
  border-radius: var(--r-lg, 14px);
  background: var(--bg2);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.msp-viewer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg3);
}
.msp-story-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.msp-story-title-icon { font-size: 16px; line-height: 1; flex-shrink: 0; }
.msp-story-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 概念标签 ── */
.msp-concept-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: var(--r-full, 999px);
  background: var(--accent-subtle);
  border: 1px solid hsla(222, 35%, 36%, 0.25);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  cursor: default;
}
.msp-concept-hash { opacity: 0.7; font-weight: 700; }
.msp-concept-label { white-space: nowrap; }
.msp-concept-key {
  font-family: var(--mono);
  font-size: 10px;
  opacity: 0.6;
  padding-left: 5px;
  margin-left: 2px;
  border-left: 1px solid hsla(222, 35%, 36%, 0.22);
  white-space: nowrap;
}

/* ── 场景容器（方向感知滑入动画） ── */
.msp-scene {
  padding: 18px 20px 16px;
  animation: msp-slide-fwd 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.msp-scene.dir-bwd {
  animation-name: msp-slide-bwd;
}
@keyframes msp-slide-fwd {
  from { opacity: 0; transform: translateX(28px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes msp-slide-bwd {
  from { opacity: 0; transform: translateX(-28px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* ── 可视化艺术展示（居中、等宽、保留空白） ── */
.msp-scene-visual {
  margin: 0 auto 14px;
  padding: 18px 16px;
  width: fit-content;
  max-width: 100%;
  font-family: var(--mono);
  font-size: 15px;
  line-height: 1.5;
  text-align: left;
  white-space: pre;
  color: var(--ink);
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: var(--r-md, 10px);
  box-shadow: inset 0 0 28px hsla(38, 55%, 50%, 0.05);
  overflow-x: auto;
}

/* ── 场景解说文字 ── */
.msp-scene-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink);
  padding: 11px 14px;
  background: var(--accent-subtle);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--r-md, 10px) var(--r-md, 10px) 0;
  animation: msp-text-in 0.5s ease 0.08s both;
}
@keyframes msp-text-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── 导航栏 ── */
.msp-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg3);
}
.msp-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 6px);
  background: var(--bg2);
  color: var(--ink);
  font-size: 14px;
  cursor: pointer;
  transition: border-color var(--t-fast, 120ms ease),
              color var(--t-fast, 120ms ease),
              background var(--t-fast, 120ms ease),
              transform var(--t-fast, 120ms ease);
}
.msp-nav-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-subtle);
}
.msp-nav-btn:active:not(:disabled) { transform: scale(0.94); }
.msp-nav-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.msp-play-btn { font-size: 12px; }
.msp-play-btn.playing {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  animation: msp-play-pulse 1.6s ease-in-out infinite;
}
.msp-play-btn.playing:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: var(--accent-text);
}
@keyframes msp-play-pulse {
  0%, 100% { box-shadow: 0 0 0 0 hsla(222, 35%, 36%, 0.4); }
  50%      { box-shadow: 0 0 0 5px hsla(222, 35%, 36%, 0); }
}

/* ── 进度点 + 场景计数 ── */
.msp-progress-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 0;
}
.msp-progress {
  display: flex;
  align-items: center;
  gap: 6px;
}
.msp-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--border-strong);
  cursor: pointer;
  transition: width var(--t-base, 180ms ease),
              background var(--t-base, 180ms ease),
              border-radius var(--t-base, 180ms ease);
}
.msp-dot:hover { background: var(--muted); }
.msp-dot.done { background: hsla(222, 35%, 36%, 0.45); }
.msp-dot.active {
  width: 22px;
  border-radius: 4px;
  background: var(--accent);
  animation: msp-dot-glow 1.8s ease-in-out infinite;
}
@keyframes msp-dot-glow {
  0%, 100% { box-shadow: 0 0 0 0 hsla(222, 35%, 36%, 0.35); }
  50%      { box-shadow: 0 0 0 3px hsla(222, 35%, 36%, 0); }
}
.msp-scene-counter {
  flex-shrink: 0;
  min-width: 36px;
  text-align: right;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
`

export default MathStoryPanel
