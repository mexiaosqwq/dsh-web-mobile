// Chat jump (issue #299): the pure half of the mobile "four arrows" control.
//
// 每颗键要回答的问题是「当前阅读位置的上一条 / 下一条用户消息是哪一条」。
// 位置用**打分器**给：offsets[i] = 第 i 条用户消息的顶边相对会话可视带顶边的像素
// 偏移（DOM 顺序，从小到大）。可视带顶边那条 = 正在读的那条，所以：
//  - 上一条 = 最后一条**严格高于**带顶超过容差的行；
//  - 下一条 = 第一条**严格低于**带顶超过容差的行。
// 两侧都用严格不等式 + 容差：贴在带顶几像素内的行当「正在读的这条」处理，否则刚跳
// 到某条提问上再点同向键会原地不动（`<=` 写法的典型症状），或者反向跳回自己（容差
// 写成 0 的典型症状）。
//
// 这个文件不 import 任何东西：node:test 直接跑它，浏览器打包也不需要解析依赖。
// （reconciler-core.ts 靠同样的做法守住「零 import」——见该文件头。）

/** 一条行离带顶多近才算「正在读的那条」。滚动常常停在小数偏移上，所以需要容差；
 *  给到 8px 仍能分辨相邻两条提问（真机上一条提问的高度远大于此）。 */
export const STEP_TOLERANCE_PX = 8

/** Which way one step goes. */
export type JumpStep = 'prev' | 'next'

/**
 * Index of the user row one step away from the reading position.
 *
 * @param offsets - row top edges relative to the conversation band top, in DOM
 *   order (ascending). Ties or jitter inside {@link STEP_TOLERANCE_PX} count as
 *   the band top itself.
 * @param step - 'prev' walks up, 'next' walks down.
 * @returns the row index, or -1 when that direction has nothing to land on.
 */
export function pickStepRow(offsets: readonly number[], step: JumpStep): number {
  if (step === 'prev') {
    for (let index = offsets.length - 1; index >= 0; index -= 1) {
      const offset = offsets[index]
      if (offset !== undefined && offset < -STEP_TOLERANCE_PX) return index
    }
    return -1
  }
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index]
    if (offset !== undefined && offset > STEP_TOLERANCE_PX) return index
  }
  return -1
}

/**
 * Scroll offset that puts one row's top edge just under the band top.
 *
 * @param scrollTop - the scroller's current offset.
 * @param rowTop - the row's viewport top edge.
 * @param bandTop - the conversation band's viewport top edge.
 * @param inset - breathing room kept above the landed row.
 * @returns the offset to assign to `scrollTop`, never below 0.
 */
export function landingScrollTop(scrollTop: number, rowTop: number, bandTop: number, inset: number): number {
  return Math.max(0, scrollTop + (rowTop - bandTop) - inset)
}
