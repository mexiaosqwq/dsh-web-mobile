import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { ReconcilerTask } from '../core/reconciler-core.ts';
import type { PanelExit } from './panel-exit.ts';
/**
 * One full-tree MutationObserver for every mobile DOM reconciler. Tasks can be
 * registered from React or plain effects; they only run while the mobile
 * breakpoint is active and are re-armed automatically on width changes.
 */
export declare function installReconciler(ctx: ClientContext): () => void;
/** Register a reconciler task. The returned disposer removes it immediately. */
export declare function addReconcilerTask(task: ReconcilerTask): () => void;
/**
 * Register the shared DOM reconciler tasks. Returns a disposer that
 * unregisters every task and resets the flag, so a same-environment plugin
 * reload can rebuild the reconciler from scratch.
 *
 * @param panelExit - the sidebar-panel exit face (panel-exit.ts): its system-back
 *   route is registered here so it shares this reconciler, and the FAB reads it
 *   to switch its meaning while a panel owns the main area.
 */
export declare function registerReconcileTasks(ctx: ClientContext, panelExit: PanelExit): () => void;
//# sourceMappingURL=reconciler-adapter.d.ts.map