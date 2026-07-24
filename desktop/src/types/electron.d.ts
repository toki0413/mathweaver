/**
 * Global type declarations for the Electron preload bridge.
 *
 * The preload script exposes `window.api` via contextBridge,
 * providing type-safe IPC communication with the main process.
 */

interface MathWeaverAPI {
  // App
  getAppInfo(): Promise<Record<string, unknown>>

  // Health
  health(): Promise<Record<string, unknown> | null>

  // DAG
  getDag(level?: string): Promise<Record<string, unknown> | null>
  getCurricula(): Promise<Record<string, unknown> | null>
  getCurriculumDag(level: string): Promise<Record<string, unknown> | null>

  // Session
  startSession(req: {
    student_id: string
    student_name?: string
    target_node_id?: string
  }): Promise<Record<string, unknown> | null>
  getSessionState(): Promise<Record<string, unknown> | null>
  sendInput(req: {
    student_input: string
    response_time_ms?: number
  }): Promise<Record<string, unknown> | null>

  // Forge
  verifyGroup(table: number[][]): Promise<Record<string, unknown> | null>
  findNonAssociative(n: number): Promise<Record<string, unknown> | null>

  // Metrics
  getMetrics(): Promise<Record<string, unknown> | null>

  // Proof
  getTheorems(level?: string): Promise<Record<string, unknown> | null>
  submitProof(theoremId: string, steps: string[], level?: string): Promise<Record<string, unknown> | null>

  // Grill
  startGrill(studentId?: string, curriculumLevel?: string): Promise<Record<string, unknown> | null>
  submitGrillAnswer(qid: string, answer: string, responseTimeMs?: number): Promise<Record<string, unknown> | null>

  // Settings
  getLLMConfig(): Promise<Record<string, unknown> | null>
  setLLMConfig(config: Record<string, unknown>): Promise<{ success: boolean; config: Record<string, unknown> } | null>
  getLLMPresets(): Promise<Record<string, unknown>[] | null>
  getSetting(key: string): Promise<unknown>
  setSetting(key: string, value: unknown): Promise<boolean | null>
  isOnboardingComplete(): Promise<boolean | null>
  setOnboardingComplete(value: boolean): Promise<boolean | null>

  // File
  saveSession(data: string): Promise<string | null>
  loadSession(): Promise<string | null>
  exportTable(data: string): Promise<string | null>

  // IPC listeners
  on(channel: string, callback: (data: unknown) => void): (() => void)
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

interface Window {
  api: MathWeaverAPI
}
