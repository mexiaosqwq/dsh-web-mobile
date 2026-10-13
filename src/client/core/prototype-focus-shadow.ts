/** Shared focus interception with descriptor and wrapper ownership restoration. */
export type FocusSkip = (element: HTMLInputElement) => boolean
const rules = new Set<{ shouldSkip: FocusSkip }>()
let restore: (() => void) | null = null

export function shadowFocus(shouldSkip: FocusSkip): () => void {
  if (restore === null) {
    const proto = HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'focus')
    const previous = proto.focus
    if (typeof previous !== 'function' || descriptor?.configurable === false ||
      (!descriptor && !Object.isExtensible(proto))) return () => {}
    const wrapper = function focus(this: HTMLInputElement, options?: FocusOptions): void {
      for (const rule of rules) if (rule.shouldSkip(this)) return
      previous.call(this, options)
    }
    try {
      Object.defineProperty(proto, 'focus', {
        configurable: true, writable: true,
        enumerable: descriptor?.enumerable ?? false, value: wrapper,
      })
    } catch { return () => {} }
    restore = () => {
      if (Object.getOwnPropertyDescriptor(proto, 'focus')?.value !== wrapper) return
      try {
        if (descriptor) Object.defineProperty(proto, 'focus', descriptor)
        else delete (proto as Partial<HTMLInputElement>).focus
      } catch {
        // An externally frozen wrapper is transparent once its rules are gone.
      }
    }
  }
  const rule = { shouldSkip }
  rules.add(rule)
  return () => {
    if (!rules.delete(rule)) return
    if (rules.size === 0) {
      const release = restore
      restore = null
      release?.()
    }
  }
}
