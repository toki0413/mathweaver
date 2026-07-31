/**
 * 音效系统 — 使用 Web Audio API 合成音效，无需音频文件
 *
 * 核心理念：MathWeaver 面向儿童/青少年，音效是游戏化体验的重要一环。
 * 但打包音频文件会增大体积，且在不同平台音质不一。Web Audio API 可以
 * 用振荡器 + 包络 + 滤波器实时合成所有需要的音效，零资源依赖。
 *
 * 音效类型：
 * - click:    点击格子（短促的高音"啵"）
 * - correct:  答对（上升音阶 do-mi-sol）
 * - wrong:    答错（下降的低音）
 * - complete: 完成关卡（胜利和弦 C-E-G-C 琶音）
 * - star:     获得星星（闪烁音）
 * - discover: 发现新概念（神秘音）
 * - unlock:   解锁成就（叮咚）
 * - whoosh:   页面切换（嗖 — 白噪声风声）
 * - pop:      弹出元素（泡泡音）
 * - celebrate:大庆祝（大和弦 + 琶音）
 *
 * 用法：
 *   import { soundSystem } from '@/utils/sound'
 *   soundSystem.play('correct')
 *   soundSystem.setEnabled(false)  // 静音
 *   soundSystem.setVolume(0.5)     // 半音量
 *
 * 注意：AudioContext 受浏览器自动播放策略限制，必须在用户首次交互后
 * 才能创建/恢复。本系统采用懒初始化：首次调用 play() 时才创建上下文。
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type SoundType =
  | 'click'
  | 'correct'
  | 'wrong'
  | 'complete'
  | 'star'
  | 'discover'
  | 'unlock'
  | 'whoosh'
  | 'pop'
  | 'celebrate'

// ---------------------------------------------------------------------------
// 音效系统
// ---------------------------------------------------------------------------

class SoundSystem {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private enabled = true
  private volume = 0.3

  // -------------------------------------------------------------------------
  // 初始化
  // -------------------------------------------------------------------------

  /**
   * 初始化 AudioContext（需要用户交互后才能创建）。
   *
   * 浏览器自动播放策略要求 AudioContext 在用户手势（点击、按键等）之后
   * 才能 resume。本方法采用懒初始化，在首次 play() 时调用。
   * 重复调用安全 — 已初始化时直接返回。
   */
  init(): void {
    if (this.ctx) return
    if (typeof window === 'undefined') return

    // 兼容旧版 webkit 前缀
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) {
      console.warn('[sound] Web Audio API 不可用，音效系统已禁用')
      return
    }

    this.ctx = new AudioContextCtor()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.volume
    this.masterGain.connect(this.ctx.destination)
  }

  // -------------------------------------------------------------------------
  // 配置
  // -------------------------------------------------------------------------

  /** 设置启用/禁用。禁用时 play() 静默返回。 */
  setEnabled(v: boolean): void {
    this.enabled = v
  }

  /** 设置主音量 (0.0 - 1.0)。超出范围会被截断。 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime)
    }
  }

  /** 获取当前启用状态 */
  isEnabled(): boolean {
    return this.enabled
  }

  // -------------------------------------------------------------------------
  // 播放
  // -------------------------------------------------------------------------

  /**
   * 播放指定类型的音效。
   *
   * 若音效被禁用则静默返回；若 AudioContext 尚未初始化则自动初始化；
   * 若上下文被浏览器挂起（自动播放策略）则尝试恢复。
   */
  play(type: SoundType): void {
    if (!this.enabled) return
    if (!this.ctx) this.init()
    if (!this.ctx || !this.masterGain) return

    // 自动播放策略：上下文可能处于 suspended 状态，尝试恢复
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        /* 恢复失败时静默处理，下次 play 会重试 */
      })
    }

    switch (type) {
      case 'click':
        // 800Hz, 0.05s, sine — 短促清脆
        this.playNote(800, 0.05, 'sine', 0)
        break

      case 'pop':
        // 400Hz → 600Hz, 0.1s, sine — 上升泡泡音
        this.playNote(400, 0.1, 'sine', 0, 600)
        break

      case 'correct':
        // C5-E5-G5 上升音阶，每个 0.1s，triangle 波形（柔和）
        this.playNote(523.25, 0.1, 'triangle', 0)
        this.playNote(659.25, 0.1, 'triangle', 0.1)
        this.playNote(783.99, 0.1, 'triangle', 0.2)
        break

      case 'wrong':
        // 200Hz → 150Hz, 0.3s, sawtooth — 下降低沉
        this.playNote(200, 0.3, 'sawtooth', 0, 150)
        break

      case 'star':
        // 1200Hz → 1600Hz, 0.15s, sine — 闪烁上升
        this.playNote(1200, 0.15, 'sine', 0, 1600)
        break

      case 'discover':
        // A4-C#5-E5 神秘音阶，每个 0.08s，triangle
        this.playNote(440.0, 0.08, 'triangle', 0)
        this.playNote(554.37, 0.08, 'triangle', 0.08)
        this.playNote(659.25, 0.08, 'triangle', 0.16)
        break

      case 'unlock':
        // E5 → A5, 0.12s, sine — 叮咚上升
        this.playNote(659.25, 0.12, 'sine', 0, 880)
        break

      case 'whoosh':
        // 白噪声 0.15s，带通滤波 + 淡出 — 风声嗖
        this.playNoise(0.15, 0)
        break

      case 'complete':
        // C5-E5-G5-C6 胜利琶音，每个 0.12s，triangle
        this.playNote(523.25, 0.12, 'triangle', 0)
        this.playNote(659.25, 0.12, 'triangle', 0.12)
        this.playNote(783.99, 0.12, 'triangle', 0.24)
        this.playNote(1046.5, 0.12, 'triangle', 0.36)
        break

      case 'celebrate':
        // 大和弦 C5-E5-G5-B5 (523-659-784-988) 持续 0.8s + 上行琶音
        this.playChord([523.25, 659.25, 783.99, 987.77], 0.8, 0)
        // 叠加琶音，增加层次感
        this.playNote(523.25, 0.15, 'triangle', 0)
        this.playNote(659.25, 0.15, 'triangle', 0.1)
        this.playNote(783.99, 0.15, 'triangle', 0.2)
        this.playNote(987.77, 0.15, 'triangle', 0.3)
        this.playNote(1046.5, 0.2, 'triangle', 0.4)
        break
    }
  }

  // -------------------------------------------------------------------------
  // 内部方法
  // -------------------------------------------------------------------------

  /**
   * 内部方法：播放单个音符
   *
   * @param freq     起始频率 (Hz)
   * @param duration 持续时间 (秒)
   * @param type     振荡器波形
   * @param delay    相对于当前时间的延迟 (秒)
   * @param endFreq  结束频率 (Hz)，用于频率扫描；省略时为持续固定频率
   */
  private playNote(
    freq: number,
    duration: number,
    type: OscillatorType,
    delay: number,
    endFreq?: number,
  ): void {
    if (!this.ctx || !this.masterGain) return

    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()

    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)

    // 频率扫描（如 pop 的上升、wrong 的下降）
    if (endFreq !== undefined && endFreq !== freq) {
      // exponentialRamp 要求目标值 > 0
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration)
    }

    // ADSR 包络 — 短音效简化为：快速 attack + 指数 release
    // exponentialRamp 的起点和终点都必须 > 0，因此用 0.0001 而非 0
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(1, t0 + 0.008) // 8ms attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration) // 指数衰减

    osc.connect(gain)
    gain.connect(this.masterGain)

    osc.start(t0)
    // 多留 20ms 余量确保衰减完整，避免结束时的咔哒声
    osc.stop(t0 + duration + 0.02)
  }

  /**
   * 内部方法：播放和弦（多个频率同时发声）
   *
   * @param freqs    频率数组
   * @param duration 持续时间 (秒)
   * @param delay    相对于当前时间的延迟 (秒)
   */
  private playChord(freqs: number[], duration: number, delay: number): void {
    for (const f of freqs) {
      this.playNote(f, duration, 'sine', delay)
    }
  }

  /**
   * 内部方法：播放白噪声（用于 whoosh 等风声效果）
   *
   * 生成一段随机白噪声 buffer，通过带通滤波器塑形为"风声"，
   * 再用指数淡出包络收尾。
   *
   * @param duration 持续时间 (秒)
   * @param delay    相对于当前时间的延迟 (秒)
   */
  private playNoise(duration: number, delay: number): void {
    if (!this.ctx || !this.masterGain) return

    const t0 = this.ctx.currentTime + delay
    const sampleCount = Math.floor(this.ctx.sampleRate * duration)
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)

    // 填充白噪声 (-1.0 到 1.0 均匀分布)
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const noise = this.ctx.createBufferSource()
    noise.buffer = buffer

    // 带通滤波：频率从 800Hz 扫到 3000Hz，模拟"嗖"的风声上扬
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(800, t0)
    filter.frequency.exponentialRampToValueAtTime(3000, t0 + duration)
    filter.Q.value = 0.7

    // 淡出包络
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.6, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)

    noise.connect(filter)
    filter.connect(gain)
    gain.connect(this.masterGain)

    noise.start(t0)
    noise.stop(t0 + duration + 0.02)
  }

  // -------------------------------------------------------------------------
  // 资源管理
  // -------------------------------------------------------------------------

  /** 销毁音频上下文，释放系统资源 */
  destroy(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => {
        /* 关闭失败时静默处理 */
      })
      this.ctx = null
      this.masterGain = null
    }
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

export const soundSystem = new SoundSystem()
