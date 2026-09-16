/**
 * Composer image intake: stage picked image files as one synthetic document
 * `drop` event, which the host's document-level drop listeners consume as if
 * the user had dragged the files in (see AGENTS.md: the host's attachment
 * intake is a document drag-and-drop listener — no visible upload button, and
 * touch devices cannot drag). Kept constructor-free and import-free so the
 * staging logic is unit-testable with injected factories; the browser
 * constructors live in the component layer (MobileImagePicker.tsx).
 */

/** A staged intake: the filtered images plus the ready-to-dispatch event. */
export interface StagedDrop {
  readonly images: readonly File[]
  readonly event: Event
}

/** Factory for the primary drop-event path (DragEvent constructor). */
export interface IntakeDragEventFactory {
  (type: string, init: { bubbles: boolean, cancelable: boolean, dataTransfer: DataTransfer }): Event | null
}

/** Factory for the legacy drop-event path (createEvent + initDragEvent). */
export interface IntakeLegacyDropFactory {
  (dataTransfer: DataTransfer): Event | null
}

/** Factory for the DataTransfer carrier (constructor may be absent on old engines). */
export interface IntakeDataTransferFactory {
  (): DataTransfer | null
}

/** Injected constructor bindings; all optional so tests can omit paths. */
export interface ImageIntakeDeps {
  makeDataTransfer?: IntakeDataTransferFactory
  makeDragEvent?: IntakeDragEventFactory
  makeLegacyDropEvent?: IntakeLegacyDropFactory
}

/** A file counts as an image only when the picker reported an image/* MIME type. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * Filter `files` down to images and stage them as a single drop event.
 * @returns the staged drop, or null when there is nothing to stage (no
 *   images, or every construction path is unavailable — a silent no-op that
 *   mirrors a dropped drag being ignored).
 */
export function stageImagesAsDrop(files: readonly File[], deps: ImageIntakeDeps): StagedDrop | null {
  const images = files.filter(isImageFile)
  if (images.length === 0) return null
  const makeDataTransfer = deps.makeDataTransfer
  if (makeDataTransfer === undefined) return null
  let transfer: DataTransfer | null
  try {
    transfer = makeDataTransfer()
  } catch {
    return null
  }
  if (transfer === null) return null
  try {
    for (const image of images) transfer.items.add(image)
  } catch {
    return null
  }
  const event = buildDropEvent(deps, transfer)
  if (event === null) return null
  return { images, event }
}

/**
 * Build the drop event: primary DragEvent-constructor path first, then the
 * legacy initDragEvent path. Both are wrapped so a throw (constructor
 * unsupported on this engine) degrades to the next path, and null from a
 * factory short-circuits the remaining path.
 */
function buildDropEvent(deps: ImageIntakeDeps, transfer: DataTransfer): Event | null {
  const makeDragEvent = deps.makeDragEvent
  if (makeDragEvent !== undefined) {
    try {
      const event = makeDragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      if (event !== null) return event
    } catch {
      // constructor threw: fall through to the legacy path
    }
  }
  const makeLegacyDropEvent = deps.makeLegacyDropEvent
  if (makeLegacyDropEvent !== undefined) {
    try {
      const event = makeLegacyDropEvent(transfer)
      if (event !== null) return event
    } catch {
      // last path exhausted
    }
  }
  return null
}
