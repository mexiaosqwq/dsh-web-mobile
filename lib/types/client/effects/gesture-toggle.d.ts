import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ReconcilerTask } from '../core/reconciler-core.ts';
import { NS } from '../i18n/locales.ts';
/** Read the preference. Fail-open: a blocked/corrupt store means gestures ON. */
export declare function gesturesEnabled(): boolean;
/** Persist the preference. A blocked store degrades to this session only. */
export declare function setGesturesEnabled(on: boolean): void;
/**
 * The drawer's brand-row gesture switch. `scopes: ['*']` because React may
 * recreate the logo row on any sidebar re-render; `ensure()` re-appends the
 * wrapper idempotently and re-reads the preference, so the button never shows
 * a stale state after another part of the UI writes the same key.
 *
 * @param t - our dictionary (the `NS` locale namespace).
 * @returns the reconciler task.
 */
export declare function createGestureToggleTask(t: TranslateNS<typeof NS>): ReconcilerTask;
//# sourceMappingURL=gesture-toggle.d.ts.map