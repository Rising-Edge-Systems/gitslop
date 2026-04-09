"""
Test — Sidebar Icon Rail Collapse (US-GT-009)

Verifies sidebar collapse to icon rail and floating overlay:
- Clicks collapse button (PanelLeftClose icon at top of sidebar)
- Asserts 48px icon rail visible with section icons
- Clicks a section icon in the rail — floating overlay panel appears
- Clicks outside overlay — verifies it closes
- Clicks expand button (PanelLeftOpen) — restored full sidebar
- Restores sidebar to expanded state at end of test
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


class TestSidebarCollapse(GUITest):
    """Verify sidebar collapse to icon rail and floating overlay."""

    name = 'TestSidebarCollapse'

    def setUp(self):
        """Create a test repo to open in GitSlop."""
        self._test_repo = create_test_repo()

    def tearDown(self):
        """Clean up the test repo."""
        if hasattr(self, '_test_repo') and self._test_repo:
            cleanup_test_repo(self._test_repo)

    def run(self):
        # Focus the window
        self.focus_window()
        self.wait(1.0)

        # Open the test repo in GitSlop
        open_test_repo(self, self._test_repo)
        self.wait(2.0)

        # Get window bounds for coordinate calculations
        x, y, w, h = self.get_window_bounds()

        # 1. Ensure sidebar is expanded first
        #    Press Ctrl+B twice to guarantee expanded state
        #    (if expanded: collapse then expand; if collapsed: expand then collapse+expand)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # Take initial screenshot showing sidebar expanded
        self.assert_visual(
            'sidebar_expanded_initial',
            'Sidebar visible on the left side of the window in fully expanded state. '
            'The sidebar shows tab buttons and section content. A collapse button '
            '(PanelLeftClose Lucide icon) is visible at the top of the sidebar. '
            'The sidebar has a reasonable width (around 200-280px).'
        )

        # 2. Click the collapse button (PanelLeftClose icon at top of sidebar)
        #    The collapse button is at the LEFT side of the sidebar header
        #    Below titlebar (36px) + toolbar (40px) = y~78
        #    The button is a small icon at x~15 (left edge of sidebar)
        collapse_btn_x = 15   # left side of sidebar header
        collapse_btn_y = 78   # just below toolbar
        self.click(collapse_btn_x, collapse_btn_y)
        self.wait(0.5)

        # 3. Take screenshot — assert 48px icon rail visible with section icons
        self.assert_visual(
            'sidebar_icon_rail',
            'Sidebar collapsed to a narrow icon rail (approximately 48px wide) on the '
            'left side of the window. The icon rail shows vertically stacked section '
            'icons (small Lucide icons for branches, files, etc.). The main content '
            'area has expanded to fill the space previously occupied by the sidebar. '
            'No full sidebar text/labels are visible — only icons in the rail.'
        )

        # 4. Click a section icon in the rail to open floating overlay panel
        #    The first icon in the rail should be around x=24 (center of 48px rail)
        #    y position depends on layout — try the first section icon
        rail_icon_x = 24    # center of 48px icon rail
        rail_icon_y = 120   # approximate y for first section icon
        self.click(rail_icon_x, rail_icon_y)
        self.wait(0.5)

        # 5. Take screenshot of floating overlay panel
        self.assert_visual(
            'sidebar_floating_overlay',
            'A floating overlay panel has appeared next to the icon rail on the left '
            'side. The overlay shows the section content (e.g., branch list) floating '
            'above the main content area. The overlay may have a shadow or border to '
            'distinguish it from the background. The icon rail is still visible behind '
            'or beside the overlay.'
        )

        # 6. Click outside the overlay to close it
        #    Click somewhere in the main content area (center of window)
        self.click(w // 2, h // 2)
        self.wait(0.5)

        # 7. Take screenshot verifying overlay closed
        self.assert_visual(
            'sidebar_overlay_closed',
            'The floating overlay panel has been dismissed/closed. Only the narrow '
            'icon rail (approximately 48px) is visible on the left side. The main '
            'content area is fully visible without any overlay.'
        )

        # 8. Click expand button (PanelLeftOpen) to restore full sidebar
        #    The expand button should be at the top of the icon rail
        #    When collapsed, there should be a PanelLeftOpen icon at top of the rail
        expand_btn_x = 24   # center of icon rail
        expand_btn_y = 73   # same vertical position as the collapse button was
        self.click(expand_btn_x, expand_btn_y)
        self.wait(0.5)

        # 9. Take screenshot of restored full sidebar
        self.assert_visual(
            'sidebar_restored_expanded',
            'Sidebar has been restored to its full expanded state. The sidebar shows '
            'tab buttons (Branches/Files), section content with branch names and icons, '
            'and the collapse button (PanelLeftClose) is visible again at the top. '
            'The sidebar has returned to its normal width (around 200-280px). '
            'All icons are Lucide — no emoji or unicode.'
        )

        # 10. Ensure sidebar stays expanded at end of test (cleanup)
        #     Already expanded from step 8, so nothing more to do
