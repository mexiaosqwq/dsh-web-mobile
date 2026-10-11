import type { ReconcilerTask } from '../core/reconciler-core.ts';
export declare function statsAnchorAlive(el: Element | null): boolean;
export type TpsCandidate = {
    textContent: string | null;
    children: {
        length: number;
    };
    parentElement: Element | null;
    getAttribute(name: string): string | null;
};
export type TpsPick = {
    index: number;
    mark: boolean;
};
export declare const pickTpsReadout: (candidates: readonly TpsCandidate[]) => TpsPick;
export declare function createStatsLineTask(): ReconcilerTask;
//# sourceMappingURL=stats-line.d.ts.map