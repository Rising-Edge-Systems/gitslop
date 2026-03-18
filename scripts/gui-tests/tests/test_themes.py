"""
Test — Both Themes (US-GT-021)

Verifies dark and light themes render correctly across all components:
- Dark theme (default) shows dark background, light text
- Theme toggle (Sun/Moon icon) switches to light theme
- Light theme shows light background, dark text, all components visible
- Commit graph nodes and lines visible in light theme
- Toggle back to dark theme restores original appearance
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


class TestThemes(GUITest):
    """Verify dark and light themes render correctly across all components."""

    name = 'TestThemes'

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

        # ---- 1. Screenshot in dark theme (default) with repo open ----
        self.assert_visual(
            'theme_dark_default',
            'The GitSlop application is shown in dark theme (the default). '
            'The overall background is dark (near-black or very dark gray). '
            'Text is light colored (white or light gray). The sidebar on the '
            'left has a dark background with light text for branch names. '
            'The toolbar at the top has dark styling with light icons. '
            'The commit graph in the center panel shows colored nodes and '
            'lane lines on a dark background. The status bar at the bottom '
            'has dark styling. All UI components are clearly readable with '
            'good contrast against the dark background.'
        )

        # ---- 2. Click theme toggle (Sun/Moon icon in titlebar) ----
        # The theme toggle button is in the titlebar area, right side,
        # near the window controls. It shows a Sun icon (for switching to light)
        # or Moon icon (for switching to dark). Typically positioned to the
        # left of the minimize/maximize/close buttons.
        # Titlebar is roughly 36px tall; the toggle is near top-right area.
        theme_toggle_x = w - 120  # Left of window controls
        theme_toggle_y = 18       # Vertical center of titlebar
        self.click(theme_toggle_x, theme_toggle_y)
        self.wait(0.8)

        # ---- 3. Screenshot in light theme ----
        self.assert_visual(
            'theme_light_full',
            'The GitSlop application has switched to light theme. '
            'The overall background is now light (white or very light gray). '
            'Text is dark colored (black or dark gray). The sidebar on the '
            'left has a light background with dark text for branch names. '
            'The toolbar at the top has light styling with dark icons and text. '
            'The status bar at the bottom has light styling. All components '
            'are clearly visible and readable — no elements are invisible or '
            'have poor contrast. The UI should look clean and professional '
            'in light mode with no dark-on-dark or light-on-light issues.'
        )

        # ---- 4. Screenshot of commit graph in light theme ----
        self.assert_visual(
            'theme_light_commit_graph',
            'Close-up focus on the commit graph area in light theme. '
            'The commit graph shows colored circle nodes connected by '
            'vertical lane lines. The nodes and lines should be clearly '
            'visible against the light background — not washed out or '
            'invisible. Branch and tag labels (pill badges) are readable. '
            'Each commit row shows the short hash, commit message, author, '
            'and relative date, all in dark text on a light background. '
            'The selected commit row (if any) has a visible highlight. '
            'No visual artifacts or rendering issues.'
        )

        # ---- 5. Toggle back to dark theme ----
        self.click(theme_toggle_x, theme_toggle_y)
        self.wait(0.8)

        # ---- 6. Confirmation screenshot — dark theme restored ----
        self.assert_visual(
            'theme_dark_restored',
            'The GitSlop application has been toggled back to dark theme. '
            'The overall background is dark again (near-black or very dark gray). '
            'Text is light colored (white or light gray). All components — '
            'sidebar, toolbar, commit graph, status bar — are back to their '
            'dark theme styling. The appearance matches the initial dark theme '
            'screenshot, confirming the toggle works bidirectionally. '
            'No lingering light-theme artifacts remain.'
        )
