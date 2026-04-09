"""
Test — Toolbar and Titlebar (US-GT-006)

Verifies toolbar context-aware buttons and titlebar layout after opening a repo:
- Toolbar shows: Pull, Push, Fetch, Branch, Merge, Stash — all with Lucide icons, no emoji
- Settings gear always visible on far right
- Titlebar shows: GitSlop wordmark (left), repo name + branch (center), window controls (right)
- Fetch button shows inline spinner during operation
- Clicking center repo info in titlebar shows 'Copied!' feedback
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


class TestToolbarTitlebar(GUITest):
    """Verify toolbar context-aware buttons and titlebar layout after opening a repo."""

    name = 'TestToolbarTitlebar'

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

        # 1. Take screenshot of the toolbar with repo open
        self.assert_visual(
            'toolbar_with_repo',
            'Toolbar visible below titlebar with repo open. Shows buttons: Pull, Push, '
            'Fetch, Branch, Merge, Stash — all with Lucide icons (ArrowDownToLine, '
            'ArrowUpFromLine, RefreshCw, GitBranch, GitMerge, Archive). No emoji or '
            'unicode icons. Settings gear icon (Lucide Settings/Cog) visible on far right '
            'of toolbar. All buttons have text labels alongside icons.'
        )

        # 2. Take screenshot of the titlebar
        self.assert_visual(
            'titlebar_layout',
            'Titlebar at very top of window showing: GitSlop wordmark/logo on the left, '
            'repository name and current branch name displayed in the center area, '
            'window controls (minimize, maximize, close) on the right side. '
            'Theme toggle button (Sun or Moon Lucide icon) near window controls.'
        )

        # 3. Click the Fetch button to trigger a fetch operation
        #    Fetch button is in the toolbar area, typically after Pull and Push
        #    Toolbar buttons are ~40px tall, starting ~30px from top (below titlebar)
        #    Approximate position: look for Fetch which is typically the 3rd toolbar button
        #    Toolbar starts at about x=200 after sidebar, buttons are ~80px wide each
        fetch_btn_x = 320  # approximate x for Fetch button
        fetch_btn_y = 65   # toolbar vertical center (below ~30px titlebar)
        self.click(fetch_btn_x, fetch_btn_y)
        self.wait(0.5)

        # 4. Take screenshot showing inline spinner during fetch operation
        self.assert_visual(
            'fetch_spinner',
            'Fetch button in toolbar showing an inline spinner/loading indicator during '
            'the fetch operation. The spinner replaces or appears next to the Fetch icon '
            '(RefreshCw Lucide icon). Other toolbar buttons remain visible and unchanged.'
        )

        # Wait for fetch to complete
        self.wait(3.0)

        # 5. Click center repo info in titlebar to trigger copy feedback
        #    The repo name + branch is centered in the titlebar (~15px from top)
        titlebar_center_x = w // 2
        titlebar_center_y = 15
        self.click(titlebar_center_x, titlebar_center_y)
        self.wait(0.3)

        # 6. Take screenshot showing 'Copied!' feedback
        self.assert_visual(
            'titlebar_copied_feedback',
            'Titlebar center area showing "Copied!" feedback text or tooltip after '
            'clicking the repo name/branch area. The feedback indicates the repo path '
            'or branch name was copied to clipboard. This is a transient tooltip or '
            'text change near the center of the titlebar.'
        )

        # Wait for feedback to dismiss
        self.wait(2.0)

        # 7. Final verification screenshot of settings gear
        self.assert_visual(
            'settings_gear',
            'Settings gear icon (Lucide Settings/Cog icon) visible on the far right '
            'side of the toolbar. It is always visible regardless of repo state. '
            'No emoji. Clean Lucide icon rendering.'
        )
