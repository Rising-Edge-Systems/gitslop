import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as os from 'os'

interface TerminalInstance {
  ptyProcess: pty.IPty
  id: string
}

const terminals: Map<string, TerminalInstance> = new Map()
let terminalCounter = 0

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env['COMSPEC'] || 'cmd.exe'
  }
  return process.env['SHELL'] || '/bin/bash'
}

export function registerTerminalIpcHandlers(): void {
  ipcMain.handle(
    'terminal:create',
    (_event, opts: { cwd?: string; id?: string }) => {
      try {
        const id = opts.id || `terminal-${++terminalCounter}`
        const shell = getDefaultShell()
        const shellArgs = process.platform === 'win32' ? [] : ['-l']

        const ptyProcess = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: opts.cwd || os.homedir(),
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor'
          } as Record<string, string>
        })

        terminals.set(id, { ptyProcess, id })

        // Forward PTY output to renderer
        ptyProcess.onData((data: string) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:data', { id, data })
          }
        })

        ptyProcess.onExit(({ exitCode }) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('terminal:exit', { id, exitCode })
          }
          terminals.delete(id)
        })

        return { success: true, data: { id } }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create terminal'
        }
      }
    }
  )

  ipcMain.handle(
    'terminal:write',
    (_event, opts: { id: string; data: string }) => {
      const terminal = terminals.get(opts.id)
      if (!terminal) {
        return { success: false, error: 'Terminal not found' }
      }
      try {
        terminal.ptyProcess.write(opts.data)
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Write failed'
        }
      }
    }
  )

  ipcMain.handle(
    'terminal:resize',
    (_event, opts: { id: string; cols: number; rows: number }) => {
      const terminal = terminals.get(opts.id)
      if (!terminal) {
        return { success: false, error: 'Terminal not found' }
      }
      try {
        terminal.ptyProcess.resize(opts.cols, opts.rows)
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Resize failed'
        }
      }
    }
  )

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    const terminal = terminals.get(id)
    if (!terminal) {
      return { success: false, error: 'Terminal not found' }
    }
    try {
      terminal.ptyProcess.kill()
      terminals.delete(id)
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Kill failed'
      }
    }
  })

  ipcMain.handle('terminal:setCwd', (_event, opts: { id: string; cwd: string }) => {
    // For node-pty, we can't change cwd after creation.
    // Instead, send a `cd` command to the terminal.
    const terminal = terminals.get(opts.id)
    if (!terminal) {
      return { success: false, error: 'Terminal not found' }
    }
    try {
      const cdCmd = process.platform === 'win32'
        ? `cd /d "${opts.cwd}"\r`
        : `cd "${opts.cwd}"\r`
      terminal.ptyProcess.write(cdCmd)
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'setCwd failed'
      }
    }
  })
}

export function killAllTerminals(): void {
  for (const [id, terminal] of terminals) {
    try {
      terminal.ptyProcess.kill()
    } catch {
      // Ignore errors during cleanup
    }
    terminals.delete(id)
  }
}
