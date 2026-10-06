/**
 * `mobileNavFileShare` namespace: file-share copy, registered by
 * installFileShare (effects/file-share.ts) through ctx.locale.register — kept
 * out of i18n/locales.ts so the feature owns its dictionary end to end.
 */
export const FILE_SHARE_NS = 'mobileNavFileShare'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const fileShareZh = {
  'share': '分享',
  'shareFile': '分享「{name}」',
  'downloadFile': '下载「{name}」',
  'sharing': '正在准备文件…',
  'downloadedUnsupported': '当前环境不支持直接分享，已下载到「下载」文件夹，可在文件管理器里转发给好友',
  'downloadedTooLarge': '文件超过 50 MB，已改为下载',
  'downloadedShareFailed': '分享未能完成，已改为下载',
  'errorTooLarge': '文件太大（超过 200 MB），无法在手机端分享或下载',
  'errorNotFound': '文件不存在或已被移动',
  'errorGeneric': '分享失败：{message}',
} as const

/** Key union of the namespace. */
export type FileShareKey = keyof typeof fileShareZh

/** English dictionary, key-identical to the Chinese source of truth. */
export const fileShareEn: Record<FileShareKey, string> = {
  'share': 'Share',
  'shareFile': 'Share "{name}"',
  'downloadFile': 'Download "{name}"',
  'sharing': 'Preparing file…',
  'downloadedUnsupported': 'Direct sharing is unavailable here, so it went to your Downloads folder — forward it from a file manager',
  'downloadedTooLarge': 'The file is over 50 MB, so it was downloaded instead',
  'downloadedShareFailed': 'Sharing did not complete, so the file was downloaded instead',
  'errorTooLarge': 'The file is too large (over 200 MB) to share or download on mobile',
  'errorNotFound': 'The file no longer exists or was moved',
  'errorGeneric': 'Share failed: {message}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-share controls copy (files tree rows + preview header). */
    'mobileNavFileShare': FileShareKey
  }
}
