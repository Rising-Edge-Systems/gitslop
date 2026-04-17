#!/usr/bin/env python3
"""
Windows screen/mouse/keyboard control — pyautogui + pywin32 equivalent of
screen-control.py. Use this when running on Windows (native Electron app).

Usage:
  python screen-control-windows.py screenshot [output.png]
  python screen-control-windows.py click <x> <y>
  python screen-control-windows.py doubleclick <x> <y>
  python screen-control-windows.py rightclick <x> <y>
  python screen-control-windows.py move <x> <y>
  python screen-control-windows.py type <text>
  python screen-control-windows.py key <keyname>       (e.g., enter, esc, ctrl+s)
  python screen-control-windows.py drag <x1> <y1> <x2> <y2>
  python screen-control-windows.py scroll <x> <y> <dy>  (dy >0 = up, <0 = down, notches)
  python screen-control-windows.py window-info           (list visible top-level windows)
  python screen-control-windows.py focus <name>          (focus+raise window by substring)
  python screen-control-windows.py screenshot-window <name> [output.png]
"""

import sys
import time
import ctypes

# Force UTF-8 on stdout so window titles with non-cp1252 glyphs don't crash
# the script on Windows console.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# Must set DPI awareness BEFORE pyautogui imports, otherwise mouse/screenshot
# coordinates get silently downscaled on high-DPI displays.
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

import pyautogui  # noqa: E402
import win32gui  # noqa: E402
import win32con  # noqa: E402

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.02


def _default_screenshot_path():
    return r'C:\Users\benki\AppData\Local\Temp\gitslop-screenshot.png'


def screenshot(output=None):
    output = output or _default_screenshot_path()
    img = pyautogui.screenshot()
    img.save(output)
    print(f'Screenshot saved: {output} ({img.width}x{img.height})')
    return output


def click(x, y, button='left'):
    pyautogui.click(x=x, y=y, button=button)
    print(f'Clicked ({button}) at ({x}, {y})')


def double_click(x, y):
    pyautogui.doubleClick(x=x, y=y)
    print(f'Double-clicked at ({x}, {y})')


def move(x, y):
    pyautogui.moveTo(x, y)


def drag(x1, y1, x2, y2):
    pyautogui.moveTo(x1, y1)
    pyautogui.dragTo(x2, y2, duration=0.25, button='left')
    print(f'Dragged ({x1},{y1}) -> ({x2},{y2})')


def scroll(x, y, dy):
    pyautogui.moveTo(x, y)
    pyautogui.scroll(int(dy))
    print(f'Scrolled {dy} at ({x}, {y})')


def type_text(text):
    # typewrite handles printable ASCII and common specials.
    pyautogui.typewrite(text, interval=0.01)
    print(f'Typed: {text[:60]}{"..." if len(text) > 60 else ""}')


def press_key(spec):
    parts = [p.strip().lower() for p in spec.split('+') if p.strip()]
    if not parts:
        print('No key given'); return
    # pyautogui expects lower-case key names like "enter", "esc", "tab",
    # "pageup", "pagedown", "f1"..."f12". Single letters also work.
    name_map = {
        'esc': 'escape',
        'del': 'delete',
        'ins': 'insert',
        'bksp': 'backspace',
    }
    key = name_map.get(parts[-1], parts[-1])
    mods = parts[:-1]
    if mods:
        pyautogui.hotkey(*mods, key)
    else:
        pyautogui.press(key)
    print(f'Pressed: {spec}')


def _iter_top_windows():
    """Yield (hwnd, title, (x, y, w, h)) for visible top-level windows."""
    results = []

    def cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if not title:
            return
        try:
            l, t, r, b = win32gui.GetWindowRect(hwnd)
        except Exception:
            return
        w, h = r - l, b - t
        # Filter obviously off-screen / zero windows
        if w <= 1 or h <= 1:
            return
        results.append((hwnd, title, (l, t, w, h)))

    win32gui.EnumWindows(cb, None)
    return results


def list_windows():
    for hwnd, title, (x, y, w, h) in _iter_top_windows():
        print(f'  {hwnd:#010x}  {w}x{h}  @({x},{y})  {title}')


def find_window(pattern):
    """Substring match (case-insensitive) against window title."""
    pat = pattern.lower()
    for hwnd, title, rect in _iter_top_windows():
        if pat in title.lower():
            return hwnd, title, rect
    return None


def focus_window(pattern):
    match = find_window(pattern)
    if not match:
        print(f'Window not found: {pattern}')
        return False
    hwnd, title, _ = match
    # Some Windows versions block SetForegroundWindow unless we attach
    # to the current foreground thread first.
    try:
        fg = win32gui.GetForegroundWindow()
        if fg and fg != hwnd:
            fg_thread = ctypes.windll.user32.GetWindowThreadProcessId(fg, None)
            our_thread = ctypes.windll.kernel32.GetCurrentThreadId()
            if fg_thread and fg_thread != our_thread:
                ctypes.windll.user32.AttachThreadInput(our_thread, fg_thread, True)
                try:
                    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                    win32gui.SetForegroundWindow(hwnd)
                finally:
                    ctypes.windll.user32.AttachThreadInput(our_thread, fg_thread, False)
            else:
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                win32gui.SetForegroundWindow(hwnd)
        else:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(hwnd)
    except Exception as e:
        print(f'Focus attempt warning: {e}')
    time.sleep(0.1)
    print(f'Focused: {title}')
    return True


def screenshot_window(pattern, output=None):
    match = find_window(pattern)
    if not match:
        print(f'Window not found: {pattern}')
        return None
    hwnd, title, (x, y, w, h) = match
    # Raise first so the capture isn't obscured.
    focus_window(pattern)
    time.sleep(0.15)
    # Re-read rect in case focusing restored from minimized
    try:
        l, t, r, b = win32gui.GetWindowRect(hwnd)
        x, y, w, h = l, t, r - l, b - t
    except Exception:
        pass
    output = output or _default_screenshot_path()
    img = pyautogui.screenshot(region=(x, y, w, h))
    img.save(output)
    print(f'Window screenshot saved: {output} ({w}x{h}) — {title}')
    return output


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'screenshot':
        screenshot(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == 'click':
        click(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == 'doubleclick':
        double_click(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == 'rightclick':
        click(int(sys.argv[2]), int(sys.argv[3]), button='right')
    elif cmd == 'move':
        move(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == 'type':
        type_text(' '.join(sys.argv[2:]))
    elif cmd == 'key':
        press_key(sys.argv[2])
    elif cmd == 'drag':
        drag(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))
    elif cmd == 'scroll':
        scroll(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    elif cmd == 'window-info':
        list_windows()
    elif cmd == 'focus':
        focus_window(' '.join(sys.argv[2:]))
    elif cmd == 'screenshot-window':
        name = sys.argv[2]
        out = sys.argv[3] if len(sys.argv) > 3 else None
        screenshot_window(name, out)
    else:
        print(f'Unknown command: {cmd}')
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
