#!/usr/bin/env python3
"""
GUI Test Runner for GitSlop.

Entry point that:
1. Builds the app (electron-vite build)
2. Launches Electron with --no-sandbox
3. Waits for the window to appear
4. Runs the TestSuite
5. Kills the app
6. Writes JSON report to results/report.json

Usage:
    python3 scripts/gui-tests/run.py [--filter <pattern>] [--no-build] [--no-launch]
"""

import argparse
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

# Resolve paths
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
TESTS_DIR = SCRIPT_DIR / 'tests'


def import_from_file(module_name, file_path):
    """Import a module from a file path (bypasses package name issues)."""
    spec = importlib.util.spec_from_file_location(module_name, str(file_path))
    if spec and spec.loader:
        mod = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = mod
        spec.loader.exec_module(mod)
        return mod
    raise ImportError(f"Cannot load {file_path}")


# Import framework
framework = import_from_file('gui_tests.framework', SCRIPT_DIR / 'framework.py')
TestSuite = framework.TestSuite
GUITest = framework.GUITest


def load_all_tests():
    """Import all test_*.py modules from the tests/ directory."""
    if not TESTS_DIR.exists():
        return
    for test_file in sorted(TESTS_DIR.glob('test_*.py')):
        module_name = f"gui_tests.tests.{test_file.stem}"
        import_from_file(module_name, test_file)


def parse_args():
    parser = argparse.ArgumentParser(description='GitSlop GUI Test Runner')
    parser.add_argument('--filter', type=str, default=None,
                        help='Run only tests matching this name substring')
    parser.add_argument('--no-build', action='store_true',
                        help='Skip electron-vite build step')
    parser.add_argument('--no-launch', action='store_true',
                        help='Skip launching Electron (assume already running)')
    parser.add_argument('--size', type=str, default=None,
                        help='Initial window size as WxH (e.g. 1280x800)')
    return parser.parse_args()


def build_app():
    """Build the app with electron-vite."""
    print("Building app...")
    result = subprocess.run(
        ['npx', 'electron-vite', 'build'],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        print(f"Build failed:\n{result.stderr}")
        sys.exit(1)
    print("Build complete.")


def launch_app(open_repo=None):
    """Launch Electron and return the process.

    Args:
        open_repo: Optional repo path to open on startup via --open-repo CLI arg.
    """
    print(f"Launching GitSlop...{f' (opening {open_repo})' if open_repo else ''}")
    env = os.environ.copy()
    env['DISPLAY'] = ':1'
    cmd = ['npx', 'electron', '--no-sandbox', '.']
    if open_repo:
        cmd.extend(['--open-repo', open_repo])
    proc = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc


def is_app_alive(proc):
    """Check if the Electron process is still running."""
    if proc is None:
        return False
    return proc.poll() is None


def ensure_app_running(proc, open_repo=None):
    """Relaunch the app if it crashed. Returns (proc, relaunched)."""
    if is_app_alive(proc):
        return proc, False
    print("  App crashed! Relaunching...")
    proc = launch_app(open_repo)
    time.sleep(2)
    if wait_for_window(timeout=15):
        time.sleep(2)
        return proc, True
    print("  Failed to relaunch app.")
    return proc, False


def wait_for_window(timeout=30):
    """Wait for the GitSlop window to appear."""
    from Xlib import display as xdisplay, Xatom
    print("Waiting for GitSlop window...")
    start = time.time()
    while time.time() - start < timeout:
        try:
            d = xdisplay.Display(':1')
            root = d.screen().root
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
                        if 'gitslop' in name_lower or 'electron' in class_str:
                            print(f"Window found: {wm_name}")
                            d.close()
                            return True
                    except Exception:
                        pass
            d.close()
        except Exception:
            pass
        time.sleep(0.5)

    print("Timed out waiting for GitSlop window.")
    return False


def kill_app(proc):
    """Kill the Electron process."""
    if proc and proc.poll() is None:
        print("Stopping GitSlop...")
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        print("GitSlop stopped.")


def write_report(results, report_path):
    """Write JSON report."""
    report = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'total': len(results),
        'passed': sum(1 for r in results if r.status == 'pass'),
        'failed': sum(1 for r in results if r.status == 'fail'),
        'errors': sum(1 for r in results if r.status == 'error'),
        'tests': [
            {
                'name': r.name,
                'status': r.status,
                'duration_seconds': r.duration_seconds,
                'screenshot_paths': r.screenshot_paths,
                'criteria': r.criteria,
                'evaluation_notes': r.evaluation_notes,
                'error_message': r.error_message,
                'evaluations': r.evaluations,
            }
            for r in results
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f"Report written to {report_path}")


def main():
    args = parse_args()

    # Import all test modules to register GUITest subclasses
    load_all_tests()

    # Build
    if not args.no_build:
        build_app()

    # Launch
    proc = None
    if not args.no_launch:
        proc = launch_app()
        # Give the app a moment to start
        time.sleep(2)
        if not wait_for_window():
            kill_app(proc)
            sys.exit(1)
        # Extra settle time for the UI to fully render
        time.sleep(2)

        # Apply initial window size if specified
        if args.size:
            try:
                sw, sh = args.size.lower().split('x')
                initial_w, initial_h = int(sw), int(sh)
                # Create a temporary GUITest to use resize_window
                resizer = GUITest()
                resizer.resize_window(initial_w, initial_h)
                print(f"Window resized to {initial_w}x{initial_h}")
                time.sleep(0.5)
            except ValueError:
                print(f"Warning: Invalid --size format '{args.size}', expected WxH (e.g. 1280x800)")

    try:
        # Run tests — pass proc for crash recovery
        suite = TestSuite(filter_pattern=args.filter)
        results = suite.run(app_proc=proc, relaunch_fn=launch_app if not args.no_launch else None)

        # Write report
        report_path = SCRIPT_DIR / 'results' / 'report.json'
        write_report(results, report_path)

        # Exit code
        all_passed = all(r.status == 'pass' for r in results)
        sys.exit(0 if all_passed else 1)

    finally:
        if proc:
            kill_app(proc)


if __name__ == '__main__':
    main()
