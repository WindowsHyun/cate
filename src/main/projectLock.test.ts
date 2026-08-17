import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let mockCommand: string | null = null
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => {
    if (mockCommand === null) throw new Error('no such process')
    return mockCommand
  }),
}))

import {
  acquireProjectLock,
  releaseProjectLock,
  releaseAllProjectLocks,
  holdsProjectLock,
} from './projectLock'

describe('projectLock', () => {
  let root: string
  const lockFile = () => path.join(root, '.cate', 'workspace.lock')
  const writeOwner = (pid: number) => {
    fs.mkdirSync(path.dirname(lockFile()), { recursive: true })
    fs.writeFileSync(lockFile(), JSON.stringify({ pid }))
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cate-lock-'))
    mockCommand = null
  })
  afterEach(() => {
    releaseAllProjectLocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('acquires a free lock and records our pid', () => {
    expect(acquireProjectLock(root)).toBe(true)
    expect(holdsProjectLock(root)).toBe(true)
    expect(JSON.parse(fs.readFileSync(lockFile(), 'utf-8')).pid).toBe(process.pid)
  })

  it('reclaims a lock left by a dead pid', () => {
    writeOwner(999999) // overwhelmingly unlikely to be alive
    expect(acquireProjectLock(root)).toBe(true)
  })

  it('refuses a lock held by a live pid whose process is Cate/Electron', () => {
    // The parent process is alive for the test and isn't our own pid.
    mockCommand = '/Applications/Cate.app/Contents/MacOS/Cate'
    writeOwner(process.ppid)
    expect(acquireProjectLock(root)).toBe(false)
    expect(holdsProjectLock(root)).toBe(false)
  })

  // Regression: a stale lock's pid can be reassigned by the OS to an unrelated
  // process (a system service, some other app) long after the Cate that wrote
  // it quit. Treating ANY live pid as "still the owner" made the "another
  // instance has this open" warning reappear forever, even with only one Cate
  // running. The pid must actually BE a Cate/Electron process to count.
  it('reclaims a lock whose live pid is not a Cate/Electron process (PID reuse)', () => {
    mockCommand = '/System/Library/Frameworks/ExtensionFoundation.framework/.../extensionkitservice'
    writeOwner(process.ppid)
    expect(acquireProjectLock(root)).toBe(true)
  })

  it('reclaims a lock when the owning pid\'s identity cannot be verified (fails open)', () => {
    mockCommand = null // ps/tasklist unavailable or errors
    writeOwner(process.ppid)
    expect(acquireProjectLock(root)).toBe(true)
  })

  it('release deletes our lock file', () => {
    acquireProjectLock(root)
    releaseProjectLock(root)
    expect(fs.existsSync(lockFile())).toBe(false)
  })

  it('release leaves a lock owned by someone else', () => {
    acquireProjectLock(root)
    writeOwner(process.ppid)
    releaseProjectLock(root)
    expect(fs.existsSync(lockFile())).toBe(true)
  })
})
