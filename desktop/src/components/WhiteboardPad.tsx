import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ChangeEvent as ReactChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'

/**
 * WhiteboardPad — 自由绘制画布组件。
 *
 * 基于 HTML5 Canvas 的数学草稿板，学生可以随手绘制、书写公式、勾勒图形。
 *
 * 功能：
 * - 三种工具：画笔（自由绘制）、橡皮（destination-out 擦除）、文字（点击放置输入框）
 * - 五色调色板（白 / 紫 / 绿 / 黄 / 红），与应用主题一致
 * - 笔触粗细滑块（1–8px）
 * - 清空 / 撤销 / 导出 PNG
 * - 深色画布背景（#1a1a1a），与主题一致
 * - 使用 requestAnimationFrame 绘制平滑线段
 * - 使用 pointerdown / pointermove / pointerup / pointerleave 跨平台事件
 *
 * 说明：
 * - 画布位图保持透明，依靠 canvas 元素的 CSS 背景色呈现深色底，
 *   这样橡皮（destination-out）擦除笔迹后能露出深色底，视觉上才可见。
 * - 撤销栈以 data URL 形式保存画布快照。
 * - 样式全部内联（不修改 index.css），className 以 `wb-` 前缀标识结构。
 */

type DrawingTool = 'pen' | 'eraser' | 'text'

interface WhiteboardPadProps {
  /** 画布宽度（像素），缺省时占满容器 100% */
  width?: number
  /** 画布高度（像素），默认 280 */
  height?: number
}

interface TextEdit {
  x: number
  y: number
}

interface ColorOption {
  name: string
  value: string
}

interface ToolOption {
  id: DrawingTool
  label: string
  icon: string
}

const DEFAULT_HEIGHT = 280
const MAX_UNDO = 50

/** 调色板：白、紫、绿、黄、红，对应主题变量 --ink/--accent/--ok/--warn/--err */
const COLORS: ColorOption[] = [
  { name: '白', value: '#ffffff' },
  { name: '紫', value: '#c678dd' },
  { name: '绿', value: '#98c379' },
  { name: '黄', value: '#e5c07b' },
  { name: '红', value: '#e06c75' },
]

const TOOLS: ToolOption[] = [
  { id: 'pen', label: '画笔', icon: '✎' },
  { id: 'eraser', label: '橡皮', icon: '▱' },
  { id: 'text', label: '文字', icon: 'T' },
]

function cursorForTool(tool: DrawingTool): CSSProperties['cursor'] {
  if (tool === 'text') return 'text'
  if (tool === 'eraser') return 'cell'
  return 'crosshair'
}

/* ----------------------------- 内联样式 ----------------------------- */

const rootStyle: CSSProperties = {
  background: '#232323',
  border: '1px solid #3a3a3a',
  borderRadius: '3px',
  padding: '8px',
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '12px',
  padding: '0 0 8px',
}

const groupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
}

const toolBtnStyle = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 10px',
  fontSize: '12px',
  fontFamily: 'var(--mono)',
  lineHeight: 1,
  color: active ? '#1a1a1a' : '#e8e6e3',
  background: active ? '#c678dd' : 'transparent',
  border: `1px solid ${active ? '#c678dd' : '#3a3a3a'}`,
  borderRadius: '3px',
  cursor: 'pointer',
  transition: 'background .12s ease, border-color .12s ease, color .12s ease',
})

const colorBtnStyle = (active: boolean, color: string): CSSProperties => ({
  width: '22px',
  height: '22px',
  padding: 0,
  borderRadius: '50%',
  background: color,
  border: `2px solid ${active ? '#e8e6e3' : '#3a3a3a'}`,
  boxShadow: active ? '0 0 0 2px #1a1a1a, 0 0 0 4px #c678dd' : 'none',
  cursor: 'pointer',
  transition: 'box-shadow .12s ease, border-color .12s ease',
})

const sliderStyle: CSSProperties = {
  width: '90px',
  height: '16px',
  cursor: 'pointer',
  accentColor: '#c678dd',
}

const sliderLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  color: '#8a8884',
  minWidth: '34px',
}

const actionBtnStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  fontFamily: 'var(--mono)',
  lineHeight: 1,
  color: '#e8e6e3',
  background: '#2e2e2e',
  border: '1px solid #3a3a3a',
  borderRadius: '3px',
  cursor: 'pointer',
  transition: 'background .12s ease, border-color .12s ease',
}

const statusDotStyle = (active: boolean): CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  background: active ? '#98c379' : '#3a3a3a',
  display: 'inline-block',
  transition: 'background .12s ease',
})

const statusLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: '11px',
  color: '#8a8884',
}

const canvasContainerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  background: '#1a1a1a',
  border: '1px solid #3a3a3a',
  borderRadius: '3px',
  overflow: 'hidden',
}

const textInputStyle = (x: number, y: number, fontSize: number, color: string): CSSProperties => ({
  position: 'absolute',
  left: `${x}px`,
  top: `${y}px`,
  background: 'rgba(26,26,26,0.55)',
  border: '1px dashed #c678dd',
  color,
  fontFamily: 'var(--mono)',
  fontSize: `${fontSize}px`,
  lineHeight: 1.2,
  padding: '1px 3px',
  borderRadius: '2px',
  outline: 'none',
  minWidth: '90px',
  zIndex: 2,
})

/* ----------------------------- 组件实现 ----------------------------- */

function WhiteboardPadBase({ width, height }: WhiteboardPadProps) {
  const displayHeight = height ?? DEFAULT_HEIGHT

  // React state
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pen')
  const [currentColor, setCurrentColor] = useState<string>('#ffffff')
  const [strokeWidth, setStrokeWidth] = useState<number>(3)
  const [isDrawing, setIsDrawing] = useState<boolean>(false)

  // 文字工具的输入框位置与内容
  const [textEditing, setTextEditing] = useState<TextEdit | null>(null)
  const [textValue, setTextValue] = useState<string>('')

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const drawingRef = useRef<boolean>(false)
  const lastXRef = useRef<number>(0)
  const lastYRef = useRef<number>(0)
  const pointRef = useRef<{ x: number; y: number } | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const undoStackRef = useRef<string[]>([])
  const dimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  const textFontSize = Math.max(16, strokeWidth * 3)

  /* -------- 画布初始化与尺寸维护（挂载时建立 context，监听容器尺寸变化） -------- */
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1

    const applySize = (preserve: boolean) => {
      const displayWidth = width ?? container.clientWidth
      const h = displayHeight
      if (displayWidth <= 0 || h <= 0) return

      // 保存旧内容（仅在 resize 时）
      let snapshot: HTMLCanvasElement | null = null
      if (preserve && contextRef.current) {
        snapshot = document.createElement('canvas')
        snapshot.width = canvas.width
        snapshot.height = canvas.height
        const sctx = snapshot.getContext('2d')
        if (sctx) sctx.drawImage(canvas, 0, 0)
      }

      canvas.width = Math.max(1, Math.round(displayWidth * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = width != null ? `${width}px` : '100%'
      canvas.style.height = `${h}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
      contextRef.current = ctx
      dimsRef.current = { w: displayWidth, h }

      // 画布位图保持透明：CSS 背景色呈现深色底，橡皮 destination-out 才可见
      if (snapshot) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(snapshot, 0, 0)
        ctx.restore()
      }
    }

    applySize(false)

    // 宽度为容器百分比时，监听容器尺寸变化并保留已绘内容
    let ro: ResizeObserver | null = null
    if (width == null && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => applySize(true))
      ro.observe(container)
    }

    return () => {
      ro?.disconnect()
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [width, displayHeight])

  /* -------- 工具样式应用（画笔 source-over / 橡皮 destination-out） -------- */
  const applyToolStyle = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'
        ctx.fillStyle = 'rgba(0,0,0,1)'
        ctx.lineWidth = strokeWidth * 3 // 橡皮稍宽，便于擦除
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = currentColor
        ctx.fillStyle = currentColor
        ctx.lineWidth = strokeWidth
      }
    },
    [currentTool, currentColor, strokeWidth],
  )

  /* -------- 将指针坐标换算为画布逻辑坐标（CSS 像素，已考虑 dpr 缩放） -------- */
  const getPos = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }, [])

  /* -------- 撤销栈：压入当前画布快照（data URL） -------- */
  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      undoStackRef.current.push(canvas.toDataURL('image/png'))
      if (undoStackRef.current.length > MAX_UNDO) {
        undoStackRef.current.shift()
      }
    } catch {
      /* 忽略 toDataURL 失败 */
    }
  }, [])

  /* -------- rAF 回调：从上一点画线段到当前点 -------- */
  const drawSegment = useCallback(() => {
    rafIdRef.current = null
    const ctx = contextRef.current
    const point = pointRef.current
    if (!ctx || !drawingRef.current || !point) return
    ctx.beginPath()
    ctx.moveTo(lastXRef.current, lastYRef.current)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastXRef.current = point.x
    lastYRef.current = point.y
  }, [])

  /* -------- 结束一次描边 -------- */
  const endStroke = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (canvas && e.pointerId !== undefined) {
        try {
          canvas.releasePointerCapture(e.pointerId)
        } catch {
          /* 忽略 */
        }
      }
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      // 提交最后一段未渲染的线段
      if (drawingRef.current && pointRef.current) {
        drawSegment()
      }
      drawingRef.current = false
      setIsDrawing(false)
      pointRef.current = null
    },
    [drawSegment],
  )

  /* -------- 文字工具：将输入框内容绘制到画布 -------- */
  const finalizeText = useCallback(() => {
    const ctx = contextRef.current
    if (ctx && textEditing && textValue.trim()) {
      pushUndo()
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = currentColor
      ctx.font = `${textFontSize}px Georgia, 'Noto Serif CJK SC', serif`
      ctx.textBaseline = 'top'
      ctx.fillText(textValue, textEditing.x, textEditing.y)
      ctx.restore()
    }
    setTextEditing(null)
    setTextValue('')
  }, [textEditing, textValue, currentColor, textFontSize, pushUndo])

  /* -------- 指针事件 -------- */
  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const ctx = contextRef.current
    if (!canvas || !ctx) return
    e.preventDefault()
    const { x, y } = getPos(e)

    // 文字工具：放置输入框
    if (currentTool === 'text') {
      if (textEditing) finalizeText()
      setTextEditing({ x, y })
      setTextValue('')
      return
    }

    // 画笔 / 橡皮：开始描边，先保存撤销快照
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* 忽略 */
    }

    pushUndo()
    drawingRef.current = true
    setIsDrawing(true)
    lastXRef.current = x
    lastYRef.current = y
    pointRef.current = { x, y }

    applyToolStyle(ctx)
    // 起笔画一个点，使单击也能留下痕迹
    ctx.beginPath()
    ctx.arc(x, y, (currentTool === 'eraser' ? strokeWidth * 3 : strokeWidth) / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const { x, y } = getPos(e)
    pointRef.current = { x, y }
    // 使用 requestAnimationFrame 调度绘制，保证平滑
    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(drawSegment)
    }
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    endStroke(e)
  }

  const handlePointerLeave = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    endStroke(e)
  }

  /* -------- 工具按钮 -------- */
  const handleToolChange = (tool: DrawingTool) => {
    // 切换工具时丢弃未确认的文字输入
    if (textEditing) {
      setTextEditing(null)
      setTextValue('')
    }
    setCurrentTool(tool)
  }

  /* -------- 清空 -------- */
  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = contextRef.current
    if (!canvas || !ctx) return
    pushUndo()
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }, [pushUndo])

  /* -------- 撤销 -------- */
  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = contextRef.current
    if (!canvas || !ctx) return
    const prev = undoStackRef.current.pop()
    if (!prev) return
    const img = new Image()
    img.onload = () => {
      const c = canvasRef.current
      const context = contextRef.current
      if (!c || !context) return
      context.save()
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, c.width, c.height)
      context.drawImage(img, 0, 0)
      context.restore()
    }
    img.src = prev
  }, [])

  /* -------- 导出 PNG -------- */
  const handleExport = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `mathweaver-whiteboard-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [])

  /* -------- 文字输入框事件 -------- */
  const onTextInputChange = (e: ReactChangeEvent<HTMLInputElement>) => {
    setTextValue(e.target.value)
  }

  const onTextInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finalizeText()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setTextEditing(null)
      setTextValue('')
    }
  }

  return (
    <div className="wb-root" style={rootStyle}>
      <div className="wb-toolbar" style={toolbarStyle}>
        {/* 工具选择 */}
        <div className="wb-group wb-tool-group" style={groupStyle}>
          {TOOLS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`wb-tool-btn${currentTool === t.id ? ' wb-tool-btn--active' : ''}`}
              style={toolBtnStyle(currentTool === t.id)}
              onClick={() => handleToolChange(t.id)}
              aria-pressed={currentTool === t.id}
              aria-label={t.label}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* 调色板 */}
        <div className="wb-group wb-color-group" style={groupStyle}>
          {COLORS.map(c => (
            <button
              key={c.value}
              type="button"
              className={`wb-color-btn${currentColor === c.value ? ' wb-color-btn--active' : ''}`}
              style={colorBtnStyle(currentColor === c.value, c.value)}
              onClick={() => setCurrentColor(c.value)}
              aria-label={`颜色 ${c.name}`}
              aria-pressed={currentColor === c.value}
            />
          ))}
        </div>

        {/* 笔触粗细 */}
        <div className="wb-group wb-width-group" style={groupStyle}>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={strokeWidth}
            onChange={e => setStrokeWidth(Number(e.target.value))}
            className="wb-width-slider"
            style={sliderStyle}
            aria-label="笔触粗细"
          />
          <span className="wb-width-label" style={sliderLabelStyle}>
            {strokeWidth}px
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="wb-group wb-action-group" style={groupStyle}>
          <button
            type="button"
            className="wb-action-btn wb-undo-btn"
            style={actionBtnStyle}
            onClick={handleUndo}
          >
            撤销
          </button>
          <button
            type="button"
            className="wb-action-btn wb-clear-btn"
            style={actionBtnStyle}
            onClick={handleClear}
          >
            清空
          </button>
          <button
            type="button"
            className="wb-action-btn wb-export-btn"
            style={actionBtnStyle}
            onClick={handleExport}
          >
            导出 PNG
          </button>
        </div>

        {/* 状态指示 */}
        <div className="wb-group wb-status" style={groupStyle}>
          <span className="wb-status-dot" style={statusDotStyle(isDrawing)} />
          <span className="wb-status-label" style={statusLabelStyle}>
            {isDrawing ? '绘制中' : `${TOOLS.find(t => t.id === currentTool)?.label ?? ''}`}
          </span>
        </div>
      </div>

      {/* 画布容器 */}
      <div className="wb-canvas-container" style={canvasContainerStyle} ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="wb-canvas"
          style={{
            display: 'block',
            background: '#1a1a1a',
            touchAction: 'none',
            cursor: cursorForTool(currentTool),
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />

        {/* 文字工具输入框 */}
        {textEditing && (
          <input
            className="wb-text-input"
            type="text"
            style={textInputStyle(textEditing.x, textEditing.y, textFontSize, currentColor)}
            value={textValue}
            onChange={onTextInputChange}
            onKeyDown={onTextInputKeyDown}
            placeholder="输入文字… (Enter 确认 · Esc 取消)"
            autoFocus
          />
        )}
      </div>
    </div>
  )
}

export const WhiteboardPad = memo(WhiteboardPadBase)
