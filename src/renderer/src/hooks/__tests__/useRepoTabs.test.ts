// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useRepoTabs } from '../useRepoTabs'

// ─── localStorage mock ───────────────────────────────────────────────────────

const localStorageData: Record<string, string> = {}

beforeEach(() => {
  // Clear storage
  Object.keys(localStorageData).forEach((key) => delete localStorageData[key])

  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => localStorageData[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageData[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageData[key]
    }),
    clear: vi.fn(() => {
      Object.keys(localStorageData).forEach((key) => delete localStorageData[key])
    })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useRepoTabs', () => {
  describe('initial state', () => {
    it('starts with empty tabs and no active tab', () => {
      const { result } = renderHook(() => useRepoTabs())

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTab).toBeNull()
      expect(result.current.activeIndex).toBe(-1)
      expect(result.current.activeRepoPath).toBeNull()
    })
  })

  describe('openTab', () => {
    it('adds a new tab and makes it active', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/home/user/repo-a')
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].repoPath).toBe('/home/user/repo-a')
      expect(result.current.tabs[0].name).toBe('repo-a')
      expect(result.current.activeIndex).toBe(0)
      expect(result.current.activeRepoPath).toBe('/home/user/repo-a')
    })

    it('extracts repo name from path', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/home/user/projects/my-project')
      })

      expect(result.current.tabs[0].name).toBe('my-project')
    })

    it('switches to existing tab if repo is already open', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.openTab('/repo-a') // Re-open existing
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.activeIndex).toBe(0) // Switched back to first tab
    })

    it('opens multiple tabs', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.openTab('/repo-c')
      })

      expect(result.current.tabs).toHaveLength(3)
      expect(result.current.activeIndex).toBe(2) // Last opened
    })
  })

  describe('closeTab', () => {
    it('removes a tab', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.closeTab(0)
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].repoPath).toBe('/repo-b')
    })

    it('closing the last tab sets activeIndex to -1', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.closeTab(0)
      })

      expect(result.current.tabs).toHaveLength(0)
      expect(result.current.activeIndex).toBe(-1)
      expect(result.current.activeTab).toBeNull()
    })

    it('closing active tab switches to previous tab', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.openTab('/repo-c')
      })
      // Active is index 2 (/repo-c)
      act(() => {
        result.current.closeTab(2)
      })

      expect(result.current.activeIndex).toBe(1) // Falls back to /repo-b
    })

    it('closing tab before active adjusts activeIndex', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.openTab('/repo-c')
      })
      // Active is index 2
      act(() => {
        result.current.closeTab(0) // Close first tab
      })

      expect(result.current.activeIndex).toBe(1) // Shifted left
      expect(result.current.activeRepoPath).toBe('/repo-c')
    })

    it('ignores invalid index', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.closeTab(-1)
      })
      act(() => {
        result.current.closeTab(5)
      })

      expect(result.current.tabs).toHaveLength(1)
    })
  })

  describe('switchTab', () => {
    it('switches to a different tab', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.switchTab(0)
      })

      expect(result.current.activeIndex).toBe(0)
      expect(result.current.activeRepoPath).toBe('/repo-a')
    })

    it('ignores invalid index', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.switchTab(5)
      })

      expect(result.current.activeIndex).toBe(0)
    })
  })

  describe('nextTab / prevTab', () => {
    it('cycles forward through tabs', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.openTab('/repo-c')
      })
      // Active is 2 (/repo-c)
      act(() => {
        result.current.nextTab()
      })
      expect(result.current.activeIndex).toBe(0) // Wraps around

      act(() => {
        result.current.nextTab()
      })
      expect(result.current.activeIndex).toBe(1)
    })

    it('cycles backward through tabs', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.openTab('/repo-c')
      })
      act(() => {
        result.current.switchTab(0)
      })
      act(() => {
        result.current.prevTab()
      })
      expect(result.current.activeIndex).toBe(2) // Wraps to end
    })

    it('does nothing with only one tab', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.nextTab()
      })
      expect(result.current.activeIndex).toBe(0)

      act(() => {
        result.current.prevTab()
      })
      expect(result.current.activeIndex).toBe(0)
    })
  })

  describe('reorderTabs', () => {
    it('moves a tab to a new position', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.openTab('/repo-c')
      })
      act(() => {
        result.current.switchTab(0)
      })
      act(() => {
        result.current.reorderTabs(0, 2) // Move first to last
      })

      expect(result.current.tabs[0].repoPath).toBe('/repo-b')
      expect(result.current.tabs[1].repoPath).toBe('/repo-c')
      expect(result.current.tabs[2].repoPath).toBe('/repo-a')
      // Active tab follows the moved tab
      expect(result.current.activeIndex).toBe(2)
    })

    it('ignores invalid indices', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.reorderTabs(-1, 1)
      })
      act(() => {
        result.current.reorderTabs(0, 5)
      })
      act(() => {
        result.current.reorderTabs(0, 0) // Same position
      })

      expect(result.current.tabs[0].repoPath).toBe('/repo-a')
      expect(result.current.tabs[1].repoPath).toBe('/repo-b')
    })
  })

  describe('per-tab state', () => {
    it('returns default state for unknown repo path', () => {
      const { result } = renderHook(() => useRepoTabs())

      const state = result.current.getTabState('/unknown/repo')
      expect(state).toEqual({
        selectedCommitHash: null,
        sidebarCollapsed: false,
        detailPanelOpen: false,
        graphScrollOffset: 0
      })
    })

    it('saves and retrieves per-tab state', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.saveTabState('/repo-a', {
          selectedCommitHash: 'abc123',
          sidebarCollapsed: true
        })
      })

      const state = result.current.getTabState('/repo-a')
      expect(state.selectedCommitHash).toBe('abc123')
      expect(state.sidebarCollapsed).toBe(true)
      expect(state.detailPanelOpen).toBe(false) // Default preserved
    })

    it('maintains separate state for different repos', () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })
      act(() => {
        result.current.openTab('/repo-b')
      })
      act(() => {
        result.current.saveTabState('/repo-a', { selectedCommitHash: 'aaa' })
      })
      act(() => {
        result.current.saveTabState('/repo-b', { selectedCommitHash: 'bbb' })
      })

      expect(result.current.getTabState('/repo-a').selectedCommitHash).toBe('aaa')
      expect(result.current.getTabState('/repo-b').selectedCommitHash).toBe('bbb')
    })
  })

  describe('persistence', () => {
    it('saves tabs to localStorage after debounce', async () => {
      const { result } = renderHook(() => useRepoTabs())

      act(() => {
        result.current.openTab('/repo-a')
      })

      // Wait for debounce (300ms) to flush
      await delay(400)

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'gitslop-repo-tabs',
        expect.any(String)
      )

      const calls = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls
      const tabSaves = calls.filter(([key]: string[]) => key === 'gitslop-repo-tabs')
      const lastSave = tabSaves[tabSaves.length - 1]
      const saved = JSON.parse(lastSave?.[1] || '{}')
      expect(saved.tabs).toHaveLength(1)
      expect(saved.tabs[0].repoPath).toBe('/repo-a')
    })

    it('restores tabs from localStorage on mount', () => {
      const stored = {
        tabs: [
          { repoPath: '/repo-x', name: 'repo-x' },
          { repoPath: '/repo-y', name: 'repo-y' }
        ],
        activeIndex: 1
      }
      localStorageData['gitslop-repo-tabs'] = JSON.stringify(stored)

      const { result } = renderHook(() => useRepoTabs())

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.activeIndex).toBe(1)
      expect(result.current.activeRepoPath).toBe('/repo-y')
    })

    it('handles corrupted localStorage gracefully', () => {
      localStorageData['gitslop-repo-tabs'] = '{invalid json'

      const { result } = renderHook(() => useRepoTabs())

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeIndex).toBe(-1)
    })
  })
})
