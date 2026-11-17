/** Open the Ctrl+K command palette. */
export function openPalette() {
  window.dispatchEvent(new Event('open-palette'))
}
