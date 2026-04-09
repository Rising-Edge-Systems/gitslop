"""
Dummy test that takes a screenshot and passes.
Used to verify the test framework is working.
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


class TestDummy(GUITest):
    """Dummy test that takes a screenshot and passes."""

    name = 'TestDummy'

    def run(self):
        path = self.screenshot('dummy_screenshot')
        assert Path(path).exists(), f"Screenshot not saved: {path}"
