import React from 'react'
import { AlertOctagon, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import styles from './ErrorBoundary.module.css'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
  showStack: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showStack: false
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo })
    console.error('[ErrorBoundary] Uncaught render error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  toggleStack = (): void => {
    this.setState((prev) => ({ showStack: !prev.showStack }))
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const { error, errorInfo, showStack } = this.state
      const stackText = [
        error?.stack || error?.message || 'Unknown error',
        errorInfo?.componentStack ? `\nComponent Stack:${errorInfo.componentStack}` : ''
      ].join('')

      return (
        <div className={styles.container}>
          <AlertOctagon size={48} className={styles.icon} />
          <div className={styles.title}>Something went wrong</div>
          <div className={styles.message}>
            {error?.message || 'An unexpected error occurred in the application.'}
          </div>
          <div className={styles.actions}>
            <button className={styles.reloadBtn} onClick={this.handleReload}>
              <RefreshCw size={16} />
              Reload App
            </button>
            <button className={styles.toggleBtn} onClick={this.toggleStack}>
              {showStack ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              {showStack ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
          {showStack && (
            <div className={styles.stackTrace}>
              <pre>{stackText}</pre>
            </div>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
