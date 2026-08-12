import { memo, useCallback, useEffect, useRef, useState, type DragEvent, type ClipboardEvent } from 'react'
import { useStore } from '../stores/sessionStore'

/**
 * 通用文件上传 + 多模态理解面板
 *
 * 三种入口，统一走同一套结果处理：
 *  1. 点击 → 原生文件对话框（图片 / PDF / 文本 / Markdown）
 *  2. 拖拽 → 把文件拖进面板（drag & drop）
 *  3. 粘贴 → 从剪贴板粘贴图片（clipboard paste）
 *
 * 处理逻辑：
 *  - 图片 → 后端视觉理解（chatVision，失败自动回退文本提示）
 *  - PDF  → 主进程提取文本；无文本（扫描件）则提示走图片识别
 *  - 文本 / Markdown → 直接提取内容插入输入框
 *
 * 自包含：仅依赖全局 CSS 变量，类名以 `fu-` 前缀作用域隔离。
 */

export interface FileUploadPanelProps {
  /** 将识别/提取结果插入输入框 */
  onInsert: (text: string) => void
  /** 禁用整个组件（如加载中） */
  disabled?: boolean
}

const MAX_PREVIEW_CHARS = 400

const CSS = `
.fu-root { display: flex; flex-direction: column; gap: 10px; width: 100%; font-family: var(--sans); color: var(--ink); }
.fu-dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 22px 14px; border: 1.5px dashed var(--border); border-radius: 4px;
  background: var(--bg2); color: var(--muted); cursor: pointer; text-align: center;
  transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.1s;
}
.fu-dropzone:hover { border-color: var(--accent); background: var(--bg3); color: var(--ink); }
.fu-dropzone--drag { border-color: var(--accent); background: var(--accent-subtle); color: var(--accent); transform: scale(1.01); }
.fu-dropzone-title { margin: 0; font-size: 13px; }
.fu-dropzone-hint { margin: 0; font-size: 11px; color: var(--muted); font-family: var(--mono); }
.fu-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fu-btn {
  display: inline-flex; align-items: center; gap: 5px; font-family: var(--sans); font-size: 12px;
  padding: 6px 11px; border: 1px solid var(--border); border-radius: 2px; background: var(--bg2);
  color: var(--ink); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
}
.fu-btn:hover:not(:disabled) { background: var(--bg3); border-color: var(--border-strong); }
.fu-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.fu-btn--primary { background: var(--accent); border-color: var(--accent); color: #1b1326; font-weight: 600; }
.fu-btn--primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.fu-loading { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--accent-subtle); border: 1px solid var(--border); border-radius: 2px; font-size: 12px; color: var(--muted); font-family: var(--mono); }
.fu-spinner { width: 13px; height: 13px; flex: none; border: 2px solid var(--border-strong); border-top-color: var(--accent); border-radius: 50%; animation: fu-spin 0.8s linear infinite; }
@keyframes fu-spin { to { transform: rotate(360deg); } }
.fu-error { padding: 8px 12px; background: var(--err-bg); border: 1px solid var(--err); border-radius: 2px; font-size: 12px; color: var(--err); font-family: var(--mono); line-height: 1.45; }
.fu-hint-ok { padding: 8px 12px; background: var(--accent-subtle); border: 1px solid var(--border); border-radius: 2px; font-size: 12px; color: var(--muted); font-family: var(--mono); line-height: 1.45; }
.fu-preview { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 2px; font-size: 12px; background: var(--bg2); }
.fu-preview-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); }
.fu-preview-kind { font-family: var(--mono); font-size: 10px; color: var(--muted); text-transform: uppercase; }
.fu-result { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow: auto; }
`

function getAPI(): MathWeaverAPI {
  return (window as unknown as { api: MathWeaverAPI }).api
}

function FileUploadPanelImpl({ onInsert, disabled = false }: FileUploadPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<UploadedFileResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragDepth = useRef(0)
  const ageLevel = useStore(s => s.ageLevel)

  // Clear transient notices after a few seconds.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  /**
   * Shared handler for every UploadedFileResult — regardless of which entry
   * point produced it (dialog / drag & drop / paste).
   */
  const processResult = useCallback(
    async (result: UploadedFileResult) => {
      setPreview(result)
      setError(null)

      if (result.kind === 'image') {
        // 图片 → 视觉理解（后端 chatVision，失败自动回退提示）
        const api = getAPI()
        if (!api.understandImage) throw new Error('视觉理解不可用')
        const resp = (await api.understandImage({
          imageDataUrl: result.dataUrl || '',
          ageLevel: ageLevel as 'kids' | 'tweens' | 'teens',
        })) as Record<string, unknown> | null
        const content = (resp?.content as string) || '（未返回内容）'
        onInsert(content)
        return
      }

      if (result.kind === 'text' && result.text) {
        onInsert(result.text)
        return
      }

      if (result.kind === 'pdf') {
        if (result.text) {
          onInsert(result.text)
          setNotice(`已从 PDF 提取 ${result.text.length} 字文本并插入输入框`)
        } else {
          setNotice(
            '该 PDF 未提取到可编辑文本（可能是扫描件/图片版）。请用「截图/拍照」把题目图片贴进来，或直接把文字打出来。',
          )
        }
        return
      }

      // unknown
      onInsert(`[已上传文件：${result.name}]`)
    },
    [onInsert, ageLevel],
  )

  /** Extract a File/Blob into a base64 data URL so it can cross the IPC boundary. */
  const fileToDataUrl = useCallback((file: File): Promise<{ dataUrl: string; mime: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ dataUrl: String(reader.result || ''), mime: file.type })
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
  }, [])

  /** Run a File through the shared data-buffer pipeline (drag & drop / paste). */
  const handleDataFile = useCallback(
    async (file: File) => {
      const api = getAPI()
      if (!api.uploadFileData) throw new Error('上传功能不可用')
      const { dataUrl, mime } = await fileToDataUrl(file)
      const result = (await api.uploadFileData({ name: file.name || mime || 'image', mime, dataUrl })) as
        | UploadedFileResult
        | null
      if (!result) return
      await processResult(result)
    },
    [fileToDataUrl, processResult],
  )

  /** Entry 1 — native file dialog. */
  const handleUpload = useCallback(async () => {
    if (disabled) return
    setError(null)
    setIsProcessing(true)
    try {
      const api = getAPI()
      if (!api.uploadFile) throw new Error('上传功能不可用')
      const result = (await api.uploadFile()) as UploadedFileResult | null
      if (!result) return // user cancelled
      await processResult(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsProcessing(false)
    }
  }, [disabled, processResult])

  /** Entry 2 — drag & drop. */
  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragDepth.current = 0
      setIsDragOver(false)
      if (disabled) return
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      setError(null)
      setIsProcessing(true)
      try {
        await handleDataFile(file)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsProcessing(false)
      }
    },
    [disabled, handleDataFile],
  )

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current += 1
    setIsDragOver(true)
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragOver(false)
    }
  }, [])

  /** Entry 3 — clipboard paste (image / screenshot). */
  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const items = e.clipboardData?.items
      if (!items) return
      let imageFile: File | null = null
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && (item.type.startsWith('image/') || item.type === 'application/pdf')) {
          const f = item.getAsFile()
          if (f) {
            imageFile = f
            break
          }
        }
      }
      if (!imageFile) return

      e.preventDefault()
      setError(null)
      setIsProcessing(true)
      try {
        await handleDataFile(imageFile)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsProcessing(false)
      }
    },
    [disabled, handleDataFile],
  )

  const previewSnippet = (() => {
    if (!preview) return ''
    if (preview.kind === 'image') return '图片已就绪，等待视觉理解'
    if (preview.text) return preview.text.slice(0, MAX_PREVIEW_CHARS)
    return ''
  })()

  return (
    <div className="fu-root" onPaste={handlePaste}>
      <style>{CSS}</style>

      <div
        className={`fu-dropzone${isDragOver ? ' fu-dropzone--drag' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => void handleUpload()}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void handleUpload()
          }
        }}
        onDrop={e => void handleDrop(e)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        aria-label="上传文件，支持点击选择、拖拽或粘贴"
      >
        <p className="fu-dropzone-title">上传文件（图片 / PDF / 文本 / Markdown）</p>
        <p className="fu-dropzone-hint">点击选择 · 拖拽至此 · 直接粘贴图片</p>
      </div>

      {isProcessing && (
        <div className="fu-loading" role="status" aria-live="polite">
          <span className="fu-spinner" aria-hidden="true" />
          正在处理…
        </div>
      )}

      {preview && !isProcessing && (
        <div className="fu-preview">
          <span className="fu-preview-name">{preview.name}</span>
          <span className="fu-preview-kind">{preview.kind}</span>
        </div>
      )}

      {previewSnippet && !isProcessing && <pre className="fu-result">{previewSnippet}</pre>}

      {notice && (
        <div className="fu-hint-ok" role="status">
          {notice}
        </div>
      )}

      {error && (
        <div className="fu-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export const FileUploadPanel = memo(FileUploadPanelImpl)