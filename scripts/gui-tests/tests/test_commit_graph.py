"""
Test — SVG Commit Graph Rendering (US-GT-012)

Verifies the commit graph renders with SVG nodes, lanes, and labels:
- Colored circle nodes, vertical branch lane lines, HEAD commit with glow effect
- Branch/tag labels as pill badges
- Each commit row shows: short hash, message, author, relative date
- Current branch label visible on HEAD commit
- Scrolling down in commit graph shows no gaps or missing nodes
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


class TestCommitGraph(GUITest):
    """Verify SVG commit graph rendering with nodes, lanes, labels, and scrolling."""

    name = 'TestCommitGraph'

    def setUp(self):
        """Create a test repo to open in GitSlop."""
        self._test_repo = create_test_repo()

    def tearDown(self):
        """Clean up the test repo."""
        if hasattr(self, '_test_repo') and self._test_repo:
            cleanup_test_repo(self._test_repo)

    def run(self):
        # Focus the window and ensure default size
        self.focus_window()
        self.wait(1.0)
        self.reset_window_size()
        self.wait(0.5)

        # Open the test repo in GitSlop
        open_test_repo(self, self._test_repo)
        self.wait(2.0)

        # Get window bounds for coordinate calculations
        x, y, w, h = self.get_window_bounds()

        # Ensure sidebar is expanded (press Ctrl+B twice to guarantee state)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # Press Escape to ensure no detail panel is open
        self.press_key('Escape')
        self.wait(0.3)

        # 1. Take screenshot of commit graph area with repo open
        self.assert_visual(
            'commit_graph_overview',
            'Commit graph is visible in the center panel. The graph shows: '
            'colored circle nodes (SVG circles) representing commits, '
            'vertical branch lane lines connecting parent/child commits, '
            'the HEAD commit has a glow or highlight effect to distinguish it, '
            'and branch/tag labels displayed as colored pill badges next to commits. '
            'No emoji icons are used anywhere — all icons are Lucide SVG.'
        )

        # 2. Assert each commit row shows: short hash, message, author, relative date
        self.assert_visual(
            'commit_row_details',
            'Each commit row in the graph shows the following columns of information: '
            'a short commit hash (7-8 hex characters), the commit message text, '
            'the author name, and a relative date (e.g., "2 days ago" or similar time format). '
            'All text is readable and properly aligned in columns. '
            'The commit graph nodes (colored circles) are on the left side of each row.'
        )

        # 3. Assert current branch label visible on HEAD commit
        self.assert_visual(
            'branch_labels',
            'Branch and/or tag labels are visible as pill-shaped badges next to commits. '
            'The current branch (likely "main" or a feature branch) is shown as a '
            'colored pill badge on the HEAD/top commit. Tag labels like "v1.0" or "v2.0" '
            'may also be visible as pill badges. The HEAD indicator is distinguishable '
            'from regular branch labels (may have special styling or glow effect).'
        )

        # 4. Scroll down in commit graph to test virtualization
        #    The commit graph is in the center area; scroll in the middle of it
        graph_center_x = w // 2
        graph_center_y = h // 2

        # Scroll down multiple times
        self.scroll(graph_center_x, graph_center_y, clicks=10, direction='down')
        self.wait(0.5)

        self.assert_visual(
            'scrolled_down',
            'The commit graph has been scrolled down from the initial position. '
            'Earlier commits are now visible (different commit messages than before). '
            'There are no gaps, blank spaces, or missing nodes in the graph. '
            'The vertical lane lines remain continuous and connected. '
            'Commit rows are fully rendered with nodes, hashes, messages, authors, and dates. '
            'The virtualized list renders correctly without visual artifacts.'
        )

        # 5. Scroll back up to verify no rendering issues
        self.scroll(graph_center_x, graph_center_y, clicks=10, direction='up')
        self.wait(0.5)

        self.assert_visual(
            'scrolled_back_up',
            'The commit graph has been scrolled back to the top/initial position. '
            'The HEAD commit with its branch label and glow effect is visible again. '
            'All commit rows render correctly after scrolling back. '
            'No visual glitches, missing nodes, or broken lane lines are present.'
        )
