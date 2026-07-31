/**
 * 吉祥物组件 — "欧拉"猫头鹰
 *
 * 一个用 SVG 绘制的猫头鹰角色，陪伴孩子学习。
 * 表情和动作会根据状态变化，提供情感陪伴与即时反馈。
 *
 * 设计理念：
 *   - 零图片依赖：纯 SVG 绘制，主题色与品牌一致
 *   - 状态驱动：6 种表情/动作，覆盖学习全流程
 *   - 年龄适配：对话气泡文案随 ageLevel 变化
 *   - 无障碍：支持键盘交互、减少动效偏好
 *
 * 状态：
 *   - idle:        眨眼，偶尔歪头（默认待机）
 *   - happy:       开心，眼睛变 ^_^，跳一下
 *   - thinking:    思考，头歪向一边，头顶有 ...
 *   - encouraging: 鼓励，翅膀举起
 *   - celebrating: 庆祝，旋转跳跃，周围有星星
 *   - sleeping:    睡觉（长时间无操作）
 *
 * 用法：
 *   <Mascot state="happy" message="答对了！" ageLevel="kids" />
 *   <Mascot state="celebrating" position="bottom-right" size={140} />
 */

import type { AgeLevel } from '../utils/ageAdapt'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type MascotState = 'idle' | 'happy' | 'thinking' | 'encouraging' | 'celebrating' | 'sleeping'

export interface MascotProps {
  /** 当前状态，决定表情与动画 */
  state?: MascotState
  /** 尺寸（像素），默认 120 */
  size?: number
  /** 说话气泡内容；为空字符串时不显示气泡，undefined 时使用状态默认文案 */
  message?: string
  /** 年龄等级，影响默认消息文案 */
  ageLevel?: AgeLevel
  /** 位置模式 */
  position?: 'bottom-right' | 'bottom-left' | 'inline'
  /** 点击回调 */
  onClick?: () => void
}

// ---------------------------------------------------------------------------
// 默认消息（年龄适配）
// ---------------------------------------------------------------------------

const DEFAULT_MESSAGES: Record<MascotState, Record<AgeLevel, string>> = {
  idle: { kids: '', tweens: '', teens: '' },
  happy: {
    kids: '太棒啦！',
    tweens: '不错！答对了',
    teens: '正确。',
  },
  thinking: {
    kids: '让我想想哦…',
    tweens: '思考中…',
    teens: 'Analyzing…',
  },
  encouraging: {
    kids: '加油加油！你可以的！',
    tweens: '继续，你能做到！',
    teens: 'Keep going.',
  },
  celebrating: {
    kids: '哇！太厉害啦！',
    tweens: '干得漂亮！',
    teens: 'Well done.',
  },
  sleeping: { kids: '', tweens: '', teens: '' },
}

/**
 * 获取状态的年龄适配默认消息。
 * 父组件可调用此函数生成消息后再传入 message prop，也可不传 message
 * 让组件自动使用默认值。
 */
export function getMascotMessage(state: MascotState, ageLevel: AgeLevel): string {
  return DEFAULT_MESSAGES[state][ageLevel]
}

// ---------------------------------------------------------------------------
// SVG 辅助
// ---------------------------------------------------------------------------

/**
 * 生成五角星 SVG path。
 *
 * @param cx     中心 x
 * @param cy     中心 y
 * @param outerR 外半径（顶点到中心）
 * @param innerR 内半径（凹点到中心）
 */
function starPath(cx: number, cy: number, outerR: number, innerR: number): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2 // 从正上方开始
    const r = i % 2 === 0 ? outerR : innerR
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return points.join(' ') + ' Z'
}

// ---------------------------------------------------------------------------
// 眼睛渲染（根据状态变化）
// ---------------------------------------------------------------------------

/** 眼睛区域常量 */
const EYE_LX = 72 // 左眼中心 x
const EYE_RX = 128 // 右眼中心 x
const EYE_CY = 88 // 眼睛中心 y
const EYE_R = 26 // 眼白半径
const PUPIL_R = 13 // 瞳孔半径

/**
 * 根据状态渲染不同的眼睛表情。
 *
 * - idle / encouraging: 圆睁眼（idle 带眨眼动画）
 * - happy: ^_^ 弯月眼
 * - thinking: 眼睛看向一侧
 * - celebrating: 星星眼
 * - sleeping: 闭眼弧线
 */
function OwlEyes({ state }: { state: MascotState }): JSX.Element {
  switch (state) {
    case 'happy':
      // ^_^ — 上弯弧线（笑眼）
      return (
        <g className="mascot-eyes">
          <path
            d={`M ${EYE_LX - 14} ${EYE_CY + 2} Q ${EYE_LX} ${EYE_CY - 12} ${EYE_LX + 14} ${EYE_CY + 2}`}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={4}
            strokeLinecap="round"
          />
          <path
            d={`M ${EYE_RX - 14} ${EYE_CY + 2} Q ${EYE_RX} ${EYE_CY - 12} ${EYE_RX + 14} ${EYE_CY + 2}`}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={4}
            strokeLinecap="round"
          />
        </g>
      )

    case 'sleeping':
      // 闭眼 — 下弯弧线
      return (
        <g className="mascot-eyes">
          <path
            d={`M ${EYE_LX - 14} ${EYE_CY - 4} Q ${EYE_LX} ${EYE_CY + 8} ${EYE_LX + 14} ${EYE_CY - 4}`}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <path
            d={`M ${EYE_RX - 14} ${EYE_CY - 4} Q ${EYE_RX} ${EYE_CY + 8} ${EYE_RX + 14} ${EYE_CY - 4}`}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={3}
            strokeLinecap="round"
          />
        </g>
      )

    case 'thinking':
      // 眼睛看向右上方（瞳孔偏移）
      return (
        <g className="mascot-eyes">
          <circle cx={EYE_LX} cy={EYE_CY} r={EYE_R} fill="#FFFFFF" />
          <circle cx={EYE_RX} cy={EYE_CY} r={EYE_R} fill="#FFFFFF" />
          <circle cx={EYE_LX + 5} cy={EYE_CY - 3} r={PUPIL_R} fill="#1A1A1A" />
          <circle cx={EYE_RX + 5} cy={EYE_CY - 3} r={PUPIL_R} fill="#1A1A1A" />
          <circle cx={EYE_LX + 9} cy={EYE_CY - 7} r={5} fill="#FFFFFF" />
          <circle cx={EYE_RX + 9} cy={EYE_CY - 7} r={5} fill="#FFFFFF" />
        </g>
      )

    case 'celebrating':
      // 星星眼 — 金色五角星替代瞳孔
      return (
        <g className="mascot-eyes">
          <circle cx={EYE_LX} cy={EYE_CY} r={EYE_R} fill="#FFFFFF" />
          <circle cx={EYE_RX} cy={EYE_CY} r={EYE_R} fill="#FFFFFF" />
          <path
            d={starPath(EYE_LX, EYE_CY, PUPIL_R, 5)}
            fill="#FFD700"
            stroke="#D4A800"
            strokeWidth={0.8}
          />
          <path
            d={starPath(EYE_RX, EYE_CY, PUPIL_R, 5)}
            fill="#FFD700"
            stroke="#D4A800"
            strokeWidth={0.8}
          />
        </g>
      )

    default: {
      // idle / encouraging — 圆睁眼，idle 带眨眼动画
      const blinkClass = state === 'idle' ? ' mascot-eyes-blink' : ''
      return (
        <g className={`mascot-eyes${blinkClass}`}>
          <circle cx={EYE_LX} cy={EYE_CY} r={EYE_R} fill="#FFFFFF" />
          <circle cx={EYE_RX} cy={EYE_CY} r={EYE_R} fill="#FFFFFF" />
          <circle cx={EYE_LX} cy={EYE_CY} r={PUPIL_R} fill="#1A1A1A" />
          <circle cx={EYE_RX} cy={EYE_CY} r={PUPIL_R} fill="#1A1A1A" />
          <circle cx={EYE_LX + 5} cy={EYE_CY - 5} r={5} fill="#FFFFFF" />
          <circle cx={EYE_RX + 5} cy={EYE_CY - 5} r={5} fill="#FFFFFF" />
        </g>
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 内联样式
// ---------------------------------------------------------------------------

const MASCOT_CSS = `
/* === 容器定位 === */

.mascot-wrapper {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  z-index: 1000;
}

.mascot-bottom-right {
  position: fixed;
  bottom: 20px;
  right: 24px;
}

.mascot-bottom-left {
  position: fixed;
  bottom: 20px;
  left: 24px;
}

.mascot-inline {
  position: relative;
}

/* === 猫头鹰主体 === */

.mascot-owl {
  display: inline-block;
  cursor: default;
  user-select: none;
  line-height: 0;
}

.mascot-owl.mascot-clickable {
  cursor: pointer;
}

.mascot-owl-svg {
  display: block;
  transform-box: fill-box;
  transform-origin: center;
}

/* === 对话气泡 === */

.mascot-bubble {
  position: relative;
  background: var(--bg2, #FFFFFF);
  border: 2px solid #8B5E3C;
  border-radius: 14px;
  padding: 8px 14px;
  max-width: 200px;
  margin-bottom: 14px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: mascot-bubble-pop 0.3s cubic-bezier(0.2, 0.7, 0.2, 1.4);
}

.mascot-bubble-text {
  font-family: var(--serif, sans-serif);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink, #333);
  line-height: 1.4;
  text-align: center;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 气泡尾巴 — 外层棕色（边框色） */
.mascot-bubble::after {
  content: '';
  position: absolute;
  bottom: -12px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 12px solid transparent;
  border-right: 12px solid transparent;
  border-top: 12px solid #8B5E3C;
}

/* 气泡尾巴 — 内层白色（填充色），覆盖在棕色上形成边框效果 */
.mascot-bubble::before {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  border-top: 9px solid var(--bg2, #FFFFFF);
  z-index: 1;
}

@keyframes mascot-bubble-pop {
  0%   { transform: scale(0.6); opacity: 0; }
  100% { transform: scale(1);   opacity: 1; }
}

/* === 状态动画 === */

/* idle — 偶尔眨眼 */
.mascot-state-idle .mascot-eyes-blink {
  transform-box: fill-box;
  transform-origin: center;
  animation: mascot-blink 4.5s infinite;
}

@keyframes mascot-blink {
  0%, 90%, 100% { transform: scaleY(1); }
  94%, 96%      { transform: scaleY(0.1); }
}

/* happy — 跳跃 */
.mascot-state-happy .mascot-owl-svg {
  animation: mascot-bounce 0.5s ease-in-out infinite;
}

@keyframes mascot-bounce {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-12px); }
}

/* thinking — 歪头 + 思考点 */
.mascot-state-thinking .mascot-owl-svg {
  animation: mascot-tilt 2.5s ease-in-out infinite;
}

@keyframes mascot-tilt {
  0%, 100% { transform: rotate(-6deg); }
  50%      { transform: rotate(-11deg); }
}

.mascot-thinking-dots .dot {
  transform-box: fill-box;
  transform-origin: center;
  animation: mascot-dot-bounce 1.2s ease-in-out infinite;
}

.mascot-thinking-dots .dot-1 { animation-delay: 0s; }
.mascot-thinking-dots .dot-2 { animation-delay: 0.2s; }
.mascot-thinking-dots .dot-3 { animation-delay: 0.4s; }

@keyframes mascot-dot-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%           { transform: translateY(-5px); opacity: 1; }
}

/* encouraging — 翅膀举起 + 轻微脉动 */
.mascot-state-encouraging .mascot-owl-svg {
  animation: mascot-pulse 0.8s ease-in-out infinite;
}

@keyframes mascot-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}

.mascot-state-encouraging .mascot-wing-left {
  transform-box: fill-box;
  transform-origin: 80% 90%;
  animation: mascot-wing-left-up 0.5s ease-in-out infinite alternate;
}

.mascot-state-encouraging .mascot-wing-right {
  transform-box: fill-box;
  transform-origin: 20% 90%;
  animation: mascot-wing-right-up 0.5s ease-in-out infinite alternate;
}

@keyframes mascot-wing-left-up {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(-28deg); }
}

@keyframes mascot-wing-right-up {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(28deg); }
}

/* celebrating — 旋转跳跃 + 星星闪烁 */
.mascot-state-celebrating .mascot-owl-svg {
  animation: mascot-celebrate 1s ease-in-out infinite;
}

@keyframes mascot-celebrate {
  0%   { transform: rotate(0deg)   translateY(0); }
  25%  { transform: rotate(-12deg) translateY(-14px); }
  50%  { transform: rotate(0deg)   translateY(-18px); }
  75%  { transform: rotate(12deg)  translateY(-14px); }
  100% { transform: rotate(0deg)   translateY(0); }
}

.mascot-stars .star {
  transform-box: fill-box;
  transform-origin: center;
  animation: mascot-star-twinkle 0.8s ease-in-out infinite;
}

.mascot-stars .star-1 { animation-delay: 0s; }
.mascot-stars .star-2 { animation-delay: 0.12s; }
.mascot-stars .star-3 { animation-delay: 0.24s; }
.mascot-stars .star-4 { animation-delay: 0.36s; }
.mascot-stars .star-5 { animation-delay: 0.48s; }

@keyframes mascot-star-twinkle {
  0%, 100% { transform: scale(0.5) rotate(0deg);   opacity: 0.4; }
  50%      { transform: scale(1.2) rotate(180deg); opacity: 1; }
}

/* sleeping — 轻柔呼吸 */
.mascot-state-sleeping .mascot-owl-svg {
  animation: mascot-breathe 3s ease-in-out infinite;
}

@keyframes mascot-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}

.mascot-zzz .z {
  transform-box: fill-box;
  transform-origin: center;
  animation: mascot-zzz-float 2.5s ease-in-out infinite;
  opacity: 0;
  font-family: var(--serif, sans-serif);
  font-weight: bold;
}

.mascot-zzz .z-1 { animation-delay: 0s; }
.mascot-zzz .z-2 { animation-delay: 0.7s; }
.mascot-zzz .z-3 { animation-delay: 1.4s; }

@keyframes mascot-zzz-float {
  0%   { transform: translate(0, 4px) scale(0.8); opacity: 0; }
  30%  { opacity: 1; }
  100% { transform: translate(6px, -12px) scale(1.1); opacity: 0; }
}

/* === 减少动效偏好 === */

@media (prefers-reduced-motion: reduce) {
  .mascot-owl-svg,
  .mascot-eyes-blink,
  .mascot-wing-left,
  .mascot-wing-right,
  .mascot-thinking-dots .dot,
  .mascot-zzz .z,
  .mascot-stars .star,
  .mascot-bubble {
    animation: none !important;
  }
}
`

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

/**
 * 吉祥物"欧拉"猫头鹰 — SVG 绘制的陪伴角色。
 *
 * 通过 state 控制表情与动画，通过 message 显示对话气泡。
 * 当 message 为 undefined 时自动使用 ageLevel 适配的默认文案；
 * 当 message 为空字符串时不显示气泡。
 */
export function Mascot({
  state = 'idle',
  size = 120,
  message,
  ageLevel = 'kids',
  position = 'inline',
  onClick,
}: MascotProps): JSX.Element {
  // message 为 undefined 时使用默认文案；为空字符串时不显示气泡
  const effectiveMessage = message ?? getMascotMessage(state, ageLevel)
  const showBubble = effectiveMessage.length > 0

  const wrapperClass = ['mascot-wrapper', `mascot-${position}`].join(' ')

  const owlClass = ['mascot-owl', `mascot-state-${state}`, onClick ? 'mascot-clickable' : ''].join(
    ' ',
  )

  return (
    <>
      <style>{MASCOT_CSS}</style>
      <div className={wrapperClass}>
        {showBubble && (
          <div className="mascot-bubble" role="status">
            <div className="mascot-bubble-text">{effectiveMessage}</div>
          </div>
        )}
        <div
          className={owlClass}
          onClick={onClick}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : undefined}
          aria-label={onClick ? '欧拉猫头鹰' : undefined}
          onKeyDown={
            onClick
              ? e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onClick()
                  }
                }
              : undefined
          }
        >
          <svg
            className="mascot-owl-svg"
            width={size}
            height={size}
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* === 庆祝星星粒子（celebrating 状态） === */}
            {state === 'celebrating' && (
              <g className="mascot-stars">
                <path d={starPath(28, 55, 9, 3.5)} fill="#FFD700" className="star star-1" />
                <path d={starPath(172, 65, 10, 4)} fill="#FF6B6B" className="star star-2" />
                <path d={starPath(35, 160, 7, 3)} fill="#4ECDC4" className="star star-3" />
                <path d={starPath(168, 150, 9, 3.5)} fill="#FFD700" className="star star-4" />
                <path d={starPath(100, 12, 8, 3)} fill="#A78BFA" className="star star-5" />
              </g>
            )}

            {/* === 耳簇 === */}
            <path d="M 58 42 L 40 16 L 80 34 Z" fill="#8B5E3C" />
            <path d="M 142 42 L 160 16 L 120 34 Z" fill="#8B5E3C" />

            {/* === 翅膀（身体两侧） === */}
            <ellipse className="mascot-wing-left" cx={35} cy={122} rx={18} ry={38} fill="#704830" />
            <ellipse
              className="mascot-wing-right"
              cx={165}
              cy={122}
              rx={18}
              ry={38}
              fill="#704830"
            />

            {/* === 身体 === */}
            <ellipse cx={100} cy={112} rx={70} ry={75} fill="#8B5E3C" />

            {/* === 腹部（浅色） === */}
            <ellipse cx={100} cy={130} rx={46} ry={50} fill="#C9A57B" />

            {/* === 脚 === */}
            <ellipse cx={82} cy={190} rx={13} ry={6} fill="#FFB347" />
            <ellipse cx={118} cy={190} rx={13} ry={6} fill="#FFB347" />

            {/* === 腮红 === */}
            <circle cx={48} cy={112} r={7} fill="#E8A0A0" opacity={0.45} />
            <circle cx={152} cy={112} r={7} fill="#E8A0A0" opacity={0.45} />

            {/* === 眼睛（根据状态变化） === */}
            <OwlEyes state={state} />

            {/* === 嘴（金色三角） === */}
            <path
              d="M 100 102 L 89 120 L 111 120 Z"
              fill="#FFD700"
              stroke="#D4A800"
              strokeWidth={1}
              strokeLinejoin="round"
            />

            {/* === 思考点（thinking 状态） === */}
            {state === 'thinking' && (
              <g className="mascot-thinking-dots">
                <circle cx={84} cy={28} r={4} fill="#8B5E3C" className="dot dot-1" />
                <circle cx={100} cy={22} r={5} fill="#8B5E3C" className="dot dot-2" />
                <circle cx={116} cy={28} r={4} fill="#8B5E3C" className="dot dot-3" />
              </g>
            )}

            {/* === 睡眠 Zzz（sleeping 状态） === */}
            {state === 'sleeping' && (
              <g className="mascot-zzz">
                <text x={130} y={48} fontSize={14} fill="#8B5E3C" className="z z-1">
                  z
                </text>
                <text x={142} y={38} fontSize={18} fill="#8B5E3C" className="z z-2">
                  z
                </text>
                <text x={156} y={24} fontSize={22} fill="#8B5E3C" className="z z-3">
                  Z
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </>
  )
}

export default Mascot
