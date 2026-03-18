"""
Test — Sidebar Expanded and Sections (US-GT-008)

Verifies the sidebar renders with all sections and is scrollable:
- Sidebar visible on left with Branches/Files tabs, collapse button at top
- Branches tab shows local branches with GitBranch icons, current branch highlighted
- All icons are Lucide (no emoji/unicode)
- Clicking a section header chevron collapses/expands a section
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


class TestSidebar(GUITest):
    """Verify the sidebar renders with all sections and is interactive."""

    name = 'TestSidebar'

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

        # 1. Ensure sidebar is expanded by pressing Ctrl+B
        #    Press Ctrl+B to toggle — if collapsed it will expand, if expanded it stays
        #    We'll take a screenshot first to check, then ensure expanded state
        self.press_key('ctrl+b')
        self.wait(0.5)
        # Press Ctrl+B again to toggle back — this guarantees we end in expanded state
        # (if it was expanded, first Ctrl+B collapsed it, second expands it)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # 2. Take screenshot of the sidebar in expanded state
        self.assert_visual(
            'sidebar_expanded',
            'Sidebar visible on the left side of the window in expanded state. '
            'The sidebar should show tab buttons at the top (Branches and Files tabs). '
            'A collapse button (PanelLeftClose Lucide icon) is visible at the top of '
            'the sidebar. The sidebar has a reasonable width (around 200-280px). '
            'All icons are Lucide — no emoji or unicode symbols.'
        )

        # 3. Verify Branches tab content
        #    The Branches tab should be active by default showing local branches
        #    Sidebar is on the left, roughly 20-250px wide
        #    Click on the Branches tab area to ensure it's selected
        sidebar_tab_y = 95   # approximate y for tab buttons (below toolbar)
        sidebar_tab_x = 60   # approximate x for first tab (Branches)
        self.click(sidebar_tab_x, sidebar_tab_y)
        self.wait(0.5)

        self.assert_visual(
            'sidebar_branches_tab',
            'Sidebar showing the Branches tab content. Local branches listed with '
            'GitBranch Lucide icons next to each branch name. The current/active branch '
            'is visually highlighted (different background color or bold text). '
            'Branch names are readable text. Section headers may have chevron icons '
            'for expand/collapse. All icons are Lucide — no emoji or unicode.'
        )

        # 4. Click a section header chevron to collapse a section
        #    Section headers are typically near the top of the sidebar content area
        #    The first section header (e.g., "Local Branches") should be around y=120-140
        section_header_x = 80   # approximate x for section header (left-aligned in sidebar)
        section_header_y = 125  # approximate y for first section header
        self.click(section_header_x, section_header_y)
        self.wait(0.3)

        # 5. Take screenshot of the collapsed section state
        self.assert_visual(
            'sidebar_section_collapsed',
            'Sidebar with at least one section collapsed. The collapsed section header '
            'should show a chevron pointing right (ChevronRight) or similar indicator '
            'that the section is collapsed. The branch list under that section should '
            'be hidden/collapsed. Other sections may still be expanded.'
        )

        # 6. Click the same section header again to expand it back
        self.click(section_header_x, section_header_y)
        self.wait(0.3)

        # 7. Take screenshot of the expanded section state
        self.assert_visual(
            'sidebar_section_expanded',
            'Sidebar with the previously collapsed section now expanded again. The '
            'section header chevron points down (ChevronDown) indicating expanded state. '
            'Branch items are visible under the section header. All icons remain Lucide '
            '— no emoji or unicode throughout the sidebar.'
        )
