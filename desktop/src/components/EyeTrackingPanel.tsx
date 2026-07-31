import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../stores/sessionStore'

// ---------------------------------------------------------------------------
// webgazer.js — loaded from local bundle only (CSP does not allow CDN)
// ---------------------------------------------------------------------------

// In Electron, the local webgazer.js is bundled as an extraResource at
// <app>/Resources/webgazer/webgazer.all.js.
function getLocalWebgazerPath(): string | null {
  // In the test/browser environment, there is no `process.resourcesPath`.
  // In Electron, this resolves to the extraResources directory.
  try {
    const process_ = (window as unknown as { process?: { resourcesPath?: string } }).process
    if (process_?.resourcesPath) {
      return `${process_.resourcesPath}/webgazer/webgazer.all.js`
    }
  } catch {
    // Not in Electron.
  }
  return null
}

interface GazeData {
  x: number
  y: number
}

/**
 * Minimal structural type for the parts of the webgazer global we use.
 * The library is untyped in this project, so we cast through `unknown`.
 */
interface WebGazer {
  setRegression(name: string): WebGazer
  setTracker(name: string): WebGazer
  setGazeListener(cb: (data: GazeData | null, elapsedTime: number) => void): WebGazer
  begin(): WebGazer
  resume(): WebGazer
  pause(): WebGazer
  end(): void
  showVideoPreview(show: boolean): WebGazer
  showPredictionPoints(show: boolean): WebGazer
  showFaceOverlay(show: boolean): WebGazer
  showFaceFeedbackBox(show: boolean): WebGazer
  saveDataAcrossSessions(save: boolean): WebGazer
  clearData(): void
}

interface GazePoint {
  x: number
  y: number
  t: number
}

type TrackStatus = 'idle' | 'loading' | 'ready' | 'tracking' | 'calibrating' | 'error'

// ---------------------------------------------------------------------------
// Cognitive-load estimation tuning constants
// ---------------------------------------------------------------------------

/** Distance (px) between gaze samples that counts as a saccade (large jump). */
const SACCADE_DISTANCE_PX = 80
/** Radius (px) within which gaze is considered to be fixating on one spot. */
const FIXATION_RADIUS_PX = 40
/** Minimum gap (ms) between two saccades to avoid double-counting noise. */
const MIN_SACCADE_GAP_MS = 120
/** Max gaze samples retained for the heatmap visualization. */
const HEATMAP_MAX_POINTS = 400
/** Rolling window (ms) used to compute saccade frequency. */
const ROLLING_WINDOW_MS = 5000
/** Debounce interval (ms) for recomputing the cognitive-load score. */
const CALC_INTERVAL_MS = 500

/** Calibration target points, expressed as % of the canvas area. */
const CALIB_TARGETS: { x: number; y: number }[] = [
  { x: 15, y: 20 },
  { x: 85, y: 20 },
  { x: 50, y: 50 },
  { x: 15, y: 80 },
  { x: 85, y: 80 },
]

const STATUS_LABEL: Record<TrackStatus, string> = {
  idle: '未启动',
  loading: '加载中',
  ready: '就绪',
  tracking: '追踪中',
  calibrating: '校准中',
  error: '错误',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EyeTrackingPanel() {
  // --- Render state --------------------------------------------------------
  const [isTracking, setIsTracking] = useState(false)
  const [status, setStatus] = useState<TrackStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loadScore, setLoadScore] = useState(0)
  const [fixationDuration, setFixationDuration] = useState(0)
  const [saccadeCount, setSaccadeCount] = useState(0)
  const [calibrationStep, setCalibrationStep] = useState(0)

  // --- Refs (mutable, do not trigger re-render) ----------------------------
  const webgazerRef = useRef<WebGazer | null>(null)
  const begunRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  const gazePointsRef = useRef<GazePoint[]>([])
  const lastGazeRef = useRef<GazePoint | null>(null)
  const lastSaccadeTimeRef = useRef(0)
  const saccadeCountRef = useRef(0)
  const saccadeTimestampsRef = useRef<number[]>([])
  const fixationStartRef = useRef(0)
  const fixationCenterRef = useRef<{ x: number; y: number } | null>(null)
  const fixationDurationRef = useRef(0)
  const fixationDurationsRef = useRef<number[]>([])
  const loadScoreRef = useRef(0)

  const trackingRef = useRef(false)
  const calcIntervalRef = useRef<number | null>(null)
  const animFrameRef = useRef(0)
  const animRunningRef = useRef(false)

  // -------------------------------------------------------------------------
  // Canvas helpers
  // -------------------------------------------------------------------------

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h } = canvasSizeRef.current
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#0a0c14'
    ctx.fillRect(0, 0, w, h)
  }, [])

  /** Draw a single gaze sample onto the heatmap (additive blending). */
  const drawPoint = useCallback((p: GazePoint) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h } = canvasSizeRef.current
    if (!w || !h) return
    const screenW = window.innerWidth || 1
    const screenH = window.innerHeight || 1
    const cx = (p.x / screenW) * w
    const cy = (p.y / screenH) * h
    const r = 16
    ctx.globalCompositeOperation = 'lighter'
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, 'rgba(255, 100, 30, 0.32)')
    grad.addColorStop(0.5, 'rgba(255, 200, 80, 0.16)')
    grad.addColorStop(1, 'rgba(255, 60, 120, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }, [])

  // -------------------------------------------------------------------------
  // webgazer gaze listener — fixation / saccade analysis
  // -------------------------------------------------------------------------

  const handleGaze = useCallback(
    (data: GazeData | null) => {
      if (!data || !trackingRef.current || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
        return
      }
      const now = performance.now()
      const pt: GazePoint = { x: data.x, y: data.y, t: now }

      // 1. Heatmap sample (capped ring buffer).
      const pts = gazePointsRef.current
      pts.push(pt)
      if (pts.length > HEATMAP_MAX_POINTS) pts.shift()
      drawPoint(pt)

      // 2. Fixation / saccade analysis.
      const center = fixationCenterRef.current
      if (!center) {
        fixationCenterRef.current = { x: pt.x, y: pt.y }
        fixationStartRef.current = now
      } else {
        const dx = pt.x - center.x
        const dy = pt.y - center.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist <= FIXATION_RADIUS_PX) {
          // Gaze remains inside the fixation radius → extend current fixation.
          fixationDurationRef.current = now - fixationStartRef.current
        } else {
          // Fixation broken: record its duration for averaging.
          const dur = now - fixationStartRef.current
          if (dur > 0) {
            fixationDurationsRef.current.push(dur)
            if (fixationDurationsRef.current.length > 20) {
              fixationDurationsRef.current.shift()
            }
          }
          // A large jump counts as a saccade (debounced to reject noise).
          if (dist > SACCADE_DISTANCE_PX && now - lastSaccadeTimeRef.current > MIN_SACCADE_GAP_MS) {
            saccadeCountRef.current += 1
            saccadeTimestampsRef.current.push(now)
            lastSaccadeTimeRef.current = now
          }
          // Begin a new fixation at the new gaze location.
          fixationCenterRef.current = { x: pt.x, y: pt.y }
          fixationStartRef.current = now
          fixationDurationRef.current = 0
        }
      }
      lastGazeRef.current = pt
    },
    [drawPoint],
  )

  // -------------------------------------------------------------------------
  // Heatmap animation loop — fade + live gaze crosshair
  // -------------------------------------------------------------------------

  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      const { w, h } = canvasSizeRef.current
      // Gentle fade so the heatmap decays over time and stays "real-time".
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(10, 12, 20, 0.10)'
      ctx.fillRect(0, 0, w, h)

      // Live gaze crosshair.
      const last = lastGazeRef.current
      if (last && trackingRef.current) {
        const screenW = window.innerWidth || 1
        const screenH = window.innerHeight || 1
        const cx = (last.x / screenW) * w
        const cy = (last.y / screenH) * h
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cx - 6, cy)
        ctx.lineTo(cx + 6, cy)
        ctx.moveTo(cx, cy - 6)
        ctx.lineTo(cx, cy + 6)
        ctx.stroke()
      }
    }
    animFrameRef.current = requestAnimationFrame(renderLoop)
  }, [])

  // -------------------------------------------------------------------------
  // Debounced cognitive-load calculation (every CALC_INTERVAL_MS)
  // -------------------------------------------------------------------------

  const computeLoad = useCallback(() => {
    const now = performance.now()

    // Saccade frequency over the rolling window (saccades / second).
    const saccTs = saccadeTimestampsRef.current
    while (saccTs.length && now - saccTs[0] > ROLLING_WINDOW_MS) saccTs.shift()
    const saccadeRate = saccTs.length / (ROLLING_WINDOW_MS / 1000)

    // Average recent completed-fixation duration; fall back to the ongoing
    // fixation when none have completed yet.
    const fixDurs = fixationDurationsRef.current
    const avgFix = fixDurs.length
      ? fixDurs.reduce((a, b) => a + b, 0) / fixDurs.length
      : fixationDurationRef.current

    // --- Heuristic mapping gaze → 0..100 cognitive load ---
    // Base level + saccade-frequency contribution + fixation contribution.
    const saccadeContrib = Math.min(saccadeRate * 12, 45)
    let fixContrib = 0
    if (avgFix > 600) {
      // Very long fixations → cognitive overload / being stuck.
      fixContrib = Math.min((avgFix - 600) / 20, 35)
    } else if (avgFix > 0 && avgFix < 150) {
      // Erratic, very short fixations → fragmented attention.
      fixContrib = 10
    }
    let load = 20 + saccadeContrib + fixContrib
    load = Math.max(0, Math.min(100, Math.round(load)))

    loadScoreRef.current = load
    setLoadScore(load)
    setFixationDuration(Math.round(fixationDurationRef.current))
    setSaccadeCount(saccadeCountRef.current)

    // --- Session-store integration (defensive) ---
    // If a setter exists on the store, push the load score up; otherwise the
    // value is stored locally and displayed (per requirements).
    try {
      const s = useStore.getState() as unknown as {
        setEpistemicState?: (load: number) => void
      }
      if (typeof s.setEpistemicState === 'function') {
        s.setEpistemicState(load)
      }
    } catch {
      // no-op: keep cognitive load local only
    }
  }, [])

  // -------------------------------------------------------------------------
  // Start / stop the calculation interval + heatmap animation
  // -------------------------------------------------------------------------

  const startCalcAndAnim = useCallback(() => {
    if (calcIntervalRef.current == null) {
      calcIntervalRef.current = window.setInterval(computeLoad, CALC_INTERVAL_MS)
    }
    if (!animRunningRef.current) {
      animRunningRef.current = true
      animFrameRef.current = requestAnimationFrame(renderLoop)
    }
  }, [computeLoad, renderLoop])

  const stopCalcAndAnim = useCallback(() => {
    if (calcIntervalRef.current != null) {
      window.clearInterval(calcIntervalRef.current)
      calcIntervalRef.current = null
    }
    if (animRunningRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animRunningRef.current = false
      animFrameRef.current = 0
    }
  }, [])

  const resetMetrics = useCallback(() => {
    saccadeCountRef.current = 0
    saccadeTimestampsRef.current = []
    fixationDurationsRef.current = []
    fixationDurationRef.current = 0
    fixationStartRef.current = 0
    fixationCenterRef.current = null
    lastGazeRef.current = null
    lastSaccadeTimeRef.current = 0
    gazePointsRef.current = []
    loadScoreRef.current = 0
    setLoadScore(0)
    setFixationDuration(0)
    setSaccadeCount(0)
    clearCanvas()
  }, [clearCanvas])

  // -------------------------------------------------------------------------
  // Tracking start / stop
  // -------------------------------------------------------------------------

  const startTracking = useCallback(async () => {
    const wg = webgazerRef.current
    if (!wg) {
      setErrorMsg('webgazer 尚未加载完成，请稍后重试')
      setStatus('error')
      return
    }
    try {
      if (!begunRef.current) {
        wg.setRegression('ridge').setTracker('clmtrackr').setGazeListener(handleGaze)
        wg.showVideoPreview(false)
          .showPredictionPoints(false)
          .showFaceOverlay(false)
          .showFaceFeedbackBox(false)
        wg.saveDataAcrossSessions(false)
        wg.begin()
        begunRef.current = true
      } else {
        wg.resume()
      }
    } catch (e) {
      setErrorMsg(`webgazer 启动失败: ${String(e)}`)
      setStatus('error')
      return
    }
    resetMetrics()
    trackingRef.current = true
    setIsTracking(true)
    setStatus('tracking')
    setErrorMsg(null)
    startCalcAndAnim()
  }, [handleGaze, resetMetrics, startCalcAndAnim])

  const stopTracking = useCallback(() => {
    trackingRef.current = false
    setIsTracking(false)
    try {
      webgazerRef.current?.pause()
    } catch {
      // ignore
    }
    setStatus(webgazerRef.current ? 'ready' : 'idle')
    stopCalcAndAnim()
  }, [stopCalcAndAnim])

  const toggleTracking = useCallback(() => {
    if (isTracking) stopTracking()
    else void startTracking()
  }, [isTracking, startTracking, stopTracking])

  // -------------------------------------------------------------------------
  // Calibration
  // -------------------------------------------------------------------------

  const startCalibration = useCallback(async () => {
    const wg = webgazerRef.current
    if (!wg) {
      setErrorMsg('webgazer 尚未加载，无法校准')
      setStatus('error')
      return
    }
    // Calibration needs webgazer actively running so its click-capture can
    // collect training samples.
    if (!begunRef.current || !trackingRef.current) {
      await startTracking()
    }
    try {
      wg.clearData()
    } catch {
      // ignore
    }
    setCalibrationStep(1)
    setStatus('calibrating')
  }, [startTracking])

  const advanceCalibration = useCallback(() => {
    setCalibrationStep(s => {
      const next = s + 1
      if (next > CALIB_TARGETS.length) {
        setStatus(trackingRef.current ? 'tracking' : 'ready')
        return 0
      }
      return next
    })
  }, [])

  // -------------------------------------------------------------------------
  // Effect: load webgazer.js — local bundle first, CDN as fallback
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false

    const markReady = (wg: WebGazer) => {
      if (cancelled) return
      webgazerRef.current = wg
      setStatus('ready')
    }

    const w = window as unknown as { webgazer?: WebGazer }
    if (w.webgazer) {
      markReady(w.webgazer)
      return
    }

    /**
     * Inject a <script> tag for the given URL and resolve when webgazer
     * becomes available on the window object. Reject on error or timeout.
     */
    const loadScript = (url: string): Promise<WebGazer> => {
      return new Promise((resolve, reject) => {
        // If a script tag for this URL is already in flight, wait for it.
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)
        if (existing) {
          const wait = window.setInterval(() => {
            const cur = (window as unknown as { webgazer?: WebGazer }).webgazer
            if (cur) {
              window.clearInterval(wait)
              resolve(cur)
            }
          }, 100)
          return
        }

        const script = document.createElement('script')
        script.src = url
        script.async = true
        script.onload = () => {
          const cur = (window as unknown as { webgazer?: WebGazer }).webgazer
          if (cur) resolve(cur)
          else reject(new Error('webgazer.js loaded but not initialized'))
        }
        script.onerror = () => reject(new Error(`Failed to load: ${url}`))
        document.body.appendChild(script)
      })
    }

    setStatus('loading')

    // --- Strategy: load from local bundle only (CSP blocks CDN) ---
    const localPath = getLocalWebgazerPath()
    const sources = [...(localPath ? [localPath] : [])]

    const tryLoadFromSources = async (urls: string[]): Promise<WebGazer> => {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        try {
          const wg = await loadScript(url)
          return wg
        } catch (err) {
          console.warn(`[EyeTracking] Failed to load webgazer.js from ${url}:`, err)
          // If this was the last source, propagate the error.
          if (i === urls.length - 1) {
            throw err
          }
          // Otherwise try the next source.
        }
      }
      throw new Error('No webgazer.js sources available')
    }

    void tryLoadFromSources(sources)
      .then(wg => {
        if (!cancelled) markReady(wg)
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMsg(
            '无法加载 webgazer.js 本地模块。请确保应用已正确安装，眼动追踪功能需要打包后的本地资源。',
          )
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  // -------------------------------------------------------------------------
  // Effect: size the heatmap canvas to its container (ResizeObserver)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      const w = container.clientWidth || 320
      const h = 220
      canvas.width = w
      canvas.height = h
      canvasSizeRef.current = { w, h }
      if (ctx) {
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = '#0a0c14'
        ctx.fillRect(0, 0, w, h)
      }
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // -------------------------------------------------------------------------
  // Effect: tear down webgazer on unmount
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      stopCalcAndAnim()
      try {
        webgazerRef.current?.end()
      } catch {
        // ignore
      }
      begunRef.current = false
    }
  }, [stopCalcAndAnim])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const loadColor = loadScore >= 70 ? 'var(--err)' : loadScore >= 40 ? 'var(--warn)' : 'var(--ok)'

  return (
    <div className="eye-tracking-panel">
      <div className="eye-tracking-header">
        <span className="eye-tracking-title">眼动追踪</span>
        <span className={`eye-tracking-status status-${status}`}>{STATUS_LABEL[status]}</span>
        <button
          className="eye-tracking-toggle"
          onClick={toggleTracking}
          disabled={status === 'loading' || status === 'error'}
        >
          {isTracking ? '停止追踪' : '开始追踪'}
        </button>
      </div>

      {errorMsg && <div className="eye-tracking-error">{errorMsg}</div>}

      <div className="eye-tracking-canvas-wrap" ref={containerRef}>
        <canvas ref={canvasRef} className="eye-tracking-canvas" />

        {calibrationStep > 0 && (
          <>
            <div className="eye-tracking-calibrate-hint">
              请注视并点击高亮圆点（{calibrationStep}/{CALIB_TARGETS.length}）
            </div>
            {CALIB_TARGETS.map((t, i) =>
              calibrationStep === i + 1 ? (
                <div
                  key={i}
                  className="eye-tracking-calib-dot"
                  style={{ left: `${t.x}%`, top: `${t.y}%` }}
                  onClick={advanceCalibration}
                />
              ) : null,
            )}
          </>
        )}
      </div>

      <div className="eye-tracking-metrics">
        <div className="eye-tracking-metric">
          <div className="eye-tracking-metric-value" style={{ color: loadColor }}>
            {loadScore}
          </div>
          <div className="eye-tracking-metric-label">认知负荷</div>
        </div>
        <div className="eye-tracking-metric">
          <div className="eye-tracking-metric-value">
            {fixationDuration}
            <span className="eye-tracking-unit">ms</span>
          </div>
          <div className="eye-tracking-metric-label">注视时长</div>
        </div>
        <div className="eye-tracking-metric">
          <div className="eye-tracking-metric-value">{saccadeCount}</div>
          <div className="eye-tracking-metric-label">扫视次数</div>
        </div>
      </div>

      <div className="eye-tracking-actions">
        <button
          className="eye-tracking-calibrate"
          onClick={() => void startCalibration()}
          disabled={status === 'loading' || status === 'error' || calibrationStep > 0}
        >
          校准
        </button>
      </div>
    </div>
  )
}

export default EyeTrackingPanel
