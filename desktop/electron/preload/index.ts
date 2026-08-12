import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// ---------------------------------------------------------------------------
// IPC Channel Whitelist
// ---------------------------------------------------------------------------

const INVOKE_CHANNELS = [
  // App
  'app:get-info',
  'app:log-error',
  // Student
  'student:get-id',
  // Backend API
  'api:health',
  'api:dag',
  'api:curricula',
  'api:curriculum-dag',
  'api:dag-path',
  'api:session-start',
  'api:session-state',
  'api:session-input',
  'api:verify-group',
  'api:find-non-associative',
  'api:metrics',
  'api:proof-theorems',
  'api:proof-verify',
  'api:grill-start',
  'api:grill-answer',
  'api:generate-content',
  'api:understand-image',
  // Settings
  'settings:get',
  'settings:set',
  'settings:get-llm-config',
  'settings:set-llm-config',
  'settings:get-llm-presets',
  'settings:test-llm-connection',
  'settings:is-onboarding-complete',
  'settings:set-onboarding-complete',
  // File
  'file:save-session',
  'file:load-session',
  'file:export-table',
  'file:upload',
  'file:upload-data',
] as const

const ON_CHANNELS = [
  'menu:save-session',
  'menu:load-session',
  'menu:open-settings',
  'menu:open-onboarding',
] as const

const SEND_CHANNELS = ['menu:save-session', 'menu:load-session'] as const

type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
type OnChannel = (typeof ON_CHANNELS)[number]
type SendChannel = (typeof SEND_CHANNELS)[number]

// ---------------------------------------------------------------------------
// Type-safe API bridge
// ---------------------------------------------------------------------------

/**
 * Invoke an IPC handler (request-response) after validating the channel
 * against the whitelist. All convenience methods route through this so the
 * whitelist check is always enforced and no raw `ipcRenderer.invoke` call can
 * bypass it.
 */
async function safeInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (INVOKE_CHANNELS.includes(channel as InvokeChannel)) {
    return await ipcRenderer.invoke(channel, ...args)
  }
  console.warn(`[Preload] Unknown IPC channel: ${channel}`)
  return null
}

const api = {
  /** Invoke an IPC handler (request-response) — validates against the whitelist */
  invoke: safeInvoke,

  /** Listen for messages from main process */
  on: (channel: string, callback: (data: unknown) => void): (() => void) => {
    if (ON_CHANNELS.includes(channel as OnChannel)) {
      const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
    return () => {}
  },

  // --- Convenience methods (all routed through safeInvoke for whitelist enforcement) ---

  // Health
  health: () => safeInvoke('api:health'),

  // DAG
  getDag: (level?: string) => safeInvoke('api:dag', level),
  getCurricula: () => safeInvoke('api:curricula'),
  getCurriculumDag: (level: string) => safeInvoke('api:curriculum-dag', level),

  // Session
  startSession: (req: { student_id: string; student_name?: string; target_node_id?: string }) =>
    safeInvoke('api:session-start', req),
  getSessionState: () => safeInvoke('api:session-state'),
  sendInput: (req: {
    student_input: string
    response_time_ms?: number
    age_level?: string
    cognitive_load?: number
    backtrack_count?: number
    trial_sequence_length?: number
  }) => safeInvoke('api:session-input', req),

  // Forge
  verifyGroup: (table: number[][]) => safeInvoke('api:verify-group', table),
  findNonAssociative: (n: number) => safeInvoke('api:find-non-associative', n),

  // Metrics
  getMetrics: () => safeInvoke('api:metrics'),

  // Proof
  getTheorems: (level?: string) => safeInvoke('api:proof-theorems', level),
  submitProof: (theoremId: string, steps: string[], level?: string) =>
    safeInvoke('api:proof-verify', theoremId, steps, level),

  // Grill
  startGrill: (studentId?: string, curriculumLevel?: string) =>
    safeInvoke('api:grill-start', studentId, curriculumLevel),
  submitGrillAnswer: (qid: string, answer: string, responseTimeMs?: number) =>
    safeInvoke('api:grill-answer', qid, answer, responseTimeMs),

  // Dynamic Content Generation
  generateContent: (req: Record<string, unknown>) => safeInvoke('api:generate-content', req),

  // Multimodal: image understanding (vision model + OCR fallback)
  understandImage: (req: {
    imageDataUrl: string
    prompt?: string
    ageLevel?: 'kids' | 'tweens' | 'teens'
  }) => safeInvoke('api:understand-image', req),

  // Settings
  getLLMConfig: () => safeInvoke('settings:get-llm-config'),
  setLLMConfig: (config: Record<string, unknown>) => safeInvoke('settings:set-llm-config', config),
  getLLMPresets: () => safeInvoke('settings:get-llm-presets'),
  testLLMConnection: () => safeInvoke('settings:test-llm-connection'),
  getSetting: (key: string) => safeInvoke('settings:get', key),
  setSetting: (key: string, value: unknown) => safeInvoke('settings:set', key, value),
  isOnboardingComplete: () => safeInvoke('settings:is-onboarding-complete'),
  setOnboardingComplete: (value: boolean) => safeInvoke('settings:set-onboarding-complete', value),

  // File
  saveSession: (data: string) => safeInvoke('file:save-session', data),
  loadSession: () => safeInvoke('file:load-session'),
  exportTable: (data: string) => safeInvoke('file:export-table', data),
  uploadFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    safeInvoke('file:upload', options),
  uploadFileData: (payload: { name: string; mime?: string; dataUrl: string }) =>
    safeInvoke('file:upload-data', payload),

  // App
  getAppInfo: () => safeInvoke('app:get-info'),

  // Electron API compatibility (used by App.tsx for menu events, student ID, etc.)
  send: (channel: string, ...args: unknown[]) => {
    if (SEND_CHANNELS.includes(channel as SendChannel)) {
      ipcRenderer.send(channel, ...args)
    }
  },
  getBackendUrl: async () => 'in-process',
}

contextBridge.exposeInMainWorld('api', api)

// Type export for the renderer
export type MathWeaverAPI = typeof api
