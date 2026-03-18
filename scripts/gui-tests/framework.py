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

from Xlib import display, X, Xatom, XK, protocol
from Xlib.ext.xtest import fake_input
from PIL import Image


# Project root (gitslop/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RESULTS_DIR = Path(__file__).resolve().parent / 'results'
SCREENSHOTS_DIR = RESULTS_DIR / 'screenshots'


def _get_evaluator():
    """Lazy-import evaluator to avoid circular imports."""
    import importlib.util
    evaluator_path = Path(__file__).resolve().parent / 'evaluator.py'
    spec = importlib.util.spec_from_file_location('gui_tests.evaluator', str(evaluator_path))
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    raise ImportError("Cannot load evaluator.py")


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
    evaluations: List[dict] = field(default_factory=list)


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
        self._evaluations: List[dict] = []

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
        """Take a screenshot of the GitSlop window only.

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

        # Try to capture just the GitSlop window
        win = self._find_gitslop_window()
        if win:
            geo = win.get_geometry()
            coords = win.translate_coords(root, 0, 0)
            abs_x = -coords.x
            abs_y = -coords.y
            w, h = geo.width, geo.height
            # Clamp to screen bounds
            screen_geo = root.get_geometry()
            w = min(w, screen_geo.width - abs_x)
            h = min(h, screen_geo.height - abs_y)
            abs_x = max(0, abs_x)
            abs_y = max(0, abs_y)
            raw = root.get_image(abs_x, abs_y, w, h, X.ZPixmap, 0xffffffff)
            img = Image.frombytes('RGBX', (w, h), raw.data, 'raw', 'BGRX')
        else:
            # Fallback: capture full desktop
            geo = root.get_geometry()
            w, h = geo.width, geo.height
            raw = root.get_image(0, 0, w, h, X.ZPixmap, 0xffffffff)
            img = Image.frombytes('RGBX', (w, h), raw.data, 'raw', 'BGRX')

        img = img.convert('RGB')
        img.save(output_path)

        self._screenshots.append(output_path)
        return output_path

    def assert_visual(self, name: str, criteria: str) -> str:
        """Take a screenshot and evaluate it against visual criteria.

        Takes a screenshot, runs it through the evaluator, saves a baseline
        on first run, and stores the evaluation result for the report.

        Args:
            name: Descriptive name for the screenshot (without extension).
            criteria: Human-readable criteria describing what should be visible
                      in the screenshot (e.g. 'sidebar collapsed to 48px icon rail').

        Returns:
            Path to the saved screenshot.
        """
        evaluator = _get_evaluator()

        # Take the screenshot
        screenshot_path = self.screenshot(name)

        # Evaluate against criteria
        evaluation = evaluator.evaluate(screenshot_path, criteria)

        # Save baseline (first run only — existing baselines are preserved)
        baseline_path = evaluator.save_baseline(screenshot_path, self.name, name)
        evaluation.baseline_path = baseline_path

        # Store criteria and evaluation for the report
        self._criteria.append(criteria)
        self._evaluations.append(evaluator.evaluation_to_dict(evaluation))

        return screenshot_path

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

    def _to_abs(self, rel_x: int, rel_y: int) -> Tuple[int, int]:
        """Convert window-relative coordinates to absolute screen coordinates."""
        wx, wy, _, _ = self.get_window_bounds()
        return (wx + rel_x, wy + rel_y)

    def focus_window(self):
        """Raise and focus the GitSlop window."""
        d = self.display
        win = self._find_gitslop_window()
        if not win:
            raise RuntimeError("GitSlop window not found")

        root = d.screen().root
        atom_active = d.intern_atom('_NET_ACTIVE_WINDOW')

        event = protocol.event.ClientMessage(
            window=win,
            client_type=atom_active,
            data=(32, [2, X.CurrentTime, 0, 0, 0])
        )
        root.send_event(event, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        d.sync()
        time.sleep(0.1)

    def click(self, rel_x: int, rel_y: int):
        """Click at window-relative coordinates.

        Args:
            rel_x: X coordinate relative to the window's left edge.
            rel_y: Y coordinate relative to the window's top edge.
        """
        d = self.display
        abs_x, abs_y = self._to_abs(rel_x, rel_y)
        root = d.screen().root
        # Move
        fake_input(d, X.MotionNotify, x=abs_x, y=abs_y, root=root)
        d.sync()
        time.sleep(0.05)
        # Press
        fake_input(d, X.ButtonPress, 1, root=root)
        d.sync()
        time.sleep(0.05)
        # Release
        fake_input(d, X.ButtonRelease, 1, root=root)
        d.sync()

    def rightclick(self, rel_x: int, rel_y: int):
        """Right-click at window-relative coordinates."""
        d = self.display
        abs_x, abs_y = self._to_abs(rel_x, rel_y)
        root = d.screen().root
        fake_input(d, X.MotionNotify, x=abs_x, y=abs_y, root=root)
        d.sync()
        time.sleep(0.05)
        fake_input(d, X.ButtonPress, 3, root=root)
        d.sync()
        time.sleep(0.05)
        fake_input(d, X.ButtonRelease, 3, root=root)
        d.sync()

    def doubleclick(self, rel_x: int, rel_y: int):
        """Double-click at window-relative coordinates."""
        self.click(rel_x, rel_y)
        time.sleep(0.1)
        self.click(rel_x, rel_y)

    def type_text(self, text: str):
        """Type a string of text.

        Args:
            text: The text to type character by character.
        """
        d = self.display
        for char in text:
            keysym = XK.string_to_keysym(char)
            if keysym == 0:
                special = {
                    ' ': 'space', '\n': 'Return', '\t': 'Tab',
                    '/': 'slash', '\\': 'backslash', '-': 'minus',
                    '=': 'equal', '[': 'bracketleft', ']': 'bracketright',
                    ';': 'semicolon', "'": 'apostrophe', ',': 'comma',
                    '.': 'period', '`': 'grave',
                }
                if char in special:
                    keysym = XK.string_to_keysym(special[char])
                else:
                    continue

            keycode = d.keysym_to_keycode(keysym)
            if keycode == 0:
                continue

            need_shift = char.isupper() or char in '~!@#$%^&*()_+{}|:"<>?'
            if need_shift:
                shift_code = d.keysym_to_keycode(XK.XK_Shift_L)
                fake_input(d, X.KeyPress, shift_code)
                d.sync()

            fake_input(d, X.KeyPress, keycode)
            d.sync()
            time.sleep(0.02)
            fake_input(d, X.KeyRelease, keycode)
            d.sync()

            if need_shift:
                fake_input(d, X.KeyRelease, shift_code)
                d.sync()

            time.sleep(0.02)

    def press_key(self, combo: str):
        """Press a key combination.

        Args:
            combo: Key combo string, e.g. 'Return', 'ctrl+b', 'ctrl+shift+f'.
        """
        d = self.display
        parts = combo.split('+')
        modifiers = []
        key_name = parts[-1]

        mod_map = {
            'ctrl': XK.XK_Control_L,
            'alt': XK.XK_Alt_L,
            'shift': XK.XK_Shift_L,
            'super': XK.XK_Super_L,
        }

        for part in parts[:-1]:
            p = part.lower().strip()
            if p in mod_map:
                modifiers.append(mod_map[p])

        keysym = XK.string_to_keysym(key_name)
        if keysym == 0:
            name_map = {
                'enter': 'Return', 'esc': 'Escape', 'del': 'Delete',
                'backspace': 'BackSpace', 'space': 'space',
                'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
                'tab': 'Tab', 'home': 'Home', 'end': 'End',
                'pageup': 'Prior', 'pagedown': 'Next',
            }
            resolved = name_map.get(key_name.lower(), key_name)
            keysym = XK.string_to_keysym(resolved)

        if keysym == 0:
            raise ValueError(f"Unknown key: {key_name}")

        keycode = d.keysym_to_keycode(keysym)

        # Press modifiers
        for mod_sym in modifiers:
            mod_code = d.keysym_to_keycode(mod_sym)
            fake_input(d, X.KeyPress, mod_code)
            d.sync()

        # Press and release key
        fake_input(d, X.KeyPress, keycode)
        d.sync()
        time.sleep(0.05)
        fake_input(d, X.KeyRelease, keycode)
        d.sync()

        # Release modifiers (reverse order)
        for mod_sym in reversed(modifiers):
            mod_code = d.keysym_to_keycode(mod_sym)
            fake_input(d, X.KeyRelease, mod_code)
            d.sync()

    def resize_window(self, width: int, height: int):
        """Resize the GitSlop window via X11 ConfigureWindow.

        Args:
            width: Desired window width in pixels.
            height: Desired window height in pixels.
        """
        d = self.display
        win = self._find_gitslop_window()
        if not win:
            raise RuntimeError("GitSlop window not found")

        root = d.screen().root

        # Unmaximize first — maximized windows ignore resize requests
        atom_state = d.intern_atom('_NET_WM_STATE')
        atom_max_h = d.intern_atom('_NET_WM_STATE_MAXIMIZED_HORZ')
        atom_max_v = d.intern_atom('_NET_WM_STATE_MAXIMIZED_VERT')
        event = protocol.event.ClientMessage(
            window=win,
            client_type=atom_state,
            data=(32, [0, atom_max_h, atom_max_v, 1, 0])  # 0 = _NET_WM_STATE_REMOVE
        )
        root.send_event(event, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        d.sync()
        time.sleep(0.3)

        win.configure(width=width, height=height)
        d.sync()
        # Allow window manager to process the resize and UI to reflow
        time.sleep(0.5)

    def reset_window_size(self):
        """Restore the GitSlop window to the default 1280x800 size."""
        self.resize_window(1280, 800)

    def scroll(self, rel_x: int, rel_y: int, clicks: int = 3, direction: str = 'down'):
        """Scroll at window-relative coordinates using mouse wheel events.

        Args:
            rel_x: X coordinate relative to the window's left edge.
            rel_y: Y coordinate relative to the window's top edge.
            clicks: Number of scroll clicks (each click is one wheel notch).
            direction: 'down' or 'up'.
        """
        d = self.display
        abs_x, abs_y = self._to_abs(rel_x, rel_y)
        root = d.screen().root

        # Move to position first
        fake_input(d, X.MotionNotify, x=abs_x, y=abs_y, root=root)
        d.sync()
        time.sleep(0.05)

        # Button4 = scroll up, Button5 = scroll down
        button = 5 if direction == 'down' else 4

        for _ in range(clicks):
            fake_input(d, X.ButtonPress, button, root=root)
            d.sync()
            time.sleep(0.02)
            fake_input(d, X.ButtonRelease, button, root=root)
            d.sync()
            time.sleep(0.05)

    def hover(self, rel_x: int, rel_y: int):
        """Move the mouse to window-relative coordinates without clicking.

        Args:
            rel_x: X coordinate relative to the window's left edge.
            rel_y: Y coordinate relative to the window's top edge.
        """
        d = self.display
        abs_x, abs_y = self._to_abs(rel_x, rel_y)
        root = d.screen().root
        fake_input(d, X.MotionNotify, x=abs_x, y=abs_y, root=root)
        d.sync()

    def drag(self, x1: int, y1: int, x2: int, y2: int):
        """Drag from one window-relative position to another.

        Args:
            x1, y1: Start position (window-relative).
            x2, y2: End position (window-relative).
        """
        d = self.display
        root = d.screen().root
        abs_x1, abs_y1 = self._to_abs(x1, y1)
        abs_x2, abs_y2 = self._to_abs(x2, y2)

        # Move to start
        fake_input(d, X.MotionNotify, x=abs_x1, y=abs_y1, root=root)
        d.sync()
        time.sleep(0.05)

        # Press
        fake_input(d, X.ButtonPress, 1, root=root)
        d.sync()
        time.sleep(0.1)

        # Smooth drag in steps
        steps = 20
        for i in range(1, steps + 1):
            ix = abs_x1 + (abs_x2 - abs_x1) * i // steps
            iy = abs_y1 + (abs_y2 - abs_y1) * i // steps
            fake_input(d, X.MotionNotify, x=ix, y=iy, root=root)
            d.sync()
            time.sleep(0.01)

        time.sleep(0.05)

        # Release
        fake_input(d, X.ButtonRelease, 1, root=root)
        d.sync()

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

    def run(self, app_proc=None, relaunch_fn=None) -> List[TestResult]:
        """Run all collected tests and return results.

        Args:
            app_proc: The Electron subprocess (for crash detection).
            relaunch_fn: Callable to relaunch the app if it crashes.
                         Signature: relaunch_fn(open_repo=None) -> subprocess.Popen
        """
        tests = self.collect_tests()
        if not tests:
            print("\033[33mNo tests found.\033[0m")
            return []

        print(f"\nRunning {len(tests)} test(s)...\n")

        for test in tests:
            # Check if app is still alive before each test
            if app_proc is not None and app_proc.poll() is not None and relaunch_fn:
                print("  App crashed — relaunching before next test...")
                app_proc = relaunch_fn()
                import time as _t
                _t.sleep(2)
                # Wait for window
                for _ in range(30):
                    try:
                        probe = GUITest()
                        probe._find_gitslop_window()
                        break
                    except Exception:
                        _t.sleep(0.5)
                _t.sleep(2)

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
            evaluations=list(test._evaluations),
        )
