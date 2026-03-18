"""
Test — Welcome Screen (US-GT-005)

Verifies the welcome screen renders correctly with all expected elements:
- GS wordmark, GitSlop title, subtitle
- Three action cards (Open/Clone/Init) with Lucide icons
- Keyboard shortcut hints
- Recent Repositories section
- No emoji
- Toolbar shows only Open, Clone, Init (no Pull/Push/Fetch)
- Status bar shows 'No repository open'
- Theme toggle (dark/light) works
"""

import importlib.util
import sys
from pathlib import Path

# Import framework via file path (package name has hyphen)
_framework_path = Path(__file__).resolve().parent.parent / 'framework.py'
if 'gui_tests.framework' not in sys.modules:
    _spec = importlib.util.spec_from_file_location('gui_tests.framework', str(_framework_path))
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules['gui_tests.framework'] = _mod
    _spec.loader.exec_module(_mod)

from gui_tests.framework import GUITest  # noqa: E402


class TestWelcomeScreen(GUITest):
    """Verify the welcome screen renders correctly with all expected elements."""

    name = 'TestWelcomeScreen'

    def run(self):
        # Relaunch app without any repo to see welcome screen
        import subprocess
        try:
            subprocess.run(['pkill', '-f', 'electron/dist/electron'],
                           capture_output=True, timeout=5)
        except Exception:
            pass
        self.wait(1)

        import os
        env = os.environ.copy()
        env['DISPLAY'] = ':1'
        project_root = str(Path(__file__).resolve().parent.parent.parent.parent)
        subprocess.Popen(
            ['npx', 'electron', '--no-sandbox', '.'],
            cwd=project_root, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.wait(5)

        # Focus and wait for window to be ready
        self.focus_window()
        self.wait(1.0)

        # Get window bounds for coordinate calculations
        x, y, w, h = self.get_window_bounds()

        # 1. Take screenshot of the welcome screen in dark theme (default)
        self.assert_visual(
            'welcome_dark',
            'Welcome screen in dark theme: GS wordmark visible, GitSlop title, '
            'subtitle text, three action cards (Open Repository, Clone Repository, '
            'Init Repository) with Lucide icons (FolderOpen, GitFork, FolderPlus), '
            'keyboard shortcut hints on cards, Recent Repositories section visible, '
            'no emoji anywhere on screen'
        )

        # 2. Verify toolbar shows only Open, Clone, Init (no Pull/Push/Fetch)
        #    Toolbar is at the top of the window, below the titlebar
        self.assert_visual(
            'welcome_toolbar',
            'Toolbar shows only Open, Clone, Init buttons (no Pull, Push, Fetch, '
            'Branch, Merge, or Stash buttons visible). Settings gear icon on far right. '
            'All icons are Lucide (no emoji).'
        )

        # 3. Verify status bar shows 'No repository open'
        #    Status bar is at the very bottom of the window
        self.assert_visual(
            'welcome_statusbar',
            'Status bar at bottom shows "No repository open" text. No branch name visible. '
            'Status bar is a thin strip at the very bottom of the window.'
        )

        # 4. Toggle theme to light mode
        #    Theme toggle button (Sun/Moon icon) is in the titlebar area, top-right
        #    Approximate position: near window controls, about 80-100px from right edge, ~15px from top
        theme_toggle_x = w - 90
        theme_toggle_y = 15
        self.click(theme_toggle_x, theme_toggle_y)
        self.wait(0.5)

        # 5. Take screenshot of welcome screen in light theme
        self.assert_visual(
            'welcome_light',
            'Welcome screen in light theme: light/white background, dark text, '
            'GS wordmark visible, GitSlop title, three action cards clearly visible '
            'with good contrast, all UI elements readable in light mode, no emoji'
        )

        # 6. Toggle back to dark theme
        self.click(theme_toggle_x, theme_toggle_y)
        self.wait(0.5)

        # 7. Confirmation screenshot back in dark theme
        self.assert_visual(
            'welcome_dark_restored',
            'Welcome screen restored to dark theme after toggling back from light theme'
        )
