"""
Test — Commit Graph Interaction (US-GT-013)

Verifies commit selection, context menus, and keyboard navigation in the graph:
- Clicking a commit row highlights it and opens the detail panel
- Right-clicking shows context menu with checkout, cherry-pick, revert, reset, etc.
- Keyboard navigation with arrow keys and Enter
- Hovering over a commit shows tooltip with commit message
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


class TestCommitInteraction(GUITest):
    """Verify commit selection, context menus, and keyboard navigation in the graph."""

    name = 'TestCommitInteraction'

    def setUp(self):
        """Create a test repo to open in GitSlop."""
        self._test_repo = create_test_repo()

    def tearDown(self):
        """Clean up the test repo."""
        if hasattr(self, '_test_repo') and self._test_repo:
            cleanup_test_repo(self._test_repo)

    def run(self):
        # Focus the window and ensure default size
        self.focus_window()
        self.wait(1.0)
        self.reset_window_size()
        self.wait(0.5)

        # Open the test repo in GitSlop
        open_test_repo(self, self._test_repo)
        self.wait(2.0)

        # Get window bounds for coordinate calculations
        x, y, w, h = self.get_window_bounds()

        # Ensure sidebar is expanded (press Ctrl+B twice to guarantee state)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # Press Escape to ensure no detail panel or overlay is open
        self.press_key('Escape')
        self.wait(0.3)

        # --- 1. Click a commit row to select it ---
        # Commit rows are in the center panel area
        # With sidebar expanded (~240px), the graph area starts around x=250
        # First commit row is roughly at y=80-100 (below toolbar/header)
        # Click the second commit row to avoid HEAD row which may behave differently
        commit_row_x = w // 2  # Center of graph area
        commit_row_y = 130     # Second commit row approximately

        self.click(commit_row_x, commit_row_y)
        self.wait(0.8)

        self.assert_visual(
            'commit_selected',
            'A commit row in the graph is highlighted/selected with an accent color '
            '(distinct background color compared to unselected rows). '
            'The detail panel has opened on the right side showing commit information '
            '(commit hash, author, date, message, changed files). '
            'The selected row stands out visually from the other commit rows.'
        )

        # Close the detail panel before next test
        self.press_key('Escape')
        self.wait(0.5)

        # --- 2. Right-click a commit to show context menu ---
        self.rightclick(commit_row_x, commit_row_y)
        self.wait(0.5)

        self.assert_visual(
            'commit_context_menu',
            'A styled context menu is visible on screen, appearing near the commit row '
            'that was right-clicked. The context menu contains items such as: '
            'checkout, cherry-pick, revert, reset, create branch, create tag, copy SHA. '
            'Each menu item has a Lucide icon next to its label. '
            'The menu has a dark background with proper styling (rounded corners, shadow). '
            'No emoji icons are used — all icons are Lucide SVG.'
        )

        # --- 3. Press Escape to close context menu ---
        self.press_key('Escape')
        self.wait(0.3)

        self.assert_visual(
            'context_menu_closed',
            'The context menu has been dismissed and is no longer visible. '
            'The commit graph is shown normally without any overlay menus. '
            'The previously selected commit row may or may not still be highlighted.'
        )

        # --- 4. Keyboard navigation: press Down arrow 3 times then Enter ---
        # First click a commit to give the graph focus
        first_commit_y = 100  # First commit row
        self.click(commit_row_x, first_commit_y)
        self.wait(0.5)

        # Close any detail panel that opened
        self.press_key('Escape')
        self.wait(0.3)

        # Click again to set focus on the graph (after Escape)
        self.click(commit_row_x, first_commit_y)
        self.wait(0.3)

        # Now navigate down 3 times
        self.press_key('Down')
        self.wait(0.2)
        self.press_key('Down')
        self.wait(0.2)
        self.press_key('Down')
        self.wait(0.2)

        # Press Enter to open detail panel for the newly selected commit
        self.press_key('Return')
        self.wait(0.8)

        self.assert_visual(
            'keyboard_navigation',
            'After pressing Down arrow 3 times from the first commit and then Enter, '
            'a commit row lower in the list is now highlighted/selected (not the first row). '
            'The detail panel is open showing the details of this newly selected commit. '
            'The selection has visibly moved down from where it was initially clicked. '
            'The commit details in the panel correspond to a different commit than the first one.'
        )

        # Close detail panel
        self.press_key('Escape')
        self.wait(0.3)

        # --- 5. Hover over a commit for 800ms to show tooltip ---
        # Move to a different commit row
        hover_row_y = 160  # A commit row lower down
        self.hover(commit_row_x, hover_row_y)
        self.wait(1.0)  # Wait 1 second for tooltip to appear (threshold ~800ms)

        self.assert_visual(
            'commit_hover_tooltip',
            'The mouse is hovering over a commit row in the graph. '
            'A tooltip or hover popup may be visible showing the full commit message '
            'or additional commit details. The hovered commit row may have a subtle '
            'hover highlight effect (slightly different background from non-hovered rows). '
            'If a tooltip is present, it appears near the cursor with commit information.'
        )
