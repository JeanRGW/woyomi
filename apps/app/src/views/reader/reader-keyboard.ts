/** Reader shortcuts must not steal keys from controls, links, or editable content. */
export function ignoreReaderKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return true
  const target = event.target instanceof HTMLElement ? event.target : document.activeElement
  return !!target?.closest('input, textarea, select, button, a, summary, [role="button"], [contenteditable="true"]')
}
