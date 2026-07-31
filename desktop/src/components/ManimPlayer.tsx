import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import DOMPurify, { type Config } from 'dompurify'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnimationInfo {
  id: string
  title: string
  description: string
  concept: string
  duration_s: number
  has_video: boolean
  frame_count: number
}

interface AnimationFrame {
  svg: string
  duration_ms: number
  caption: string
}

interface AnimationDetail {
  id: string
  title: string
  description: string
  concept: string
  duration_s: number
  has_video: boolean
  video_url: string | null
  frames: AnimationFrame[]
  manim_source: string | null
}

// ---------------------------------------------------------------------------
// SVG Sanitization — prevents XSS from Manim-generated SVG frames
// ---------------------------------------------------------------------------

/**
 * DOMPurify config for SVG content produced by Manim.
 *
 * Manim SVG frames contain standard SVG elements (svg, g, path, rect, circle,
 * text, line, polygon, polyline, defs, use, etc.) with style attributes.
 * We allow these while blocking all inline event handlers and external
 * resources (scripts, iframes, foreignObject with scripts, etc.).
 */
const SVG_PURIFY_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'foreignObject'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
}

function sanitizeSvg(svg: string): string {
  if (typeof DOMPurify?.sanitize === 'function') {
    return String(DOMPurify.sanitize(svg, SVG_PURIFY_CONFIG))
  }
  // Fallback: strip tags entirely, returning empty string for safety
  return ''
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ManimPlayer: React.FC = () => {
  const [catalog, setCatalog] = useState<AnimationInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AnimationDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Playback state
  const [currentFrame, setCurrentFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // -- Fetch animation catalog --
  const fetchCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/animations')
      if (res.ok) {
        const data = await res.json()
        setCatalog(data.animations || [])
      } else {
        setError('后端不可用。动画播放需要启动 MathWeaver 后端。')
      }
    } catch {
      setError('无法连接后端。请确保后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }, [])

  // -- Fetch animation detail --
  const fetchDetail = useCallback(async (animId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/animations/${animId}`)
      if (res.ok) {
        const data = await res.json()
        setDetail(data)
        setCurrentFrame(0)
        setPlaying(false)
      } else {
        setError(`无法加载动画「${animId}」`)
      }
    } catch {
      setError('网络错误，无法加载动画。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCatalog()
  }, [fetchCatalog])

  // -- Playback logic --
  useEffect(() => {
    if (!playing || !detail || detail.frames.length === 0) return

    const frame = detail.frames[currentFrame]
    if (!frame) {
      setPlaying(false)
      return
    }

    playTimerRef.current = setTimeout(() => {
      if (currentFrame < detail.frames.length - 1) {
        setCurrentFrame(f => f + 1)
      } else {
        setPlaying(false)
      }
    }, frame.duration_ms)

    return () => {
      if (playTimerRef.current) {
        clearTimeout(playTimerRef.current)
      }
    }
  }, [playing, currentFrame, detail])

  const handlePlay = useCallback(() => {
    if (!detail || detail.frames.length === 0) return
    if (currentFrame >= detail.frames.length - 1) {
      setCurrentFrame(0)
    }
    setPlaying(true)
  }, [detail, currentFrame])

  const handlePause = useCallback(() => {
    setPlaying(false)
  }, [])

  const handleSelect = useCallback(
    (animId: string) => {
      setSelectedId(animId)
      fetchDetail(animId)
    },
    [fetchDetail],
  )

  const handleStep = useCallback(
    (delta: number) => {
      if (!detail) return
      setPlaying(false)
      setCurrentFrame(f => {
        const next = f + delta
        if (next < 0) return 0
        if (next >= detail.frames.length) return detail.frames.length - 1
        return next
      })
    },
    [detail],
  )

  // -- Render --
  const currentFrameData = detail?.frames[currentFrame]
  const progress =
    detail && detail.frames.length > 0 ? ((currentFrame + 1) / detail.frames.length) * 100 : 0

  // Security: Sanitize SVG content to prevent XSS attacks
  const sanitizedSvg = useMemo(() => {
    if (!currentFrameData?.svg) return ''
    return sanitizeSvg(currentFrameData.svg)
  }, [currentFrameData?.svg])

  return (
    <div className="manim-player">
      {/* Animation list */}
      <div className="manim-list">
        <div className="manim-list-header">
          <span className="manim-list-title">动画库</span>
          <button className="manim-refresh" onClick={fetchCatalog} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
        {error && <div className="manim-error">{error}</div>}
        {!error && catalog.length === 0 && !loading && (
          <div className="manim-empty">暂无动画。请启动后端服务。</div>
        )}
        <div className="manim-items">
          {catalog.map(anim => (
            <button
              key={anim.id}
              className={`manim-item${selectedId === anim.id ? ' manim-item-selected' : ''}`}
              onClick={() => handleSelect(anim.id)}
            >
              <span className="manim-item-title">{anim.title}</span>
              <span className="manim-item-meta">
                {anim.duration_s}s · {anim.has_video ? '视频' : `${anim.frame_count} 帧`}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Playback area */}
      {detail && (
        <div className="manim-stage">
          <div className="manim-stage-header">
            <span className="manim-stage-title">{detail.title}</span>
            <span className="manim-stage-desc">{detail.description}</span>
          </div>

          {/* Video or SVG frames */}
          {detail.has_video && detail.video_url ? (
            <video
              className="manim-video"
              src={detail.video_url}
              controls
              autoPlay
              style={{ width: '100%', borderRadius: '8px' }}
            />
          ) : (
            <div className="manim-frame-area">
              {currentFrameData && (
                <>
                  <div
                    className="manim-frame-svg"
                    dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
                  />
                  {currentFrameData.caption && (
                    <div className="manim-caption">{currentFrameData.caption}</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Controls (SVG mode only) */}
          {!detail.has_video && detail.frames.length > 0 && (
            <div className="manim-controls">
              <button
                className="manim-btn"
                onClick={() => handleStep(-1)}
                disabled={currentFrame === 0}
              >
                ◀
              </button>
              {playing ? (
                <button className="manim-btn manim-btn-primary" onClick={handlePause}>
                  ⏸ 暂停
                </button>
              ) : (
                <button className="manim-btn manim-btn-primary" onClick={handlePlay}>
                  ▶ 播放
                </button>
              )}
              <button
                className="manim-btn"
                onClick={() => handleStep(1)}
                disabled={currentFrame >= detail.frames.length - 1}
              >
                ▶
              </button>
              <span className="manim-frame-counter">
                {currentFrame + 1} / {detail.frames.length}
              </span>
            </div>
          )}

          {/* Progress bar */}
          {!detail.has_video && detail.frames.length > 0 && (
            <div className="manim-progress">
              <div className="manim-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Manim source toggle */}
          {detail.manim_source && (
            <div className="manim-source-section">
              <button className="manim-source-toggle" onClick={() => setShowSource(!showSource)}>
                {showSource ? '隐藏' : '查看'} Manim 源码
              </button>
              {showSource && (
                <pre className="manim-source-code">
                  <code>{detail.manim_source}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ManimPlayer
