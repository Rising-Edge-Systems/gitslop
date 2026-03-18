"""
Test that verifies window resize and multi-size support works.

Resizes the GitSlop window to 800x500, takes a screenshot showing
the smaller window, then resizes back to 1280x800.
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


class TestWindowResize(GUITest):
    """Verify resize_window() and reset_window_size() work correctly."""

    name = 'TestWindowResize'

    def run(self):
        # Focus the window
        self.focus_window()
        self.wait(0.5)

        # Record initial bounds at default size
        x0, y0, w0, h0 = self.get_window_bounds()
        self.screenshot('initial_size')

        # Resize to 800x500
        self.resize_window(800, 500)
        self.wait(0.5)

        # Re-read bounds after resize — they must reflect the new size
        x1, y1, w1, h1 = self.get_window_bounds()
        self.screenshot('resized_800x500')

        # Verify the window actually got smaller
        assert w1 <= 820, f"Expected width ~800, got {w1}"
        assert h1 <= 520, f"Expected height ~500, got {h1}"

        # Resize back to default
        self.reset_window_size()
        self.wait(0.5)

        # Verify restored size
        x2, y2, w2, h2 = self.get_window_bounds()
        self.screenshot('restored_1280x800')

        assert w2 >= 1260, f"Expected width ~1280 after reset, got {w2}"
        assert h2 >= 780, f"Expected height ~800 after reset, got {h2}"

    def tearDown(self):
        # Always ensure we restore the default size
        try:
            self.reset_window_size()
        except Exception:
            pass
