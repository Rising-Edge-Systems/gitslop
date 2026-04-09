import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Settings, Palette, GitBranch, Pencil, Keyboard, X } from 'lucide-react'
import type { AppSettings } from '../hooks/useSettings'
import { DEFAULT_SETTINGS } from '../hooks/useSettings'
import styles from './SettingsPanel.module.css'

type SettingsSection = 'general' | 'appearance' | 'git' | 'editor' | 'keybindings'

interface SettingsPanelProps {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
  onReset: () => void
  onClose: () => void
}

export function SettingsPanel({
  settings,
  onUpdate,
  onReset,
  onClose
}: SettingsPanelProps): React.JSX.Element {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <Settings size={16} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
    { id: 'git', label: 'Git', icon: <GitBranch size={16} /> },
    { id: 'editor', label: 'Editor', icon: <Pencil size={16} /> },
    { id: 'keybindings', label: 'Keybindings', icon: <Keyboard size={16} /> }
  ]

  const handleBrowseCloneDir = useCallback(async () => {
    const dir = await window.electronAPI.dialog.openDirectory()
    if (dir) {
      onUpdate({ defaultCloneDirectory: dir })
    }
  }, [onUpdate])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Sidebar nav */}
          <nav className={styles.nav}>
            {sections.map((s) => (
              <button
                key={s.id}
                className={`${styles.navItem} ${activeSection === s.id ? styles.navItemActive : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                <span className={styles.navIcon}>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className={styles.content}>
            {activeSection === 'general' && (
              <GeneralSection
                settings={settings}
                onUpdate={onUpdate}
                onBrowseCloneDir={handleBrowseCloneDir}
              />
            )}
            {activeSection === 'appearance' && (
              <AppearanceSection settings={settings} onUpdate={onUpdate} />
            )}
            {activeSection === 'git' && (
              <GitSection settings={settings} onUpdate={onUpdate} />
            )}
            {activeSection === 'editor' && (
              <EditorSection settings={settings} onUpdate={onUpdate} />
            )}
            {activeSection === 'keybindings' && (
              <KeybindingsSection />
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.resetBtn} onClick={onReset}>
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── General Section ─────────────────────────────────────────────────────── */

function GeneralSection({
  settings,
  onUpdate,
  onBrowseCloneDir
}: {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
  onBrowseCloneDir: () => void
}): React.JSX.Element {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>General</h3>

      <SettingsRow label="Default Clone Directory" description="Default folder for cloned repositories">
        <div className={styles.inputWithBtn}>
          <input
            className={styles.input}
            type="text"
            value={settings.defaultCloneDirectory}
            onChange={(e) => onUpdate({ defaultCloneDirectory: e.target.value })}
            placeholder="Not set (will use system default)"
          />
          <button className={styles.browseBtn} onClick={onBrowseCloneDir}>
            Browse
          </button>
        </div>
      </SettingsRow>

      <SettingsRow label="Auto-Fetch Interval" description="How often to fetch from remotes (0 to disable)">
        <div className={styles.inputGroup}>
          <input
            className={`${styles.input} ${styles.inputSmall}`}
            type="number"
            min={0}
            max={60}
            value={settings.autoFetchInterval}
            onChange={(e) => onUpdate({ autoFetchInterval: Math.max(0, parseInt(e.target.value) || 0) })}
          />
          <span className={styles.inputSuffix}>minutes</span>
        </div>
      </SettingsRow>

      <SettingsRow label="Proxy URL" description="HTTP/SOCKS proxy for git operations (e.g. http://proxy:8080)">
        <input
          className={styles.input}
          type="text"
          value={settings.proxyUrl}
          onChange={(e) => onUpdate({ proxyUrl: e.target.value })}
          placeholder="No proxy"
        />
      </SettingsRow>
    </div>
  )
}

/* ─── Appearance Section ──────────────────────────────────────────────────── */

function AppearanceSection({
  settings,
  onUpdate
}: {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
}): React.JSX.Element {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Appearance</h3>

      <SettingsRow label="Theme" description="Choose between dark and light theme">
        <select
          className={styles.select}
          value={settings.theme}
          onChange={(e) => onUpdate({ theme: e.target.value as 'dark' | 'light' })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Font Family" description="Override the application font (leave empty for default)">
        <input
          className={styles.input}
          type="text"
          value={settings.fontFamily}
          onChange={(e) => onUpdate({ fontFamily: e.target.value })}
          placeholder="System default"
        />
      </SettingsRow>

      <SettingsRow label="Font Size" description="Base font size for the application">
        <div className={styles.inputGroup}>
          <input
            className={`${styles.input} ${styles.inputSmall}`}
            type="number"
            min={10}
            max={24}
            value={settings.fontSize}
            onChange={(e) => {
              const val = parseInt(e.target.value) || DEFAULT_SETTINGS.fontSize
              onUpdate({ fontSize: Math.min(24, Math.max(10, val)) })
            }}
          />
          <span className={styles.inputSuffix}>px</span>
        </div>
      </SettingsRow>

      <SettingsRow label="Sidebar Position" description="Place the sidebar on the left or right side">
        <select
          className={styles.select}
          value={settings.sidebarPosition}
          onChange={(e) => onUpdate({ sidebarPosition: e.target.value as 'left' | 'right' })}
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </SettingsRow>
    </div>
  )
}

/* ─── Git Section ─────────────────────────────────────────────────────────── */

interface GpgKeyOption {
  keyId: string
  uid: string
  fingerprint: string
}

function GitSection({
  settings,
  onUpdate
}: {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
}): React.JSX.Element {
  const [gpgKeys, setGpgKeys] = useState<GpgKeyOption[]>([])
  const [gpgKeysLoading, setGpgKeysLoading] = useState(false)
  const [gpgKeysError, setGpgKeysError] = useState<string | null>(null)

  // Load GPG keys when sign commits is enabled
  useEffect(() => {
    if (settings.signCommits) {
      setGpgKeysLoading(true)
      setGpgKeysError(null)
      window.electronAPI.git.getAvailableGpgKeys().then((result) => {
        if (result.success && Array.isArray(result.data)) {
          setGpgKeys(result.data as GpgKeyOption[])
          if (result.data.length === 0) {
            setGpgKeysError('No GPG keys found. Install GPG and generate a key first.')
          }
        } else {
          setGpgKeysError('Could not list GPG keys. Is GPG installed?')
          setGpgKeys([])
        }
        setGpgKeysLoading(false)
      })
    }
  }, [settings.signCommits])

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Git</h3>

      <SettingsRow label="Default Pull Strategy" description="How to integrate remote changes when pulling">
        <select
          className={styles.select}
          value={settings.defaultPullStrategy}
          onChange={(e) => onUpdate({ defaultPullStrategy: e.target.value as 'merge' | 'rebase' })}
        >
          <option value="merge">Merge</option>
          <option value="rebase">Rebase</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Sign Commits (GPG)" description="Sign commits with GPG key by default">
        <SettingsToggle
          checked={settings.signCommits}
          onChange={(checked) => onUpdate({ signCommits: checked })}
        />
      </SettingsRow>

      {settings.signCommits && (
        <SettingsRow label="GPG Signing Key" description="Select which GPG key to use for signing commits">
          {gpgKeysLoading ? (
            <span className={styles.rowDesc}>Loading GPG keys...</span>
          ) : gpgKeysError ? (
            <span className={styles.rowDesc} style={{ color: 'var(--color-error, #f44)' }}>{gpgKeysError}</span>
          ) : (
            <select
              className={styles.select}
              value={settings.gpgKeyId}
              onChange={(e) => onUpdate({ gpgKeyId: e.target.value })}
            >
              <option value="">Default (from git config)</option>
              {gpgKeys.map((key) => (
                <option key={key.keyId} value={key.keyId}>
                  {key.uid} ({key.keyId.slice(-8)})
                </option>
              ))}
            </select>
          )}
        </SettingsRow>
      )}

      <SettingsRow label="Auto-Stash on Pull" description="Automatically stash changes before pulling and re-apply after">
        <SettingsToggle
          checked={settings.autoStashOnPull}
          onChange={(checked) => onUpdate({ autoStashOnPull: checked })}
        />
      </SettingsRow>

      <SettingsRow label="Default Branch Name" description="Name for new branches when initializing a repository">
        <input
          className={`${styles.input} ${styles.inputMedium}`}
          type="text"
          value={settings.defaultBranchName}
          onChange={(e) => onUpdate({ defaultBranchName: e.target.value })}
          placeholder="main"
        />
      </SettingsRow>
    </div>
  )
}

/* ─── Editor Section ──────────────────────────────────────────────────────── */

function EditorSection({
  settings,
  onUpdate
}: {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
}): React.JSX.Element {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Editor</h3>

      <SettingsRow label="Tab Size" description="Number of spaces per tab">
        <select
          className={styles.select}
          value={settings.tabSize}
          onChange={(e) => onUpdate({ tabSize: parseInt(e.target.value) || 4 })}
        >
          <option value="2">2</option>
          <option value="4">4</option>
          <option value="8">8</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Word Wrap" description="Wrap long lines in the editor">
        <SettingsToggle
          checked={settings.wordWrap}
          onChange={(checked) => onUpdate({ wordWrap: checked })}
        />
      </SettingsRow>

      <SettingsRow label="Minimap" description="Show a minimap overview in the editor">
        <SettingsToggle
          checked={settings.minimapEnabled}
          onChange={(checked) => onUpdate({ minimapEnabled: checked })}
        />
      </SettingsRow>
    </div>
  )
}

/* ─── Keybindings Section ─────────────────────────────────────────────────── */

function KeybindingsSection(): React.JSX.Element {
  // Import at runtime to avoid circular deps
  const [shortcuts, setShortcuts] = useState<{ id: string; label: string; category: string; keys: string }[]>([])

  useEffect(() => {
    // Dynamic import to get the registry snapshot
    import('../hooks/useKeyboardShortcuts').then(({ getRegisteredShortcuts, subscribeToRegistry }) => {
      const update = (): void => {
        setShortcuts(
          getRegisteredShortcuts().map((s) => ({
            id: s.id,
            label: s.label,
            category: s.category,
            keys: s.keys
          }))
        )
      }
      update()
      const unsub = subscribeToRegistry(update)
      return unsub
    })
  }, [])

  // Group by category
  const grouped = shortcuts.reduce<Record<string, typeof shortcuts>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Keybindings</h3>
      <p className={styles.sectionDesc}>
        All currently registered keyboard shortcuts. Customization coming soon.
      </p>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className={styles.keybindingsGroup}>
          <h4 className={styles.keybindingsCategory}>{category}</h4>
          <div className={styles.keybindingsList}>
            {items.map((s) => (
              <div key={s.id} className={styles.keybindingRow}>
                <span className={styles.keybindingLabel}>{s.label}</span>
                <kbd className={styles.keybindingKeys}>{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── Reusable sub-components ─────────────────────────────────────────────── */

function SettingsRow({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={styles.row}>
      <div className={styles.rowInfo}>
        <label className={styles.rowLabel}>{label}</label>
        {description && <span className={styles.rowDesc}>{description}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

function SettingsToggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <button
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={styles.toggleThumb} />
    </button>
  )
}
