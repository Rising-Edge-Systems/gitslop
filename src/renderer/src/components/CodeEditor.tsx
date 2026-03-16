import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EditorTab {
  filePath: string
  fileName: string
  content: string
  originalContent: string
  language: string
  modified: boolean
}

interface CodeEditorProps {
  repoPath: string
  /** Called when the editor saves a file — parent should refresh status */
  onFileSaved?: () => void
}

// ─── Language detection ────────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
  '.lua': 'lua',
  '.r': 'r',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.vue': 'html',
  '.svelte': 'html'
}

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase()
  // Handle special filenames
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
  if (lower === '.gitignore' || lower === '.gitattributes') return 'ini'

  const dotIndex = lower.lastIndexOf('.')
  if (dotIndex === -1) return 'plaintext'
  const ext = lower.slice(dotIndex)
  return EXT_TO_LANGUAGE[ext] || 'plaintext'
}

function getFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

// ─── Component ─────────────────────────────────────────────────────────────

export function CodeEditor({ repoPath, onFileSaved }: CodeEditorProps): React.JSX.Element {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1)
  const [showMinimap, setShowMinimap] = useState(true)
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('off')
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTab = activeTabIndex >= 0 && activeTabIndex < tabs.length ? tabs[activeTabIndex] : null

  // ─── Open a file ─────────────────────────────────────────────────────────

  const openFile = useCallback(
    async (filePath: string) => {
      // Check if already open
      const existingIndex = tabs.findIndex((t) => t.filePath === filePath)
      if (existingIndex >= 0) {
        setActiveTabIndex(existingIndex)
        return
      }

      setError(null)
      const result = await window.electronAPI.file.read(filePath)
      if (!result.success) {
        setError(result.error || 'Failed to read file')
        return
      }

      const content = result.data || ''
      const fileName = getFileName(filePath)
      const newTab: EditorTab = {
        filePath,
        fileName,
        content,
        originalContent: content,
        language: detectLanguage(fileName),
        modified: false
      }

      setTabs((prev) => [...prev, newTab])
      setActiveTabIndex(tabs.length) // will be the new last index
    },
    [tabs]
  )

  // ─── Close a tab ─────────────────────────────────────────────────────────

  const closeTab = useCallback(
    (index: number, e?: React.MouseEvent) => {
      e?.stopPropagation()
      const tab = tabs[index]
      if (tab.modified) {
        if (!confirm(`${tab.fileName} has unsaved changes. Close anyway?`)) {
          return
        }
      }
      setTabs((prev) => prev.filter((_, i) => i !== index))
      setActiveTabIndex((prev) => {
        if (prev === index) {
          // If closing the active tab, switch to the previous one or the next one
          return Math.max(0, index - 1)
        } else if (prev > index) {
          return prev - 1
        }
        return prev
      })
    },
    [tabs]
  )

  // ─── Save the active file ───────────────────────────────────────────────

  const saveActiveFile = useCallback(async () => {
    if (!activeTab || !activeTab.modified) return

    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI.file.write(activeTab.filePath, activeTab.content)
      if (!result.success) {
        setError(result.error || 'Failed to save file')
        return
      }

      // Mark as saved
      setTabs((prev) =>
        prev.map((t, i) =>
          i === activeTabIndex
            ? { ...t, modified: false, originalContent: t.content }
            : t
        )
      )
      onFileSaved?.()
    } finally {
      setSaving(false)
    }
  }, [activeTab, activeTabIndex, onFileSaved])

  // ─── Keyboard shortcuts (central registry) ──────────────────────────────

  const stableSave = useShortcutHandler(saveActiveFile)

  const editorShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      defineShortcut(
        'save-file',
        'Save File',
        'Editor',
        'Ctrl+S',
        { ctrl: true, key: 's' },
        stableSave
      )
    ],
    [stableSave]
  )

  useKeyboardShortcuts(editorShortcuts)

  // ─── Monaco editor mount ─────────────────────────────────────────────────

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor
    editor.focus()
  }, [])

  // ─── Content change handler ──────────────────────────────────────────────

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (activeTabIndex < 0) return
      const newContent = value ?? ''
      setTabs((prev) =>
        prev.map((t, i) =>
          i === activeTabIndex
            ? {
                ...t,
                content: newContent,
                modified: newContent !== t.originalContent
              }
            : t
        )
      )
    },
    [activeTabIndex]
  )

  // ─── Expose openFile to parent via ref-like pattern ──────────────────────
  // We use a custom event for inter-component communication
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ filePath: string }>).detail
      if (detail?.filePath) {
        openFile(detail.filePath)
      }
    }
    window.addEventListener('editor:open-file', handler)
    return () => window.removeEventListener('editor:open-file', handler)
  }, [openFile])

  // ─── Fix activeTabIndex if tabs change ───────────────────────────────────

  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTabIndex(-1)
    } else if (activeTabIndex >= tabs.length) {
      setActiveTabIndex(tabs.length - 1)
    }
  }, [tabs.length, activeTabIndex])

  // ─── Empty state ─────────────────────────────────────────────────────────

  if (tabs.length === 0) {
    return (
      <div className="code-editor-empty">
        <div className="code-editor-empty-icon">&#128196;</div>
        <p>No files open</p>
        <p className="code-editor-empty-hint">
          Open files from the file tree, diff viewer, or commit details
        </p>
      </div>
    )
  }

  return (
    <div className="code-editor">
      {/* Tab bar */}
      <div className="code-editor-tabs">
        <div className="code-editor-tabs-list">
          {tabs.map((tab, index) => (
            <div
              key={tab.filePath}
              className={`code-editor-tab ${index === activeTabIndex ? 'active' : ''} ${tab.modified ? 'modified' : ''}`}
              onClick={() => setActiveTabIndex(index)}
              title={tab.filePath}
            >
              <span className="code-editor-tab-name">{tab.fileName}</span>
              {tab.modified && <span className="code-editor-tab-dot" title="Unsaved changes" />}
              <button
                className="code-editor-tab-close"
                onClick={(e) => closeTab(index, e)}
                title="Close"
              >
                &#10005;
              </button>
            </div>
          ))}
        </div>
        <div className="code-editor-tabs-actions">
          <button
            className="code-editor-action-btn"
            onClick={() => setWordWrap((prev) => (prev === 'on' ? 'off' : 'on'))}
            title={`Word Wrap: ${wordWrap}`}
          >
            {wordWrap === 'on' ? '&#8629;' : '&#8594;'}
          </button>
          <button
            className="code-editor-action-btn"
            onClick={() => setShowMinimap((prev) => !prev)}
            title={`Minimap: ${showMinimap ? 'On' : 'Off'}`}
          >
            &#9638;
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="code-editor-error">
          <span>&#9888; {error}</span>
          <button onClick={() => setError(null)}>&#10005;</button>
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div className="code-editor-saving">Saving...</div>
      )}

      {/* Editor */}
      {activeTab && (
        <div className="code-editor-monaco">
          <Editor
            key={activeTab.filePath}
            defaultValue={activeTab.content}
            language={activeTab.language}
            theme="vs-dark"
            onMount={handleEditorMount}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: showMinimap },
              wordWrap,
              lineNumbers: 'on',
              fontSize: 13,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              renderWhitespace: 'selection',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              padding: { top: 8 }
            }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Helper to open files from other components ────────────────────────────

export function openFileInEditor(filePath: string): void {
  window.dispatchEvent(
    new CustomEvent('editor:open-file', { detail: { filePath } })
  )
}
