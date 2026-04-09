"""
Test that verifies the test repo fixtures work correctly.

Creates a test repo, verifies all expected state (branches, commits, tags,
stash, staged/unstaged/untracked files), then cleans up.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

# Import framework via file path (package name has hyphen)
_framework_path = Path(__file__).resolve().parent.parent / 'framework.py'
if 'gui_tests.framework' not in sys.modules:
    _spec = importlib.util.spec_from_file_location('gui_tests.framework', str(_framework_path))
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules['gui_tests.framework'] = _mod
    _spec.loader.exec_module(_mod)

# Import fixtures via file path
_fixtures_path = Path(__file__).resolve().parent.parent / 'fixtures.py'
if 'gui_tests.fixtures' not in sys.modules:
    _spec2 = importlib.util.spec_from_file_location('gui_tests.fixtures', str(_fixtures_path))
    _mod2 = importlib.util.module_from_spec(_spec2)
    sys.modules['gui_tests.fixtures'] = _mod2
    _spec2.loader.exec_module(_mod2)

from gui_tests.framework import GUITest  # noqa: E402
from gui_tests.fixtures import create_test_repo, cleanup_test_repo  # noqa: E402


def _git_output(repo_path: str, *args) -> str:
    """Run a git command and return stdout."""
    result = subprocess.run(
        ['git'] + list(args),
        cwd=repo_path,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return result.stdout.strip()


class TestFixtures(GUITest):
    """Test that verifies create_test_repo() produces correct state."""

    name = 'TestFixtures'

    def setUp(self):
        self._repo_path = None

    def run(self):
        # Create the test repo
        self._repo_path = create_test_repo()
        repo = self._repo_path

        assert os.path.isdir(repo), f"Repo directory not created: {repo}"
        assert os.path.isdir(os.path.join(repo, '.git')), "Not a git repo"

        # Verify we're on main branch
        branch = _git_output(repo, 'branch', '--show-current')
        assert branch == 'main', f"Expected main branch, got: {branch}"

        # Verify commit count on main (5 commits + 1 merge = 6 on main)
        log = _git_output(repo, 'log', '--oneline', '--first-parent')
        commits = [line for line in log.split('\n') if line.strip()]
        assert len(commits) == 6, f"Expected 6 commits on main (5 + merge), got {len(commits)}: {log}"

        # Verify feature branch exists
        branches = _git_output(repo, 'branch', '--list')
        assert 'feature' in branches, f"Feature branch missing. Branches: {branches}"

        # Verify tags
        tags = _git_output(repo, 'tag', '--list')
        assert 'v1.0' in tags, f"Tag v1.0 missing. Tags: {tags}"
        assert 'v2.0' in tags, f"Tag v2.0 missing. Tags: {tags}"

        # Verify stash
        stash = _git_output(repo, 'stash', 'list')
        assert 'WIP: stashed changes' in stash, f"Stash entry missing. Stash: {stash}"

        # Verify staged file
        staged = _git_output(repo, 'diff', '--cached', '--name-only')
        assert 'src/staged_new.py' in staged, f"Staged file missing. Staged: {staged}"

        # Verify unstaged modified file
        unstaged = _git_output(repo, 'diff', '--name-only')
        assert 'config.json' in unstaged, f"Unstaged modified file missing. Unstaged: {unstaged}"

        # Verify untracked file
        untracked = _git_output(repo, 'ls-files', '--others', '--exclude-standard')
        assert 'notes.txt' in untracked, f"Untracked file missing. Untracked: {untracked}"

        # Verify key files exist
        assert (Path(repo) / 'README.md').exists(), "README.md missing"
        assert (Path(repo) / 'src/main.py').exists(), "src/main.py missing"
        assert (Path(repo) / 'src/utils.py').exists(), "src/utils.py missing"
        assert (Path(repo) / 'src/feature.py').exists(), "src/feature.py missing"
        assert (Path(repo) / 'config.json').exists(), "config.json missing"
        assert (Path(repo) / 'tests/test_utils.py').exists(), "tests/test_utils.py missing"
        assert (Path(repo) / 'tests/test_feature.py').exists(), "tests/test_feature.py missing"

        # Verify deterministic author
        author = _git_output(repo, 'log', '-1', '--format=%an <%ae>')
        assert author == 'Test Author <test@example.com>', f"Unexpected author: {author}"

        # Verify deterministic dates (first commit)
        first_date = _git_output(repo, 'log', '--reverse', '--format=%aI', '-1')
        assert '2024-01-15' in first_date, f"First commit date unexpected: {first_date}"

        # Take a screenshot to confirm framework integration
        self.screenshot('fixtures_verified')

    def tearDown(self):
        if self._repo_path:
            cleanup_test_repo(self._repo_path)
