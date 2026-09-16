import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from '../i18n/locales.ts'
import { stageImagesAsDrop } from '../core/image-intake.ts'

/** Full props for the composer image-upload entry (session-standard owner share unused). */
export interface MobileImagePickerProps extends PropsRuntime<'conversation.input.left'>, PropsLocale<typeof NS> {}

/** Primary drop-event path: the DragEvent constructor carrying the transfer. */
function makeDragEvent(type: string, init: { bubbles: boolean, cancelable: boolean, dataTransfer: DataTransfer }): Event | null {
  try {
    return new DragEvent(type, init)
  } catch {
    return null
  }
}

/** Legacy initDragEvent surface (removed from lib.dom's DragEvent typing). */
interface LegacyDragEvent extends Event {
  initDragEvent(type: string, canBubble: boolean, cancelable: boolean, view: Window | null, detail: number, screenX: number, screenY: number, clientX: number, clientY: number, ctrlKey: boolean, altKey: boolean, shiftKey: boolean, metaKey: boolean, button: number, relatedTarget: EventTarget | null, dataTransfer: DataTransfer | null): void
}

/** Legacy drop-event path: createEvent + initDragEvent for engines without the constructor. */
function makeLegacyDropEvent(transfer: DataTransfer): Event | null {
  try {
    const event = document.createEvent('DragEvent') as unknown as LegacyDragEvent
    event.initDragEvent('drop', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null, transfer)
    return event
  } catch {
    return null
  }
}

/** DataTransfer carrier for the synthetic drop. */
function makeDataTransfer(): DataTransfer | null {
  try {
    return new DataTransfer()
  } catch {
    return null
  }
}

/**
 * Mobile-only paperclip button in the composer's left tool lane
 * (`conversation.input.left`): opens the system image picker, then stages the
 * picked files as one synthetic document drop so the host's native attachment
 * pipeline takes over (thumbnail drafts, upload, inline message images, model
 * vision content). The button itself carries no state — a rejected or empty
 * intake is a silent no-op, exactly like a real drag the host declines.
 * Hidden on wide screens by misc.css.ts (desktop complement block).
 */
export function MobileImagePicker({ t }: MobileImagePickerProps) {
  const pickImages = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      input.remove()
      const files = Array.from(input.files ?? [])
      const staged = stageImagesAsDrop(files, { makeDataTransfer, makeDragEvent, makeLegacyDropEvent })
      if (staged !== null) document.dispatchEvent(staged.event)
    }, { once: true })
    input.click()
  }
  return (
    <button
      type="button"
      data-mobile-nav="image-picker"
      aria-label={t('uploadImage')}
      title={t('uploadImage')}
      onClick={pickImages}
    >
      <IconPaperclipOutline16 size={14} />
    </button>
  )
}
