"""
Test — Status Bar (US-GT-007)

Verifies the status bar information and interactions:
- Branch name with GitBranch icon visible in left section
- Right section shows: UTF-8, LF indicators, refresh button, notification bell
- Hover over status bar makes text more visible
- Clicking notification bell opens history dropdown
- Escape closes dropdown
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


class TestStatusBar(GUITest):
    """Verify the status bar information and interactions."""

    name = 'TestStatusBar'

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

        # 1. Take screenshot of the status bar with repo open
        #    Status bar is 24px tall at the bottom of the window
        self.assert_visual(
            'statusbar_overview',
            'Status bar visible at the bottom of the window (24px tall strip). '
            'Left section shows current branch name with a GitBranch Lucide icon. '
            'Right section shows indicators: UTF-8 encoding label, LF line ending '
            'label, a refresh button (RefreshCw Lucide icon), and a notification '
            'bell icon (Bell Lucide icon). All icons are Lucide — no emoji or unicode.'
        )

        # 2. Hover over the status bar to check hover effect
        #    Status bar is at the very bottom — use h - 12 for vertical center
        #    Use drag with minimal movement to simulate hover (no move_mouse method)
        statusbar_center_y = h - 12
        statusbar_center_x = w // 2
        self.drag(statusbar_center_x - 1, statusbar_center_y,
                  statusbar_center_x, statusbar_center_y)
        self.wait(0.5)

        self.assert_visual(
            'statusbar_hover',
            'Status bar with mouse hovering over it. Text and icons should appear '
            'more visible or brighter compared to the non-hovered state. The status '
            'bar may have a subtle highlight or increased opacity on hover.'
        )

        # 3. Click notification bell in status bar
        #    The bell icon is in the right section, near the far right of the status bar
        #    Approximate position: about 30px from right edge, vertically centered in status bar
        bell_x = w - 30
        bell_y = h - 12
        self.click(bell_x, bell_y)
        self.wait(0.5)

        # 4. Take screenshot of the notification history dropdown
        self.assert_visual(
            'notification_history_dropdown',
            'Notification history dropdown/panel visible above the status bar, '
            'opened by clicking the bell icon. The dropdown shows a list of past '
            'notifications (or an empty state message if no notifications yet). '
            'The dropdown has a styled container with proper borders/shadows.'
        )

        # 5. Press Escape to close the dropdown
        self.press_key('Escape')
        self.wait(0.3)

        # 6. Take screenshot verifying dropdown is closed
        self.assert_visual(
            'statusbar_dropdown_closed',
            'Status bar visible at bottom of window. The notification history '
            'dropdown is now closed/dismissed after pressing Escape. Only the '
            'status bar strip is visible, no overlay or dropdown panel.'
        )
