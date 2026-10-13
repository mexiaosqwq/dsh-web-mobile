import type { ReconcilerTask } from '../core/reconciler-core.ts';
/** Reconciler task face for the header-height variable (see the doc comment above).
 *  与拆分前同形：name/scopes/ensure/dispose 四项一字未改，只是从调用处搬进工厂。
 *  ensure 走**结构路径**（顶栏没换就不做 layout 工作），几何路径由 ResizeObserver 驱动。 */
export declare function createHeaderMetricsTask(): ReconcilerTask;
//# sourceMappingURL=header-metrics.d.ts.map