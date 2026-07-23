import { create } from 'zustand'

// Backend URL will be set from main process
let API_BASE = 'http://127.0.0.1:18765'

// Initialize API base from Electron main process
export async function initBackendUrl() {
  if (window.electronAPI) {
    try {
      const url = await window.electronAPI.getBackendUrl()
      if (url) API_BASE = url
    } catch (e) {
      console.error('Failed to get backend URL:', e)
    }
  }
}

// Get current API base (dynamic, reflects initBackendUrl changes)
export function getApiBase(): string {
  return API_BASE
}

// Helper: fetch with backend URL
async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, options)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// Helper: native file save via IPC
async function nativeSaveFile(data: string): Promise<string | null> {
  if (window.electronAPI) {
    return await window.electronAPI.invoke('file:save-session', data) as string | null
  }
  return null
}

// Helper: native file load via IPC
async function nativeLoadFile(): Promise<string | null> {
  if (window.electronAPI) {
    return await window.electronAPI.invoke('file:load-session') as string | null
  }
  return null
}

interface ChatMessage {
  role: 'user' | 'system'
  content: string
  phase?: string
}

interface FourFields {
  knowledge: {
    current_node_id: string | null
    mastery_estimate: number
    zpd_lower: number
    zpd_upper: number
    prerequisite_gaps: string[]
    in_zpd: boolean
    ready_to_advance: boolean
  }
  cognitive: {
    response_time_ms: number
    rt_zscore: number
    cognitive_load: number
    state: string
    is_overloaded: boolean
  }
  emotional: {
    anxiety_index: number
    flow_score: number
    state: string
    is_anxious: boolean
    in_flow: boolean
  }
  interaction: {
    current_hint_level: number
    consecutive_correct: number
    scaffold_fade_threshold: number
    should_fade_scaffold: boolean
    is_struggling: boolean
  }
}

interface SessionData {
  studentId: string
  targetNode: string
  chat: ChatMessage[]
  fourFields: FourFields | null
  phaseTrace: string[]
  savedAt: string
}

interface DagNodeInfo {
  id: string
  name: string
  description: string
  prerequisites: string[]
  abstraction_level: number
  difficulty: number
  is_milestone: boolean
}

interface SessionState {
  sessionId: string | null
  targetNode: string | null
  phase: string
  fourFields: FourFields | null
  chat: ChatMessage[]
  loading: boolean
  phaseTrace: string[]
  decision: { action: string; reason: string } | null
  backendReady: boolean
  dagNodes: DagNodeInfo[]

  startSession: (studentId: string, targetNode: string) => Promise<void>
  sendInput: (input: string, responseTimeMs: number) => Promise<void>
  clearChat: () => void
  checkBackend: () => Promise<void>
  fetchDagNodes: () => Promise<void>
  saveSession: () => Promise<string | null>
  loadSession: () => Promise<boolean>
}

export const useStore = create<SessionState>((set, get) => ({
  sessionId: null,
  targetNode: null,
  phase: 'idle',
  fourFields: null,
  chat: [],
  loading: false,
  phaseTrace: [],
  decision: null,
  backendReady: false,
  dagNodes: [],

  checkBackend: async () => {
    try {
      await apiFetch('/api/health')
      set({ backendReady: true })
    } catch {
      set({ backendReady: false })
    }
  },

  fetchDagNodes: async () => {
    try {
      const data = await apiFetch('/api/dag')
      set({ dagNodes: data.nodes || [] })
    } catch (e) {
      console.error('Failed to fetch DAG nodes:', e)
    }
  },

  startSession: async (studentId: string, targetNode: string) => {
    set({ loading: true })
    try {
      const data = await apiFetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, target_node_id: targetNode }),
      })
      set({
        sessionId: data.session_id,
        targetNode: data.target_node,
        phase: data.phase,
        loading: false,
        chat: [{
          role: 'system',
          content: `📄 学习目标: ${data.node_name}\n${data.node_description}\n\n学习路径: ${data.learning_path?.map((n: any) => n.name).join(' → ') || '直接开始'}`,
          phase: 'session_start',
        }],
      })
    } catch (e) {
      set({ loading: false })
      console.error('Failed to start session:', e)
    }
  },

  sendInput: async (input: string, responseTimeMs: number) => {
    set((state) => ({
      chat: [...state.chat, { role: 'user', content: input }],
      loading: true,
    }))

    try {
      const data = await apiFetch('/api/session/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_input: input, response_time_ms: responseTimeMs }),
      })

      set((state) => ({
        chat: [...state.chat, {
          role: 'system',
          content: data.response?.content || '',
          phase: data.response?.action,
        }],
        phase: data.phase || 'idle',
        fourFields: data.four_fields,
        phaseTrace: data.phase_trace || [],
        decision: data.decision,
        loading: false,
      }))
    } catch (e) {
      set({ loading: false })
      console.error('Failed to send input:', e)
    }
  },

  clearChat: () => set({ chat: [] }),

  saveSession: async () => {
    const state = get()
    const sessionData: SessionData = {
      studentId: state.sessionId || '',
      targetNode: state.targetNode || '',
      chat: state.chat,
      fourFields: state.fourFields,
      phaseTrace: state.phaseTrace,
      savedAt: new Date().toISOString(),
    }
    return await nativeSaveFile(JSON.stringify(sessionData, null, 2))
  },

  loadSession: async () => {
    const content = await nativeLoadFile()
    if (!content) return false

    try {
      const data: SessionData = JSON.parse(content)
      set({
        sessionId: data.studentId,
        targetNode: data.targetNode,
        chat: data.chat,
        fourFields: data.fourFields,
        phaseTrace: data.phaseTrace,
      })
      return true
    } catch {
      return false
    }
  },
}))
