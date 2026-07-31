import { memo, useCallback, useEffect, useRef, useState } from 'react'

/* ==========================================================================
 * ImageInput —— MathWeaver 数学题图片 OCR 输入组件
 *
 * 功能：
 *  - 文件上传（点击选择 + 拖放）
 *  - 剪贴板粘贴图片（Ctrl+V）
 *  - 摄像头拍照（navigator.mediaDevices.getUserMedia）
 *  - 基于 Tesseract.js 的本地 OCR 识别
 *  - OCR 结果基础清洗（常见符号 → LaTeX 风格）
 *  - 可编辑识别结果 + 「插入到输入框」回调
 *
 * 自包含：仅依赖全局 CSS 变量，CSS 以 `cw-img-` 前缀作用域隔离。
 * Tesseract.js 为运行时动态加载的可选依赖，未安装或离线时给出友好提示。
 * ========================================================================== */

export interface ImageInputProps {
  /** 识别（并经用户校正）后的数学文本回调 */
  onRecognized: (text: string) => void
  /** 禁用整个组件 */
  disabled?: boolean
}

/* -------------------------------------------------------------------------- */
/*  OCR 原始文本 → LaTeX 风格的基础清洗                                         */
/* -------------------------------------------------------------------------- */

const SYMBOL_MAP: Record<string, string> = {
  '×': '\\times',
  '·': '\\cdot',
  '÷': '\\div',
  '±': '\\pm',
  '∓': '\\mp',
  '√': '\\sqrt',
  '∛': '\\sqrt[3]',
  '∜': '\\sqrt[4]',
  π: '\\pi',
  '∞': '\\infty',
  '≤': '\\leq',
  '≥': '\\geq',
  '≠': '\\neq',
  '≈': '\\approx',
  '≡': '\\equiv',
  '∝': '\\propto',
  '→': '\\to',
  '←': '\\leftarrow',
  '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow',
  '⇐': '\\Leftarrow',
  '⇔': '\\Leftrightarrow',
  '∑': '\\sum',
  '∏': '\\prod',
  '∫': '\\int',
  '∮': '\\oint',
  '∂': '\\partial',
  '∇': '\\nabla',
  Δ: '\\Delta',
  δ: '\\delta',
  ε: '\\epsilon',
  θ: '\\theta',
  λ: '\\lambda',
  μ: '\\mu',
  σ: '\\sigma',
  ω: '\\omega',
  φ: '\\phi',
  ψ: '\\psi',
  α: '\\alpha',
  β: '\\beta',
  γ: '\\gamma',
  ρ: '\\rho',
  τ: '\\tau',
  η: '\\eta',
  ζ: '\\zeta',
  ν: '\\nu',
  ξ: '\\xi',
  κ: '\\kappa',
  χ: '\\chi',
  ι: '\\iota',
  '°': '^\\circ',
  '′': "'",
  '″': "''",
  '…': '\\ldots',
  '⋯': '\\cdots',
  '⋮': '\\vdots',
  '⋱': '\\ddots',
  '∈': '\\in',
  '∉': '\\notin',
  '∀': '\\forall',
  '∃': '\\exists',
  '∪': '\\cup',
  '∩': '\\cap',
  '⊂': '\\subset',
  '⊃': '\\supset',
  '⊆': '\\subseteq',
  '⊇': '\\supseteq',
  '∅': '\\emptyset',
  ℝ: '\\mathbb{R}',
  ℕ: '\\mathbb{N}',
  ℤ: '\\mathbb{Z}',
  ℚ: '\\mathbb{Q}',
  ℂ: '\\mathbb{C}',
}

const SUP_MAP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
  '⁺': '+',
  '⁽': '(',
  '⁾': ')',
}
const SUB_MAP: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₋': '-',
  '₊': '+',
  ₐ: 'a',
  ₓ: 'x',
  ᵧ: 'y',
  ₙ: 'n',
  ₘ: 'm',
  ₖ: 'k',
  ᵢ: 'i',
  ⱼ: 'j',
}

/** 将 OCR 原始文本做一次基础清洗，转成 LaTeX 友好的形式 */
function cleanupOcrText(raw: string): string {
  if (!raw) return ''
  let text = raw

  // 1) Unicode 数学符号 → LaTeX 命令
  for (const [sym, cmd] of Object.entries(SYMBOL_MAP)) {
    if (text.indexOf(sym) !== -1) {
      text = text.split(sym).join(cmd)
    }
  }

  // 2) Unicode 上标 / 下标 → ^{...} / _{...}
  const supChars = Object.keys(SUP_MAP).join('')
  if (supChars) {
    text = text.replace(
      new RegExp(`[${supChars}]+`, 'g'),
      run =>
        `^{${run
          .split('')
          .map(c => SUP_MAP[c] || c)
          .join('')}}`,
    )
  }
  const subChars = Object.keys(SUB_MAP).join('')
  if (subChars) {
    text = text.replace(
      new RegExp(`[${subChars}]+`, 'g'),
      run =>
        `_{${run
          .split('')
          .map(c => SUB_MAP[c] || c)
          .join('')}}`,
    )
  }

  // 3) \sqrt(...) → \sqrt{...}
  text = text.replace(/\\sqrt\s*\(([^()]+)\)/g, '\\sqrt{$1}')
  // \sqrt 后紧跟单个数字/字母（未被花括号包裹）→ \sqrt{...}
  text = text.replace(/\\sqrt(?!\s*\{)\s*([A-Za-z0-9])/g, '\\sqrt{$1}')

  // 4) 数字分数 a/b → \frac{a}{b}
  text = text.replace(/(\d)\s*\/\s*(\d)/g, '\\frac{$1}{$2}')

  // 5) 规整空白：压缩行内多余空格、去除首尾空行
  text = text
    .split('\n')
    .map(l => l.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text
}

/* -------------------------------------------------------------------------- */
/*  摄像头错误信息汉化                                                          */
/* -------------------------------------------------------------------------- */
function cameraErrorMessage(e: unknown): string {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return '摄像头权限被拒绝，请在系统设置中允许访问'
      case 'NotFoundError':
      case 'OverconstrainedError':
        return '未找到可用的摄像头设备'
      case 'NotReadableError':
        return '摄像头被其他程序占用'
      case 'AbortError':
        return '摄像头启动被中断'
      default:
        return `无法访问摄像头（${e.name}）`
    }
  }
  return '无法访问摄像头'
}

/* -------------------------------------------------------------------------- */
/*  动态加载 Tesseract.js（可选依赖）                                           */
/* -------------------------------------------------------------------------- */
type CreateWorker = (lang?: string) => Promise<TesseractWorkerLike>

interface TesseractWorkerLike {
  recognize: (source: string) => Promise<{ data?: { text?: string } }>
  terminate: () => Promise<void>
}

/** Minimal type shape for the tesseract.js module (handles both ESM and CJS exports). */
interface TesseractModule {
  createWorker?: CreateWorker
  default?: { createWorker?: CreateWorker }
}

async function loadTesseract(): Promise<CreateWorker> {
  let mod: TesseractModule
  try {
    // tesseract.js 为可选依赖，运行时动态加载；@vite-ignore 避免 Vite 在未安装时构建报错。
    // 使用类型断言而非 any，确保后续属性访问有类型检查。
    mod = (await import(/* @vite-ignore */ 'tesseract.js')) as unknown as TesseractModule
  } catch {
    throw new Error('未能加载 OCR 引擎（tesseract.js），请检查网络连接或确认已安装该依赖')
  }
  const createWorker = mod?.createWorker ?? mod?.default?.createWorker
  if (typeof createWorker !== 'function') {
    throw new Error('OCR 引擎接口异常，请确认 tesseract.js 版本兼容')
  }
  return createWorker
}

/* -------------------------------------------------------------------------- */
/*  作用域 CSS（cw-img- 前缀）                                                  */
/* -------------------------------------------------------------------------- */
const CSS = `
.cw-img-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  font-family: var(--sans);
  color: var(--ink);
}
.cw-img-root[hidden] { display: none; }

.cw-img-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 26px 16px;
  border: 1.5px dashed var(--border);
  border-radius: 4px;
  background: var(--bg2);
  color: var(--muted);
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.cw-img-dropzone:hover { border-color: var(--accent); background: var(--bg3); color: var(--ink); }
.cw-img-dropzone--drag { border-color: var(--accent); background: var(--accent-subtle); color: var(--ink); }
.cw-img-dropzone-icon { color: var(--muted); transition: color 0.15s; }
.cw-img-dropzone:hover .cw-img-dropzone-icon,
.cw-img-dropzone--drag .cw-img-dropzone-icon { color: var(--accent); }
.cw-img-dropzone-title { margin: 0; font-size: 13px; }
.cw-img-dropzone-hint { margin: 0; font-size: 11px; color: var(--muted); font-family: var(--mono); }

.cw-img-preview-wrap {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  overflow: hidden;
}
.cw-img-preview { display: block; width: 100%; max-height: 240px; object-fit: contain; background: #000; }
.cw-img-preview-toolbar {
  position: absolute; top: 6px; right: 6px;
  display: flex; gap: 6px;
}

.cw-img-actions { display: flex; flex-wrap: wrap; gap: 6px; }

.cw-img-btn {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--sans); font-size: 12px;
  padding: 6px 11px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg2);
  color: var(--ink);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s, transform 0.05s;
}
.cw-img-btn:hover:not(:disabled) { background: var(--bg3); border-color: var(--border-strong); }
.cw-img-btn:active:not(:disabled) { transform: translateY(1px); }
.cw-img-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cw-img-btn--primary {
  background: var(--accent); border-color: var(--accent);
  color: #1b1326; font-weight: 600;
}
.cw-img-btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.cw-img-btn--ghost { background: transparent; }
.cw-img-btn-icon { display: inline-flex; }

.cw-img-loading {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px;
  background: var(--accent-subtle);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-size: 12px; color: var(--muted);
  font-family: var(--mono);
}
.cw-img-spinner {
  width: 13px; height: 13px; flex: none;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: cw-img-spin 0.8s linear infinite;
}
@keyframes cw-img-spin { to { transform: rotate(360deg); } }

.cw-img-error {
  padding: 8px 12px;
  background: var(--err-bg);
  border: 1px solid var(--err);
  border-radius: 2px;
  font-size: 12px; color: var(--err);
  font-family: var(--mono);
  line-height: 1.45;
}

.cw-img-result-label {
  margin: 0; font-size: 11px; color: var(--muted);
  font-family: var(--mono);
}
.cw-img-textarea {
  width: 100%; min-height: 92px; resize: vertical;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--ink);
  font-family: var(--mono); font-size: 13px; line-height: 1.5;
  transition: border-color 0.15s;
}
.cw-img-textarea:focus { outline: none; border-color: var(--accent); }
.cw-img-textarea::placeholder { color: var(--muted); }

.cw-img-insert-row { display: flex; justify-content: flex-end; }

.cw-img-camera-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.78);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 14px; z-index: 1000;
}
.cw-img-camera-video {
  max-width: 92vw; max-height: 74vh;
  border: 1px solid var(--border);
  border-radius: 4px; background: #000;
}
.cw-img-camera-tip { color: var(--muted); font-size: 12px; font-family: var(--mono); }
.cw-img-camera-actions { display: flex; gap: 10px; }
`

/* -------------------------------------------------------------------------- */
/*  组件实现                                                                    */
/* -------------------------------------------------------------------------- */
function ImageInputImpl({ onRecognized, disabled = false }: ImageInputProps) {
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [recognizedText, setRecognizedText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // 始终持有最新值，供异步回调 / 事件监听读取，避免闭包过期
  const isProcessingRef = useRef(false)
  isProcessingRef.current = isProcessing

  const cameraSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'

  /* ---------------------------- OCR 核心 ---------------------------- */
  const runOCR = useCallback(async (source: string) => {
    setIsProcessing(true)
    setError(null)
    setRecognizedText('')
    try {
      const createWorker = await loadTesseract()
      const worker = await createWorker('eng')
      try {
        const result = await worker.recognize(source)
        const rawText: string = result?.data?.text ?? ''
        const cleaned = cleanupOcrText(rawText)
        setRecognizedText(cleaned)
        if (!cleaned) {
          setError('未识别到文本，请使用更清晰的图片，或直接在下方输入框手动编辑')
        }
      } finally {
        try {
          await worker.terminate()
        } catch {
          /* 忽略终止异常 */
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'OCR 识别失败，请重试'
      setError(msg)
      setRecognizedText('')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  /* ---------------------------- 文件处理 ---------------------------- */
  const handleFile = useCallback(
    (file: File) => {
      if (isProcessingRef.current) return
      if (!file || !file.type.startsWith('image/')) {
        setError('请选择图片文件（JPG / PNG / WebP 等）')
        return
      }
      setError(null)
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result
        if (typeof dataUrl !== 'string') {
          setError('读取图片失败')
          return
        }
        setImagePreview(dataUrl)
        void runOCR(dataUrl)
      }
      reader.onerror = () => setError('读取图片失败，请重试')
      reader.readAsDataURL(file)
    },
    [runOCR],
  )

  const openFilePicker = useCallback(() => {
    if (disabled || isProcessingRef.current) return
    fileInputRef.current?.click()
  }, [disabled])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      // 重置 value 以允许重复选择同一文件
      e.target.value = ''
    },
    [handleFile],
  )

  /* ---------------------------- 拖放 ---------------------------- */
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isProcessingRef.current) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      if (disabled || isProcessingRef.current) return
      const file = e.dataTransfer?.files?.[0]
      if (file) handleFile(file)
    },
    [disabled, handleFile],
  )

  /* ---------------------------- 摄像头 ---------------------------- */
  const stopCamera = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
  }, [])

  const startCamera = useCallback(async () => {
    if (disabled || isProcessingRef.current) return
    if (!cameraSupported) {
      setError('当前环境不支持摄像头')
      return
    }
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)
    } catch (e) {
      setError(cameraErrorMessage(e))
      setCameraActive(false)
    }
  }, [disabled, cameraSupported])

  const capturePhoto = useCallback(() => {
    const video = videoRef.current
    if (!video) {
      stopCamera()
      return
    }
    const w = video.videoWidth || 640
    const h = video.videoHeight || 480
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('无法捕获画面')
      stopCamera()
      return
    }
    ctx.drawImage(video, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/png')
    stopCamera()
    setImagePreview(dataUrl)
    void runOCR(dataUrl)
  }, [runOCR, stopCamera])

  /* ---------------------------- 其它操作 ---------------------------- */
  const handleReset = useCallback(() => {
    stopCamera()
    setImagePreview(null)
    setRecognizedText('')
    setError(null)
    setIsProcessing(false)
    setIsDragging(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [stopCamera])

  const handleInsert = useCallback(() => {
    const text = recognizedText.trim()
    if (!text) return
    onRecognized(text)
  }, [recognizedText, onRecognized])

  /* ---------------------------- 副作用 ---------------------------- */
  // 剪贴板粘贴：仅拦截图片类型，纯文本粘贴不受影响
  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      if (isProcessingRef.current) return
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            handleFile(file)
            return
          }
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [disabled, handleFile])

  // 摄像头视频流绑定到 <video> 元素
  useEffect(() => {
    if (!cameraActive) return
    const video = videoRef.current
    const stream = streamRef.current
    if (video && stream) {
      video.srcObject = stream
      void video.play().catch(() => {
        /* 自动播放被阻止时忽略，用户可手动播放 */
      })
    }
  }, [cameraActive])

  // 卸载时释放摄像头流，避免资源泄漏
  useEffect(() => {
    return () => {
      const stream = streamRef.current
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  /* ---------------------------- 渲染 ---------------------------- */
  return (
    <div className="cw-img-root" hidden={disabled}>
      <style>{CSS}</style>

      {/* 拖放 / 选择区 */}
      <div
        className={`cw-img-dropzone${isDragging ? ' cw-img-dropzone--drag' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={openFilePicker}
        role="button"
        tabIndex={0}
        aria-label="拖放或点击选择数学题图片"
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openFilePicker()
          }
        }}
      >
        <svg
          className="cw-img-dropzone-icon"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <p className="cw-img-dropzone-title">拖放数学题图片到此处，或点击选择</p>
        <p className="cw-img-dropzone-hint">支持 JPG / PNG / WebP · 可 Ctrl+V 粘贴</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFileInputChange}
        />
      </div>

      {/* 图片预览 */}
      {imagePreview && (
        <div className="cw-img-preview-wrap">
          <img className="cw-img-preview" src={imagePreview} alt="待识别的数学题图片" />
          <div className="cw-img-preview-toolbar">
            <button
              type="button"
              className="cw-img-btn cw-img-btn--ghost"
              onClick={handleReset}
              title="清除当前图片"
            >
              清除
            </button>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="cw-img-actions">
        <button
          type="button"
          className="cw-img-btn"
          onClick={openFilePicker}
          disabled={isProcessing}
          title="从本地选择图片"
        >
          <svg
            className="cw-img-btn-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          选择图片
        </button>

        <button
          type="button"
          className="cw-img-btn"
          onClick={startCamera}
          disabled={isProcessing || !cameraSupported}
          title={cameraSupported ? '使用摄像头拍照' : '当前环境不支持摄像头'}
        >
          <svg
            className="cw-img-btn-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          拍照
        </button>

        {imagePreview && (
          <button
            type="button"
            className="cw-img-btn cw-img-btn--ghost"
            onClick={handleReset}
            disabled={isProcessing}
            title="清空图片与识别结果"
          >
            <svg
              className="cw-img-btn-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            清空
          </button>
        )}
      </div>

      {/* 识别中 */}
      {isProcessing && (
        <div className="cw-img-loading" role="status" aria-live="polite">
          <span className="cw-img-spinner" aria-hidden="true" />
          正在识别…
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="cw-img-error" role="alert">
          {error}
        </div>
      )}

      {/* 识别结果（可编辑） */}
      {imagePreview && !isProcessing && (
        <>
          <p className="cw-img-result-label">识别结果（可编辑，可手动校正）</p>
          <textarea
            className="cw-img-textarea"
            value={recognizedText}
            onChange={e => setRecognizedText(e.target.value)}
            placeholder="识别结果将显示在此处，可手动编辑后插入…"
            spellCheck={false}
            aria-label="识别结果编辑框"
          />
          <div className="cw-img-insert-row">
            <button
              type="button"
              className="cw-img-btn cw-img-btn--primary"
              onClick={handleInsert}
              disabled={!recognizedText.trim()}
              title="将校正后的文本插入到输入框"
            >
              <svg
                className="cw-img-btn-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
              插入到输入框
            </button>
          </div>
        </>
      )}

      {/* 摄像头拍照浮层 */}
      {cameraActive && (
        <div className="cw-img-camera-overlay" role="dialog" aria-label="摄像头拍照">
          <video ref={videoRef} className="cw-img-camera-video" autoPlay muted playsInline />
          <p className="cw-img-camera-tip">将摄像头对准数学题，点击「拍摄」</p>
          <div className="cw-img-camera-actions">
            <button type="button" className="cw-img-btn cw-img-btn--primary" onClick={capturePhoto}>
              拍摄
            </button>
            <button type="button" className="cw-img-btn" onClick={stopCamera}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export const ImageInput = memo(ImageInputImpl)
