"""
Test — Staging Area Layout and Stage/Unstage (US-GT-016)

Verifies the staging area two-column layout, stage, and unstage operations:
- Staging area below graph with collapsible header and file count badge
- Two-column layout (Unstaged left, Staged right)
- Each file shows Lucide status icon, filename, directory path (muted)
- Click + to stage a file, click - to unstage
- Stage All / Unstage All buttons
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


class TestStaging(GUITest):
    """Verify the staging area two-column layout and stage/unstage operations."""

    name = 'TestStaging'

    def setUp(self):
        """Create a test repo with staged/unstaged/untracked files."""
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

        # Ensure sidebar is expanded (press Ctrl+B twice to guarantee known state)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # Press Escape to dismiss any open panels/overlays
        self.press_key('Escape')
        self.wait(0.3)

        # --- 1. Take screenshot of the staging area ---
        # The staging area is below the commit graph.
        # With the test repo, we have: 1 staged file, 1 unstaged modified file, 1 untracked file
        # Scroll down in the main area to ensure the staging area is visible
        # The staging area should be visible below the graph rows
        self.assert_visual(
            'staging_overview',
            'The staging area is visible in the application window. '
            'It has a collapsible header section with a file count badge showing '
            'the number of changed files. Below the header, there is a two-column '
            'layout: the left column shows "Unstaged Changes" (or similar heading) '
            'and the right column shows "Staged Changes" (or similar heading). '
            'Files are listed in each column. The unstaged column should show at '
            'least one modified file (config.json) and one untracked file (notes.txt). '
            'The staged column should show at least one file (staged_new.py). '
            'Each file entry shows a Lucide status icon (not emoji), the filename, '
            'and the directory path in muted/dimmed text. '
            'No emoji or unicode icons are used — all icons are Lucide SVG.'
        )

        # --- 2. Click + button on an unstaged file to stage it ---
        # The unstaged files are in the left column of the staging area
        # The staging area is typically in the lower portion of the center panel
        # With sidebar expanded (~240px), center starts around x=250
        # The + button is on the right side of each file row in the unstaged column
        # Estimate unstaged file area: roughly in the lower-center of the window
        unstaged_area_x = int(w * 0.35)  # Left-center area for unstaged column
        staging_area_y = h - 120  # Near the bottom of the window

        # First, hover over a file in the unstaged area to reveal the + button
        self.hover(unstaged_area_x, staging_area_y)
        self.wait(0.3)

        # Click the + button (typically appears on hover, to the right of the file name)
        stage_btn_x = int(w * 0.45)  # Right side of unstaged column where + button appears
        self.click(stage_btn_x, staging_area_y)
        self.wait(0.5)

        self.assert_visual(
            'after_stage_file',
            'After clicking the stage (+) button on an unstaged file, the file '
            'has moved from the Unstaged Changes column (left) to the Staged Changes '
            'column (right). The staged column now shows more files than before. '
            'The unstaged column shows fewer files. The file count badges have updated '
            'to reflect the change. The layout remains a clean two-column design.'
        )

        # --- 3. Click - button on a staged file to unstage it ---
        # The staged files are in the right column
        staged_area_x = int(w * 0.65)  # Right-center area for staged column
        staged_file_y = h - 120  # Near the bottom

        # Hover to reveal the - button
        self.hover(staged_area_x, staged_file_y)
        self.wait(0.3)

        # Click the - button
        unstage_btn_x = int(w * 0.75)  # Right side of staged column where - button appears
        self.click(unstage_btn_x, staged_file_y)
        self.wait(0.5)

        self.assert_visual(
            'after_unstage_file',
            'After clicking the unstage (-) button on a staged file, the file '
            'has moved from the Staged Changes column (right) back to the Unstaged '
            'Changes column (left). The file counts have updated accordingly. '
            'The two-column layout is maintained with proper spacing.'
        )

        # --- 4. Click "Stage All" button ---
        # The "Stage All" button is typically in the header area of the unstaged section
        # or as a toolbar action near the top of the staging area
        # Look for it near the top of the staging area, left side
        stage_all_area_x = int(w * 0.35)
        stage_all_area_y = h - 180  # Near the staging section header

        self.click(stage_all_area_x, stage_all_area_y)
        self.wait(0.5)

        self.assert_visual(
            'after_stage_all',
            'After clicking "Stage All" (or a similar bulk stage action), '
            'all files have moved from the Unstaged Changes column to the '
            'Staged Changes column. The unstaged column should now be empty '
            'or show a message like "No unstaged changes". The staged column '
            'shows all the previously unstaged files plus any that were already staged. '
            'File count badges reflect the bulk operation.'
        )

        # --- 5. Click "Unstage All" button ---
        # The "Unstage All" button is near the staged section header
        unstage_all_area_x = int(w * 0.65)
        unstage_all_area_y = h - 180  # Near the staging section header

        self.click(unstage_all_area_x, unstage_all_area_y)
        self.wait(0.5)

        self.assert_visual(
            'after_unstage_all',
            'After clicking "Unstage All" (or a similar bulk unstage action), '
            'all files have returned from the Staged Changes column to the '
            'Unstaged Changes column. The staged column should now be empty '
            'or show a message like "No staged changes". The unstaged column '
            'shows all the files. File count badges reflect the operation. '
            'The two-column layout remains intact with proper styling.'
        )
