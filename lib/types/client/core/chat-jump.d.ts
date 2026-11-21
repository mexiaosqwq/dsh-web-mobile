/** 一条行离带顶多近才算「正在读的那条」。滚动常常停在小数偏移上，所以需要容差；
 *  给到 8px 仍能分辨相邻两条提问（真机上一条提问的高度远大于此）。 */
export declare const STEP_TOLERANCE_PX = 8;
/** Which way one step goes. */
export type JumpStep = 'prev' | 'next';
/**
 * Index of the user row one step away from the reading position.
 *
 * @param offsets - row top edges relative to the conversation band top, in DOM
 *   order (ascending). Ties or jitter inside {@link STEP_TOLERANCE_PX} count as
 *   the band top itself.
 * @param step - 'prev' walks up, 'next' walks down.
 * @returns the row index, or -1 when that direction has nothing to land on.
 */
export declare function pickStepRow(offsets: readonly number[], step: JumpStep): number;
/**
 * Scroll offset that puts one row's top edge just under the band top.
 *
 * @param scrollTop - the scroller's current offset.
 * @param rowTop - the row's viewport top edge.
 * @param bandTop - the conversation band's viewport top edge.
 * @param inset - breathing room kept above the landed row.
 * @returns the offset to assign to `scrollTop`, never below 0.
 */
export declare function landingScrollTop(scrollTop: number, rowTop: number, bandTop: number, inset: number): number;
//# sourceMappingURL=chat-jump.d.ts.map