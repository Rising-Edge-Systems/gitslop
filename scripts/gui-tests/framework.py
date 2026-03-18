"""
GUI Test Framework for GitSlop.

Provides base classes for defining and running GUI tests using python-xlib
for screenshot capture and window interaction.
"""

import os
import time
import traceback
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from pathlib import Path

from Xlib import display, X, Xatom
from PIL import Image


# Project root (gitslop/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RESULTS_DIR = Path(__file__).resolve().parent / 'results'
SCREENSHOTS_DIR = RESULTS_DIR / 'screenshots'


@dataclass
class TestResult:
    """Result of a single GUI test."""
    name: str
    status: str  # 'pass', 'fail', 'error'
    screenshot_paths: List[str] = field(default_factory=list)
    criteria: List[str] = field(default_factory=list)
    evaluation_notes: str = ''
    duration_seconds: float = 0.0
    error_message: str = ''


class GUITest:
    """Base class for GUI tests.

    Subclass this and implement run() to create a test.
    Optionally override setUp() and tearDown() for setup/cleanup.
    """

    name: str = ''

    def __init__(self):
        if not self.name:
            self.name = self.__class__.__name__
        self._display: Optional[display.Display] = None
        self._screenshots: List[str] = []
        self._criteria: List[str] = []

    @property
    def display(self) -> display.Display:
        if self._display is None:
            self._display = display.Display(':1')
        return self._display

    def setUp(self):
        """Override for test setup. Called before run()."""
        pass

    def tearDown(self):
        """Override for test cleanup. Called after run() regardless of outcome."""
        pass

    def run(self):
        """Override this method to implement the test."""
        raise NotImplementedError("Subclasses must implement run()")

    def screenshot(self, name: str) -> str:
        """Take a screenshot and save to results/screenshots/.

        Args:
            name: Descriptive name for the screenshot (without extension).

        Returns:
            Path to the saved screenshot.
        """
        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{self.name}_{name}.png"
        output_path = str(SCREENSHOTS_DIR / filename)

        d = self.display
        root = d.screen().root
        geo = root.get_geometry()
        w, h = geo.width, geo.height
        raw = root.get_image(0, 0, w, h, X.ZPixmap, 0xffffffff)
        img = Image.frombytes('RGBX', (w, h), raw.data, 'raw', 'BGRX')
        img = img.convert('RGB')
        img.save(output_path)

        self._screenshots.append(output_path)
        return output_path

    def wait(self, seconds: float):
        """Wait for a specified number of seconds."""
        time.sleep(seconds)

    def get_window_bounds(self) -> Tuple[int, int, int, int]:
        """Get the gitslop window position and size.

        Returns:
            Tuple of (x, y, width, height) in absolute screen coordinates.
        """
        d = self.display
        win = self._find_gitslop_window()
        if win is None:
            raise RuntimeError("GitSlop window not found")

        geo = win.get_geometry()
        coords = win.translate_coords(d.screen().root, 0, 0)
        abs_x = -coords.x
        abs_y = -coords.y
        return (abs_x, abs_y, geo.width, geo.height)

    def _find_gitslop_window(self):
        """Find the GitSlop window via X11."""
        d = self.display
        root = d.screen().root
        patterns = ['gitslop', 'electron']

        atom = d.intern_atom('_NET_CLIENT_LIST')
        resp = root.get_full_property(atom, Xatom.WINDOW)
        if resp:
            for wid in resp.value:
                w = d.create_resource_object('window', wid)
                try:
                    wm_name = w.get_wm_name() or ''
                    wm_class = w.get_wm_class() or ('', '')
                    name_lower = str(wm_name).lower()
                    class_str = ' '.join(wm_class).lower()
                    for pattern in patterns:
                        if pattern in name_lower or pattern in class_str:
                            return w
                except Exception:
                    pass
        return None


class TestSuite:
    """Collects and runs GUITest subclasses."""

    def __init__(self, filter_pattern: Optional[str] = None):
        self.filter_pattern = filter_pattern
        self.results: List[TestResult] = []

    def collect_tests(self) -> List[GUITest]:
        """Collect all GUITest subclasses that have been imported."""
        tests = []
        for cls in GUITest.__subclasses__():
            instance = cls()
            if self.filter_pattern:
                if self.filter_pattern.lower() not in instance.name.lower():
                    continue
            tests.append(instance)
        # Sort by name for deterministic ordering
        tests.sort(key=lambda t: t.name)
        return tests

    def run(self) -> List[TestResult]:
        """Run all collected tests and return results."""
        tests = self.collect_tests()
        if not tests:
            print("\033[33mNo tests found.\033[0m")
            return []

        print(f"\nRunning {len(tests)} test(s)...\n")

        for test in tests:
            result = self._run_single(test)
            self.results.append(result)

            # Print colored result
            if result.status == 'pass':
                color = '\033[32m'  # green
                label = '[PASS]'
            elif result.status == 'fail':
                color = '\033[31m'  # red
                label = '[FAIL]'
            else:
                color = '\033[31m'  # red
                label = '[ERROR]'

            reset = '\033[0m'
            print(f"  {color}{label}{reset} {result.name} ({result.duration_seconds:.2f}s)")
            if result.error_message:
                print(f"         {result.error_message}")

        # Summary
        passed = sum(1 for r in self.results if r.status == 'pass')
        failed = sum(1 for r in self.results if r.status == 'fail')
        errors = sum(1 for r in self.results if r.status == 'error')
        total = len(self.results)

        print(f"\n{'='*50}")
        print(f"Results: {passed}/{total} passed, {failed} failed, {errors} errors")
        print(f"{'='*50}\n")

        return self.results

    def _run_single(self, test: GUITest) -> TestResult:
        """Run a single test with error handling."""
        start_time = time.time()
        try:
            test.setUp()
            test.run()
            status = 'pass'
            error_msg = ''
        except AssertionError as e:
            status = 'fail'
            error_msg = str(e) or traceback.format_exc().split('\n')[-2]
        except Exception as e:
            status = 'error'
            error_msg = f"{type(e).__name__}: {e}"
            traceback.print_exc()
        finally:
            try:
                test.tearDown()
            except Exception as e:
                print(f"  Warning: tearDown failed for {test.name}: {e}")

        duration = time.time() - start_time

        return TestResult(
            name=test.name,
            status=status,
            screenshot_paths=list(test._screenshots),
            criteria=list(test._criteria),
            evaluation_notes='',
            duration_seconds=duration,
            error_message=error_msg,
        )
