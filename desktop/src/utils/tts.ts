/**
 * Speech output (TTS) system — Web Speech API `speechSynthesis`, zero dependencies.
 *
 * 核心理念：MathWeaver 的导师 / Mascot 需要"开口说话"，才能形成真正的苏格拉底式
 * 口语引导。Web Speech API 是浏览器 / Electron 内置能力，无需任何网络依赖或打包
 * 资源，且天然支持中文（zh-CN）与英文（en-US）。
 *
 * 特性：
 *  - 按语言自动挑选合适的系统语音（优先本地/普通话高质音色）
 *  - 静音/音量控制，与全局音效系统互不冲突
 *  - 朗读中断（新朗读自动打断旧朗读，避免语音叠加）
 *  - 自动清理：朗读结束自动停止，避免 SpeechSynthesis 泄漏
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type TTSLanguage = 'zh-CN' | 'en-US'

export interface TTSOptions {
  /** 朗读语言，默认 zh-CN */
  language?: TTSLanguage
  /** 音量 0..1 */
  volume?: number
  /** 语速倍率 0.1..10，默认 1 */
  rate?: number
  /** 音调 0..2，默认 1 */
  pitch?: number
  /** 是否打断当前朗读（默认 true） */
  interrupt?: boolean
}

// ---------------------------------------------------------------------------
// 语音选择
// ---------------------------------------------------------------------------

/** 按语言挑一个合适的系统语音；挑不到则返回 null（交给引擎默认）。 */
function pickVoice(lang: TTSLanguage): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()

  // 1) 精确匹配语言前缀（zh-CN / en-US）
  const exact = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase())
  if (exact) return exact

  // 2) 宽松匹配语言前缀（如 zh-CN 匹配 zh-TW 之前的 zh、zh_CN）
  const prefix = lang.split('-')[0].toLowerCase()
  const loose = voices.find(v => v.lang.toLowerCase().startsWith(prefix))
  return loose ?? null
}

// ---------------------------------------------------------------------------
// TTS 系统
// ---------------------------------------------------------------------------

class TTSSystem {
  private enabled = true
  private volume = 1
  private voiceCache: SpeechSynthesisVoice | null = null
  private voiceCacheLang: TTSLanguage | null = null

  /** 运行时是否可用（浏览器/Electron 支持 speechSynthesis） */
  get supported(): boolean {
    return typeof window !== 'undefined' && !!window.speechSynthesis
  }

  setEnabled(v: boolean): void {
    this.enabled = v
    if (!v) this.stop()
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
  }

  /** 立即停止当前朗读 */
  stop(): void {
    if (!this.supported) return
    window.speechSynthesis.cancel()
  }

  /**
   * 朗读一段文本。返回是否成功发起。
   */
  speak(text: string, options: TTSOptions = {}): boolean {
    if (!this.enabled || !text || !text.trim()) return false
    if (!this.supported) return false

    const lang = options.language ?? 'zh-CN'
    const { volume = this.volume, rate = 1, pitch = 1, interrupt = true } = options

    // 打断当前朗读（教研场景下新回复应覆盖旧回复）
    if (interrupt) this.stop()

    // 缓存语音选择（语言相同则复用，减少 getVoices 开销）
    if (this.voiceCacheLang !== lang) {
      this.voiceCache = pickVoice(lang)
      this.voiceCacheLang = lang
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    if (this.voiceCache) utterance.voice = this.voiceCache
    utterance.volume = volume
    utterance.rate = rate
    utterance.pitch = pitch

    window.speechSynthesis.speak(utterance)
    return true
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

export const ttsSystem = new TTSSystem()