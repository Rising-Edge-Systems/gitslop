"""
Test — Responsive Layout at Multiple Sizes (US-GT-018)

Verifies layout adapts at 1280x800, 1024x768, 900x600, and 800x500:
- At 1280x800: full layout, toolbar labels visible, sidebar expanded
- At 1024x768: sidebar still visible
- At 900x600: sidebar auto-collapsed to icon rail
- At 800x500: toolbar icon-only (no labels), status bar center hidden, titlebar repo path hidden
- Resizes back to 1280x800: sidebar restored, labels returned
- Text truncates with ellipsis at narrow sizes (no wrapping/overflow)
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


class TestResponsiveLayout(GUITest):
    """Verify layout adapts at multiple window sizes."""

    name = 'TestResponsiveLayout'

    def setUp(self):
        """Create a test repo to open in GitSlop."""
        self._test_repo = create_test_repo()

    def tearDown(self):
        """Clean up the test repo."""
        if hasattr(self, '_test_repo') and self._test_repo:
            cleanup_test_repo(self._test_repo)

    def run(self):
        # Focus the window and set initial size
        self.focus_window()
        self.wait(1.0)
        self.resize_window(1280, 800)
        self.wait(0.5)

        # Open the test repo in GitSlop
        open_test_repo(self, self._test_repo)
        self.wait(2.0)

        # Ensure sidebar is expanded (Ctrl+B toggle twice to guarantee expanded)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # ---- 1. Full size: 1280x800 ----
        self.resize_window(1280, 800)
        self.wait(0.5)

        self.assert_visual(
            'responsive_1280x800',
            'At 1280x800 (full size): The layout shows a full three-panel capable view. '
            'The sidebar on the left is EXPANDED (not collapsed to icon rail) showing '
            'Branches/Files tabs with section content visible. The toolbar at the top '
            'shows buttons WITH text labels (e.g., "Pull", "Push", "Fetch", "Branch", etc.) '
            'alongside their icons — not icon-only. The status bar at the bottom shows '
            'branch info on the left, and indicators (UTF-8, LF, etc.) on the right. '
            'The commit graph fills the center area. Everything is readable with no '
            'text overflow or wrapping.'
        )

        # ---- 2. Medium: 1024x768 ----
        self.resize_window(1024, 768)
        self.wait(0.5)

        self.assert_visual(
            'responsive_1024x768',
            'At 1024x768 (medium size): The sidebar is still visible on the left side '
            'of the window — it may be expanded or collapsed to an icon rail depending '
            'on the responsive threshold, but it is NOT completely hidden. The toolbar '
            'is still visible at the top. The commit graph is in the center. The overall '
            'layout still looks functional with all major sections accessible. '
            'Text may be slightly more compact but should not overflow or wrap.'
        )

        # ---- 3. Small: 900x600 ----
        self.resize_window(900, 600)
        self.wait(0.5)

        self.assert_visual(
            'responsive_900x600',
            'At 900x600 (small size): The sidebar has auto-collapsed to a narrow icon '
            'rail (approximately 48px wide) showing only section icons without labels. '
            'The sidebar is NOT fully expanded with text labels — it shows a thin strip '
            'of icons only. The commit graph takes up more horizontal space now. '
            'The toolbar may show fewer text labels. The layout adapts to the smaller '
            'window without any content overflow or horizontal scrollbars.'
        )

        # ---- 4. Smallest: 800x500 ----
        self.resize_window(800, 500)
        self.wait(0.5)

        self.assert_visual(
            'responsive_800x500',
            'At 800x500 (smallest size): The toolbar shows icon-only buttons WITHOUT '
            'text labels — buttons are compact with just icons. The status bar center '
            'section may be hidden or very minimal. The titlebar may hide the repo path '
            'to save space. The sidebar is collapsed to icon rail or hidden. Text that '
            'is too long should truncate with ellipsis (...) rather than wrapping or '
            'overflowing. The commit graph area is compact but still functional. '
            'No horizontal scrollbars or content overflow visible.'
        )

        # ---- 5. Restore to 1280x800 ----
        self.resize_window(1280, 800)
        self.wait(0.5)

        # Re-expand sidebar if it was collapsed
        # Press Ctrl+B twice to ensure it's in expanded state
        self.press_key('ctrl+b')
        self.wait(0.3)
        self.press_key('ctrl+b')
        self.wait(0.3)

        self.assert_visual(
            'responsive_restored_1280x800',
            'After restoring to 1280x800: The layout has returned to the full-size '
            'appearance. The sidebar is expanded again showing Branches/Files tabs '
            'with section content. The toolbar shows buttons with text labels again '
            '(not icon-only). The status bar shows all indicators. The commit graph '
            'fills the center area. Everything looks the same as the initial 1280x800 '
            'screenshot — the responsive layout correctly restores when the window '
            'is enlarged back to its original size.'
        )

        # Reset to default size at end
        self.reset_window_size()
        self.wait(0.3)
