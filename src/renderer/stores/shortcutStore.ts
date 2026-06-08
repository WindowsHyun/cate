// =============================================================================
// Shortcut Store — Zustand state for keyboard shortcut bindings and matching.
// Ported from KeyboardShortcuts.swift
// =============================================================================

import { create } from 'zustand'
import type { ShortcutAction, StoredShortcut } from '../../shared/types'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from '../../shared/types'

function persistCustomShortcuts(shortcuts: Record<ShortcutAction, StoredShortcut>): void {
  if (typeof window === 'undefined' || !window.electronAPI) return
  const custom: Partial<Record<ShortcutAction, StoredShortcut>> = {}
  for (const action of SHORTCUT_ACTIONS) {
    const s = shortcuts[action]
    const d = DEFAULT_SHORTCUTS[action]
    if (s.key !== d.key || s.command !== d.command || s.shift !== d.shift ||
        s.option !== d.option || s.control !== d.control) {
      custom[action] = s
    }
  }
  window.electronAPI.settingsSet('customShortcuts', custom).catch(() => {})
}

// -----------------------------------------------------------------------------
// Modifier state
// -----------------------------------------------------------------------------

interface ModifierState {
  command: boolean
  shift: boolean
  option: boolean
  control: boolean
}

// -----------------------------------------------------------------------------
// Store interface
// -----------------------------------------------------------------------------

interface ShortcutStoreState {
  shortcuts: Record<ShortcutAction, StoredShortcut>
}

interface ShortcutStoreActions {
  setShortcut: (action: ShortcutAction, shortcut: StoredShortcut) => void
  resetShortcut: (action: ShortcutAction) => void
  resetAll: () => void
  matchEvent: (e: KeyboardEvent) => ShortcutAction | null
  /** Merge persisted custom shortcuts over defaults. Called once on settings load. */
  applyCustomShortcuts: (custom: Partial<Record<ShortcutAction, StoredShortcut>>) => void
}

export type ShortcutStore = ShortcutStoreState & ShortcutStoreActions

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Normalise a KeyboardEvent.key to the stored key format.
 * Special keys map to the same strings used in DEFAULT_SHORTCUTS.
 */
function normaliseKey(e: KeyboardEvent): string {
  switch (e.key) {
    case 'Tab':
      return '\t'
    case 'Enter':
      return '\r'
    case ' ':
      return ' '
    case 'Backspace':
      return 'Backspace'
    case 'Escape':
      return 'Escape'
    case 'ArrowLeft':
      return '\u2190' // ←
    case 'ArrowRight':
      return '\u2192' // →
    case 'ArrowDown':
      return '\u2193' // ↓
    case 'ArrowUp':
      return '\u2191' // ↑
    default:
      return e.key.toLowerCase()
  }
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

export const useShortcutStore = create<ShortcutStore>((set, get) => ({
  // --- State ---
  shortcuts: { ...DEFAULT_SHORTCUTS },

  // --- Actions ---

  setShortcut(action, shortcut) {
    set((state) => {
      const next = { ...state.shortcuts, [action]: shortcut }
      persistCustomShortcuts(next)
      return { shortcuts: next }
    })
  },

  resetShortcut(action) {
    set((state) => {
      const next = { ...state.shortcuts, [action]: DEFAULT_SHORTCUTS[action] }
      persistCustomShortcuts(next)
      return { shortcuts: next }
    })
  },

  applyCustomShortcuts(custom) {
    if (!custom || Object.keys(custom).length === 0) return
    set((state) => ({
      shortcuts: { ...state.shortcuts, ...custom },
    }))
  },

  resetAll() {
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } })
  },

  matchEvent(e: KeyboardEvent): ShortcutAction | null {
    const { shortcuts } = get()
    const eventKey = normaliseKey(e)
    const eventMods: ModifierState = {
      command: e.metaKey,
      shift: e.shiftKey,
      option: e.altKey,
      control: e.ctrlKey,
    }

    for (const action of SHORTCUT_ACTIONS) {
      const stored = shortcuts[action]
      if (
        stored.key === eventKey &&
        stored.command === eventMods.command &&
        stored.shift === eventMods.shift &&
        stored.option === eventMods.option &&
        stored.control === eventMods.control
      ) {
        return action
      }
    }

    return null
  },
}))
