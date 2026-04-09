"""
Test — Notification System (US-GT-020)

Verifies toast notifications and notification history:
- Triggering a notification via Fetch shows a toast in bottom-right
- Toast auto-dismisses after ~4 seconds (success)
- Notification bell in status bar opens history dropdown with past notifications
- Escape closes the dropdown
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


class TestNotifications(GUITest):
    """Verify toast notifications and notification history."""

    name = 'TestNotifications'

    def setUp(self):
        """Create a test repo to open in GitSlop."""
        self._test_repo = create_test_repo()

    def tearDown(self):
        """Clean up the test repo."""
        if hasattr(self, '_test_repo') and self._test_repo:
            cleanup_test_repo(self._test_repo)

    def run(self):
        # Focus the window and open repo
        self.focus_window()
        self.wait(1.0)

        # Open the test repo in GitSlop
        open_test_repo(self, self._test_repo)
        self.wait(2.0)

        # Get window bounds for coordinate calculations
        x, y, w, h = self.get_window_bounds()

        # ---- 1. Trigger a notification by clicking Fetch ----
        # Use Ctrl+Shift+F to trigger fetch operation
        self.press_key('ctrl+shift+f')

        # Wait briefly for toast to appear (take screenshot quickly)
        self.wait(1.0)

        # Take screenshot to capture the toast notification
        self.assert_visual(
            'notification_toast_visible',
            'A toast notification is visible in the bottom-right area of the window. '
            'The toast should show a success or info message related to the fetch '
            'operation (e.g. "Fetch complete" or "Already up to date"). The toast '
            'has a Lucide icon (such as CheckCircle or Info) and a text message. '
            'It appears as a small rectangular card floating above the status bar '
            'with rounded corners, a background color, and possibly a shadow.'
        )

        # ---- 2. Wait for toast to auto-dismiss ----
        # Success toasts auto-dismiss after ~4 seconds
        self.wait(5.0)

        # Take screenshot to verify toast has dismissed
        self.assert_visual(
            'notification_toast_dismissed',
            'The toast notification has been automatically dismissed after the '
            'timeout period. The bottom-right area of the window should be clear '
            'of any toast or notification overlay. Only the normal application '
            'layout is visible: the commit graph area and the status bar at the '
            'bottom. No floating notification card is present.'
        )

        # ---- 3. Click notification bell in status bar to open history ----
        # The bell icon is in the right section of the status bar,
        # near the far right edge, vertically centered in the 24px status bar
        bell_x = w - 30
        bell_y = h - 12
        self.click(bell_x, bell_y)
        self.wait(0.5)

        # Take screenshot of the notification history dropdown
        self.assert_visual(
            'notification_history_with_entry',
            'A notification history dropdown/panel is visible above the status bar, '
            'opened by clicking the bell icon. The dropdown shows at least one past '
            'notification entry from the fetch operation that was triggered earlier. '
            'Each entry should show a Lucide icon, a message describing the operation '
            '(e.g. fetch result), and possibly a timestamp. The dropdown has proper '
            'styling with borders, shadows, and a contained list of notifications.'
        )

        # ---- 4. Press Escape to close the history dropdown ----
        self.press_key('Escape')
        self.wait(0.3)

        # Take screenshot confirming dropdown is closed
        self.assert_visual(
            'notification_history_closed',
            'The notification history dropdown has been closed after pressing Escape. '
            'Only the status bar strip is visible at the bottom of the window. '
            'No dropdown, overlay, or floating panel is present. The main application '
            'layout (sidebar, commit graph, toolbar) is fully visible.'
        )
