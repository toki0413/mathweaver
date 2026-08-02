import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { useStore, initBackendUrl } from './stores/sessionStore'
import { CayleyTable } from './components/CayleyTable'
import { FourFieldDashboard } from './components/FourFieldDashboard'
import { ChatPanel } from './components/ChatPanel'
import { DagGraph } from './components/DagGraph'
import { RadialGauge, MasteryRadar, DifficultyGauge } from './components/Gauges'
import { ConjectureTimeline } from './components/ConjectureTimeline'
import { AgentFlow } from './components/AgentFlow'
import { GroupOperationVisualizer } from './components/GroupOperationVisualizer'
import { AchievementSystem } from './components/AchievementSystem'
import { SettingsPanel } from './components/SettingsPanel'
import { OnboardingOverlay } from './components/OnboardingOverlay'
import { MATHWEAVER_COACH_STEPS } from './components/CoachMarks'
import { ErrorBanner } from './components/ErrorBanner'
import { ToastSystem, type ToastItem } from './components/ToastSystem'
import { CommandPalette, type CommandAction } from './components/CommandPalette'
import { VoiceInput } from './components/VoiceInput'
import { MathSymbolPalette } from './components/MathSymbolPalette'
import { CollapsibleSection } from './components/CollapsibleSection'
import { ShortcutsOverlay, type ShortcutItem } from './components/ShortcutsOverlay'
import { OperationStepVisualizer } from './components/OperationStepVisualizer'
import { GuidedDiscoveryPanel } from './components/GuidedDiscoveryPanel'
import { AgeSelector } from './components/AgeSelector'
import { StreakBadge, useStreak } from './components/StreakBadge'
import { Mascot } from './components/Mascot'
import type { MascotState } from './components/Mascot'
import { soundSystem } from './utils/sound'
import type { AgeLevel } from './utils/ageAdapt'
import {
  ChatIcon,
  FlameIcon,
  ProofIcon,
  GraphIcon,
  ModelIcon,
  SettingsIcon,
  KeyboardIcon,
  type IconProps,
} from './components/Icons'

// --- Code-split heavy / mode-specific / collapsed-section components ---
// These are only loaded when actually rendered (mode switch or section expand),
// significantly reducing initial JS transfer in dev mode.
const AIContentPanel = lazy(() =>
  import('./components/AIContentPanel').then(m => ({ default: m.default })),
)
const GrillPanel = lazy(() =>
  import('./components/GrillPanel').then(m => ({ default: m.GrillPanel })),
)
const ProofPanel = lazy(() =>
  import('./components/ProofPanel').then(m => ({ default: m.ProofPanel })),
)
const SymmetryGroup3D = lazy(() =>
  import('./components/SymmetryGroup3D').then(m => ({ default: m.SymmetryGroup3D })),
)
const EyeTrackingPanel = lazy(() =>
  import('./components/EyeTrackingPanel').then(m => ({ default: m.EyeTrackingPanel })),
)
const ManimPlayer = lazy(() =>
  import('./components/ManimPlayer').then(m => ({ default: m.ManimPlayer })),
)
const PatternBuilder = lazy(() =>
  import('./components/PatternBuilder').then(m => ({ default: m.PatternBuilder })),
)
const WhiteboardPad = lazy(() =>
  import('./components/WhiteboardPad').then(m => ({ default: m.WhiteboardPad })),
)
const InteractiveExplorer = lazy(() =>
  import('./components/InteractiveExplorer').then(m => ({ default: m.InteractiveExplorer })),
)
const FlashcardSystem = lazy(() =>
  import('./components/FlashcardSystem').then(m => ({ default: m.FlashcardSystem })),
)
const FormulaLiveEditor = lazy(() =>
  import('./components/FormulaLiveEditor').then(m => ({ default: m.FormulaLiveEditor })),
)
const ImageInput = lazy(() =>
  import('./components/ImageInput').then(m => ({ default: m.ImageInput })),
)
const VisualStepSolver = lazy(() =>
  import('./components/VisualStepSolver').then(m => ({ default: m.VisualStepSolver })),
)
const CurriculumMapper = lazy(() =>
  import('./components/CurriculumMapper').then(m => ({ default: m.CurriculumMapper })),
)
const StudentPlayground = lazy(() =>
  import('./components/StudentPlayground').then(m => ({ default: m.StudentPlayground })),
)
const ModelingLab = lazy(() =>
  import('./components/ModelingLab').then(m => ({ default: m.ModelingLab })),
)

// --- Structuralism & New Math inspired components (code-split for lazy loading) ---
const WarmupPuzzles = lazy(() =>
  import('./components/WarmupPuzzles').then(m => ({ default: m.WarmupPuzzles })),
)
const RubiksCubeGroup = lazy(() =>
  import('./components/RubiksCubeGroup').then(m => ({ default: m.RubiksCubeGroup })),
)
const ProblemInvention = lazy(() =>
  import('./components/ProblemInvention').then(m => ({ default: m.ProblemInvention })),
)

// Type-only import for the Step type (erased at compile time, no runtime cost)
import type { Step as SolverStep } from './components/VisualStepSolver'

type Mode = 'chat' | 'grill' | 'proof' | 'dag' | 'modeling'

const MODE_TABS: { id: Mode; label: string; icon: React.FC<IconProps> }[] = [
  { id: 'chat', label: '对话', icon: ChatIcon },
  { id: 'grill', label: '挑战', icon: FlameIcon },
  { id: 'proof', label: '证明', icon: ProofIcon },
  { id: 'dag', label: '知识地图', icon: GraphIcon },
  { id: 'modeling', label: '建模', icon: ModelIcon },
]

const presetTables: Record<string, { table: number[][]; size: number }> = {
  z3: {
    table: [
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
    ],
    size: 3,
  },
  klein: {
    table: [
      [0, 1, 2, 3],
      [1, 0, 3, 2],
      [2, 3, 0, 1],
      [3, 2, 1, 0],
    ],
    size: 4,
  },
  s3: {
    table: [
      [0, 1, 2, 3, 4, 5],
      [1, 0, 4, 5, 2, 3],
      [2, 5, 0, 4, 3, 1],
      [3, 4, 5, 0, 1, 2],
      [4, 3, 1, 2, 5, 0],
      [5, 2, 3, 1, 0, 4],
    ],
    size: 6,
  },
  'non-group': {
    table: [
      [0, 1, 2],
      [1, 0, 1],
      [2, 1, 0],
    ],
    size: 3,
  },
  'non-assoc': {
    table: [
      [0, 1, 2],
      [1, 1, 0],
      [2, 0, 2],
    ],
    size: 3,
  },
}

function makeIdentityTable(n: number): number[][] {
  const t: number[][] = []
  for (let i = 0; i < n; i++) {
    t.push([])
    for (let j = 0; j < n; j++) {
      t[i].push((i + j) % n)
    }
  }
  return t
}

export default function App() {
  const startSession = useStore(s => s.startSession)
  const sendInput = useStore(s => s.sendInput)
  const sessionId = useStore(s => s.sessionId)
  const loading = useStore(s => s.loading)
  const fourFields = useStore(s => s.fourFields)
  const decision = useStore(s => s.decision)
  const phaseTrace = useStore(s => s.phaseTrace)
  const visualData = useStore(s => s.visualData)
  const backendReady = useStore(s => s.backendReady)
  const checkBackend = useStore(s => s.checkBackend)
  const fetchDagNodes = useStore(s => s.fetchDagNodes)
  const dagNodes = useStore(s => s.dagNodes)
  const saveSession = useStore(s => s.saveSession)
  const loadSession = useStore(s => s.loadSession)
  const checkOnboarding = useStore(s => s.checkOnboarding)
  const onboardingCompleted = useStore(s => s.onboardingCompleted)
  const chat = useStore(s => s.chat)
  const grillState = useStore(s => s.grillState)
  const proofState = useStore(s => s.proofState)
  const llmConfig = useStore(s => s.llmConfig)

  const [tableSize, setTableSize] = useState(3)
  const [table, setTable] = useState<number[][]>([
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ])
  const [textInput, setTextInput] = useState('')
  const [selectedNode, setSelectedNode] = useState('group_definition')
  const [studentId, setStudentId] = useState(`student_${Date.now().toString().slice(-6)}`)
  const [inputStartTime, setInputStartTime] = useState<number>(Date.now())
  const [appVersion, setAppVersion] = useState('')
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const [mode, setMode] = useState<Mode>('chat')
  const [symmetryGroup, setSymmetryGroup] = useState<'S4' | 'A5'>('S4')
  const initialized = useRef(false)

  // --- Cross-component highlight state (OperationStepVisualizer → CayleyTable) ---
  const [highlightCell, setHighlightCell] = useState<{
    row: number
    col: number
    type: 'computation' | 'identity' | 'symmetry'
  } | null>(null)
  // --- Verification animation trigger (incremented to re-trigger CayleyTable sweep) ---
  const [verifyTrigger, setVerifyTrigger] = useState(0)
  // --- Age level for adaptive content (kids/tweens/teens) ---
  const [ageLevel, setAgeLevel] = useState<AgeLevel>('kids')
  // --- Color mode for CayleyTable (student-friendly color visualization) ---
  const [colorMode, setColorMode] = useState(false)

  // --- Daily learning streak (records activity for the StreakBadge) ---
  const { recordActivity } = useStreak()

  // --- Guided discovery progress (GuidedDiscoveryPanel → AchievementSystem) ---
  const [guidedMissionsCompleted, setGuidedMissionsCompleted] = useState(0)
  const [guidedStarsCollected, setGuidedStarsCollected] = useState(0)
  const [guidedModesCompleted, setGuidedModesCompleted] = useState(0)
  const handleGuidedProgress = useCallback((completed: number, stars: number, modes: number) => {
    setGuidedMissionsCompleted(completed)
    setGuidedStarsCollected(stars)
    setGuidedModesCompleted(modes)
  }, [])

  // --- Toast notification state ---
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts(prev => [...prev, { ...toast, id }])
  }, [])
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // --- Voice input handler: append final transcripts to text input ---
  const handleVoiceTranscript = useCallback((text: string, isFinal: boolean) => {
    if (isFinal && text.trim()) {
      setTextInput(prev => {
        const trimmed = prev.trimEnd()
        return trimmed + (trimmed ? ' ' : '') + text.trim()
      })
      setInputStartTime(Date.now())
    }
  }, [])

  // --- Math symbol insert handler ---
  const handleSymbolInsert = useCallback((symbol: string, latex?: string) => {
    setTextInput(prev => {
      const insert = latex ?? symbol
      return prev + insert
    })
    setInputStartTime(Date.now())
  }, [])

  // --- InteractiveExplorer group change handler (deduped via ref) ---
  const lastGroupInfo = useRef<string>('')
  const handleGroupChange = useCallback(
    (info: {
      type: string
      order: number
      isGroup: boolean
      isAbelian: boolean
      identity: number | null
    }) => {
      const key = `${info.type}-${info.order}-${info.isGroup}-${info.isAbelian}`
      if (key === lastGroupInfo.current) return
      lastGroupInfo.current = key
      if (info.isGroup && info.isAbelian) {
        addToast({
          type: 'info',
          title: '群性质检测',
          message: `${info.type}（阶 ${info.order}）是交换群`,
          duration: 3000,
        })
      }
    },
    [addToast],
  )

  // --- Formula editor insert handler ---
  const handleFormulaInsert = useCallback(
    (latex: string) => {
      setTextInput(prev => prev + (prev ? '\n' : '') + `$$${latex}$$`)
      setInputStartTime(Date.now())
      addToast({
        type: 'info',
        title: '公式已插入',
        message: 'LaTeX 已添加到输入框',
        duration: 2500,
      })
    },
    [addToast],
  )

  // --- Discovery moment handler (CayleyTable / StudentPlayground → mascot + toast) ---
  const discoveryMessages: Record<string, { title: string; message: string }> = useMemo(() => {
    const isKids = ageLevel === 'kids'
    return {
      closure: isKids
        ? { title: '🎉 发现啦！', message: '所有数字都没跑出去！这就是「闭合性」' }
        : { title: '闭合性满足', message: '运算表所有结果都在有效范围内' },
      associativity: isKids
        ? { title: '🎉 发现啦！', message: '谁先谁后结果都一样！这就是「结合律」' }
        : { title: '结合律满足', message: '(a∗b)∗c = a∗(b∗c) 对所有元素成立' },
      identity: isKids
        ? { title: '🎉 发现啦！', message: '找到老大了！碰了它不会变！这就是「单位元」' }
        : { title: '单位元发现', message: '存在元素 e 使 e∗a = a∗e = a' },
      inverses: isKids
        ? { title: '🎉 发现啦！', message: '每个人都有好搭档！碰一碰就变老大！这就是「逆元」' }
        : { title: '逆元完备', message: '每个元素都存在逆元' },
      commutativity: isKids
        ? { title: '🎉 发现啦！', message: '换位置碰结果也一样！这就是「交换律」' }
        : { title: '交换律满足', message: 'a∗b = b∗a 对所有元素成立' },
    }
  }, [ageLevel])

  const handleDiscovery = useCallback(
    (property: string, _ageLevel?: AgeLevel) => {
      const msg = discoveryMessages[property]
      if (msg) {
        addToast({
          type: 'achievement',
          title: msg.title,
          message: msg.message,
          duration: 5000,
        })
        soundSystem.play('star')
        setMascotState('celebrating')
        setMascotMessage(ageLevel === 'kids' ? '你太厉害了！🎉' : '发现新性质！')
        setTimeout(() => {
          setMascotState('idle')
          setMascotMessage(undefined)
        }, 3000)
      }
    },
    [discoveryMessages, addToast, ageLevel],
  )

  // --- Shortcuts overlay state ---
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // --- Visual Step Solver state ---
  const [solverProblem, setSolverProblem] = useState('')
  const [solverSteps, setSolverSteps] = useState<SolverStep[] | undefined>(undefined)

  // --- Mascot state ---
  const [mascotState, setMascotState] = useState<MascotState>('idle')
  const [mascotMessage, setMascotMessage] = useState<string | undefined>(undefined)

  // --- Sound-enabled flag (persisted) ---
  const [soundEnabled, setSoundEnabled] = useState(true)

  // Sync sound system
  useEffect(() => {
    soundSystem.setEnabled(soundEnabled)
  }, [soundEnabled])

  // Age-aware mascot messages
  const mascotMoods = useMemo(() => {
    if (ageLevel === 'kids') {
      return {
        welcome: '嗨！我是欧拉猫头鹰！一起来玩魔法密码表吧！🦉',
        idle: '有什么不懂的随时问我哦！',
        encouraging: '你可以的！再试一次！',
        celebrating: '太棒了！你真厉害！🎉',
      }
    } else if (ageLevel === 'tweens') {
      return {
        welcome: '欢迎回来！继续探索群论吧。',
        idle: '有问题随时提问。',
        encouraging: '差一点了，换个思路试试。',
        celebrating: '做得好！继续保持。',
      }
    }
    return {
      welcome: 'Ready to explore.',
      idle: 'Ask if you need help.',
      encouraging: 'Try a different approach.',
      celebrating: 'Well done.',
    }
  }, [ageLevel])

  // Update mascot on backend status change
  useEffect(() => {
    if (backendReady) {
      setMascotMessage(mascotMoods.welcome)
      setMascotState('happy')
      soundSystem.play('unlock')
      const timer = setTimeout(() => {
        setMascotState('idle')
        setMascotMessage(undefined)
      }, 4000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [backendReady, mascotMoods.welcome])

  // Play sound on toast milestones
  useEffect(() => {
    if (toasts.length > 0) {
      const latest = toasts[toasts.length - 1]
      if (latest.type === 'achievement') soundSystem.play('celebrate')
      else if (latest.type === 'milestone') soundSystem.play('star')
    }
  }, [toasts])

  // Play sound on proof completion
  useEffect(() => {
    const isComplete = proofState.currentResult?.is_complete ?? false
    if (isComplete) {
      soundSystem.play('complete')
      setMascotState('celebrating')
      setMascotMessage(mascotMoods.celebrating)
      const timer = setTimeout(() => {
        setMascotState('idle')
        setMascotMessage(undefined)
      }, 3000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [proofState.currentResult?.is_complete, mascotMoods.celebrating])

  // Kids mode: hide advanced sections
  const isKidsMode = ageLevel === 'kids'

  const shortcuts: ShortcutItem[] = useMemo(
    () => [
      { keys: ['⌘', 'K'], description: '打开命令面板', category: '全局' },
      { keys: ['?'], description: '查看键盘快捷键', category: '全局' },
      { keys: ['Esc'], description: '关闭弹窗 / 浮层', category: '全局' },
      { keys: ['1'], description: '切换到对话模式', category: '导航' },
      { keys: ['2'], description: '切换到面试模式', category: '导航' },
      { keys: ['3'], description: '切换到证明模式', category: '导航' },
      { keys: ['4'], description: '切换到图谱模式', category: '导航' },
      { keys: ['Enter'], description: '发送消息', category: '输入' },
      { keys: ['Shift', 'Enter'], description: '换行', category: '输入' },
      { keys: ['⌘', '/'], description: '打开数学符号面板', category: '输入' },
      { keys: ['Ctrl', 'Enter'], description: '提交证明验证', category: '证明' },
      { keys: ['←', '→'], description: '闪卡翻页', category: '复习' },
      { keys: ['Space'], description: '翻转闪卡', category: '复习' },
    ],
    [],
  )

  // --- Number key mode switching (1-4), ignores input/textarea focus ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const map: Record<string, Mode> = { '1': 'chat', '2': 'grill', '3': 'proof', '4': 'dag' }
      const m = map[e.key]
      if (m) {
        e.preventDefault()
        setMode(m)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const init = async () => {
      await initBackendUrl()
      if (window.api) {
        try {
          const id = await Promise.race([
            window.api.invoke('student:get-id'),
            new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
          ])
          if (typeof id === 'string' && id.trim()) setStudentId(id.trim())
        } catch {
          // 保留默认生成的 studentId
        }
      }
      await checkBackend()
      await fetchDagNodes()
      await checkOnboarding()
      setOnboardingChecked(true)
    }
    init()
  }, [])

  const isMockMode = !llmConfig || (llmConfig.provider || '').toLowerCase() === 'mock'
  const [mockBannerDismissed, setMockBannerDismissed] = useState(false)

  useEffect(() => {
    if (onboardingChecked && !onboardingCompleted) {
      setOnboardingOpen(true)
    }
  }, [onboardingChecked, onboardingCompleted])

  useEffect(() => {
    if (backendReady && !sessionId) {
      startSession(studentId, selectedNode)
    }
  }, [backendReady])

  useEffect(() => {
    if (!window.api) return

    const cleanupSave = window.api.on('menu:save-session', async () => {
      const path = await saveSession()
      if (path) {
        setSaveStatus(`已保存: ${path}`)
        setTimeout(() => setSaveStatus(null), 3000)
      }
    })

    const cleanupLoad = window.api.on('menu:load-session', async () => {
      const ok = await loadSession()
      if (ok) {
        setSaveStatus('会话已加载')
        setTimeout(() => setSaveStatus(null), 3000)
      }
    })

    const cleanupOpenSettings = window.api.on('menu:open-settings', () => setSettingsOpen(true))
    const cleanupOpenOnboarding = window.api.on('menu:open-onboarding', () =>
      setOnboardingOpen(true),
    )

    window.api
      .getAppInfo()
      .then((info: Record<string, unknown>) => {
        if (info && 'version' in info && typeof info.version === 'string') {
          setAppVersion(info.version)
        }
      })
      .catch(() => {})

    return () => {
      cleanupSave()
      cleanupLoad()
      cleanupOpenSettings()
      cleanupOpenOnboarding()
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => checkBackend(), 15000)
    return () => clearInterval(interval)
  }, [])

  // --- Toast triggers: proof completion ---
  const prevProofComplete = useRef(false)
  useEffect(() => {
    const isComplete = proofState.currentResult?.is_complete ?? false
    if (isComplete && !prevProofComplete.current) {
      addToast({
        type: 'achievement',
        title: '证明完成！',
        message: `${proofState.currentResult?.theorem_name ?? '定理'} 验证通过`,
        icon: 'TrophyIcon',
        duration: 6000,
      })
    }
    prevProofComplete.current = isComplete
  }, [proofState.currentResult, addToast])

  // --- Toast triggers: grill streak milestones ---
  const prevStreak = useRef(0)
  useEffect(() => {
    const streak = grillState.summary?.adaptive.streak_correct ?? 0
    if (streak > prevStreak.current && (streak === 3 || streak === 5 || streak === 10)) {
      const titles: Record<number, string> = { 3: '三连胜！', 5: '五连胜！', 10: '十连胜！' }
      addToast({
        type: 'milestone',
        title: titles[streak] ?? `${streak} 连胜`,
        message: '保持节奏，继续挑战',
        icon: streak >= 10 ? 'CrownIcon' : 'SparkleIcon',
        duration: 5000,
      })
    }
    prevStreak.current = streak
  }, [grillState.summary, addToast])

  const handleSendTable = useCallback(() => {
    const rt = Date.now() - inputStartTime
    sendInput(JSON.stringify(table), rt)
    setInputStartTime(Date.now())
  }, [table, sendInput, inputStartTime])

  const handleSendText = useCallback(() => {
    if (!textInput.trim()) return
    recordActivity()
    const rt = Date.now() - inputStartTime
    sendInput(textInput, rt)
    setTextInput('')
    setInputStartTime(Date.now())
  }, [textInput, sendInput, inputStartTime, recordActivity])

  const handleTableChange = useCallback((row: number, col: number, value: number) => {
    setTable(prev => {
      const next = prev.map(r => [...r])
      next[row][col] = value
      return next
    })
    soundSystem.play('click')
  }, [])

  const handleResize = useCallback((n: number) => {
    setTableSize(n)
    setTable(makeIdentityTable(n))
  }, [])

  // --- Command palette command list (defined after handleSendTable) ---
  const commands: CommandAction[] = useMemo(
    () => [
      {
        id: 'nav-chat',
        label: '切换到对话模式',
        icon: 'ChatIcon',
        section: 'navigation',
        action: () => setMode('chat'),
      },
      {
        id: 'nav-grill',
        label: '切换到面试模式',
        icon: 'FlameIcon',
        section: 'navigation',
        action: () => setMode('grill'),
      },
      {
        id: 'nav-proof',
        label: '切换到证明模式',
        icon: 'ProofIcon',
        section: 'navigation',
        action: () => setMode('proof'),
      },
      {
        id: 'nav-dag',
        label: '切换到图谱模式',
        icon: 'GraphIcon',
        section: 'navigation',
        action: () => setMode('dag'),
      },
      {
        id: 'nav-modeling',
        label: '切换到建模模式',
        icon: 'ModelIcon',
        section: 'navigation',
        action: () => setMode('modeling'),
      },
      {
        id: 'act-settings',
        label: '打开设置',
        icon: 'SettingsIcon',
        hint: '⌘,',
        section: 'action',
        action: () => setSettingsOpen(true),
      },
      {
        id: 'act-onboarding',
        label: '查看新手引导',
        icon: 'BookIcon',
        section: 'action',
        action: () => setOnboardingOpen(true),
      },
      {
        id: 'act-submit',
        label: '提交运算表',
        icon: 'CheckIcon',
        section: 'action',
        action: handleSendTable,
      },
      {
        id: 'act-clear',
        label: '清空对话记录',
        icon: 'TrashIcon',
        section: 'action',
        action: () => useStore.getState().clearChat(),
      },
      {
        id: 'help-shortcuts',
        label: '键盘快捷键',
        icon: 'KeyboardIcon',
        hint: '?',
        section: 'help',
        action: () => setShortcutsOpen(true),
      },
      {
        id: 'help-about',
        label: '关于 MathWeaver',
        icon: 'InfoIcon',
        section: 'help',
        action: () =>
          addToast({
            type: 'info',
            title: 'MathWeaver',
            message: `${appVersion ? `v${appVersion} · ` : ''}多智能体数学认知操作系统 · 7 语言支持 · OCR 识别`,
            duration: 6000,
          }),
      },
    ],
    [setMode, setSettingsOpen, setOnboardingOpen, handleSendTable, addToast, appVersion],
  )

  const handleNodeSelect = useCallback(
    (id: string) => {
      if (chat.length > 0) {
        if (!window.confirm('切换学习目标会清空当前对话，确定继续吗？')) return
      }
      setSelectedNode(id)
      if (backendReady) startSession(studentId, id)
    },
    [backendReady, startSession, studentId, chat],
  )

  const loadPreset = useCallback((preset: string) => {
    const p = presetTables[preset]
    if (p) {
      setTable(p.table)
      setTableSize(p.size)
    }
  }, [])

  const handleDecisionAction = useCallback((action: string) => {
    switch (action) {
      case 'review_prerequisites':
        setMode('dag')
        break
      case 'reduce_difficulty':
        setMode('grill')
        break
      case 'pause':
        setSaveStatus('已暂停 — 随时可以继续')
        setTimeout(() => setSaveStatus(null), 3000)
        break
      default:
        break
    }
  }, [])

  return (
    <div className={`app ${ageLevel === 'kids' ? 'theme-kids' : ''}`}>
      <header className="header">
        <div>
          <h1>MathWeaver</h1>
          <div className="subtitle">
            多智能体数学认知操作系统{appVersion ? ` · v${appVersion}` : ''}
          </div>
        </div>
        <div className="header-right">
          <StreakBadge compact />
          <AgeSelector level={ageLevel} onChange={setAgeLevel} compact />
          <span style={{ width: 6 }} />
          <button
            className="icon-btn"
            onClick={() => setShortcutsOpen(true)}
            aria-label="快捷键"
            title="键盘快捷键 (?)"
            style={{ marginRight: '6px' }}
          >
            <KeyboardIcon size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="设置"
            title="设置 (⌘,)"
            style={{ marginRight: '6px' }}
          >
            <SettingsIcon size={14} />
          </button>
          {isMockMode && (
            <button
              className="settings-alert-btn"
              onClick={() => setSettingsOpen(true)}
              title="配置 API"
            >
              配置 API
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label="音效开关"
            title={soundEnabled ? '关闭音效' : '开启音效'}
            style={{ marginRight: '6px' }}
          >
            <span style={{ fontSize: '14px' }}>{soundEnabled ? '🔊' : '🔇'}</span>
          </button>
          <div className={`backend-status ${backendReady ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {backendReady ? '就绪' : '正在初始化'}
          </div>
        </div>
      </header>

      {isMockMode && backendReady && !mockBannerDismissed && onboardingCompleted && (
        <div className="mock-banner">
          <span className="mock-banner-icon">⚠</span>
          <span className="mock-banner-text">
            当前为演示模式，AI 回复为示例内容。请在设置中配置 API Key 以获得真实教学。
          </span>
          <button className="mock-banner-btn" onClick={() => setSettingsOpen(true)}>
            去配置
          </button>
          <button
            className="mock-banner-close"
            onClick={() => setMockBannerDismissed(true)}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
      )}

      <nav className="mode-nav" role="tablist" aria-label="模式切换">
        {MODE_TABS.map(tab => {
          const TabIcon = tab.icon
          return (
            <button
              key={tab.id}
              className={`mode-tab ${mode === tab.id ? 'active' : ''}`}
              role="tab"
              aria-selected={mode === tab.id}
              onClick={() => setMode(tab.id)}
            >
              <TabIcon size={14} className="tab-icon" />
              {tab.label}
            </button>
          )
        })}
      </nav>

      {saveStatus && <div className="save-status-bar">{saveStatus}</div>}

      {!backendReady && (
        <div className="backend-warning">
          <div className="spinner" style={{ width: '12px', height: '12px' }} />
          正在初始化...
        </div>
      )}

      <Suspense
        fallback={
          <div
            className="lazy-loading-fallback"
            style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}
          >
            加载中…
          </div>
        }
      >
        {/* ========== Chat Mode ========== */}
        {mode === 'chat' && (
          <div className="main-grid mode-enter" key="chat-mode">
            <div className="main-col">
              {/* --- Daily Warm-up Puzzle --- */}
              <div className="section-group">
                <div className="section-group-label">今日热身</div>
                <CollapsibleSection
                  title={isKidsMode ? '🧩 每日脑力热身' : '每日热身谜题'}
                  hint="逻辑 · 物理 · 数学 · 语言"
                  defaultOpen={true}
                >
                  <p className="desc">
                    {isKidsMode
                      ? '每天一道有趣的脑筋急转弯！先自己想想，再看提示和答案。'
                      : '承结构主义传统：每堂课以热身谜题开场，训练代数思维所需的底层能力。'}
                  </p>
                  <WarmupPuzzles ageLevel={ageLevel} />
                </CollapsibleSection>
              </div>

              {/* --- Primary: Conversation --- */}
              <div className="section-group">
                <div className="section-group-label">对话</div>
                <div className="card card-primary">
                  <textarea
                    className="text-input"
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    placeholder="问我任何数学问题，或者拖入一个公式..."
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendText()
                      }
                    }}
                  />
                  <div className="btn-row">
                    <VoiceInput
                      onTranscript={handleVoiceTranscript}
                      disabled={loading || !backendReady}
                    />
                    <MathSymbolPalette onInsert={handleSymbolInsert} />
                    <span className="btn-separator" />
                    <button
                      className="btn btn-primary"
                      onClick={handleSendText}
                      disabled={loading || !textInput.trim() || !backendReady}
                    >
                      发送
                    </button>
                  </div>
                </div>
                {!isKidsMode && (
                  <CollapsibleSection
                    title="拍照 / 图片识别"
                    hint="OCR 识别数学公式"
                    defaultOpen={false}
                  >
                    <p className="desc">上传题目图片或拍照，自动识别数学公式并插入到输入框。</p>
                    <ImageInput
                      onRecognized={text => {
                        setTextInput(prev => prev + (prev ? '\n' : '') + text)
                        setInputStartTime(Date.now())
                        addToast({
                          type: 'info',
                          title: '识别完成',
                          message: '已插入到输入框，请检查并修正',
                          duration: 3000,
                        })
                      }}
                    />
                  </CollapsibleSection>
                )}
                <ChatPanel />
              </div>

              {/* --- Secondary: Operation Table --- */}
              <div className="section-group">
                <div className="section-group-label">{isKidsMode ? '魔法工具' : '运算工具'}</div>
                <div className="card card-primary">
                  <h2>
                    运算表 <span className="card-hint">编辑后提交验证</span>
                  </h2>
                  <p className="desc">编辑单元格后提交验证。值范围 0 ~ n-1。</p>
                  <CayleyTable
                    table={table}
                    size={tableSize}
                    onChange={handleTableChange}
                    highlightCell={highlightCell}
                    verifyTrigger={verifyTrigger}
                    colorMode={colorMode}
                    onToggleColorMode={() => setColorMode(!colorMode)}
                    onDiscovery={p => handleDiscovery(p)}
                  />
                  <div className="btn-row">
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setVerifyTrigger(t => t + 1)
                        soundSystem.play('whoosh')
                      }}
                      disabled={loading || !backendReady}
                    >
                      ▶ 验证动画
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={handleSendTable}
                      disabled={loading || !backendReady}
                    >
                      {loading ? '验证中' : '提交'}
                    </button>
                    <span className="btn-separator" />
                    <button className="btn" onClick={() => handleResize(3)}>
                      3
                    </button>
                    <button className="btn" onClick={() => handleResize(4)}>
                      4
                    </button>
                    <button className="btn" onClick={() => handleResize(6)}>
                      6
                    </button>
                  </div>
                  <h3>预设</h3>
                  <div className="btn-row">
                    <button className="btn btn-sm" onClick={() => loadPreset('z3')}>
                      Z3
                    </button>
                    <button className="btn btn-sm" onClick={() => loadPreset('klein')}>
                      Klein
                    </button>
                    <button className="btn btn-sm" onClick={() => loadPreset('s3')}>
                      S3
                    </button>
                    <button className="btn btn-sm" onClick={() => loadPreset('non-group')}>
                      非群
                    </button>
                    <button className="btn btn-sm" onClick={() => loadPreset('non-assoc')}>
                      非结合
                    </button>
                  </div>
                  <div className="group-viz-section">
                    <h3>运算步骤可视化</h3>
                    <p className="desc" style={{ marginBottom: 8 }}>
                      选择元素，点击播放观看运算在表中逐步展开的过程。
                    </p>
                    <OperationStepVisualizer
                      table={table}
                      size={tableSize}
                      ageLevel={ageLevel}
                      onHighlightCell={setHighlightCell}
                    />
                  </div>
                  <div className="group-viz-section">
                    <h3>群运算可视化</h3>
                    <GroupOperationVisualizer table={table} size={tableSize} />
                  </div>
                </div>

                <CollapsibleSection
                  title={isKidsMode ? '🎮 游戏场' : '学生互动游戏场'}
                  hint={isKidsMode ? '碰一碰 · 找搭档 · 彩色表' : '拖拽 · 翻牌 · 颜色可视化'}
                  defaultOpen={isKidsMode}
                >
                  <p className="desc">
                    {isKidsMode
                      ? '把数字当成彩色球来玩！碰一碰看变成什么，找找谁是好搭档，给密码表涂颜色！'
                      : '通过拖拽碰撞、翻牌配对、颜色可视化三种互动方式，直观感受群运算的结构。'}
                  </p>
                  <StudentPlayground
                    table={table}
                    size={tableSize}
                    ageLevel={ageLevel}
                    onHighlightCell={setHighlightCell}
                    onDiscovery={handleDiscovery}
                  />
                </CollapsibleSection>

                <CollapsibleSection title="模式探索" hint="拖拽发现群结构" defaultOpen={false}>
                  <p className="desc">从元素池拖拽元素到运算工作台，探索封闭性、幺元和交换性。</p>
                  <PatternBuilder
                    elements={Array.from({ length: tableSize }, (_, i) => i)}
                    size={tableSize}
                    table={table}
                    onPatternComplete={pairs => {
                      if (pairs.length > 0 && pairs.length % 5 === 0) {
                        addToast({
                          type: 'info',
                          title: '探索进度',
                          message: `已测试 ${pairs.length} 组运算`,
                          duration: 3000,
                        })
                      }
                    }}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  title="参数探索器"
                  hint="滑块实时观察群性质"
                  defaultOpen={false}
                >
                  <p className="desc">
                    调节阶数 n，切换群类型，实时检测封闭性、结合律、交换性等性质。
                  </p>
                  <InteractiveExplorer onGroupChange={handleGroupChange} />
                </CollapsibleSection>

                {!isKidsMode && (
                  <CollapsibleSection
                    title="3D 对称群可视化"
                    hint="Three.js 正多面体旋转"
                    defaultOpen={false}
                  >
                    <p className="desc">
                      选择群元，观察正四面体 (S₄) 或正二十面体 (A₅) 的旋转对称如何对应置换。
                    </p>
                    <SymmetryGroup3D groupType={symmetryGroup} />
                    <div className="btn-row" style={{ marginTop: 8 }}>
                      <button
                        className={`btn btn-sm${symmetryGroup === 'S4' ? ' btn-primary' : ''}`}
                        onClick={() => setSymmetryGroup('S4')}
                      >
                        S₄ / 四面体
                      </button>
                      <button
                        className={`btn btn-sm${symmetryGroup === 'A5' ? ' btn-primary' : ''}`}
                        onClick={() => setSymmetryGroup('A5')}
                      >
                        A₅ / 二十面体
                      </button>
                    </div>
                  </CollapsibleSection>
                )}

                {!isKidsMode && (
                  <CollapsibleSection
                    title="眼动认知负荷"
                    hint="webgazer.js 实时注视点"
                    defaultOpen={false}
                  >
                    <p className="desc">
                      基于 webgazer.js
                      实时追踪注视点，通过注视时长与扫视频率估算认知负荷，并叠加注视热力图。
                    </p>
                    <EyeTrackingPanel />
                  </CollapsibleSection>
                )}

                {!isKidsMode && (
                  <CollapsibleSection
                    title="Manim 动画管线"
                    hint="预渲染数学动画 · 按需播放"
                    defaultOpen={false}
                  >
                    <p className="desc">
                      后端预渲染 Manim
                      动画（群运算、结合律、单位元、逆元、交换律反例），前端按需播放 SVG 帧或视频。
                    </p>
                    <ManimPlayer />
                  </CollapsibleSection>
                )}

                {/* 魔方群论实验室 — 交换子与非交换性 */}
                <CollapsibleSection
                  title={isKidsMode ? '🧊 魔方魔法实验室' : '魔方群论实验室'}
                  hint={isKidsMode ? '转一转魔方' : '交换子 · 非交换性 · 置换群'}
                  defaultOpen={false}
                >
                  <p className="desc">
                    {isKidsMode
                      ? '魔方不只是玩具！转一下看看两个动作交换顺序后结果一样不一样。'
                      : '用魔方直观演示置换群的交换子 [A,B] = A·B·A⁻¹·B⁻¹，理解非交换性。'}
                  </p>
                  <RubiksCubeGroup ageLevel={ageLevel} />
                </CollapsibleSection>
              </div>

              {/* --- Secondary: Auxiliary Tools --- */}
              <div className="section-group">
                <div className="section-group-label">辅助工具</div>
                {!isKidsMode && (
                  <CollapsibleSection
                    title="可视化分步解答"
                    hint="逐步展示解题过程"
                    defaultOpen={false}
                  >
                    <p className="desc">
                      输入数学问题，查看可视化的分步解答过程。每一步都有详细解释和数学公式渲染。
                    </p>
                    <VisualStepSolver
                      problem={solverProblem || textInput}
                      steps={solverSteps}
                      onRequestSolution={() => {
                        if (!textInput.trim() || !backendReady) {
                          addToast({
                            type: 'info',
                            title: '提示',
                            message: '请先在对话区输入问题',
                            duration: 3000,
                          })
                          return
                        }
                        setSolverProblem(textInput)
                        // 模拟分步解答数据（实际使用时由后端返回）
                        setSolverSteps([
                          {
                            title: '分析问题',
                            expression: textInput,
                            explanation: '识别问题类型，确定解题方向。',
                            type: 'transform',
                          },
                          {
                            title: '建立框架',
                            expression: '\\text{设所求为 } x',
                            explanation: '根据题意建立数学模型。',
                            type: 'substitute',
                          },
                          {
                            title: '核心推导',
                            expression: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
                            explanation: '应用公式进行核心计算。',
                            type: 'simplify',
                          },
                          {
                            title: '得出结论',
                            expression: '\\boxed{x = \\text{最终结果}}',
                            explanation: '整理结果，完成解答。',
                            type: 'conclude',
                          },
                        ])
                      }}
                    />
                  </CollapsibleSection>
                )}

                {!isKidsMode && (
                  <CollapsibleSection title="公式编辑器" hint="实时 LaTeX 预览" defaultOpen={false}>
                    <p className="desc">
                      输入 LaTeX 代码，右侧实时预览渲染结果，可一键插入到对话。
                    </p>
                    <FormulaLiveEditor onInsert={handleFormulaInsert} height={200} />
                  </CollapsibleSection>
                )}

                {!isKidsMode && (
                  <CollapsibleSection title="草稿板" hint="手绘数学图形" defaultOpen={false}>
                    <p className="desc">自由绘制辅助图形、标注运算表或勾勒证明思路。</p>
                    <WhiteboardPad height={240} />
                  </CollapsibleSection>
                )}
              </div>

              {/* --- 问题发明 --- */}
              <div className="section-group">
                <div className="section-group-label">{isKidsMode ? '我的发现' : '问题发明'}</div>
                <CollapsibleSection
                  title={isKidsMode ? '✨ 发明你自己的数学问题！' : '发明新问题并首次解决'}
                  hint={isKidsMode ? '当一个小数学家' : '良构检查 · 新颖性检验 · 保存'}
                  defaultOpen={false}
                >
                  <p className="desc">
                    {isKidsMode
                      ? '你也能发明数学问题！写下你的发现，系统会帮你检查它是不是一个新的好问题。'
                      : '承结构主义理念：不再只是解题，而是发明新问题并成为第一个解决它的人。'}
                  </p>
                  <ProblemInvention ageLevel={ageLevel} />
                </CollapsibleSection>
              </div>
            </div>

            <div className="sidebar-col">
              {/* Dynamic guided discovery — Lakatos cycle */}
              <GuidedDiscoveryPanel
                tableSize={tableSize}
                ageLevel={ageLevel}
                onJumpToCayley={() => {
                  const el = document.querySelector('.cayley-table')
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                onJumpToChat={() => {
                  const el = document.querySelector('.text-input')
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                onJumpToConjecture={() => setMode('grill')}
                onJumpToExplore={() => {
                  const el = document.querySelector('.op-step-visualizer')
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                onProgressChange={handleGuidedProgress}
              />

              {/* AI-powered dynamic content generation */}
              <CollapsibleSection
                title="AI 内容生成"
                hint="LLM 动态生成习题与故事"
                defaultOpen={false}
              >
                <p className="desc">基于当前学习进度，AI 自动生成适合你年龄的习题、故事和挑战。</p>
                <AIContentPanel ageLevel={ageLevel} tableSize={tableSize} table={table} />
              </CollapsibleSection>

              {/* Multi-modal visualization: gauges + radar */}
              {!isKidsMode && visualData?.four_field_gauges && (
                <div className="card card-compact">
                  <h2>
                    认知仪表盘 <span className="card-hint">悬停查看详情</span>
                  </h2>
                  <div className="gauge-row">
                    <RadialGauge
                      value={visualData.four_field_gauges.cognitive_load}
                      label="认知负荷"
                      sublabel={visualData.four_field_gauges.cognitive_state}
                      metricInfo={{
                        interpretation: visualData.four_field_gauges.cognitive_state,
                        suggestion:
                          visualData.four_field_gauges.cognitive_load > 0.7
                            ? '负荷过高，建议暂停或简化任务'
                            : '负荷适中，可以继续',
                      }}
                    />
                    <RadialGauge
                      value={visualData.four_field_gauges.anxiety_index}
                      label="焦虑指数"
                      metricInfo={{
                        interpretation:
                          visualData.four_field_gauges.anxiety_index > 0.6
                            ? '焦虑偏高，需要鼓励和降低难度'
                            : '情绪稳定',
                        suggestion:
                          visualData.four_field_gauges.anxiety_index > 0.6
                            ? '提供正面反馈，降低问题难度'
                            : undefined,
                      }}
                    />
                    <RadialGauge
                      value={visualData.four_field_gauges.flow_score}
                      label="心流分数"
                      invert
                      metricInfo={{
                        interpretation:
                          visualData.four_field_gauges.flow_score > 0.6
                            ? '处于心流状态，学习效率最佳'
                            : '尚未进入心流，可调整挑战难度',
                        suggestion: '匹配难度与能力以促进心流',
                      }}
                    />
                    <RadialGauge
                      value={visualData.four_field_gauges.hint_dependency}
                      label="提示依赖"
                      metricInfo={{
                        interpretation:
                          visualData.four_field_gauges.hint_dependency > 0.6
                            ? '过度依赖提示，需要更多独立思考'
                            : '独立思考能力良好',
                        suggestion:
                          visualData.four_field_gauges.hint_dependency > 0.6
                            ? '逐步减少提示，鼓励自主探索'
                            : undefined,
                      }}
                    />
                  </div>
                </div>
              )}

              {!isKidsMode && visualData?.mastery_radar && (
                <div className="card card-compact">
                  <h2>
                    能力雷达 <span className="card-hint">悬停维度查看详情</span>
                  </h2>
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                    <MasteryRadar
                      dimensions={[
                        {
                          label: '准确率',
                          value: visualData.mastery_radar.accuracy,
                          description: '答题正确率，反映知识掌握程度',
                        },
                        {
                          label: '猜想力',
                          value: visualData.mastery_radar.conjecture,
                          description: '提出数学猜想的能力',
                        },
                        {
                          label: '独立性',
                          value: visualData.mastery_radar.independence,
                          description: '独立解决问题的能力',
                        },
                        {
                          label: '流畅度',
                          value: visualData.mastery_radar.fluency,
                          description: '数学表达和推理的流畅程度',
                        },
                        {
                          label: '抽象力',
                          value: visualData.mastery_radar.abstraction,
                          description: '从具体到抽象的概括能力',
                        },
                      ]}
                      overall={visualData.mastery_radar.overall}
                    />
                  </div>
                </div>
              )}

              <div className="card card-compact">
                <h2>概念图</h2>
                <DagGraph
                  nodes={dagNodes}
                  currentNodeId={selectedNode}
                  onSelect={handleNodeSelect}
                />
              </div>

              <CollapsibleSection title="学习状态" hint="认知与情绪指标" defaultOpen={false}>
                <FourFieldDashboard
                  fields={fourFields}
                  decision={decision}
                  onAction={handleDecisionAction}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="协作流程"
                hint={phaseTrace.length > 0 ? `${phaseTrace.length} 步` : undefined}
                defaultOpen={phaseTrace.length > 0}
              >
                {phaseTrace.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-state-text">提交运算表后显示智能体协作流程</span>
                  </div>
                ) : (
                  <AgentFlow phases={phaseTrace} />
                )}
              </CollapsibleSection>

              <div className="card card-compact">
                <h2>学习成就</h2>
                <AchievementSystem
                  consecutiveCorrect={fourFields?.interaction.consecutive_correct ?? 0}
                  masteryEstimate={fourFields?.knowledge.mastery_estimate ?? 0}
                  questionsAsked={phaseTrace.length}
                  guidedMissionsCompleted={guidedMissionsCompleted}
                  guidedStarsCollected={guidedStarsCollected}
                  guidedModesCompleted={guidedModesCompleted}
                  ageLevel={ageLevel}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========== Grill Mode ========== */}
        {mode === 'grill' && (
          <div className="main-grid mode-enter" key="grill-mode">
            <div className="main-col">
              <GrillPanel onActivity={recordActivity} />
            </div>
            <div className="sidebar-col">
              {visualData?.conjecture_journey && visualData.conjecture_journey.timeline && (
                <div className="card card-compact">
                  <h2>猜想之旅</h2>
                  <ConjectureTimeline
                    timeline={visualData.conjecture_journey.timeline}
                    refinementChains={visualData.conjecture_journey.refinement_chains}
                    totalConjectures={visualData.conjecture_journey.total_conjectures}
                    confirmed={visualData.conjecture_journey.confirmed}
                    refuted={visualData.conjecture_journey.refuted}
                  />
                </div>
              )}

              {visualData?.difficulty_gauge && (
                <div className="card card-compact">
                  <h2>难度仪表</h2>
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                    <DifficultyGauge
                      current={visualData.difficulty_gauge.current_difficulty}
                      band={visualData.difficulty_gauge.difficulty_band}
                      trend={visualData.difficulty_gauge.trend}
                      accuracy={visualData.difficulty_gauge.accuracy_rate}
                    />
                  </div>
                </div>
              )}

              <CollapsibleSection title="学习状态" hint="认知与情绪指标" defaultOpen={false}>
                <FourFieldDashboard
                  fields={fourFields}
                  decision={decision}
                  onAction={handleDecisionAction}
                />
              </CollapsibleSection>

              <div className="card card-compact">
                <h2>学习成就</h2>
                <AchievementSystem
                  consecutiveCorrect={grillState.summary?.adaptive.streak_correct ?? 0}
                  masteryEstimate={fourFields?.knowledge.mastery_estimate ?? 0}
                  questionsAsked={grillState.questionsAsked}
                  guidedMissionsCompleted={guidedMissionsCompleted}
                  guidedStarsCollected={guidedStarsCollected}
                  guidedModesCompleted={guidedModesCompleted}
                  ageLevel={ageLevel}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========== Proof Mode ========== */}
        {mode === 'proof' && (
          <div className="main-grid mode-enter" key="proof-mode">
            <div className="main-col">
              <ProofPanel />
              <CollapsibleSection title="公式编辑器" hint="实时 LaTeX 预览" defaultOpen={false}>
                <p className="desc">编写复杂数学公式，一键插入到证明步骤中。</p>
                <FormulaLiveEditor onInsert={handleFormulaInsert} height={180} />
              </CollapsibleSection>
            </div>
            <div className="sidebar-col">
              <CollapsibleSection title="学习状态" hint="认知与情绪指标" defaultOpen={false}>
                <FourFieldDashboard
                  fields={fourFields}
                  decision={decision}
                  onAction={handleDecisionAction}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="协作流程"
                hint={phaseTrace.length > 0 ? `${phaseTrace.length} 步` : undefined}
                defaultOpen={phaseTrace.length > 0}
              >
                {phaseTrace.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-state-text">提交证明后显示智能体协作流程</span>
                  </div>
                ) : (
                  <AgentFlow phases={phaseTrace} />
                )}
              </CollapsibleSection>
            </div>
          </div>
        )}

        {/* ========== DAG Mode ========== */}
        {mode === 'dag' && (
          <div className="main-grid mode-enter" key="dag-mode">
            <div className="main-col">
              <div className="card card-primary">
                <h2>
                  概念依赖图 <span className="card-hint">点击节点切换学习目标</span>
                </h2>
                <DagGraph
                  nodes={dagNodes}
                  currentNodeId={selectedNode}
                  onSelect={handleNodeSelect}
                />
              </div>
              <CollapsibleSection
                title="教材课程映射"
                hint="对照课程标准定位知识点"
                defaultOpen={false}
              >
                <p className="desc">
                  将 MathWeaver 的概念体系映射到主流课程标准，帮助定位学习目标和年级水平。
                </p>
                <CurriculumMapper />
              </CollapsibleSection>
            </div>
            <div className="sidebar-col">
              <div className="card card-compact">
                <h2>
                  概念复习 <span className="card-hint">3D 翻转闪卡</span>
                </h2>
                <p className="desc">翻转卡片复习群论概念，评分后自动调整复习间隔（SM-2 算法）。</p>
                <FlashcardSystem
                  onProgress={stats => {
                    if (stats.reviewed > 0 && stats.reviewed === stats.total) {
                      addToast({
                        type: 'achievement',
                        title: '复习完成！',
                        message: `已复习全部 ${stats.total} 张卡片`,
                        icon: 'GraduationIcon',
                        duration: 6000,
                      })
                    }
                  }}
                />
              </div>

              <CollapsibleSection title="学习状态" hint="认知与情绪指标" defaultOpen={false}>
                <FourFieldDashboard
                  fields={fourFields}
                  decision={decision}
                  onAction={handleDecisionAction}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="协作流程"
                hint={phaseTrace.length > 0 ? `${phaseTrace.length} 步` : undefined}
                defaultOpen={phaseTrace.length > 0}
              >
                {phaseTrace.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-state-text">提交后显示智能体协作流程</span>
                  </div>
                ) : (
                  <AgentFlow phases={phaseTrace} />
                )}
              </CollapsibleSection>
            </div>
          </div>
        )}

        {/* ========== Modeling Mode ========== */}
        {mode === 'modeling' && (
          <div className="mode-enter" key="modeling-mode" style={{ height: '100%' }}>
            <ModelingLab ageLevel={ageLevel} />
          </div>
        )}
      </Suspense>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <OnboardingOverlay
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onComplete={() => useStore.getState().completeOnboarding()}
        ageLevel={ageLevel}
        onAgeChange={setAgeLevel}
        interactiveSteps={MATHWEAVER_COACH_STEPS}
        onFinish={() => {
          const el = document.querySelector('.gdp-root')
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}
      />
      <ErrorBanner />
      <ToastSystem toasts={toasts} onDismiss={dismissToast} />
      <CommandPalette commands={commands} />
      <ShortcutsOverlay
        shortcuts={shortcuts}
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* --- Mascot (Euler the Owl) --- */}
      <Mascot
        state={mascotState}
        message={mascotMessage}
        ageLevel={ageLevel}
        position="bottom-right"
        size={isKidsMode ? 80 : 64}
        onClick={() => {
          setMascotState('happy')
          setMascotMessage(mascotMoods.idle)
          soundSystem.play('pop')
          setTimeout(() => {
            setMascotState('idle')
            setMascotMessage(undefined)
          }, 2500)
        }}
      />
    </div>
  )
}
