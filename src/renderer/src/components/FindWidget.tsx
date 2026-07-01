import React, { useEffect, useRef } from 'react'
import { ArrowUp, ArrowDown, X, CaseSensitive, WholeWord } from 'lucide-react'
import styles from './FindWidget.module.css'

export interface FindWidgetProps {
  query: string
  onQueryChange: (q: string) => void
  /**
   * Text to pre-fill the query with when the widget opens (the document
   * selection captured at Ctrl+F). Applied once on mount; empty means keep
   * whatever query was there before. The widget remounts on every open, so
   * mount === open.
   */
  seed?: string
  caseSensitive: boolean
  wholeWord: boolean
  onToggleCase: () => void
  onToggleWholeWord: () => void
  count: number
  currentIndex: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

export function FindWidget(props: FindWidgetProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  // On open: if text was selected at Ctrl+F, seed the query with it and select
  // it (so the user can immediately type to replace). We set the DOM value
  // directly before select() because onQueryChange only updates the controlled
  // value on the next render — too late for select() to see it. Then focus +
  // select whatever is in the input (seeded or the previous query).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    if (props.seed) {
      props.onQueryChange(props.seed)
      el.value = props.seed
    }
    el.focus()
    el.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? props.onPrev() : props.onNext() }
    else if (e.key === 'Escape') { e.preventDefault(); props.onClose() }
  }

  return (
    <div className={styles.widget}>
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Find"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        className={`${styles.toggle} ${props.caseSensitive ? styles.toggleActive : ''}`}
        title="Match Case"
        onClick={props.onToggleCase}
      ><CaseSensitive size={14} /></button>
      <button
        className={`${styles.toggle} ${props.wholeWord ? styles.toggleActive : ''}`}
        title="Match Whole Word"
        onClick={props.onToggleWholeWord}
      ><WholeWord size={14} /></button>
      <span className={styles.counter}>
        {props.count === 0 ? 'No results' : `${props.currentIndex + 1} of ${props.count}`}
      </span>
      <button className={styles.nav} title="Previous (Shift+Enter)" onClick={props.onPrev} disabled={props.count === 0}><ArrowUp size={14} /></button>
      <button className={styles.nav} title="Next (Enter)" onClick={props.onNext} disabled={props.count === 0}><ArrowDown size={14} /></button>
      <button className={styles.nav} title="Close (Esc)" onClick={props.onClose}><X size={14} /></button>
    </div>
  )
}
