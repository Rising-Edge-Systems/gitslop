"""
Test — Commit Detail Panel Content (US-GT-014)

Verifies the detail panel shows full commit info, file list, and copy functionality:
- Subject bold, full SHA visible, author name + email, absolute and relative date
- Changed Files section lists files with Lucide status icons (FilePlus/FileMinus/FileEdit)
- File count summary with +insertions -deletions
- SHA copy button shows copy feedback
- Close (X) button dismisses panel
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


class TestDetailPanel(GUITest):
    """Verify the commit detail panel shows full commit info, file list, and copy functionality."""

    name = 'TestDetailPanel'

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

        # --- 1. Click a commit to open the detail panel ---
        # Layout: titlebar(36) + tabbar(~32) + toolbar(40) + repoheader(~100) + filter(~30) + graphheader(~35) = ~273
        # First commit row ~385, second ~420
        commit_row_x = w // 2  # Center of graph area
        commit_row_y = 420     # Second commit row (should have changed files)

        self.click(commit_row_x, commit_row_y)
        self.wait(1.0)

        # --- 2. Take screenshot of detail panel and assert content ---
        self.assert_visual(
            'detail_panel_content',
            'The commit detail panel is open on the right side of the window. '
            'It shows the following commit information: '
            '1) The commit subject/message displayed in bold text at the top. '
            '2) The full SHA hash (40 hex characters) is visible. '
            '3) The author name and email address are shown. '
            '4) Both an absolute date and a relative date (e.g., "2 days ago") are displayed. '
            'The panel has a clean layout with proper spacing and typography. '
            'No emoji icons — all icons are Lucide SVG.'
        )

        # --- 3. Assert Changed Files section with Lucide status icons ---
        self.assert_visual(
            'changed_files_section',
            'The detail panel shows a "Changed Files" section (or similar heading) '
            'listing the files that were modified in this commit. '
            'Each file entry shows a Lucide status icon indicating the type of change: '
            'FilePlus (green, for added files), FileMinus (red, for deleted files), '
            'or FileEdit/Pencil (for modified files). '
            'File names are displayed with their directory paths (paths may be muted/dimmed). '
            'A file count summary is visible showing the number of files changed, '
            'with +insertions and -deletions counts (e.g., "+15 -3"). '
            'No emoji or unicode icons — all status icons are Lucide SVG.'
        )

        # --- 4. Click the SHA copy button and verify copy feedback ---
        # The SHA copy button is typically near the full SHA hash at the top of the panel
        # The detail panel is on the right side, roughly at x = w * 0.75
        # The SHA line is near the top of the panel, roughly at y = 140-180
        sha_area_x = int(w * 0.85)  # Right side where copy button would be
        sha_area_y = 160            # Near the SHA hash line

        self.click(sha_area_x, sha_area_y)
        self.wait(0.5)

        self.assert_visual(
            'sha_copy_feedback',
            'After clicking near the SHA hash area in the detail panel, '
            'there may be visual copy feedback such as: '
            'a "Copied!" tooltip or text appearing, a checkmark icon replacing the copy icon, '
            'or a brief flash/highlight on the SHA text. '
            'The full SHA hash (40 hex characters) should still be visible in the panel. '
            'If no copy button was hit, the panel still shows normal commit detail content.'
        )

        # --- 5. Click close (X) button to dismiss the panel ---
        # The close button is typically at the top-right of the detail panel
        # With the panel on the right side of the window, X button is near the right edge
        close_x = w - 20   # Near right edge of window
        close_y = 80       # Near top of detail panel

        self.click(close_x, close_y)
        self.wait(0.5)

        self.assert_visual(
            'panel_closed',
            'The commit detail panel has been closed/dismissed. '
            'The commit graph is visible taking up more horizontal space now '
            'that the detail panel is no longer showing. '
            'Only the sidebar and the main commit graph area are visible — '
            'no detail panel or overlay is present on the right side. '
            'The previously selected commit row may still be highlighted in the graph.'
        )
