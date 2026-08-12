/**
 * Global type declarations for the Electron preload bridge.
 *
 * The preload script exposes `window.api` via contextBridge,
 * providing type-safe IPC communication with the main process.
 */

interface MathWeaverAPI {
  // App
  getAppInfo(): Promise<Record<string, unknown>>
  getBackendUrl(): Promise<string>

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
    age_level?: string
    cognitive_load?: number
    backtrack_count?: number
    trial_sequence_length?: number
    whiteboard_strokes?: number
    whiteboard_active?: boolean
  }): Promise<Record<string, unknown> | null>

  // Forge
  verifyGroup(table: number[][]): Promise<Record<string, unknown> | null>
  findNonAssociative(n: number): Promise<Record<string, unknown> | null>

  // Metrics
  getMetrics(): Promise<Record<string, unknown> | null>

  // Proof
  getTheorems(level?: string): Promise<Record<string, unknown> | null>
  submitProof(
    theoremId: string,
    steps: string[],
    level?: string,
  ): Promise<Record<string, unknown> | null>

  // Grill
  startGrill(studentId?: string, curriculumLevel?: string): Promise<Record<string, unknown> | null>
  submitGrillAnswer(
    qid: string,
    answer: string,
    responseTimeMs?: number,
  ): Promise<Record<string, unknown> | null>

  // Dynamic Content Generation
  generateContent(req: Record<string, unknown>): Promise<Record<string, unknown> | null>

  // Multimodal: image understanding
  understandImage(req: {
    imageDataUrl: string
    prompt?: string
    ageLevel?: 'kids' | 'tweens' | 'teens'
  }): Promise<Record<string, unknown> | null>

  // Settings
  getLLMConfig(): Promise<Record<string, unknown> | null>
  setLLMConfig(
    config: Record<string, unknown>,
  ): Promise<{ success: boolean; config: Record<string, unknown> } | null>
  getLLMPresets(): Promise<Record<string, unknown>[] | null>
  testLLMConnection(): Promise<{ ok: boolean; message: string; latencyMs?: number } | null>
  getSetting(key: string): Promise<unknown>
  setSetting(key: string, value: unknown): Promise<boolean | null>
  isOnboardingComplete(): Promise<boolean | null>
  setOnboardingComplete(value: boolean): Promise<boolean | null>

  // File
  saveSession(data: string): Promise<string | null>
  loadSession(): Promise<string | null>
  exportTable(data: string): Promise<string | null>
  uploadFile(options?: {
    filters?: { name: string; extensions: string[] }[]
  }): Promise<UploadedFileResult | null>
  uploadFileData(payload: {
    name: string
    mime?: string
    dataUrl: string
  }): Promise<UploadedFileResult | null>

  // Raw IPC bridge
  send(channel: string, ...args: unknown[]): void
  on(channel: string, callback: (data: unknown) => void): () => void
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

interface Window {
  api: MathWeaverAPI
}

/** Result of a native file upload (kind + base64 / text payload). */
interface UploadedFileResult {
  name: string
  kind: 'image' | 'pdf' | 'text' | 'unknown'
  mime: string
  size: number
  dataUrl?: string
  text?: string
}
