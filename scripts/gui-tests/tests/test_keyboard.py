"""
Test — Keyboard Shortcuts (US-GT-019)

Verifies all major keyboard shortcuts trigger correct actions:
- Ctrl+B: sidebar toggles (expanded to collapsed or vice versa)
- Ctrl+`: terminal panel toggles on/off
- Ctrl+K: search/command palette opens
- Ctrl+Shift+F: fetch operation starts (spinner visible in toolbar)
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

# Import fixtures
_fixtures_path = Path(__file__).resolve().parent.parent / 'fixtures.py'
if 'gui_tests.fixtures' not in sys.modules:
    _spec2 = importlib.util.spec_from_file_location('gui_tests.fixtures', str(_fixtures_path))
    _mod2 = importlib.util.module_from_spec(_spec2)
    sys.modules['gui_tests.fixtures'] = _mod2
    _spec2.loader.exec_module(_mod2)

from gui_tests.fixtures import create_test_repo, cleanup_test_repo, open_test_repo  # noqa: E402


class TestKeyboardShortcuts(GUITest):
    """Verify all major keyboard shortcuts trigger correct actions."""

    name = 'TestKeyboardShortcuts'

    def setUp(self):
        """Create a test repo to open in GitSlop."""
        self._test_repo = create_test_repo()

    def tearDown(self):
        """Clean up the test repo."""
        if hasattr(self, '_test_repo') and self._test_repo:
            cleanup_test_repo(self._test_repo)

    def run(self):
        # Focus the window and open repo
        self.focus_window()
        self.wait(1.0)

        # Open the test repo in GitSlop
        open_test_repo(self, self._test_repo)
        self.wait(2.0)

        # Ensure sidebar is expanded first (toggle twice to guarantee expanded)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # ---- 1. Ctrl+B: Sidebar toggle ----
        # Take "before" screenshot with sidebar expanded
        self.assert_visual(
            'keyboard_sidebar_before',
            'The sidebar is visible on the left in its fully expanded state, showing '
            'Branches/Files tabs with section content and branch names visible. '
            'The sidebar has a reasonable width (around 200-280px). The toolbar is '
            'at the top and the commit graph is in the center area.'
        )

        # Press Ctrl+B to collapse sidebar
        self.press_key('ctrl+b')
        self.wait(0.5)

        # Take "after" screenshot with sidebar collapsed
        self.assert_visual(
            'keyboard_sidebar_collapsed',
            'After pressing Ctrl+B, the sidebar has collapsed. It is either fully '
            'hidden or collapsed to a narrow icon rail (approximately 48px wide) '
            'showing only section icons without text labels. The main content area '
            '(commit graph) has expanded to fill the space previously occupied by '
            'the sidebar. This is visibly different from the previous screenshot.'
        )

        # Press Ctrl+B again to restore sidebar
        self.press_key('ctrl+b')
        self.wait(0.5)

        # Take screenshot confirming sidebar is restored
        self.assert_visual(
            'keyboard_sidebar_restored',
            'After pressing Ctrl+B again, the sidebar has been restored to its '
            'expanded state. The sidebar shows Branches/Files tabs with section '
            'content visible again. The layout matches the initial "before" state.'
        )

        # ---- 2. Ctrl+`: Terminal toggle ----
        # Press Ctrl+` to open terminal
        self.press_key('ctrl+grave')
        self.wait(0.5)

        # Take screenshot showing terminal panel
        self.assert_visual(
            'keyboard_terminal_open',
            'After pressing Ctrl+`, a terminal panel has appeared at the bottom of '
            'the window. The terminal area shows a dark panel below the commit graph '
            'area. The terminal may show a command prompt or shell interface. '
            'The commit graph area above has shrunk vertically to make room for '
            'the terminal panel at the bottom.'
        )

        # Press Ctrl+` again to hide terminal
        self.press_key('ctrl+grave')
        self.wait(0.5)

        # Take screenshot confirming terminal is hidden
        self.assert_visual(
            'keyboard_terminal_closed',
            'After pressing Ctrl+` again, the terminal panel at the bottom has been '
            'hidden/closed. The commit graph area has expanded back to fill the full '
            'vertical space. No terminal panel is visible at the bottom of the window.'
        )

        # ---- 3. Ctrl+K: Search/command palette ----
        # Press Ctrl+K to open search/command palette
        self.press_key('ctrl+k')
        self.wait(0.5)

        # Take screenshot showing command palette
        self.assert_visual(
            'keyboard_command_palette',
            'After pressing Ctrl+K, a search/command palette has appeared. This is '
            'typically a modal dialog or overlay centered on the screen with a search '
            'input field at the top. The palette may show a list of available commands '
            'or search results below the input. It floats above the main content with '
            'a backdrop or shadow effect.'
        )

        # Press Escape to close palette
        self.press_key('Escape')
        self.wait(0.5)

        # Take screenshot confirming palette is closed
        self.assert_visual(
            'keyboard_palette_closed',
            'After pressing Escape, the search/command palette has been dismissed. '
            'The main application is fully visible without any modal overlay. '
            'The commit graph and sidebar are visible in their normal state.'
        )

        # ---- 4. Ctrl+Shift+F: Fetch operation ----
        # Press Ctrl+Shift+F to trigger fetch
        self.press_key('ctrl+shift+f')
        self.wait(0.3)

        # Take screenshot quickly to catch the spinner
        self.assert_visual(
            'keyboard_fetch_triggered',
            'After pressing Ctrl+Shift+F, a fetch operation has been triggered. '
            'The toolbar may show an inline spinner on the Fetch button indicating '
            'the operation is in progress. Alternatively, a toast notification may '
            'appear indicating the fetch has started or completed. There may be '
            'visual feedback in the toolbar area showing the fetch operation state.'
        )

        # Wait for fetch to complete
        self.wait(2.0)

        # Restore sidebar to expanded state at end of test
        self.press_key('ctrl+b')
        self.wait(0.3)
        self.press_key('ctrl+b')
        self.wait(0.3)
