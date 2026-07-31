import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

import { ErrorBoundary } from '@/components/ErrorBoundary'

// ---------------------------------------------------------------------------
// Test components
// ---------------------------------------------------------------------------

/** Always throws on render — used to drive the boundary into its error UI. */
function AlwaysBomb(): ReactNode {
  throw new Error('kaboom')
}

/**
 * Throws while `shouldThrow` is true, otherwise renders recovered content.
 * Lets a single test exercise both the error UI and a successful retry.
 */
let shouldThrow = true
function Flaky(): ReactNode {
  if (shouldThrow) throw new Error('flaky boom')
  return <div data-testid="recovered">recovered child</div>
}

// ---------------------------------------------------------------------------
// React logs caught render errors to console.error in development. These are
// expected by-products of driving an error boundary in tests, not test
// failures, so we silence them for the duration of this suite.
// ---------------------------------------------------------------------------
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  shouldThrow = true
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('ErrorBoundary', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('renders children unchanged when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">hello world</div>
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('hello world')).toBeInTheDocument()
    // The error fallback must not be rendered.
    expect(screen.queryByText('应用遇到了问题')).not.toBeInTheDocument()
  })

  it('renders multiple children wrapped in a fragment', () => {
    render(
      <ErrorBoundary>
        <>
          <span>first</span>
          <span>second</span>
        </>
      </ErrorBoundary>,
    )

    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Error UI
  // -------------------------------------------------------------------------

  it('shows the error UI when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <AlwaysBomb />
      </ErrorBoundary>,
    )

    expect(screen.getByText('应用遇到了问题')).toBeInTheDocument()
    expect(screen.getByText(/MathWeaver 遇到了一个意外错误/)).toBeInTheDocument()
    // The action buttons are rendered.
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })

  it('renders the error icon svg in the error UI', () => {
    const { container } = render(
      <ErrorBoundary>
        <AlwaysBomb />
      </ErrorBoundary>,
    )

    // The fallback includes a warning icon drawn as an inline <svg>.
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.querySelector('circle')).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Retry -> recovery
  // -------------------------------------------------------------------------

  it('resets the error state on retry and re-renders children once they recover', () => {
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )

    // Initially Flaky throws -> error UI.
    expect(screen.getByText('应用遇到了问题')).toBeInTheDocument()
    expect(screen.queryByTestId('recovered')).not.toBeInTheDocument()

    // Stop throwing, then retry.
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    // The boundary re-renders children; Flaky now renders normally.
    expect(screen.getByTestId('recovered')).toBeInTheDocument()
    expect(screen.getByText('recovered child')).toBeInTheDocument()
    // The error fallback is gone.
    expect(screen.queryByText('应用遇到了问题')).not.toBeInTheDocument()
  })

  it('returns to the error UI if the child throws again after retry', () => {
    // After a successful retry the boundary renders children (no error UI).
    // To make the child throw again we must force the boundary to re-render
    // its children — we do that by toggling the `shouldThrow` flag and
    // remounting via a `key` change.
    let shouldThrowNow = true
    function FlakyByKey(): ReactNode {
      if (shouldThrowNow) throw new Error('flaky boom')
      return <div data-testid="recovered">recovered child</div>
    }

    const { rerender } = render(
      <ErrorBoundary key="b1">
        <FlakyByKey />
      </ErrorBoundary>,
    )

    // Initially throws -> error UI.
    expect(screen.getByText('应用遇到了问题')).toBeInTheDocument()

    // Recover.
    shouldThrowNow = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByTestId('recovered')).toBeInTheDocument()

    // Break again and force a fresh mount of the boundary; it must catch.
    shouldThrowNow = true
    rerender(
      <ErrorBoundary key="b2">
        <FlakyByKey />
      </ErrorBoundary>,
    )
    expect(screen.getByText('应用遇到了问题')).toBeInTheDocument()
    expect(screen.queryByTestId('recovered')).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Retry count
  // -------------------------------------------------------------------------

  it('increments the retry count message on each retry while the child keeps failing', () => {
    render(
      <ErrorBoundary>
        <AlwaysBomb />
      </ErrorBoundary>,
    )

    // No retry message before any retry.
    expect(screen.queryByText(/已重试/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText(/已重试 1 次/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText(/已重试 2 次/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText(/已重试 3 次/)).toBeInTheDocument()
  })

  it('hides the retry-count message before the first retry', () => {
    render(
      <ErrorBoundary>
        <AlwaysBomb />
      </ErrorBoundary>,
    )

    expect(screen.queryByText(/已重试/)).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Error details toggle
  // -------------------------------------------------------------------------

  it('toggles error details visibility with the details button', () => {
    const { container } = render(
      <ErrorBoundary>
        <AlwaysBomb />
      </ErrorBoundary>,
    )

    // Details are hidden initially.
    expect(screen.getByText(/显示错误详情/)).toBeInTheDocument()
    expect(screen.queryByText(/隐藏错误详情/)).not.toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()

    // Show details.
    fireEvent.click(screen.getByText(/显示错误详情/))
    expect(screen.getByText(/隐藏错误详情/)).toBeInTheDocument()
    expect(screen.queryByText(/显示错误详情/)).not.toBeInTheDocument()

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    // The <pre> contains the error message (and the stack trace).
    expect(pre?.textContent ?? '').toContain('kaboom')

    // Hide details again.
    fireEvent.click(screen.getByText(/隐藏错误详情/))
    expect(container.querySelector('pre')).toBeNull()
    expect(screen.getByText(/显示错误详情/)).toBeInTheDocument()
  })

  it('does not show the details <pre> until the toggle is clicked', () => {
    const { container } = render(
      <ErrorBoundary>
        <AlwaysBomb />
      </ErrorBoundary>,
    )

    expect(container.querySelector('pre')).toBeNull()
    // The error message must not leak into the DOM while details are hidden.
    expect(screen.queryByText('kaboom')).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Reload action
  // -------------------------------------------------------------------------

  it('invokes window.location.reload when the 重新加载 button is clicked', () => {
    // jsdom's native location.reload throws "Not implemented: navigation", so
    // replace it with a spy for the duration of this test.
    const reloadSpy = vi.fn()
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location')
    try {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalDescriptor?.value, reload: reloadSpy },
        writable: true,
      })

      render(
        <ErrorBoundary>
          <AlwaysBomb />
        </ErrorBoundary>,
      )

      fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    } finally {
      // Best-effort restore; ignore if jsdom refuses to reset the property.
      try {
        if (originalDescriptor) {
          Object.defineProperty(window, 'location', originalDescriptor)
        }
      } catch {
        /* ignore */
      }
    }
  })
})
