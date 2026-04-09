import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/global.css'

// Global error handlers for non-React errors
window.onerror = (message, source, lineno, colno, error): void => {
  console.error('[Global Error]', { message, source, lineno, colno })
  if (error?.stack) {
    console.error('[Global Error] Stack:', error.stack)
  }
}

window.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  console.error('[Unhandled Promise Rejection]', event.reason)
  if (event.reason?.stack) {
    console.error('[Unhandled Promise Rejection] Stack:', event.reason.stack)
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const root = createRoot(rootElement)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
