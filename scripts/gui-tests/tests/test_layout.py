"""
Test — Three-Column Layout and Panel Dividers (US-GT-010)

Verifies three-column layout, panel resizing, and terminal toggle:
- With repo open and no commit selected: two columns (sidebar + center)
- Click a commit row — third column (detail panel) appears
- Drag a panel divider to resize, before/after screenshots
- Toggle terminal with Ctrl+`
- Close detail panel
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


class TestLayout(GUITest):
    """Verify three-column layout, panel resizing, and terminal toggle."""

    name = 'TestLayout'

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

        # Ensure sidebar is expanded (Ctrl+B toggle twice to guarantee)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # 1. Two-column layout: sidebar + center (no commit selected)
        #    Press Escape to ensure no detail panel is open
        self.press_key('Escape')
        self.wait(0.3)

        self.assert_visual(
            'two_column_layout',
            'Two-column layout visible: sidebar on the left (with Branches/Files tabs '
            'and section content) and the main center panel showing the commit graph. '
            'No third panel/detail panel is visible on the right side. '
            'The commit graph area fills the remaining width after the sidebar.'
        )

        # 2. Click a commit row in the graph to open detail panel (third column)
        #    The commit graph rows are in the center area, roughly:
        #    x: sidebar_width + some offset (around 300-400px from left)
        #    y: first commit row is around 120-150px from top (below toolbar)
        commit_x = 500  # center of commit graph area
        commit_y = 160  # approximate y for first visible commit row
        self.click(commit_x, commit_y)
        self.wait(1.0)

        self.assert_visual(
            'three_column_layout',
            'Three-column layout visible: sidebar on the left, commit graph in the center, '
            'and a detail panel on the right side showing commit information. '
            'The detail panel shows commit details such as subject, SHA, author, '
            'and changed files. All three columns are visible simultaneously.'
        )

        # 3. Drag a panel divider to resize
        #    The divider between center and detail panel is a thin vertical line
        #    approximately at 2/3 of the window width (where detail panel starts)
        #    We'll drag it to the left to make the detail panel wider
        divider_x = w * 2 // 3  # approximate position of the right divider
        divider_y = h // 2      # middle of the window vertically

        # Take before screenshot
        self.assert_visual(
            'before_resize',
            'Three-column layout before resizing. The divider between the center '
            'panel and the detail panel is at approximately 2/3 of the window width. '
            'The detail panel has its default width.'
        )

        # Drag the divider to the left by ~100px
        self.drag(divider_x, divider_y, divider_x - 100, divider_y)
        self.wait(0.5)

        # Take after screenshot
        self.assert_visual(
            'after_resize',
            'Three-column layout after resizing. The detail panel on the right '
            'should now be wider than before (the divider was dragged to the left). '
            'The center panel (commit graph) should be narrower. '
            'Both panels should still be visible and usable.'
        )

        # 4. Toggle terminal with Ctrl+`
        self.press_key('ctrl+grave')
        self.wait(0.5)

        self.assert_visual(
            'terminal_visible',
            'Terminal panel is now visible at the bottom of the window. '
            'The terminal area appears below the main content area (below the '
            'commit graph and detail panel). The terminal may show a command prompt '
            'or dark terminal background. The main layout above the terminal '
            'is still visible but vertically shorter.'
        )

        # 5. Toggle terminal off again with Ctrl+`
        self.press_key('ctrl+grave')
        self.wait(0.5)

        self.assert_visual(
            'terminal_hidden',
            'Terminal panel has been hidden/toggled off. The main content area '
            '(commit graph and detail panel) has returned to full height. '
            'No terminal panel visible at the bottom of the window.'
        )

        # 6. Close detail panel by clicking X button
        #    The X/close button is typically at the top-right corner of the detail panel
        #    Detail panel starts at approximately divider_x - 100 (after our resize)
        #    The close button is near the top-right of the detail panel
        close_btn_x = w - 20    # near the right edge of the window
        close_btn_y = 75        # near the top of the detail panel, below toolbar
        self.click(close_btn_x, close_btn_y)
        self.wait(0.5)

        self.assert_visual(
            'detail_panel_closed',
            'Detail panel has been closed/dismissed. The layout has returned to '
            'two columns: sidebar on the left and commit graph filling the remaining '
            'width. No detail panel visible on the right side of the window.'
        )
