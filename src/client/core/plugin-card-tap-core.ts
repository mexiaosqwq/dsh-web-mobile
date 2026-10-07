// plugin-card-tap-core.ts — 插件管理页「整卡可点」的判定纯核（零 import，node --test 直跑）。
//
// 背景（2026-10-07 店主报障：「打开如图里面的功能，需要点击那些加黑字体才行」）：
// 宿主 dsh-client-ui-plugin-manager 的卡片只把**标题**渲染成 <button>
// （class 含 cardOpen；行式条目是 rowOpen 那颗），描述、图标、徽标、留白都不响应点击。
// 宿主自己给标题按钮带了一层 stretched-link（.cardOpen:after{position:absolute;inset:0}），
// 但卡片 DOM 顺序是 icon → titleRow(button) → **cardDesc**，描述那个 -webkit-box 盒子
// 绘制在覆盖层之后 ⇒ 把点击整块吃掉。真机实测：补 z-index 抬升仍不生效，
// 所以改成**捕获期转发点击**（行为级、不依赖绘制顺序）：点在卡片内、又不在任何交互
// 控件上 ⇒ 替用户点一次那颗打开按钮。

/** 一次点击应当如何处理。 */
export type PluginCardTapDecision = 'open' | 'ignore'

/** 判定所需的最小信息（调用方负责查 DOM，便于单测）。 */
export interface PluginCardTapTarget {
  /** 点击是否落在条目自己的「打开详情」按钮内部（含其文字/子节点）。 */
  readonly insideOpen: boolean
  /** 点击是否落在别的交互控件上（开关、链接、输入框…）。 */
  readonly onInteractive: boolean
}

/**
 * 判定一次点击要不要转发给「打开详情」按钮。
 *
 * - 点标题本身 ⇒ 'ignore'（宿主自己会开，转发会双重触发）；
 * - 点开关/链接/输入框等交互件 ⇒ 'ignore'（绝不抢它们的点击）；
 * - 其余（描述、图标、徽标、留白）⇒ 'open'，由调用方转发。
 * @param target - 命中的元素信息。
 * @returns 'open' 需要转发；'ignore' 放行。
 */
export function decidePluginCardTap(target: PluginCardTapTarget): PluginCardTapDecision {
  if (target.insideOpen) return 'ignore'
  if (target.onInteractive) return 'ignore'
  return 'open'
}
