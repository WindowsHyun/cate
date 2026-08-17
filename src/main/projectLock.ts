import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import log from './logger'

// ---------------------------------------------------------------------------
// Per-project lock for .cate/workspace.json
//
// The single-instance lock (index.ts) is keyed on Electron's userData dir, but
// a dev build and an installed build deliberately use *different* userData dirs
// (the `app.isPackaged` split), so they each win their own single-instance lock
// and can run side by side. When both open the *same project*, both autosave
// .cate/workspace.json (~30s) and each reads the other's write as an external
// edit — the spurious "Reload workspace?" loop.
//
// So we drop a .cate/workspace.lock holding the owning pid when a project opens
// here. A second Cate that finds a *live* owner won't autosave that project.
// The pid lets us recover from a crash: a leftover lock whose pid is gone is
// reclaimed instead of bricking the project read-only. Advisory only — if the
// file can't be written we fail open and behave as the owner.
// ---------------------------------------------------------------------------

const heldRoots = new Set<string>()

function lockPath(rootPath: string): string {
  return path.join(rootPath, '.cate', 'workspace.lock')
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0) // signal 0 = existence check, sends nothing
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM' // exists, not ours to signal
  }
}

/** Best-effort process command name for `pid`, or null if it can't be read. */
function processCommand(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf-8',
        timeout: 1000,
      })
      return out.split(',')[0]?.replace(/^"|"$/g, '') || null
    }
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf-8',
      timeout: 1000,
    })
    return out.trim() || null
  } catch {
    return null
  }
}

/** A PID surviving in the lock file is only meaningful if it's still an actual
 *  Cate process — a bare `isProcessAlive` check treats ANY live PID as "still
 *  the owner", but PIDs get recycled by the OS. A quit that leaves a stale
 *  lock behind (or a crash) means that number can later be reassigned to a
 *  completely unrelated process (a system service, some other app), which
 *  then reads as "another instance has this open" forever. Dev Cate runs the
 *  stock, unbranded Electron binary (comm shows as "Electron"), the packaged
 *  app as "Cate" — match either. */
function isLiveCateProcess(pid: number): boolean {
  if (!isProcessAlive(pid)) return false
  const command = processCommand(pid)
  // Can't verify identity (ps/tasklist unavailable, sandboxed, etc.) — this
  // lock is advisory only ("fail open" per the module doc above), so default
  // to NOT blocking rather than repeat the PID-reuse false positive this
  // check replaces.
  return command !== null && /cate|electron/i.test(command)
}

function ownerPid(file: string): number | null {
  try {
    const pid = JSON.parse(fs.readFileSync(file, 'utf-8'))?.pid
    return typeof pid === 'number' ? pid : null
  } catch {
    return null // missing or corrupt
  }
}

/** Take this project's lock. Returns false only if a live instance holds it. */
export function acquireProjectLock(rootPath: string): boolean {
  const file = lockPath(rootPath)
  const pid = ownerPid(file)
  if (pid !== null && pid !== process.pid && isLiveCateProcess(pid)) return false
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid }))
  } catch (err) {
    log.warn('projectLock: could not write lock for %s, proceeding unlocked: %O', rootPath, err)
  }
  heldRoots.add(rootPath)
  return true
}

export function holdsProjectLock(rootPath: string): boolean {
  return heldRoots.has(rootPath)
}

/** Release one project's lock, but only if the file on disk is still ours. */
export function releaseProjectLock(rootPath: string): void {
  if (!heldRoots.delete(rootPath)) return
  const file = lockPath(rootPath)
  if (ownerPid(file) === process.pid) {
    try { fs.unlinkSync(file) } catch { /* best effort */ }
  }
}

/** Release every lock this process holds. Called on quit. */
export function releaseAllProjectLocks(): void {
  for (const root of [...heldRoots]) releaseProjectLock(root)
}
