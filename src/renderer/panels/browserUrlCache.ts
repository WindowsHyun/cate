// Module-level cache of each browser panel's last-visited URL, keyed by the
// (restore-stable) panel id. BrowserPanel seeds its webview src from this on
// mount so a viewport-cull / dock-tab-switch remount reopens the page the user
// was on instead of resetting to the initial URL.
//
// Lives in its own module (not inside BrowserPanel.tsx) so appStore.closePanel
// can evict an entry when a panel is permanently destroyed — without creating a
// circular import between the store and the panel component.

const lastUrlByPanel = new Map<string, string>()
const lastScrollByPanel = new Map<string, { x: number; y: number }>()

export function getBrowserPanelUrl(panelId: string): string | undefined {
  return lastUrlByPanel.get(panelId)
}

export function setBrowserPanelUrl(panelId: string, url: string): void {
  lastUrlByPanel.set(panelId, url)
}

/** Last-known scroll offset of a browser panel, used to restore scroll after a
 *  remount destroys+recreates the webview (dock-tab switch, workspace switch).
 *  The canvas-cull path keeps browser nodes mounted, so it preserves scroll
 *  natively without needing this. */
export function getBrowserPanelScroll(panelId: string): { x: number; y: number } | undefined {
  return lastScrollByPanel.get(panelId)
}

export function setBrowserPanelScroll(panelId: string, x: number, y: number): void {
  lastScrollByPanel.set(panelId, { x, y })
}

/** Evict a panel's cached URL + scroll. Call only on permanent panel close —
 *  NOT on component unmount, which is the very event the cache exists to
 *  survive. */
export function forgetBrowserPanelUrl(panelId: string): void {
  lastUrlByPanel.delete(panelId)
  lastScrollByPanel.delete(panelId)
}
