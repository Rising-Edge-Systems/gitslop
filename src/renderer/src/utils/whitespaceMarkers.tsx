import React, { useEffect } from 'react'

/**
 * Wraps every space (' ') and tab ('\t') in `text` in a span carrying the
 * `ws-space` / `ws-tab` class so the global selection listener can overlay
 * the · / → markers when the character is inside the user's selection.
 *
 * Non-whitespace runs are emitted as plain strings to keep DOM count low.
 */
export function renderTextWithWhitespace(text: string, keyPrefix = ''): React.ReactNode {
  if (text.length === 0) return text
  if (!/[ \t]/.test(text)) return text

  const parts: React.ReactNode[] = []
  let segStart = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t') {
      if (i > segStart) {
        parts.push(text.slice(segStart, i))
      }
      parts.push(
        <span
          key={`${keyPrefix}w-${i}`}
          className={ch === '\t' ? 'ws-tab' : 'ws-space'}
        >
          {ch}
        </span>
      )
      segStart = i + 1
    }
  }
  if (segStart < text.length) {
    parts.push(text.slice(segStart))
  }
  return <>{parts}</>
}

/**
 * Globally installs a `selectionchange` listener that toggles the `ws-active`
 * class on every `.ws-space` / `.ws-tab` span the selection currently touches.
 * Renders the dot / arrow overlay via CSS (see global.css).
 *
 * Throttled to one update per frame because `selectionchange` fires per pixel
 * during a drag. Only one installation is allowed at a time — App-level mount.
 */
let installCount = 0

export function useWhitespaceSelectionMarkers(): void {
  useEffect(() => {
    installCount++
    if (installCount > 1) return undefined

    let rafId: number | null = null
    let lastActive: Element[] = []

    const update = (): void => {
      rafId = null
      const sel = document.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        for (const el of lastActive) el.classList.remove('ws-active')
        lastActive = []
        return
      }
      const range = sel.getRangeAt(0)
      const candidates = document.querySelectorAll<HTMLElement>('.ws-space, .ws-tab')
      const nextActive: Element[] = []
      for (const el of candidates) {
        if (range.intersectsNode(el)) {
          if (!el.classList.contains('ws-active')) el.classList.add('ws-active')
          nextActive.push(el)
        } else if (el.classList.contains('ws-active')) {
          el.classList.remove('ws-active')
        }
      }
      lastActive = nextActive
    }

    const onSelectionChange = (): void => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(update)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (rafId !== null) cancelAnimationFrame(rafId)
      for (const el of lastActive) el.classList.remove('ws-active')
      installCount--
    }
  }, [])
}
