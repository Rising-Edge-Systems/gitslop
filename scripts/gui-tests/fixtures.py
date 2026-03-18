"""
Test Repo Fixtures for GitSlop GUI Tests.

Provides deterministic test repository creation with known branches, commits,
tags, stash entries, and working tree state for reproducible GUI testing.
"""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


# Base date for deterministic commits (2024-01-15 12:00:00 UTC)
_BASE_DATE = '2024-01-15T12:00:00+00:00'


def _git(repo_path: str, *args, env_extra: dict = None):
    """Run a git command in the given repo, raising on failure."""
    env = os.environ.copy()
    env['GIT_AUTHOR_NAME'] = 'Test Author'
    env['GIT_AUTHOR_EMAIL'] = 'test@example.com'
    env['GIT_COMMITTER_NAME'] = 'Test Author'
    env['GIT_COMMITTER_EMAIL'] = 'test@example.com'
    if env_extra:
        env.update(env_extra)

    result = subprocess.run(
        ['git'] + list(args),
        cwd=repo_path,
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed:\n{result.stderr.strip()}"
        )
    return result.stdout.strip()


def _date_offset(hours: int) -> str:
    """Return a deterministic date string offset from the base date by N hours."""
    # Parse base and add hours
    from datetime import datetime, timezone, timedelta
    base = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    dt = base + timedelta(hours=hours)
    return dt.strftime('%Y-%m-%dT%H:%M:%S+00:00')


def create_test_repo() -> str:
    """Create a deterministic test repository with known state.

    Creates a temporary directory with:
    - git init with 5 commits on main (known messages and file contents)
    - A 'feature' branch with 3 commits, merged back to main
    - 2 tags ('v1.0', 'v2.0')
    - 1 stash entry
    - 1 staged file
    - 1 unstaged modified file
    - 1 untracked file

    All commits use deterministic author/dates for reproducibility.

    Returns:
        Path to the created test repository directory.
    """
    repo_dir = tempfile.mkdtemp(prefix='gitslop-test-repo-')

    # Initialize repo
    _git(repo_dir, 'init', '-b', 'main')

    # Configure repo-local settings
    _git(repo_dir, 'config', 'user.name', 'Test Author')
    _git(repo_dir, 'config', 'user.email', 'test@example.com')

    # --- Main branch: 5 commits ---

    # Commit 1: Initial project structure
    _write_file(repo_dir, 'README.md', '# Test Project\n\nA deterministic test repository.\n')
    _write_file(repo_dir, 'src/main.py', 'def main():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    main()\n')
    _write_file(repo_dir, '.gitignore', '__pycache__/\n*.pyc\n.env\n')
    _git(repo_dir, 'add', '-A', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(0),
        'GIT_COMMITTER_DATE': _date_offset(0),
    })
    _git(repo_dir, 'commit', '-m', 'Initial project structure', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(0),
        'GIT_COMMITTER_DATE': _date_offset(0),
    })

    # Commit 2: Add configuration
    _write_file(repo_dir, 'config.json', '{\n  "debug": false,\n  "version": "1.0.0"\n}\n')
    _git(repo_dir, 'add', 'config.json', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(1),
        'GIT_COMMITTER_DATE': _date_offset(1),
    })
    _git(repo_dir, 'commit', '-m', 'Add configuration file', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(1),
        'GIT_COMMITTER_DATE': _date_offset(1),
    })

    # Tag v1.0
    _git(repo_dir, 'tag', 'v1.0', '-m', 'Version 1.0 release', env_extra={
        'GIT_COMMITTER_DATE': _date_offset(1),
    })

    # Commit 3: Add utility module
    _write_file(repo_dir, 'src/utils.py', 'def format_name(first, last):\n    return f"{first} {last}"\n\ndef add(a, b):\n    return a + b\n')
    _git(repo_dir, 'add', 'src/utils.py', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(2),
        'GIT_COMMITTER_DATE': _date_offset(2),
    })
    _git(repo_dir, 'commit', '-m', 'Add utility module with helpers', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(2),
        'GIT_COMMITTER_DATE': _date_offset(2),
    })

    # Commit 4: Add tests
    _write_file(repo_dir, 'tests/test_utils.py', 'from src.utils import add, format_name\n\ndef test_add():\n    assert add(1, 2) == 3\n\ndef test_format_name():\n    assert format_name("John", "Doe") == "John Doe"\n')
    _git(repo_dir, 'add', 'tests/test_utils.py', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(3),
        'GIT_COMMITTER_DATE': _date_offset(3),
    })
    _git(repo_dir, 'commit', '-m', 'Add unit tests for utils', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(3),
        'GIT_COMMITTER_DATE': _date_offset(3),
    })

    # Commit 5: Update README
    _write_file(repo_dir, 'README.md', '# Test Project\n\nA deterministic test repository.\n\n## Features\n- Main module\n- Configuration\n- Utility helpers\n- Unit tests\n')
    _git(repo_dir, 'add', 'README.md', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(4),
        'GIT_COMMITTER_DATE': _date_offset(4),
    })
    _git(repo_dir, 'commit', '-m', 'Update README with feature list', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(4),
        'GIT_COMMITTER_DATE': _date_offset(4),
    })

    # --- Feature branch: 3 commits, then merge ---

    _git(repo_dir, 'checkout', '-b', 'feature')

    # Feature commit 1
    _write_file(repo_dir, 'src/feature.py', 'class Feature:\n    def __init__(self, name):\n        self.name = name\n\n    def describe(self):\n        return f"Feature: {self.name}"\n')
    _git(repo_dir, 'add', 'src/feature.py', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(5),
        'GIT_COMMITTER_DATE': _date_offset(5),
    })
    _git(repo_dir, 'commit', '-m', 'Add Feature class', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(5),
        'GIT_COMMITTER_DATE': _date_offset(5),
    })

    # Feature commit 2
    _write_file(repo_dir, 'src/feature.py', 'class Feature:\n    def __init__(self, name, enabled=True):\n        self.name = name\n        self.enabled = enabled\n\n    def describe(self):\n        status = "enabled" if self.enabled else "disabled"\n        return f"Feature: {self.name} ({status})"\n\n    def toggle(self):\n        self.enabled = not self.enabled\n')
    _git(repo_dir, 'add', 'src/feature.py', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(6),
        'GIT_COMMITTER_DATE': _date_offset(6),
    })
    _git(repo_dir, 'commit', '-m', 'Add enabled flag and toggle to Feature', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(6),
        'GIT_COMMITTER_DATE': _date_offset(6),
    })

    # Feature commit 3
    _write_file(repo_dir, 'tests/test_feature.py', 'from src.feature import Feature\n\ndef test_feature_describe():\n    f = Feature("dark-mode")\n    assert f.describe() == "Feature: dark-mode (enabled)"\n\ndef test_feature_toggle():\n    f = Feature("dark-mode")\n    f.toggle()\n    assert not f.enabled\n')
    _git(repo_dir, 'add', 'tests/test_feature.py', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(7),
        'GIT_COMMITTER_DATE': _date_offset(7),
    })
    _git(repo_dir, 'commit', '-m', 'Add tests for Feature class', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(7),
        'GIT_COMMITTER_DATE': _date_offset(7),
    })

    # Merge feature into main
    _git(repo_dir, 'checkout', 'main')
    _git(repo_dir, 'merge', '--no-ff', 'feature', '-m', 'Merge feature branch', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(8),
        'GIT_COMMITTER_DATE': _date_offset(8),
    })

    # Tag v2.0
    _git(repo_dir, 'tag', 'v2.0', '-m', 'Version 2.0 release', env_extra={
        'GIT_COMMITTER_DATE': _date_offset(8),
    })

    # --- Create stash ---
    _write_file(repo_dir, 'src/stashed.py', '# This file was stashed\nprint("stash test")\n')
    _git(repo_dir, 'add', 'src/stashed.py')
    _git(repo_dir, 'stash', 'push', '-m', 'WIP: stashed changes', env_extra={
        'GIT_AUTHOR_DATE': _date_offset(9),
        'GIT_COMMITTER_DATE': _date_offset(9),
    })

    # --- Working tree state ---

    # Staged file
    _write_file(repo_dir, 'src/staged_new.py', '# This file is staged but not committed\nSTAGED = True\n')
    _git(repo_dir, 'add', 'src/staged_new.py')

    # Unstaged modified file
    _write_file(repo_dir, 'config.json', '{\n  "debug": true,\n  "version": "2.0.0",\n  "new_setting": "value"\n}\n')

    # Untracked file
    _write_file(repo_dir, 'notes.txt', 'This is an untracked file.\nIt should appear in the working tree.\n')

    return repo_dir


def cleanup_test_repo(repo_path: str):
    """Remove a test repository directory.

    Args:
        repo_path: Path to the test repository to remove.
    """
    if repo_path and os.path.isdir(repo_path):
        shutil.rmtree(repo_path, ignore_errors=True)


def open_test_repo(test_instance, repo_path: str):
    """Open a test repo in GitSlop by passing the path as a command-line argument.

    This helper uses keyboard shortcuts and the UI to navigate to and open
    the given repository path. It types the path into the Open Repository
    dialog.

    Note: This interacts with the native file dialog which may not be reliable
    in all environments. Consider launching the app with the repo path as
    an argument if possible.

    Args:
        test_instance: A GUITest instance (provides click, type_text, etc.).
        repo_path: Path to the repository to open.
    """
    # Focus the GitSlop window
    test_instance.focus_window()
    time.sleep(0.3)

    # Use Ctrl+O to open the file dialog (common shortcut for Open)
    test_instance.press_key('ctrl+o')
    time.sleep(1.0)

    # Type the repo path into the file dialog path bar
    # Most GTK/Electron file dialogs accept typing a path directly
    test_instance.type_text(repo_path)
    time.sleep(0.5)

    # Press Enter to confirm
    test_instance.press_key('Return')
    time.sleep(2.0)  # Wait for repo to load


def _write_file(repo_dir: str, relative_path: str, content: str):
    """Write a file to the repo, creating directories as needed."""
    full_path = Path(repo_dir) / relative_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_text(content)
