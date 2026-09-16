import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from '../i18n/locales.ts';
/** Full props for the composer image-upload entry (session-standard owner share unused). */
export interface MobileImagePickerProps extends PropsRuntime<'conversation.input.left'>, PropsLocale<typeof NS> {
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
export declare function MobileImagePicker({ t }: MobileImagePickerProps): import("react").JSX.Element;
//# sourceMappingURL=MobileImagePicker.d.ts.map