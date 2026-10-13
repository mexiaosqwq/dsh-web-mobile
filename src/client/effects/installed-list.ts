import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { MOBILE_QUERY } from '../platform/breakpoints.ts'
import { createRafScheduler } from '../core/raf-scheduler.ts'

// Market「installed」列表行的内联样式效果——2026-10-12 由 src/client/index.tsx
// 逐字搬运（P3：组装根只留组装 + 调用）。搬运不改语义：写前比较、按所有权释放的
// 账本、rAF 合帧与「flush 时复查断点」全部原样保留。

// Hard-fix the installed-plugins list text layout: the host market UI
// injects its own CSS after this plugin's stylesheet, so CSS overrides can
// be beaten. Inline !important styles win over every external rule. Keep
// the selector on outer rows only; irowActions/irowTrailing are nested
// flex containers and must retain the market's own action geometry.
//
// 2026-10-11：apply() 原每次 flush 无条件重写 !important（值没变也让样式失效），clear() 原裸
// removeProperty 一批属性、连宿主的内联样式一起删；现在写前比较、释放只回收本效果写过的值。
// 2026-10-12：行内目标（行 / 首个子节点 / spec / nm）原先在 apply 与 clear 里各写一遍遍历，
// 现将「写哪个元素、写哪些属性」收敛成下面那张 rowTargets 表——apply 按它写、clear 按同一张表
// 释放，将来加目标元素只改表里的一条。
export function installInstalledListRows(ctx: ClientContext): void {
  ctx.effect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const rowSelector = '[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"])'
    // 行内目标的**单一描述**：pick 取目标元素（取不到就跳过这一条），props 是 apply 要写的
    // 属性。数组顺序 = 写入顺序 = 释放顺序，别重排；三个选择器字符串在本 effect 里各自只出现
    // 这一次，改结构只改这张表。
    // 解析与写入交替进行（旧形态是「先把 spec/nm 都查出来再一起写」）；写入动的是内联 style，
    // class 子串查询不受其影响，所以这点顺序差别不改变结果。
    const TEXT: Record<string, string> = { 'white-space': 'nowrap', 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'max-width': '100%' }
    type RowTarget = { pick: (row: HTMLElement) => HTMLElement | null; props: Record<string, string> }
    const rowTargets: readonly RowTarget[] = [
      { pick: (row) => row, props: { 'flex-wrap': 'wrap', 'align-items': 'center', 'gap': '4px 10px' } },
      { pick: (row) => (row.children[0] as HTMLElement | undefined) ?? null, props: { 'flex': '1 1 100%', 'max-width': '100%', 'min-width': '0' } },
      { pick: (row) => row.querySelector<HTMLElement>('[class*="spec"]'), props: TEXT },
      { pick: (row) => row.querySelector<HTMLElement>('[class*="nm"]'), props: TEXT },
    ]
    // 所有权账本：元素 → 属性 → 写下的值/优先级 + 写入前的原值/优先级；释放只回收「当前
    // inline 值（含优先级）仍等于本效果写下的那个值」的属性，别处改过或没写过的一律不动。
    type Held = { value: string; priority: string; before: string; beforePriority: string }
    const owned = new WeakMap<HTMLElement, Map<string, Held>>()
    const write = (el: HTMLElement, props: Record<string, string>): void => {
      let account = owned.get(el)
      if (account === undefined) owned.set(el, account = new Map())
      for (const [key, value] of Object.entries(props)) {
        const priority = 'important'
        const current = el.style.getPropertyValue(key)
        const currentPriority = el.style.getPropertyPriority(key)
        // 写前比较：值 + 优先级已经一致就跳过——重设同一个值同样会让样式失效并同步
        // 重算这一行，而这是 apply 的热路径（每帧可能重扫整份已安装列表）。
        if (current === value && currentPriority === priority) continue
        const held = account.get(key)
        // 只在首次写、或「我们上次写的值已被改掉」时更新 before：后一种情况当前值
        // 才是释放时该恢复的前置状态（旧 before 已不是这一格的原始值）。
        const stillOurs = held !== undefined && held.value === current && held.priority === currentPriority
        account.set(key, stillOurs ? { ...held, value, priority } : { value, priority, before: current, beforePriority: currentPriority })
        el.style.setProperty(key, value, priority)
      }
    }
    const release = (el: HTMLElement): void => {
      const account = owned.get(el)
      if (account === undefined) return
      for (const [key, held] of account) {
        // 先摘账：无论回不回收，这一格都不再归本效果（值被人改过就永久弃权）。
        account.delete(key)
        if (el.style.getPropertyValue(key) !== held.value || el.style.getPropertyPriority(key) !== held.priority) continue
        if (held.before === '') el.style.removeProperty(key)
        else el.style.setProperty(key, held.before, held.beforePriority)
      }
      if (account.size === 0) owned.delete(el)
    }
    const clear = (): void => {
      document.querySelectorAll<HTMLElement>(rowSelector).forEach((row) => {
        for (const target of rowTargets) {
          const el = target.pick(row)
          if (el) release(el)
        }
      })
    }
    // 市场容器的缓存（2026-10-13）。apply() 原来每趟都做两件**全文档**的事：① 用
    // `[data-dsh-market-root], [role="dialog"]` 判存在性；② 全文档扫 irow 行。市场根一挂上
    // 就不会自己搬家，两件事都没必要每帧重来 —— 尤其②：任意 dialog 在场（会话删除确认、
    // 快捷键弹层、设置面板）都会触发一次 18k 节点的 class 子串全扫。现在缓存容器：根还挂在
    // 文档上就零查询，行扫描收窄到容器内。
    // clear() 刻意**不**收窄：它要负责把本效果写过的样式全部还回去，容器可能是旧的/已断开的，
    // 收窄会漏掉写入点、把 !important 内联样式永久留在宿主行上。
    let marketRoot: HTMLElement | null = null
    /** 存在性判定用的选择器：与旧版逐字相同，语义不变。 */
    const MARKET_GATE = '[data-dsh-market-root], [role="dialog"]'
    /** 市场根自己的标记（dshmarket 1.20.x）。 */
    const MARKET_ROOT = '[data-dsh-market-root]'
    /**
     * 拿到该扫的容器。缓存命中（仍挂在文档上）⇒ 零查询。
     *
     * 缓存失效时先跑那条与旧版逐字相同的存在性查询：两个标记都不在 ⇒ null ⇒ 早退
     * ——「不在场即早退」的语义、查询条数都与旧版一致。
     *
     * 命中的不是市场根时**再补一条查询**把根找出来。收窄之后「命中谁」变成语义了：旧版
     * 反正随后全文档扫，命中哪个都无所谓；现在若按文档序拿到别的弹层（会话删除确认、快捷键），
     * 市场行会被漏掉。所以优先市场根、退而用弹层兜底。
     *
     * 兜底本身不足以兑现「降级为成本，不是静默死掉」（2026-10-13 独立验证 V5）：容器不是
     * 市场根时，市场行可能长在它**外面**（标记换代、只命中设置弹层）——收窄扫一条都拿不到，
     * 却也不报错。这一档由 apply 的 fail-open 补上（见下）。
     */
    const resolveRoot = (): HTMLElement | null => {
      const cached = marketRoot
      if (cached !== null && cached.isConnected) return cached
      const gate = document.querySelector<HTMLElement>(MARKET_GATE)
      if (gate === null) {
        marketRoot = null
        return null
      }
      marketRoot = gate.matches(MARKET_ROOT) ? gate : document.querySelector<HTMLElement>(MARKET_ROOT) ?? gate
      return marketRoot
    }
    const apply = (): void => {
      // The market rows only exist while the market UI is mounted (inside a
      // settings dialog). Skip the scan on every streamed mutation frame with
      // no market open; dshmarket keeps the data-dsh-market-root marker
      // (1.20.x), [role="dialog"] covers the settings dialog generically so a
      // marker change degrades to cost, not to a silently dead effect.
      const root = resolveRoot()
      if (root === null) return
      let rows = root.querySelectorAll<HTMLElement>(rowSelector)
      // fail-open（2026-10-13 独立验证 V5）：容器**不是市场根本身**时，它不代表市场 ——
      // 收窄扫一条行都没拿到就说明「市场行长在这个容器外面」（市场根标记换代、或只命中了
      // 设置/会话删除确认弹层），旧行为是静默漏写。同一趟（同一个 apply 调用里）退回全文档
      // 扫，把这一档的成本补回来。
      // 两个前提都不能少：① 有行存在的信号 —— 收窄扫非空就说明容器是对的，不必也不能兜底；
      // ② 容器不是市场根本身 —— 根上的空结果语义是「市场当前没有行」，不是「找错容器」。
      // 正常一代（容器就是市场根）因此永远走不到这里：零查询缓存与收窄扫描都不变。
      if (rows.length === 0 && !root.matches(MARKET_ROOT)) rows = document.querySelectorAll<HTMLElement>(rowSelector)
      rows.forEach((row) => {
        for (const target of rowTargets) {
          const el = target.pick(row)
          if (el) write(el, target.props)
        }
      })
    }
    const arm = (): void => {
      clear()
      if (mq.matches) apply()
    }
    arm()
    // Streaming floods this observer with document-wide childList batches;
    // coalesce to one apply per frame and re-check the breakpoint at flush
    // time so a queued callback never writes mobile styles on desktop.
    const scheduler = createRafScheduler(
      (cb) => window.requestAnimationFrame(cb),
      (id) => window.cancelAnimationFrame(id),
    )
    // 2026-10-13 受控实测（流式帧成本 A/B）：正文内流式时共享协调器**明确丢弃**正文 mutation
    // （phone-chrome 的 `closest('[data-chat-flow]')` 过滤），但本观察器当时没有这层过滤 ——
    // 于是它成了流式期间**唯一**的每帧查询（实测 +8.09 次 document.querySelector/秒，
    // 全部是同一条 `[data-dsh-market-root], [role="dialog"]`）。
    // 这里补上同一套过滤：**整批记录都在正文内**时直接不排程（市场根不可能长在会话正文里，
    // 真正的开合 mutation 落在正文之外，仍会照常排程）。一行过滤换掉一次每帧全文档查询。
    /* @patch
           id: installed-list-chatflow-filter
           for: 共享协调器的「正文整批丢弃」语义（phone-chrome 侧既有过滤）
           why: 本观察器与协调器各自观察 DOM；正文内 mutation 不可能含市场根，不补这层过滤就会在流式期间每帧做一次全文档查询
           until: 宿主把市场根挂到稳定容器、且协调器把 childList 一并按容器路由（届时可改为按容器早期退出）
           test: tests/installed-list.test.ts
        */
    const mo = new MutationObserver((records = []) => {
      // 空批次（或测试夹具不传参数）一律按「需要跑」处理 —— 只有**明确整批都在正文内**
      // 时才跳过排程。生产环境里 MutationObserver 必然带 records，这里只为稳妥。
      let relevant = records.length === 0
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement
        if (target?.closest('[data-chat-flow]') == null) { relevant = true; break }
      }
      if (relevant && mq.matches) scheduler.schedule(() => { if (mq.matches) apply() })
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    mq.addEventListener('change', arm)
    return () => {
      scheduler.cancel()
      mo.disconnect()
      mq.removeEventListener('change', arm)
      clear()
      marketRoot = null
    }
  }, 'dsh-web-mobile: installed-list-inline-styles')
}
