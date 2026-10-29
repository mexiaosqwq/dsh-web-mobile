import type { ReactElement } from 'react';
import type { MobileNavKey } from '../i18n/locales.ts';
/** 20px download glyph for the guide card. */
export declare function DownloadsIcon(): ReactElement;
/** Props handed to a slot body: the bound dictionary for the plugin namespace. */
export interface DownloadsPageProps {
    t?: (key: MobileNavKey) => string;
}
/** The page the guide card opens: hand off to the native panel once, then stay retryable. */
export declare function DownloadsPage({ t }: DownloadsPageProps): ReactElement;
//# sourceMappingURL=DownloadsEntry.d.ts.map