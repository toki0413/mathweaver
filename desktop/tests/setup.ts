/**
 * Global test setup — loaded by vitest before every test file (see
 * `setupFiles` in vitest.config.ts).
 */

// Register @testing-library/jest-dom matchers with vitest's `expect`.
// jest-dom v7 exposes a vitest-specific entry point that augments
// vitest's expect at import time.
try {
  await import('@testing-library/jest-dom/vitest')
} catch {
  // jest-dom not available — tests fall back to vitest built-in matchers.
  console.warn('@testing-library/jest-dom not available; using vitest built-in matchers')
}

/**
 * Mock the Electron IPC bridge exposed by the preload script.
 *
 * In production the preload injects `window.api`.
 * Components read it to invoke IPC channels
 * and subscribe to menu events. We provide a benign no-op mock so that any
 * component touching the bridge during a test does not throw.
 *
 * Only applied when a `window` global exists (e.g. jsdom/happy-dom). In the
 * default `node` environment this block is a no-op, which is fine because the
 * current unit tests render via react-dom/server and never touch `window`.
 */
if (typeof window !== 'undefined') {
  type ChannelListener = (data: unknown) => void

  const channelListeners: Record<string, Set<ChannelListener>> = {}

  const mockElectronAPI = {
    send: (_channel: string, ..._args: unknown[]) => {
      /* no-op */
    },
    invoke: async (_channel: string, ..._args: unknown[]): Promise<unknown> => {
      return null
    },
    on: (channel: string, callback: ChannelListener): (() => void) => {
      let set = channelListeners[channel]
      if (!set) {
        set = new Set()
        channelListeners[channel] = set
      }
      set.add(callback)
      return () => {
        set?.delete(callback)
      }
    },
    getBackendUrl: async (): Promise<string> => 'mock://test',
    getAppInfo: async (): Promise<Record<string, unknown>> => ({
      version: '0.0.0-test',
      name: 'MathWeaver',
    }),
  }

  // Assign the mock object, mirroring the preload bridge.
  const w = window as unknown as {
    api: typeof mockElectronAPI
  }
  w.api = mockElectronAPI
}

/**
 * Stub the Web Audio API for jsdom.
 *
 * jsdom does not implement AudioContext, so the sound module
 * (src/utils/sound.ts) would log "[sound] Web Audio API 不可用" on every
 * init. Providing a minimal stub lets it initialize cleanly and keeps the
 * test runner output free of expected-environment warning noise.
 */
if (typeof window !== 'undefined') {
  const noop = () => {}
  class MockAudioContext {
    currentTime = 0
    state: AudioContextState = 'running'
    destination = { connect: noop }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime: noop,
          exponentialRampToValueAtTime: noop,
        },
        connect: noop,
      }
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime: noop,
          exponentialRampToValueAtTime: noop,
        },
        connect: noop,
        start: noop,
        stop: noop,
      }
    }
    resume(): Promise<void> {
      return Promise.resolve()
    }
  }
  ;(window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext
}

export {}
