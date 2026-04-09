"""
Test — Hybrid Detail Panel (Inline vs Overlay) (US-GT-011)

Verifies the detail panel switches between inline column and overlay at different widths:
- At 1500x800: clicks a commit, detail panel is inline third column
- Resizes to 1100x700: detail panel should now be overlay with backdrop shadow
- Presses Escape — overlay dismisses
- Resizes back to 1280x800, restores default state
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


class TestDetailPanelModes(GUITest):
    """Verify the detail panel switches between inline column and overlay at different widths."""

    name = 'TestDetailPanelModes'

    def setUp(self):
        """Create a test repo to open in GitSlop."""
        self._test_repo = create_test_repo()

    def tearDown(self):
        """Clean up the test repo."""
        if hasattr(self, '_test_repo') and self._test_repo:
            cleanup_test_repo(self._test_repo)

    def run(self):
        # Focus the window and set a large initial size (above DETAIL_PANEL_BREAKPOINT of 1400px)
        self.focus_window()
        self.wait(1.0)
        self.resize_window(1500, 800)
        self.wait(0.5)

        # Open the test repo in GitSlop
        open_test_repo(self, self._test_repo)
        self.wait(2.0)

        # Get window bounds
        x, y, w, h = self.get_window_bounds()

        # Ensure sidebar is expanded (Ctrl+B toggle twice to guarantee)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # 1. At 1500x800 (above 1400px breakpoint): click a commit, detail panel should be inline
        #    Click a commit row in the graph area
        commit_x = 500  # center of commit graph area
        commit_y = 160  # approximate y for first visible commit row
        self.click(commit_x, commit_y)
        self.wait(1.0)

        self.assert_visual(
            'inline_detail_panel_1500',
            'At 1500px wide window: three-column layout visible. The detail panel '
            'on the right is displayed as an inline third column alongside the sidebar '
            'and commit graph. The detail panel is part of the normal layout flow — '
            'it does NOT have a backdrop shadow or overlay appearance. The panel shows '
            'commit details such as subject, SHA, author, and changed files. '
            'All three columns (sidebar, graph, detail) are side by side.'
        )

        # 2. Resize window to 1100x700 (below the 1400px breakpoint)
        #    The detail panel should switch to overlay mode
        self.resize_window(1100, 700)
        self.wait(0.5)

        # Re-read window bounds after resize
        x, y, w, h = self.get_window_bounds()

        # Click a commit again to ensure detail panel is showing at the new size
        commit_x = 400  # adjusted for narrower window
        commit_y = 160
        self.click(commit_x, commit_y)
        self.wait(1.0)

        self.assert_visual(
            'overlay_detail_panel_1100',
            'At 1100px wide window: the detail panel is now displayed as an overlay '
            'or floating panel, NOT as an inline third column. The overlay should have '
            'a backdrop shadow or semi-transparent background behind it. The panel '
            'floats above the commit graph area rather than being a permanent column. '
            'The commit graph underneath may be partially visible or dimmed. '
            'The detail panel shows commit information (subject, SHA, author, files).'
        )

        # 3. Press Escape to dismiss the overlay
        self.press_key('Escape')
        self.wait(0.5)

        self.assert_visual(
            'overlay_dismissed',
            'The overlay detail panel has been dismissed after pressing Escape. '
            'The layout shows the sidebar on the left and the commit graph filling '
            'the remaining width. No detail panel or overlay is visible. '
            'No backdrop shadow is present. The window is at 1100x700 resolution.'
        )

        # 4. Resize back to 1280x800 and restore default state
        self.resize_window(1280, 800)
        self.wait(0.5)
        self.reset_window_size()
        self.wait(0.3)

        self.assert_visual(
            'restored_default',
            'Window has been restored to default size (1280x800). The layout shows '
            'the sidebar and commit graph in a clean two-column layout. No detail '
            'panel is open. The application looks normal at its default resolution.'
        )
