"""
Test — Multi-Repo Tabs (US-GT-022)

Verifies tab bar appears with multiple repos and tab switching works:
- Single repo open: no tab bar visible
- Opening a second repo shows tab bar with two tabs
- Active tab is visually distinct (highlighted/underlined)
- Clicking a tab switches to that repo's view
- Closing a tab removes it from the tab bar
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


class TestTabs(GUITest):
    """Verify tab bar appears with multiple repos and tab switching works."""

    name = 'TestTabs'

    def setUp(self):
        """Create two test repos so we can open multiple repos."""
        self._test_repo1 = create_test_repo()
        self._test_repo2 = create_test_repo()

    def tearDown(self):
        """Clean up both test repos."""
        for repo in [self._test_repo1, self._test_repo2]:
            if repo:
                cleanup_test_repo(repo)

    def run(self):
        # Focus the window
        self.focus_window()
        self.wait(1.0)

        # ---- 1. Open the first repo ----
        open_test_repo(self, self._test_repo1)
        self.wait(2.0)

        # Get window bounds for coordinate calculations
        x, y, w, h = self.get_window_bounds()

        # ---- 2. Screenshot with single repo — no tab bar should be visible ----
        self.assert_visual(
            'tabs_single_repo',
            'The GitSlop application has a single repository open. There should be '
            'NO tab bar visible above the main content area. The titlebar shows the '
            'repo name and branch. The toolbar is directly below the titlebar with '
            'no tab strip between them. Only one repo is open so tabs are unnecessary.'
        )

        # ---- 3. Open the second repo ----
        open_test_repo(self, self._test_repo2)
        self.wait(2.0)

        # ---- 4. Screenshot with two repos — tab bar should appear ----
        self.assert_visual(
            'tabs_two_repos',
            'The GitSlop application now has two repositories open. A tab bar or '
            'tab strip should be visible showing two tabs — one for each open repo. '
            'Each tab shows the repository name (the directory name of the repo). '
            'The active tab (the second/most recently opened repo) should be visually '
            'distinct — highlighted, underlined, or otherwise differentiated from the '
            'inactive tab. The tab bar appears between the titlebar and the toolbar, '
            'or integrated into the titlebar area.'
        )

        # ---- 5. Click the first tab to switch to the first repo ----
        # Tab bar is typically near the top, below the titlebar (~36px).
        # The first tab would be on the left side of the tab bar.
        # Tab bar is roughly at y=36-50px range (below titlebar, above toolbar).
        first_tab_x = 100   # Left side of tab bar for first tab
        first_tab_y = 48    # Approximate vertical center of tab bar
        self.click(first_tab_x, first_tab_y)
        self.wait(1.0)

        # ---- 6. Screenshot showing first tab is now active ----
        self.assert_visual(
            'tabs_switched_to_first',
            'After clicking the first tab, the first repository should now be '
            'active. The first tab should be visually highlighted/active, and the '
            'second tab should be inactive. The main content area (commit graph, '
            'sidebar branches) should reflect the first repo\'s data. The titlebar '
            'should show the first repo\'s name and branch.'
        )

        # ---- 7. Close the second tab by clicking its X button ----
        # The second tab should have a close (X) button on hover or always visible.
        # Second tab is to the right of the first tab.
        second_tab_x = 250  # Approximate position of second tab
        second_tab_y = 48   # Same vertical as tab bar

        # First hover over the second tab to reveal the X button
        # Then click the X button (typically on the right edge of the tab)
        second_tab_close_x = 310  # Right edge of second tab where X would be
        second_tab_close_y = 48
        self.click(second_tab_close_x, second_tab_close_y)
        self.wait(1.0)

        # ---- 8. Screenshot showing tab removed, back to single repo ----
        self.assert_visual(
            'tabs_after_close',
            'After closing the second tab, only one repository should remain open. '
            'The tab bar may still be visible with a single tab, or it may disappear '
            'since only one repo is open (either behavior is acceptable). The main '
            'content should show the first repo\'s commit graph and branches. '
            'The closed repo\'s tab is no longer visible.'
        )
