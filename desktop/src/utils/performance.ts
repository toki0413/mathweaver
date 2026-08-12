/**
 * Performance Monitoring Utility
 *
 * Lightweight, dependency-free performance instrumentation for MathWeaver.
 * Tracks component render times, API call latency, memory usage, and error rates.
 * Reports are buffered and flushed periodically to the main process via IPC.
 *
 * Usage:
 *   import { perf } from '@/utils/performance'
 *   perf.mark('api:session-start')
 *   // ... do work ...
 *   perf.measure('api:session-start', 'api:session-start:done')
 *
 *   // Wrap async operations
 *   const result = await perf.wrap('llm:chat', () => fetchLlmResponse())
 *
 *   // React component profiling
 *   const ProfiledComponent = perf.withProfiler(MyComponent, 'MyComponent')
 */

import { Profiler, createElement, type ComponentType } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PerfEntry {
  name: string
  startTime: number
  duration: number
  type: 'render' | 'api' | 'action'
  metadata?: Record<string, unknown>
}

interface ErrorEntry {
  timestamp: string
  module: string
  error: string
  stack?: string
}

interface MetricSummary {
  count: number
  min: number
  max: number
  avg: number
  p50: number
  p95: number
  total: number
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BUFFER_SIZE = 200
const FLUSH_INTERVAL_MS = 30_000 // 30 seconds
const SLOW_THRESHOLD_MS = 1000 // Log warnings for operations > 1s
const ENABLED = typeof window !== 'undefined'

// ---------------------------------------------------------------------------
// Performance Monitor
// ---------------------------------------------------------------------------

class PerformanceMonitor {
  private entries: PerfEntry[] = []
  private errors: ErrorEntry[] = []
  private marks = new Map<string, number>()
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private initialized = false

  /**
   * Lazy initialization — only starts the flush timer and memory baseline
   * when the monitor is actually used (mark/measure/wrap). This prevents
   * an active setInterval from running when the module is imported but
   * never consumed.
   */
  private ensureInitialized(): void {
    if (this.initialized || !ENABLED) return
    this.initialized = true
    this.startFlushTimer()
  }

  // --- Mark / Measure (Web Performance API style) ---

  mark(name: string): void {
    if (!ENABLED) return
    this.ensureInitialized()
    this.marks.set(name, performance.now())
  }

  measure(
    markName: string,
    endMarkName: string,
    type: PerfEntry['type'] = 'action',
    metadata?: Record<string, unknown>,
  ): number {
    if (!ENABLED) return 0
    const start = this.marks.get(markName)
    const end = this.marks.get(endMarkName) ?? performance.now()
    if (start === undefined) return 0

    const duration = end - start
    this.addEntry({
      name: markName,
      startTime: start,
      duration,
      type,
      metadata,
    })

    if (duration > SLOW_THRESHOLD_MS) {
      console.warn(`[perf] Slow operation: ${markName} took ${duration.toFixed(0)}ms`)
    }

    return duration
  }

  // --- Wrap async function ---

  async wrap<T>(name: string, fn: () => Promise<T>, type: PerfEntry['type'] = 'api'): Promise<T> {
    if (!ENABLED) return fn()
    this.ensureInitialized()
    const start = performance.now()
    try {
      const result = await fn()
      const duration = performance.now() - start
      this.addEntry({ name, startTime: start, duration, type })
      if (duration > SLOW_THRESHOLD_MS) {
        console.warn(`[perf] Slow ${type}: ${name} took ${duration.toFixed(0)}ms`)
      }
      return result
    } catch (error) {
      const duration = performance.now() - start
      this.addEntry({ name: `${name}:error`, startTime: start, duration, type })
      this.logError(name, error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  // --- Wrap sync function ---

  wrapSync<T>(name: string, fn: () => T, type: PerfEntry['type'] = 'render'): T {
    if (!ENABLED) return fn()
    this.ensureInitialized()
    const start = performance.now()
    try {
      const result = fn()
      const duration = performance.now() - start
      this.addEntry({ name, startTime: start, duration, type })
      return result
    } catch (error) {
      const duration = performance.now() - start
      this.addEntry({ name: `${name}:error`, startTime: start, duration, type })
      throw error
    }
  }

  // --- React Profiler callback helper ---

  onRenderCallback(
    id: string,
    _phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    _baseDuration: number,
    _startTime: number,
    _commitTime: number,
  ): void {
    if (!ENABLED) return
    this.ensureInitialized()
    this.addEntry({
      name: `render:${id}`,
      startTime: _startTime,
      duration: actualDuration,
      type: 'render',
    })

    if (actualDuration > 16) {
      // Slower than one frame (60fps)
      console.warn(`[perf] Render ${id} took ${actualDuration.toFixed(1)}ms`)
    }
  }

  // --- Error tracking ---

  logError(module: string, error: Error): void {
    this.errors.push({
      timestamp: new Date().toISOString(),
      module,
      error: error.message,
      stack: error.stack,
    })
    if (this.errors.length > BUFFER_SIZE) {
      this.errors.shift()
    }
  }

  // --- Memory tracking ---

  getMemoryUsage(): { used: number; total: number; limit: number } | null {
    if (typeof performance === 'undefined') return null
    const memory = (
      performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
      }
    ).memory
    if (!memory) return null
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit,
    }
  }

  // --- Summary / Report ---

  getSummary(): Record<string, MetricSummary> {
    const grouped = new Map<string, number[]>()
    for (const entry of this.entries) {
      const arr = grouped.get(entry.name) ?? []
      arr.push(entry.duration)
      grouped.set(entry.name, arr)
    }

    const summary: Record<string, MetricSummary> = {}
    for (const [name, durations] of grouped) {
      const sorted = [...durations].sort((a, b) => a - b)
      const total = sorted.reduce((s, v) => s + v, 0)
      summary[name] = {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: total / sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        total,
      }
    }
    return summary
  }

  getErrorCount(): number {
    return this.errors.length
  }

  // --- Flush to main process ---

  flush(): void {
    if (this.entries.length === 0 && this.errors.length === 0) return

    const summary = this.getSummary()
    const memUsage = this.getMemoryUsage()
    const report = {
      timestamp: new Date().toISOString(),
      entryCount: this.entries.length,
      errorCount: this.errors.length,
      memory: memUsage,
      metrics: summary,
      recentErrors: this.errors.slice(-10),
    }

    // Send to main process if available
    if (typeof window !== 'undefined') {
      const api = (
        window as unknown as {
          api?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> }
        }
      ).api
      if (api?.invoke) {
        api
          .invoke('app:log-error', {
            message: '[Performance Report]',
            stack: JSON.stringify(report, null, 2),
            componentStack: '',
            timestamp: report.timestamp,
            retryCount: 0,
          })
          .catch(() => {
            // Silent fail - performance reporting is best-effort
          })
      }
    }

    // Debug output only when explicitly enabled (avoids console noise in production)
    if (typeof console !== 'undefined' && console.warn && ENABLED) {
      console.warn(
        '[perf] Report flushed:',
        report.entryCount,
        'entries,',
        report.errorCount,
        'errors',
      )
    }

    // Clear flushed entries but keep recent
    this.entries = this.entries.slice(-50)
    this.errors = this.errors.slice(-10)
  }

  // --- Internal helpers ---

  private addEntry(entry: PerfEntry): void {
    this.entries.push(entry)
    if (this.entries.length > BUFFER_SIZE) {
      this.entries.shift()
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    // Flush on page unload
    window.addEventListener('beforeunload', () => this.flush())
  }

  // --- Cleanup ---

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const perf = new PerformanceMonitor()

// ---------------------------------------------------------------------------
// React Profiler HOC helper
// ---------------------------------------------------------------------------

/**
 * Wrap a component with React.Profiler for automatic render timing.
 * Usage: const ProfiledApp = withProfiler(App, 'App')
 */
export function withProfiler<P extends object>(
  Component: ComponentType<P>,
  id: string,
): ComponentType<P> {
  const Wrapped = (props: P) =>
    createElement(
      Profiler,
      { id, onRender: perf.onRenderCallback },
      createElement(Component, props),
    )
  Wrapped.displayName = `withProfiler(${id})`
  return Wrapped
}
