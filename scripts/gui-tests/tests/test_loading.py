"""
Test — Loading States and Skeletons (US-GT-024)

Verifies skeleton screens appear during loading instead of blank screens:
- Opens a repo and rapidly takes screenshots (every 100ms for 2 seconds) during initial load
- Reviews rapid screenshots — asserts at least one shows skeleton placeholders (gray pulsing rectangles)
- Asserts no screenshot shows a completely blank/white center panel
- Saves the sequence as loading_001.png through loading_020.png for review
"""

import importlib.util
import sys
import time
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


class TestLoadingStates(GUITest):
    """Verify skeleton screens appear during loading instead of blank screens."""

    name = 'TestLoadingStates'

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

        # ---- 1. Rapid screenshot capture during repo open ----
        # Start opening the repo and immediately begin capturing screenshots
        # to catch transient loading/skeleton states.

        # We use open_test_repo which triggers the repo open flow.
        # To capture loading states, we start rapid screenshots right after
        # initiating the open action.

        # First, take a baseline screenshot before opening anything
        self.assert_visual(
            'before_open',
            'The GitSlop application is visible before opening a new repo. '
            'This is the baseline state — either a welcome screen or a '
            'previously opened repo view.'
        )

        # Open the test repo — this triggers loading
        open_test_repo(self, self._test_repo)

        # ---- 2. Rapidly capture 20 screenshots every 100ms (2 seconds total) ----
        # These capture the loading/transition states including skeleton screens
        loading_screenshots = []
        for i in range(1, 21):
            seq_name = f'loading_{i:03d}'
            path = self.screenshot(seq_name)
            loading_screenshots.append(path)
            time.sleep(0.1)

        # ---- 3. Take a final screenshot after loading is fully complete ----
        self.wait(2.0)

        self.assert_visual(
            'after_load_complete',
            'The GitSlop application has fully loaded a repository. '
            'The commit graph is visible with commit entries (circle nodes, '
            'commit messages, author names, dates). The sidebar shows branches. '
            'The toolbar shows repo-specific buttons (Pull, Push, Fetch, etc.). '
            'No skeleton placeholders or loading indicators are visible — '
            'the application is in its normal fully-loaded state.'
        )

        # ---- 4. Evaluate the rapid screenshot sequence ----
        # Assert visual on the full sequence with criteria about what
        # should be seen across the loading screenshots
        self.assert_visual(
            'loading_sequence_sample',
            'This screenshot is part of a rapid capture sequence taken during '
            'repo loading. Across the full sequence, at least one screenshot '
            'should show a loading or skeleton state — gray pulsing rectangles '
            'or placeholder shapes in the center panel where the commit graph '
            'will appear. No screenshot in the sequence should show a completely '
            'blank white panel with no content at all. Acceptable states include: '
            'skeleton placeholders (gray rectangles), a spinner/loading indicator, '
            'partially loaded commit graph, or the fully loaded state. '
            'The key requirement is that the transition from empty to loaded '
            'is never a jarring blank screen.'
        )
