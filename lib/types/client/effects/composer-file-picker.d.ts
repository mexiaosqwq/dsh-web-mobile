import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** 两个选项：图片走 image 通配，附件保持宿主原样（见 acceptForKind 的实验说明）。 */
export type FilePickerKind = 'image' | 'file';
/**
 * 选项对应的 accept（空串 = 不改宿主 input 的属性）。
 *
 * 2026-10-07 实验记录（已回退）：曾给附件那路显式写全通配 accept，想验证「空的
 * acceptTypes」是不是让 DSHA 起了文档选择器（DownloadsUI）而不是店主想要的
 * 「打开方式」+ 应用列表。店主真机实测**形态没变** ⇒ 那是 DSHA
 * `WebChromeClient.onShowFileChooser` 建 Intent 的方式决定的，插件只能影响 accept、
 * 换不出 chooser 形态。所以这里回到「不改属性」，不给宿主 input 写多余的 accept。
 * @param kind - 用户选择的入口。
 * @returns 要临时写到宿主 input 上的 accept；空串表示不动该属性。
 */
export declare function acceptForKind(kind: FilePickerKind): string;
/**
 * 安装手机档的输入框文件入口弹层。
 * @param ctx - client 上下文。
 */
export declare function installComposerFilePicker(ctx: ClientContext): void;
//# sourceMappingURL=composer-file-picker.d.ts.map