import { type ReconcilerTask } from '../core/reconciler-core.ts';
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
/** TPS 折叠的定位结果（原在 createStatsLineTask 内部；2026-10-13 提到模块级，
 *  因为快路径的纯核 resolveTpsForKey 也要用这个形状）。 */
export interface TpsLocated {
    readonly el: Element;
    readonly reserve: Element;
    readonly live: string;
}
/**
 * 快路径上解析 TPS 那一段（2026-10-13，纯函数 + 注入 ⇒ 可数）。三级，能短路就短路：
 *
 *   ① 记得住的读数节点（上一趟折过的那个）仍活着 ⇒ **零查询**：直接拿它和它的实时文本。
 *      旧版每趟都在 key 比较**之前**跑 locateTps，而 locateTps 的第 134 行是
 *      `stack.querySelectorAll('div')` —— 把整个 composer 栈的 div 全materialize 出来，
 *      再对每个候选读一次 textContent（各自还要走整棵子树）。那是本效果仅存的每帧查询。
 *   ② 否则先用栈内文本做一次**零查询预筛**：文本里没有「TPS <数字>」⇒ 栈内不可能有读数
 *      （pickTpsReadout 只认这种形状、且要求节点是裸文本持有者）⇒ 判定缺席。
 *   ③ 预筛命中才做那条全栈查询（locate），把读数真正找出来。
 *
 * 返回 null = 本趟缺席（key 里写 'none'，并且「上一趟也缺席」成为一个**可跳过**的稳定态 ——
 * 旧版缺席时四个 stillFolded 恒 false，于是永不 skip、每帧白折一遍）。
 * @param remembered - 上一趟折过的读数（节点都还活着时），否则 null。
 * @param rememberedText - 那个节点的实时文本（只在 remembered 非 null 时被读）。
 * @param stackText - 栈内文本的读取器（只在需要预筛时才调用，零查询）。
 * @param locate - 唯一的查询步骤（全栈 div 查询）。
 * @returns 该用的读数，或 null 表示缺席。
 */
export declare function resolveTpsForKey(remembered: TpsLocated | null, rememberedText: string, stackText: () => string, locate: () => TpsLocated | null): TpsLocated | null;
/**
 * TPS 两个槽（读数 + 它的占位）是否已经在「本趟不需要再折」的定态（2026-10-13 抽出为纯函数，
 * 因为它正是「缺席即永不 skip」的修复点）。
 *
 * 关键：key 本趟已经**现读**了「在不在 + 读数文本」（见 resolveTpsForKey），所以
 *   · 本趟缺席时该问的是「上一趟也缺席吗」—— 是，则定态成立、这一趟可以跳；
 *   · 不能问「折过的读数节点还活着吗」：缺席时它必然是 null，旧版因此恒 false ⇒ 永不 skip ⇒
 *     每帧白折一遍（含 measure/write 那串强制同步布局）。
 * 本趟在、或上一趟在而这一趟不在（读数刚消失）都要真折，所以那两种情形仍按 liveness 判。
 * 环形那两个槽没有 presence 位（环缺席时 key 里没有它的盒子），不适用这条规则，保持原判据。
 * @param absentNow - 本趟是否缺席（key 里那一段是 'none'）。
 * @param absentBefore - 上一趟是否缺席（两个槽都是 null）。
 * @param tpsAlive - 上一趟折过的读数节点是否仍活着且带标记。
 * @param reserveAlive - 上一趟折过的占位 span 是否仍活着且带标记。
 * @returns 定态成立 ⇒ 允许这一趟跳过。
 */
export declare function tpsSlotsSettled(absentNow: boolean, absentBefore: boolean, tpsAlive: boolean, reserveAlive: boolean): boolean;
export declare function createStatsLineTask(): ReconcilerTask;
//# sourceMappingURL=stats-line.d.ts.map