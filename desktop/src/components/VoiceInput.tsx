import { memo, useCallback, useEffect, useRef, useState } from 'react'

/**
 * Web Speech API 的类型声明 —— TypeScript 5.5 的 lib.dom.d.ts 尚未内置
 * SpeechRecognition 相关类型，这里以最小接口补齐，供组件内部使用。
 */
declare global {
  interface SpeechRecognitionAlternative {
    readonly transcript: string
    readonly confidence: number
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean
    readonly length: number
    [index: number]: SpeechRecognitionAlternative
  }

  interface SpeechRecognitionResultList {
    readonly length: number
    [index: number]: SpeechRecognitionResult
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }

  interface SpeechRecognition extends EventTarget {
    lang: string
    continuous: boolean
    interimResults: boolean
    start(): void
    stop(): void
    abort(): void
    onresult: ((event: SpeechRecognitionEvent) => void) | null
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
    onend: ((event: Event) => void) | null
  }

  interface Window {
    SpeechRecognition: { new (): SpeechRecognition }
    webkitSpeechRecognition: { new (): SpeechRecognition }
  }
}

export interface VoiceInputProps {
  /** 收到识别结果时回调；isFinal=false 为临时结果，true 为最终结果 */
  onTranscript: (text: string, isFinal: boolean) => void
  /** 识别语言，默认简体中文 */
  language?: string
  /** 禁用按钮 */
  disabled?: boolean
}

/** 静默超时：30 秒无任何结果则自动停止 */
const SILENCE_TIMEOUT = 30_000

function VoiceInputImpl({ onTranscript, language = 'zh-CN', disabled = false }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  /** 是否“应当”继续监听：用于区分用户主动停止与浏览器自动停止 */
  const shouldListenRef = useRef(false)
  /** 静默计时器 */
  const silenceTimerRef = useRef<number | null>(null)
  /** 始终持有最新的 onTranscript，避免识别回调闭包过期 */
  const onTranscriptRef = useRef(onTranscript)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  const speechSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const stopListening = useCallback(() => {
    shouldListenRef.current = false
    clearSilenceTimer()
    const recognition = recognitionRef.current
    if (recognition) {
      try {
        recognition.stop()
      } catch {
        // 忽略：可能尚未开始或已结束
      }
    }
    setIsListening(false)
  }, [clearSilenceTimer])

  const startListening = useCallback(() => {
    if (disabled || !speechSupported) return
    setError(null)

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionClass) return

    const recognition = new SpeechRecognitionClass()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = language

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // 收到结果即重置静默计时
      clearSilenceTimer()
      silenceTimerRef.current = window.setTimeout(() => {
        stopListening()
      }, SILENCE_TIMEOUT)

      // 仅处理本次新增的结果（resultIndex 起）
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        onTranscriptRef.current(transcript, result.isFinal)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      let message = '语音识别出错'
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          message = '麦克风权限被拒绝，请在浏览器设置中允许使用麦克风'
          break
        case 'network':
          message = '网络错误，语音识别服务不可用'
          break
        case 'aborted':
          message = '语音识别已中止'
          break
        case 'no-speech':
          message = '未检测到语音输入'
          break
        case 'audio-capture':
          message = '无法捕获音频，请检查麦克风设备'
          break
        default:
          break
      }
      setError(message)
      shouldListenRef.current = false
      clearSilenceTimer()
      setIsListening(false)
    }

    recognition.onend = () => {
      // 若仍应监听，说明是浏览器自动停止，尝试重启
      if (shouldListenRef.current) {
        try {
          recognition.start()
        } catch {
          shouldListenRef.current = false
          clearSilenceTimer()
          setIsListening(false)
        }
      } else {
        clearSilenceTimer()
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition
    shouldListenRef.current = true

    try {
      recognition.start()
      setIsListening(true)
      silenceTimerRef.current = window.setTimeout(() => {
        stopListening()
      }, SILENCE_TIMEOUT)
    } catch {
      setError('无法启动语音识别')
      shouldListenRef.current = false
      setIsListening(false)
    }
  }, [disabled, language, speechSupported, clearSilenceTimer, stopListening])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  // 错误提示 4 秒后自动清除
  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 4000)
    return () => window.clearTimeout(timer)
  }, [error])

  // 卸载时清理资源
  useEffect(() => {
    return () => {
      shouldListenRef.current = false
      clearSilenceTimer()
      const recognition = recognitionRef.current
      if (recognition) {
        try {
          recognition.abort()
        } catch {
          // 忽略
        }
        recognitionRef.current = null
      }
    }
  }, [clearSilenceTimer])

  const isDisabled = disabled || !speechSupported

  const buttonTitle = !speechSupported
    ? '浏览器不支持语音输入'
    : isListening
      ? '停止语音输入'
      : '开始语音输入'

  return (
    <span className="voice-input-wrap">
      <button
        type="button"
        className={`voice-input-btn${isListening ? ' voice-input-active' : ''}`}
        onClick={toggleListening}
        disabled={isDisabled}
        title={buttonTitle}
        aria-label={buttonTitle}
        aria-pressed={isListening}
      >
        <svg
          className="voice-input-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
      {isListening && <span className="voice-input-label">正在聆听...</span>}
      {error && <span className="voice-input-error">{error}</span>}
    </span>
  )
}

export const VoiceInput = memo(VoiceInputImpl)
