// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ErrorBoundary } from '../ErrorBoundary'

// ─── Helper: a component that throws during render ───────────────────────────

function ThrowingComponent({ message }: { message: string }): React.ReactElement {
  throw new Error(message)
}

function GoodComponent(): React.ReactElement {
  return <div data-testid="child">Hello, World!</div>
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ErrorBoundary', () => {
  // Suppress React's error boundary console.error noise during tests
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    originalConsoleError = console.error
    console.error = vi.fn()
  })

  afterEach(() => {
    cleanup()
    console.error = originalConsoleError
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>
    )
    expect(screen.getByTestId('child')).toBeTruthy()
    expect(screen.getByText('Hello, World!')).toBeTruthy()
  })

  it('displays fallback UI when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test render crash" />
      </ErrorBoundary>
    )

    // Should show the error heading
    expect(screen.getByText('Something went wrong')).toBeTruthy()

    // Should show the error message
    expect(screen.getByText('Test render crash')).toBeTruthy()

    // Should show Reload App button
    expect(screen.getByText('Reload App')).toBeTruthy()

    // Should show Show Details toggle button
    expect(screen.getByText('Show Details')).toBeTruthy()
  })

  it('does not show stack trace by default', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Hidden stack crash" />
      </ErrorBoundary>
    )

    // The pre element for stack trace should not be visible
    const pre = document.querySelector('pre')
    expect(pre).toBeNull()
  })

  it('toggles stack trace visibility when Show Details is clicked', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Toggle stack crash" />
      </ErrorBoundary>
    )

    // Click "Show Details"
    const toggleBtn = screen.getByText('Show Details')
    fireEvent.click(toggleBtn)

    // Stack trace should now be visible
    const pre = document.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('Toggle stack crash')

    // Button text should change to "Hide Details"
    expect(screen.getByText('Hide Details')).toBeTruthy()

    // Click again to hide
    fireEvent.click(screen.getByText('Hide Details'))
    expect(document.querySelector('pre')).toBeNull()
    expect(screen.getByText('Show Details')).toBeTruthy()
  })

  it('calls window.location.reload when Reload App is clicked', () => {
    // Mock window.location.reload
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true
    })

    render(
      <ErrorBoundary>
        <ThrowingComponent message="Reload test crash" />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByText('Reload App'))
    expect(reloadMock).toHaveBeenCalledOnce()
  })

  it('logs error to console via componentDidCatch', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Console log crash" />
      </ErrorBoundary>
    )

    // console.error should have been called by the ErrorBoundary (and React internals)
    const consoleErrorMock = console.error as ReturnType<typeof vi.fn>
    const calls = consoleErrorMock.mock.calls.flat().map(String)
    const hasBoundaryLog = calls.some((c) => c.includes('[ErrorBoundary]'))
    expect(hasBoundaryLog).toBe(true)
  })
})
