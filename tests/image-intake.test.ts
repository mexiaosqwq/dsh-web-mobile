import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isImageFile, stageImagesAsDrop, type ImageIntakeDeps, type StagedDrop } from '../src/client/core/image-intake.ts'

/** Node has no DOM: File is typed by lib.dom but not constructible in tests. */
function fakeFile(type: string): File {
  return { type } as File
}

/** Minimal DataTransfer stand-in recording items.add calls. */
interface FakeTransfer {
  items: { added: File[]; add: (file: File) => void }
  types: readonly string[]
}

function fakeTransfer(types: readonly string[] = ['Files']): FakeTransfer {
  const added: File[] = []
  return {
    items: {
      added,
      add: (file: File) => { added.push(file) },
    },
    types,
  }
}

/** Minimal drop event stand-in carrying the transfer. */
interface FakeDropEvent {
  type: string
  bubbles: boolean
  cancelable: boolean
  transfer: unknown
}

function fakeDropEvent(): FakeDropEvent {
  return { type: '', bubbles: false, cancelable: false, transfer: null }
}

function recordingDeps(): {
  deps: ImageIntakeDeps
  transfer: FakeTransfer
  event: FakeDropEvent
} {
  const transfer = fakeTransfer()
  const event = fakeDropEvent()
  const deps: ImageIntakeDeps = {
    makeDataTransfer: () => transfer as unknown as DataTransfer,
    makeDragEvent: (type, init) => {
      event.type = type
      event.bubbles = init.bubbles
      event.cancelable = init.cancelable
      event.transfer = init.dataTransfer
      return event as unknown as Event
    },
  }
  return { deps, transfer, event }
}

test('classifies files by image/* MIME type only', () => {
  assert.equal(isImageFile(fakeFile('image/png')), true)
  assert.equal(isImageFile(fakeFile('image/webp')), true)
  assert.equal(isImageFile(fakeFile('text/plain')), false)
  assert.equal(isImageFile(fakeFile('application/pdf')), false)
  assert.equal(isImageFile(fakeFile('')), false)
})

test('stages picked images as one drop event with the full file set', () => {
  const { deps, transfer, event } = recordingDeps()
  const images = [fakeFile('image/png'), fakeFile('image/jpeg'), fakeFile('text/plain')]
  const staged = stageImagesAsDrop(images, deps) as StagedDrop
  assert.notEqual(staged, null)
  assert.deepEqual(staged.images.map((f) => f.type), ['image/png', 'image/jpeg'])
  assert.equal(transfer.items.added.length, 2)
  assert.equal(transfer.items.added[0] as unknown, images[0])
  assert.equal(transfer.items.added[1] as unknown, images[1])
  assert.equal(event.type, 'drop')
  assert.equal(event.bubbles, true)
  assert.equal(event.cancelable, true)
  assert.equal(event.transfer as unknown, transfer)
})

test('returns null when no picked file is an image', () => {
  const { deps, transfer } = recordingDeps()
  const staged = stageImagesAsDrop([fakeFile('text/plain'), fakeFile('')], deps)
  assert.equal(staged, null)
  assert.equal(transfer.items.added.length, 0)
})

test('returns null when no DataTransfer factory is available', () => {
  const staged = stageImagesAsDrop([fakeFile('image/png')], {})
  assert.equal(staged, null)
})

test('returns null when the DataTransfer constructor throws', () => {
  const staged = stageImagesAsDrop([fakeFile('image/png')], {
    makeDataTransfer: () => {
      throw new Error('no DataTransfer on this engine')
    },
  })
  assert.equal(staged, null)
})

test('falls back to the legacy path when the DragEvent constructor throws', () => {
  const transfer = fakeTransfer()
  let legacyCalled = false
  let legacyTransfer: unknown = null
  const deps: ImageIntakeDeps = {
    makeDataTransfer: () => transfer as unknown as DataTransfer,
    makeDragEvent: () => {
      throw new Error('no DragEvent constructor')
    },
    makeLegacyDropEvent: (t) => {
      legacyCalled = true
      legacyTransfer = t
      return fakeDropEvent() as unknown as Event
    },
  }
  const staged = stageImagesAsDrop([fakeFile('image/png')], deps)
  assert.notEqual(staged, null)
  assert.equal(legacyCalled, true)
  assert.equal(legacyTransfer as unknown, transfer)
})

test('falls back to the legacy path when the primary factory returns null', () => {
  const transfer = fakeTransfer()
  let legacyCalled = false
  const deps: ImageIntakeDeps = {
    makeDataTransfer: () => transfer as unknown as DataTransfer,
    makeDragEvent: () => null,
    makeLegacyDropEvent: () => {
      legacyCalled = true
      return fakeDropEvent() as unknown as Event
    },
  }
  assert.notEqual(stageImagesAsDrop([fakeFile('image/png')], deps), null)
  assert.equal(legacyCalled, true)
})

test('returns null when both event paths are unavailable', () => {
  const transfer = fakeTransfer()
  const staged = stageImagesAsDrop([fakeFile('image/png')], {
    makeDataTransfer: () => transfer as unknown as DataTransfer,
    makeDragEvent: () => null,
    makeLegacyDropEvent: () => null,
  })
  assert.equal(staged, null)
  assert.equal(transfer.items.added.length, 1)
})
