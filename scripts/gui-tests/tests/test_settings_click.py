"""
Test that verifies screen interaction helpers work by clicking
the Settings gear icon and taking a screenshot.
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


class TestSettingsClick(GUITest):
    """Click the Settings gear icon and verify the interaction helpers work."""

    name = 'TestSettingsClick'

    def run(self):
        # Focus the window first
        self.focus_window()
        self.wait(0.5)

        # Take a screenshot before clicking
        before_path = self.screenshot('before_settings')
        assert Path(before_path).exists(), f"Screenshot not saved: {before_path}"

        # Get window bounds for reference
        x, y, w, h = self.get_window_bounds()

        # The Settings gear is typically on the far right of the toolbar.
        # Toolbar is near the top of the window. Click near top-right area.
        # Approx: 30px from right edge, ~45px from top (below titlebar).
        settings_x = w - 30
        settings_y = 45
        self.click(settings_x, settings_y)
        self.wait(0.5)

        # Take a screenshot after clicking
        after_path = self.screenshot('after_settings_click')
        assert Path(after_path).exists(), f"Screenshot not saved: {after_path}"

        # Press Escape to close any dialog that may have opened
        self.press_key('Escape')
        self.wait(0.3)
