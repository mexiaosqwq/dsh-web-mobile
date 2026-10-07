/**
 * File-share pure core: how a workspace file's bytes are read and how they
 * reach the user — the system share sheet when the platform can share files,
 * a plain download otherwise. DOM-free and import-free so node --test drives
 * every decision with injected fakes (tests/file-share.test.ts); the React
 * controls in file-share-controls.tsx bind the real navigator/document.
 *
 * Reading goes through the host's own Remote (`remote.workspaceFiles.readBytes`,
 * dsh-api-workspace-files) — the same call the document preview uses, so
 * authentication, sandbox policy and workspace confinement stay host-owned.
 * Reads are windowed: one ranged call is capped by the host `maxBytes`
 * (default 2 MiB, a larger window is refused rather than shortened), so the
 * file is pulled in CHUNK_BYTES windows until EOF.
 */

/** Above this size the share sheet is skipped and the file is downloaded instead. */
export const SHARE_MAX_BYTES = 50 * 1024 * 1024

/** Above this size nothing is read at all: the browser would hold the whole file in memory. */
const READ_MAX_BYTES = 200 * 1024 * 1024

/** One ranged read; well under the host's default 2 MiB per-call window cap. */
export const CHUNK_BYTES = 1024 * 1024

/** Stable failure codes the controls map to localized copy. */
export type FileShareErrorCode = 'too-large' | 'not-found' | 'read-failed'

/** A share-flow failure carrying its stable code. */
export class FileShareError extends Error {
  readonly code: FileShareErrorCode
  /**
   * @param code - stable failure code.
   * @param message - diagnostic text.
   */
  constructor(code: FileShareErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'FileShareError'
  }
}

/** The successful readBytes payload fields this module consumes. */
export interface ReadBytesValue {
  readonly offset: number
  readonly data: Uint8Array
  readonly eof: boolean
  readonly bytes?: number | undefined
}

/** The host RemoteResult shape of one readBytes call. */
export type ReadBytesResult =
  | { readonly ok: true; readonly value: ReadBytesValue }
  | { readonly ok: false; readonly error: { readonly code?: string; readonly message?: string } }

/**
 * One bound ranged read (session already applied).
 * @param path - absolute or workspace-relative file path.
 * @param range - byte window.
 * @param signal - cancellation.
 */
export type ReadRange = (
  path: string,
  range: { offset: number; length: number },
  signal: AbortSignal,
) => Promise<ReadBytesResult>

/** A fully read file. */
export interface ReadFile {
  readonly parts: Uint8Array<ArrayBuffer>[]
  readonly size: number
}

/** Map one Remote failure onto a share-flow failure. */
function remoteFailure(error: { readonly code?: string; readonly message?: string }): FileShareError {
  const code = error.code ?? ''
  if (code === 'workspace-file/too-large') return new FileShareError('too-large', error.message ?? code)
  if (code === 'workspace-file/not-found' || code === 'workspace-file/not-regular-file') {
    return new FileShareError('not-found', error.message ?? code)
  }
  return new FileShareError('read-failed', error.message ?? (code || 'read failed'))
}

/**
 * Read a whole file in windows until EOF. The first window also reports the
 * file's size (`bytes`), so an oversized file is refused after one small read.
 * @param read - bound ranged read.
 * @param path - file path.
 * @param signal - cancellation; an abort rejects with the signal's reason.
 * @param chunk - window size (tests shrink it).
 * @param max - refuse files above this size.
 * @returns the chunks and their total size.
 */
export async function readWholeFile(
  read: ReadRange,
  path: string,
  signal: AbortSignal,
  chunk: number = CHUNK_BYTES,
  max: number = READ_MAX_BYTES,
): Promise<ReadFile> {
  const parts: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (;;) {
    signal.throwIfAborted()
    const result = await read(path, { offset, length: chunk }, signal)
    signal.throwIfAborted()
    if (!result.ok) throw remoteFailure(result.error)
    const { data, eof, bytes } = result.value
    if (bytes !== undefined && bytes > max) {
      throw new FileShareError('too-large', `${path}: ${bytes} bytes exceed the ${max} byte share cap`)
    }
    // Copy into a fresh ArrayBuffer-backed view: the payload may be a view
    // over a larger transport buffer, and Blob parts want ArrayBuffer views.
    parts.push(new Uint8Array(data))
    offset += data.length
    if (offset > max) throw new FileShareError('too-large', `${path}: more than ${max} bytes`)
    // An empty window with eof unset would loop forever; treat it as the end.
    if (eof || data.length === 0) break
  }
  return { parts, size: offset }
}

/** Final outcome of one delivery. */
export type ShareOutcome =
  | { readonly kind: 'shared' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'downloaded'; readonly reason: 'unsupported' | 'too-large' | 'share-failed' }

/** The minimal File surface the decision needs. */
export interface ShareableFile {
  readonly name: string
  readonly size: number
}

/** Platform seams (navigator.canShare / navigator.share / anchor download). */
export interface ShareDeps<F extends ShareableFile> {
  readonly canShare?: ((data: { files: F[] }) => boolean) | undefined
  readonly share?: ((data: { files: F[]; title: string }) => Promise<void>) | undefined
  readonly download: (file: F) => void
  readonly shareMax?: number
}

/** Whether a rejection is the user dismissing the share sheet. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/**
 * Whether this platform can deliver a file to another app at all.
 *
 * The UI reads it to label the button HONESTLY: when nothing can share, the
 * press can only end in a download, so calling it 「分享」 would be a lie (owner
 * report 2026-10-07: 「还是选择存到哪里，而不是分享到媒体，比如说微信QQ，不然这不算是
 * 文件分享」). Deliberately a *surface* probe, not a per-file `canShare` call:
 * `canShare` wants real `File` objects, and a fabricated probe object makes
 * browsers report false even for shareable files.
 *
 * Deliberately NOT named after `navigator.share`: Android WebView implements no
 * Web Share at all (only standalone browsers do), so a host-side bridge — e.g. a
 * DSHA `ACTION_SEND` entry point — is the route that actually matters on a phone,
 * and it would NOT show up in these two seams. When such a bridge lands, extend
 * `ShareDeps` with it and make this predicate (`bridge !== undefined ||` …) and
 * the `deliverFile` routing order **bridge → Web Share → download** agree; the
 * label and the glyph follow this predicate automatically, so the button flips
 * back to 「分享「x」」 with no UI change. Do not pre-guess the bridge's shape from
 * here: a `path`-only bridge needs the host half, a byte/base64 bridge does not.
 * @param deps - platform seams.
 * @returns true when both Web Share members are present.
 */
export function canShareFiles<F extends ShareableFile>(deps: ShareDeps<F>): boolean {
  return deps.share !== undefined && deps.canShare !== undefined
}

/**
 * Deliver one file: the system share sheet when the platform can share it,
 * otherwise a download. A dismissed sheet (AbortError) is a silent cancel;
 * any other share rejection (NotAllowedError after the user-activation window
 * lapsed during a long read, a target app refusing the type, …) still gets
 * the file to the user through the download route.
 * @param file - the file to deliver.
 * @param deps - platform seams.
 * @returns the outcome.
 */
export async function deliverFile<F extends ShareableFile>(file: F, deps: ShareDeps<F>): Promise<ShareOutcome> {
  if (file.size > (deps.shareMax ?? SHARE_MAX_BYTES)) {
    deps.download(file)
    return { kind: 'downloaded', reason: 'too-large' }
  }
  // No share seam at all: a real branch of its own (it used to hide inside
  // `!supported || deps.share === undefined`, where the second half could
  // never decide anything because `supported` was already false).
  const share = deps.share
  if (share === undefined) {
    deps.download(file)
    return { kind: 'downloaded', reason: 'unsupported' }
  }
  let supported = false
  try {
    supported = deps.canShare?.({ files: [file] }) === true
  } catch {
    supported = false
  }
  if (!supported) {
    deps.download(file)
    return { kind: 'downloaded', reason: 'unsupported' }
  }
  try {
    await share({ files: [file], title: file.name })
    return { kind: 'shared' }
  } catch (error) {
    if (isAbortError(error)) return { kind: 'cancelled' }
    deps.download(file)
    return { kind: 'downloaded', reason: 'share-failed' }
  }
}

/** Common extensions → MIME type; share targets filter on it, so a guess beats octet-stream. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', tsx: 'text/plain',
  py: 'text/plain', sh: 'text/plain', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', heic: 'image/heic', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * The basename of a host path, in either separator spelling.
 * @param path - absolute or relative path.
 * @returns the last segment (the path itself when it has none).
 */
export function fileNameOf(path: string): string {
  const segments = path.split(/[/\\]+/).filter(Boolean)
  return segments.at(-1) ?? path
}

/**
 * MIME type guessed from a file name's extension.
 * @param name - file name.
 * @returns the guessed type, or application/octet-stream.
 */
export function mimeTypeOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}
