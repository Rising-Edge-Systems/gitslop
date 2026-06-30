import React, { useMemo } from 'react'
import { Pencil } from 'lucide-react'
import styles from './RepoView.module.css'
import { RangeHighlightedContent } from './DiffViewer'
import { useInlineLineEdit } from './useInlineLineEdit'
import { buildEditableTargets, type NavItem } from '../utils/inlineEditNav'
import { type HighlightRange } from '../utils/textHighlight'

/**
 * Non-virtualized working-tree File view with in-place single-line editing.
 *
 * Every row maps 1:1 to file line `i + 1`, so the whole file is editable.
 * Hovering a row reveals a pencil; clicking it turns that one row into an
 * `<input>` seeded with the line text while the rest of the file stays
 * visible. Enter commits + moves down, Esc cancels, Arrow up/down move the
 * edit between adjacent rows (when the caret is at the respective edge).
 *
 * `editable` gates the entire affordance: a staged file shows the index
 * snapshot (read-only) so it renders no pencil and never enters edit mode.
 *
 * Find (Task 14) and selection (Task 17) highlighting are preserved: when a
 * row is not being edited it renders exactly as before via
 * `RangeHighlightedContent`, and every row keeps its `data-find-line` hook so
 * find scroll-to-match and selection-highlight DOM scanning keep working.
 */
export function FullFileEditableView({
  fileContent,
  language,
  absPath,
  editable,
  onSaved,
  findOpen,
  rangesByLine,
  selByLine
}: {
  fileContent: string
  language: string | null
  absPath: string
  editable: boolean
  onSaved: () => void
  findOpen: boolean
  rangesByLine: Map<number, HighlightRange[]>
  selByLine: Map<number, HighlightRange[]>
}): React.JSX.Element {
  const lines = useMemo(() => fileContent.split('\n'), [fileContent])

  // Every File-view row maps 1:1 to file line i+1.
  const navItems = useMemo<NavItem[]>(
    () => lines.map((_, i) => ({ type: 'line', line: { type: 'context', newLineNum: i + 1 } })),
    [lines]
  )
  const targets = useMemo(() => buildEditableTargets(navItems), [navItems])
  const lineText = useMemo(() => new Map(lines.map((l, i) => [i + 1, l] as const)), [lines])

  const edit = useInlineLineEdit({ absPath, targets, lineText, onSaved })

  return (
    <pre className={styles.fullFilePre}>
      <code>
        {lines.map((line, i) => {
          const fileLine = i + 1
          const isEditing = editable && !!edit.editing && edit.editing.focusLine === fileLine
          return (
            <div key={i} data-find-line={i} className={styles.fullFileLine}>
              <span className={styles.fullFileLineNum}>{fileLine}</span>
              <span className={styles.fullFileLineContent}>
                {isEditing ? (
                  <input
                    className={styles.inlineEditInput}
                    autoFocus
                    value={edit.buffer}
                    onChange={(e) => edit.setBuffer(e.target.value)}
                    onKeyDown={(e) => {
                      // Handle locally and stop the event before it reaches the
                      // window-level keydown listeners (e.g. Escape-closes-file).
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.stopPropagation()
                        void edit.moveDown()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        e.stopPropagation()
                        edit.cancel()
                      } else if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
                        e.preventDefault()
                        e.stopPropagation()
                        void edit.moveUp()
                      } else if (
                        e.key === 'ArrowDown' &&
                        e.currentTarget.selectionStart === e.currentTarget.value.length
                      ) {
                        e.preventDefault()
                        e.stopPropagation()
                        void edit.moveDown()
                      }
                    }}
                  />
                ) : (
                  <>
                    <RangeHighlightedContent
                      text={line}
                      language={language}
                      ranges={findOpen ? (rangesByLine.get(i) ?? []) : (selByLine.get(i) ?? [])}
                      baseClass={findOpen ? 'findMatch' : 'selectionHighlight'}
                    />
                    {editable && (
                      <button
                        className={styles.editPencil}
                        title="Edit this line"
                        onClick={() => edit.enter(fileLine)}
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          )
        })}
      </code>
    </pre>
  )
}
