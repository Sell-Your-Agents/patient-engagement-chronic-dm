/** Jump to Call Logs with the scheduled-callbacks drawer open. */
export function openCallbacks(navigate: (o: { to: string }) => unknown) {
  ;(window as unknown as { __ppOpenCallbacks?: boolean }).__ppOpenCallbacks = true
  navigate({ to: '/calls' })
  window.dispatchEvent(new Event('open-callbacks'))
}

/** Open the Ctrl+K command palette. */
export function openPalette() {
  window.dispatchEvent(new Event('open-palette'))
}
