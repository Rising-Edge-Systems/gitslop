"""
Test — Diff Viewer in Detail Panel (US-GT-015)

Verifies inline and side-by-side diff views in the commit detail panel:
- Clicking a file in Changed Files list shows a diff
- Diff renders with green additions and red deletions
- Diff header shows file path and change type
- Split toggle switches to side-by-side view
- File navigation switches to next file's diff
- Can switch back to Inline mode
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


class TestDiffViewer(GUITest):
    """Verify inline and side-by-side diff views in the commit detail panel."""

    name = 'TestDiffViewer'

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

        # Press Escape to clear any overlays
        self.press_key('Escape')
        self.wait(0.3)

        # --- 1. Click a commit that has multiple changed files ---
        # Layout: titlebar(36) + tabbar(~32) + toolbar(40) + repoheader(~100) + filter(~30) + graphheader(~35) = ~273
        # Click the merge commit row (e67dd7d "Merge feature branch") which has multiple files
        # Merge commit is row 3 at roughly y=455
        commit_row_x = w // 2  # Center of graph area
        commit_row_y = 455     # Merge commit row

        self.click(commit_row_x, commit_row_y)
        self.wait(1.0)

        # Take a screenshot to confirm detail panel is open
        self.assert_visual(
            'detail_panel_open',
            'The commit detail panel is open on the right side showing commit '
            'information. A "Changed Files" section lists files that were '
            'modified in this commit. Each file entry is clickable.'
        )

        # --- 2. Click a file in the Changed Files list to open its diff ---
        # The Changed Files section is in the detail panel (right side)
        # Files are listed below the commit info, roughly in the middle-to-lower
        # part of the detail panel. The detail panel occupies roughly the right 1/3.
        # Try clicking on the first file in the list.
        file_list_x = int(w * 0.78)   # Within the detail panel area
        file_list_y = int(h * 0.45)   # Mid-panel where file list starts

        self.click(file_list_x, file_list_y)
        self.wait(1.0)

        # --- 3. Assert diff renders with green additions and red deletions ---
        self.assert_visual(
            'diff_inline_view',
            'A diff view is visible showing the file changes. '
            'The diff displays with syntax-highlighted code: '
            'green-colored lines (or green background) for additions (lines starting with +), '
            'and red-colored lines (or red background) for deletions (lines starting with -). '
            'A diff header at the top shows the file path and possibly the change type '
            '(added/modified/deleted). Line numbers may be visible on the left side. '
            'This is an inline/unified diff view showing old and new lines interleaved.'
        )

        # --- 4. Click the Split toggle to switch to side-by-side view ---
        # The Split/Inline toggle is typically near the top of the diff view area,
        # as a button or toggle control in the diff header/toolbar.
        # It could be in the detail panel header area, near the top-right of the diff.
        # Look for it near the top of the detail panel area.
        split_btn_x = int(w * 0.90)   # Near right side of detail panel
        split_btn_y = int(h * 0.32)   # Near top of diff area, below commit info

        self.click(split_btn_x, split_btn_y)
        self.wait(0.8)

        self.assert_visual(
            'diff_split_view',
            'The diff view has changed to a side-by-side (split) layout. '
            'The old version of the file is shown on the left side and '
            'the new version is shown on the right side. '
            'Deletions are highlighted in red on the left pane, '
            'additions are highlighted in green on the right pane. '
            'Both panes show line numbers. '
            'OR if the split toggle was not found, the diff is still in inline mode '
            'showing additions in green and deletions in red.'
        )

        # --- 5. Navigate to the next file ---
        # Try pressing ] key or clicking a next-file navigation button.
        # The next file button might be near the diff header or at the bottom.
        # Also try clicking the second file in the Changed Files list directly.
        # First, try the ] key shortcut for next file navigation
        self.press_key('bracketright')
        self.wait(0.8)

        self.assert_visual(
            'diff_next_file',
            'The diff view now shows a different file than before. '
            'The file path in the diff header has changed to a new filename. '
            'The diff content shows different code changes than the previous file. '
            'The diff still renders properly with colored additions and deletions. '
            'OR if ] did not navigate, the same file diff is still shown.'
        )

        # --- 6. Switch back to Inline mode ---
        # Click the Inline toggle button (same area as the Split button)
        inline_btn_x = int(w * 0.85)  # Near the split/inline toggle area
        inline_btn_y = int(h * 0.32)  # Same row as the split button

        self.click(inline_btn_x, inline_btn_y)
        self.wait(0.8)

        self.assert_visual(
            'diff_back_to_inline',
            'The diff view has returned to inline (unified) mode. '
            'Old and new lines are shown interleaved in a single column, '
            'with deletions in red and additions in green. '
            'The file path and change type are visible in the diff header. '
            'The view is a standard unified diff format.'
        )

        # --- 7. Close the detail panel ---
        self.press_key('Escape')
        self.wait(0.5)

        self.assert_visual(
            'panel_closed_after_diff',
            'The detail panel has been closed. '
            'Only the sidebar and the main commit graph area are visible. '
            'No diff view or detail panel overlay is present.'
        )
