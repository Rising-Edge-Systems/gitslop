import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Settings, Palette, GitBranch, Pencil, Keyboard, X, UserCircle, Plus, Trash2, Check, Pencil as PencilIcon } from 'lucide-react'
import type { AppSettings } from '../hooks/useSettings'
import { DEFAULT_SETTINGS } from '../hooks/useSettings'
import styles from './SettingsPanel.module.css'

interface ProfileData {
  id: string
  name: string
  authorName: string
  authorEmail: string
  isDefault: boolean
}

type SettingsSection = 'general' | 'appearance' | 'git' | 'editor' | 'keybindings' | 'profiles'

interface SettingsPanelProps {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
  onReset: () => void
  onClose: () => void
  currentRepo?: string | null
}

export function SettingsPanel({
  settings,
  onUpdate,
  onReset,
  onClose,
  currentRepo
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
    { id: 'profiles', label: 'Profiles', icon: <UserCircle size={16} /> },
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
            {activeSection === 'profiles' && (
              <ProfilesSection currentRepo={currentRepo ?? null} />
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

/* ─── Profiles Section ───────────────────────────────────────────────────── */

function ProfilesSection({ currentRepo }: { currentRepo: string | null }): React.JSX.Element {
  const [profiles, setProfiles] = useState<ProfileData[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string>('')
  const [editing, setEditing] = useState<string | null>(null) // profile id or 'new'
  const [formName, setFormName] = useState('')
  const [formAuthorName, setFormAuthorName] = useState('')
  const [formAuthorEmail, setFormAuthorEmail] = useState('')
  const [formIsDefault, setFormIsDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProfiles = useCallback(async () => {
    try {
      const list = await window.electronAPI.profiles.list()
      setProfiles(list)
      const activeId = await window.electronAPI.profiles.getActive()
      setActiveProfileId(activeId)
    } catch {
      // Ignore
    }
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const startCreate = (): void => {
    setEditing('new')
    setFormName('')
    setFormAuthorName('')
    setFormAuthorEmail('')
    setFormIsDefault(profiles.length === 0)
    setError(null)
  }

  const startEdit = (profile: ProfileData): void => {
    setEditing(profile.id)
    setFormName(profile.name)
    setFormAuthorName(profile.authorName)
    setFormAuthorEmail(profile.authorEmail)
    setFormIsDefault(profile.isDefault)
    setError(null)
  }

  const cancelEdit = (): void => {
    setEditing(null)
    setError(null)
  }

  const saveProfile = async (): Promise<void> => {
    if (!formName.trim() || !formAuthorName.trim() || !formAuthorEmail.trim()) {
      setError('All fields are required')
      return
    }

    try {
      if (editing === 'new') {
        await window.electronAPI.profiles.create({
          name: formName.trim(),
          authorName: formAuthorName.trim(),
          authorEmail: formAuthorEmail.trim(),
          isDefault: formIsDefault
        })
      } else if (editing) {
        await window.electronAPI.profiles.update(editing, {
          name: formName.trim(),
          authorName: formAuthorName.trim(),
          authorEmail: formAuthorEmail.trim(),
          isDefault: formIsDefault
        })
      }
      setEditing(null)
      setError(null)
      await loadProfiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    }
  }

  const deleteProfile = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.profiles.delete(id)
      if (editing === id) setEditing(null)
      await loadProfiles()
    } catch {
      // Ignore
    }
  }

  const applyProfile = async (id: string): Promise<void> => {
    if (!currentRepo) {
      setError('Open a repository first to apply a profile')
      return
    }
    try {
      const result = await window.electronAPI.profiles.apply(id, currentRepo)
      if (result.success) {
        setActiveProfileId(id)
        setError(null)
      } else {
        setError(result.error || 'Failed to apply profile')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply profile')
    }
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Profiles</h3>
      <p className={styles.sectionDesc}>
        Manage author identities. Switch profiles to set git user.name and user.email per repository.
      </p>

      {error && (
        <div className={styles.profileError}>{error}</div>
      )}

      {/* Profile list */}
      <div className={styles.profileList}>
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className={`${styles.profileCard} ${activeProfileId === profile.id ? styles.profileCardActive : ''}`}
          >
            {editing === profile.id ? (
              <div className={styles.profileForm}>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="Profile name (e.g. Work, Personal)"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  autoFocus
                />
                <input
                  className={styles.input}
                  type="text"
                  placeholder="Author name (user.name)"
                  value={formAuthorName}
                  onChange={(e) => setFormAuthorName(e.target.value)}
                />
                <input
                  className={styles.input}
                  type="email"
                  placeholder="Author email (user.email)"
                  value={formAuthorEmail}
                  onChange={(e) => setFormAuthorEmail(e.target.value)}
                />
                <label className={styles.profileCheckboxLabel}>
                  <input
                    type="checkbox"
                    checked={formIsDefault}
                    onChange={(e) => setFormIsDefault(e.target.checked)}
                  />
                  Default profile
                </label>
                <div className={styles.profileFormActions}>
                  <button className={styles.profileSaveBtn} onClick={saveProfile}>Save</button>
                  <button className={styles.profileCancelBtn} onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.profileInfo}>
                  <div className={styles.profileNameRow}>
                    <span className={styles.profileName}>{profile.name}</span>
                    {profile.isDefault && <span className={styles.profileDefaultBadge}>Default</span>}
                    {activeProfileId === profile.id && <span className={styles.profileActiveBadge}>Active</span>}
                  </div>
                  <span className={styles.profileDetail}>{profile.authorName} &lt;{profile.authorEmail}&gt;</span>
                </div>
                <div className={styles.profileActions}>
                  <button
                    className={styles.profileActionBtn}
                    onClick={() => applyProfile(profile.id)}
                    title="Apply this profile to current repo"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className={styles.profileActionBtn}
                    onClick={() => startEdit(profile)}
                    title="Edit profile"
                  >
                    <PencilIcon size={14} />
                  </button>
                  <button
                    className={`${styles.profileActionBtn} ${styles.profileActionBtnDanger}`}
                    onClick={() => deleteProfile(profile.id)}
                    title="Delete profile"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* New profile form */}
      {editing === 'new' ? (
        <div className={`${styles.profileCard} ${styles.profileCardNew}`}>
          <div className={styles.profileForm}>
            <input
              className={styles.input}
              type="text"
              placeholder="Profile name (e.g. Work, Personal)"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoFocus
            />
            <input
              className={styles.input}
              type="text"
              placeholder="Author name (user.name)"
              value={formAuthorName}
              onChange={(e) => setFormAuthorName(e.target.value)}
            />
            <input
              className={styles.input}
              type="email"
              placeholder="Author email (user.email)"
              value={formAuthorEmail}
              onChange={(e) => setFormAuthorEmail(e.target.value)}
            />
            <label className={styles.profileCheckboxLabel}>
              <input
                type="checkbox"
                checked={formIsDefault}
                onChange={(e) => setFormIsDefault(e.target.checked)}
              />
              Default profile
            </label>
            <div className={styles.profileFormActions}>
              <button className={styles.profileSaveBtn} onClick={saveProfile}>Create</button>
              <button className={styles.profileCancelBtn} onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <button className={styles.profileAddBtn} onClick={startCreate}>
          <Plus size={14} /> Add Profile
        </button>
      )}
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
