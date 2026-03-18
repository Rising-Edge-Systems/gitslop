"""
Test — Git Operations End-to-End (US-GT-023)

Verifies actual git operations (stage, commit, stash, branch) work through the UI:
- Modifies a file in the test repo and detects the change
- Stages a file via the UI
- Commits via the commit form
- Stashes changes via keyboard shortcut
- Verifies each operation reflected in the UI
"""

import importlib.util
import os
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


class TestGitOps(GUITest):
    """Verify end-to-end git operations (stage, commit, stash) through the UI."""

    name = 'TestGitOps'

    def setUp(self):
        """Create a test repo with known state."""
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

        # Ensure sidebar is expanded (toggle twice to guarantee known state)
        self.press_key('ctrl+b')
        self.wait(0.5)
        self.press_key('ctrl+b')
        self.wait(0.5)

        # Dismiss any open panels/overlays
        self.press_key('Escape')
        self.wait(0.3)

        # --- 1. Modify a file in the test repo and wait for watcher ---
        # Write a new file directly into the test repo
        new_file_path = os.path.join(self._test_repo, 'src', 'new_module.py')
        with open(new_file_path, 'w') as f:
            f.write('# New module added during test\n\ndef hello():\n    return "hello from test"\n')

        # Wait for the file watcher to detect the change
        self.wait(3.0)

        # Take screenshot showing the new file in Unstaged Changes
        self.assert_visual(
            'new_file_detected',
            'The application window shows the staging area with unstaged changes. '
            'A new file (new_module.py or similar) should be visible in the '
            'Unstaged Changes column along with other pre-existing unstaged files '
            '(config.json modified, notes.txt untracked). The file watcher has '
            'detected the newly created file and it appears in the file list. '
            'Each file shows a Lucide status icon (not emoji).'
        )

        # --- 2. Stage the new file by clicking + button ---
        # The unstaged files are in the left column of the staging area
        # Staging area is in the lower portion of the window
        unstaged_area_x = int(w * 0.35)
        staging_area_y = h - 100

        # Hover over the file area to reveal the + button
        self.hover(unstaged_area_x, staging_area_y)
        self.wait(0.3)

        # Click the + button (right side of file row)
        stage_btn_x = int(w * 0.45)
        self.click(stage_btn_x, staging_area_y)
        self.wait(0.5)

        self.assert_visual(
            'file_staged',
            'After staging a file, it has moved from the Unstaged Changes column '
            '(left) to the Staged Changes column (right). The staged column now '
            'shows the staged file. File count badges have updated to reflect '
            'the change. The two-column layout remains clean.'
        )

        # --- 3. Type commit message and commit ---
        # The commit form is typically below or within the staging area
        # Look for a commit message input field and a Commit button
        # The commit input is usually at the bottom of the staging area
        commit_input_x = int(w * 0.5)
        commit_input_y = h - 50  # Near the very bottom, above the status bar

        # Click on the commit message input area
        self.click(commit_input_x, commit_input_y)
        self.wait(0.3)

        # Type a commit message
        self.type_text('Add new module via GUI test')
        self.wait(0.3)

        self.assert_visual(
            'commit_message_typed',
            'The commit message input field shows the typed text '
            '"Add new module via GUI test" (or similar). The commit button '
            'should be visible and enabled since there are staged files. '
            'The staging area shows files ready to be committed.'
        )

        # Press Ctrl+Enter or click the Commit button to commit
        # Ctrl+Enter is a common shortcut for committing
        self.press_key('ctrl+Return')
        self.wait(2.0)

        self.assert_visual(
            'after_commit',
            'After committing, the commit graph should show a new commit at the '
            'top with the message "Add new module via GUI test" (or similar). '
            'The staging area should show fewer staged files (the committed file '
            'is no longer in the staged column). A success notification or toast '
            'may be visible. The new commit should appear as the HEAD commit in '
            'the graph with the current branch label.'
        )

        # --- 4. Create another change for stashing ---
        # Modify an existing file to create an unstaged change for stash
        readme_path = os.path.join(self._test_repo, 'README.md')
        with open(readme_path, 'a') as f:
            f.write('\n## Stash Test\nThis line was added for stash testing.\n')

        # Wait for watcher to detect
        self.wait(3.0)

        self.assert_visual(
            'pre_stash_changes',
            'The staging area shows new unstaged changes. The README.md file '
            '(or another modified file) should appear in the Unstaged Changes '
            'column with a modified/edit status icon. These changes will be '
            'stashed in the next step.'
        )

        # --- 5. Stash changes via Ctrl+Shift+S or Stash button ---
        # Try the keyboard shortcut for stash
        self.press_key('ctrl+shift+s')
        self.wait(1.0)

        # A stash dialog may appear — if so, confirm it
        # Take a screenshot to see the stash dialog state
        self.assert_visual(
            'stash_dialog',
            'Either a stash dialog/modal is visible asking for a stash message '
            'or description, OR the stash has been performed directly. If a '
            'dialog is shown, it should have a text input for the stash message '
            'and confirm/cancel buttons. If no dialog, the staging area should '
            'now be empty (all changes stashed).'
        )

        # If a dialog appeared, press Enter to confirm the stash
        self.press_key('Return')
        self.wait(1.5)

        self.assert_visual(
            'after_stash',
            'After stashing, the staging area should show no unstaged changes '
            '(or fewer changes than before). The stash was successful. '
            'The sidebar may show a stash entry in the Stashes section. '
            'A success toast/notification may be visible confirming the stash.'
        )
