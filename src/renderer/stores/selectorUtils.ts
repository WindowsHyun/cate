// =============================================================================
// Selector Utilities — shared equality helpers for zustand selectors.
//
// These back the custom equality functions passed to useStoreWithEqualityFn so
// granular selectors only re-render when the data they project actually changes.
// =============================================================================

/**
 * Element-wise equality for arrays of primitives (compared with `!==`).
 * Returns true only when both arrays have the same length and identical
 * elements in the same order.
 */
export function primitiveArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Set equality for arrays of primitives: same elements regardless of order.
 * Used for node-id lists where DOM order is irrelevant (CSS zIndex handles
 * stacking) — prevents spurious re-renders when zOrder changes without adding
 * or removing nodes, which would reorder DOM and cause webview reloads.
 */
export function primitiveSetEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  for (const item of a) {
    if (!setB.has(item)) return false
  }
  return true
}

/**
 * Generic array equality keyed on a per-element comparator. `cmp(x, y)` must
 * return true when two elements are considered equal. Returns true only when
 * both arrays have the same length and every aligned pair compares equal.
 */
export function arrayEqualBy<T>(
  a: readonly T[],
  b: readonly T[],
  cmp: (x: T, y: T) => boolean,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!cmp(a[i], b[i])) return false
  }
  return true
}
