import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function layoutSource(): string {
  return readFileSync(join(root, 'src/client/styles/layout.css.ts'), 'utf8')
}

type ScopedRule = { scopes: string[]; sel: string; body: string }

const MOBILE_SCOPE = '@media (max-width: 1023px) and (pointer: coarse)'
const PHONE_SCOPE = '@media (max-width: 767px) and (pointer: coarse)'

// 2026-10-13：本批顶栏改动被收进「手机档作用域」之后，光断言「源码里出现过某个值」就不
// 够了 —— 同一个值写在共用档还是手机档，决定了平板会不会跟着变。所以这里把 layout.css.ts
// 的模板正文粗解析一遍，每条样式规则连它所在的 @media 作用域链一起取出来，供下面
// 「值必须在手机档作用域里」/「共用档必须是本批之前的值」这两类断言使用。
// 先把注释挖空（保留换行与长度），免得注释里的字被当成声明或选择器。
function scopedRules(source: string): ScopedRule[] {
  // ① 只解析模板字面量的正文（模板外的 import 与文件头注释不参与）
  const m = source.match(/=\s*`([\s\S]*)`\s*;?\s*$/)
  const css = m === null ? source : m[1]
  // ② 逐字符把注释替换成空格（保持长度不变）—— 若把整段注释换成一个空格，长度会变，
  //    后面按挖空串的下标去切原文就会切错位。
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (x) => x.split('').map((ch) => (ch === '\n' ? '\n' : ' ')).join(''))
  const out: ScopedRule[] = []
  const stack: { prelude: string; isAt: boolean; bodyFrom: number }[] = []
  let buf = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{') {
      const prelude = buf.replace(/\s+/g, ' ').trim()
      buf = ''
      stack.push({ prelude, isAt: prelude.startsWith('@'), bodyFrom: i + 1 })
      continue
    }
    if (c === '}') {
      const f = stack.pop()
      if (f !== undefined && !f.isAt && f.prelude !== '') {
        const scopes: string[] = []
        for (const x of stack) if (x.isAt) scopes.push(x.prelude)
        out.push({
          scopes,
          sel: f.prelude,
          // 注释挖空后取正文 —— 注释里出现的旧值不算声明
          body: css.slice(f.bodyFrom, i).replace(/\/\*[\s\S]*?\*\//g, ' '),
        })
      }
      buf = ''
      continue
    }
    buf += c
  }
  return out
}

const inPhone = (r: ScopedRule) => r.scopes.includes(PHONE_SCOPE)
const inSharedMobile = (r: ScopedRule) => r.scopes.length === 1 && r.scopes[0] === MOBILE_SCOPE

function phoneDecl(rules: ScopedRule[], selNeedle: string, declNeedle: string): boolean {
  return rules.some((r) => inPhone(r) && r.sel.includes(selNeedle) && r.body.includes(declNeedle))
}
function sharedDecl(rules: ScopedRule[], selNeedle: string, declNeedle: string): boolean {
  return rules.some((r) => inSharedMobile(r) && r.sel.includes(selNeedle) && r.body.includes(declNeedle))
}
function phoneRule(rules: ScopedRule[], selNeedle: string): string | null {
  return rules.find((r) => inPhone(r) && r.sel.includes(selNeedle))?.body ?? null
}
function sharedRule(rules: ScopedRule[], selNeedle: string): string | null {
  return rules.find((r) => inSharedMobile(r) && r.sel.includes(selNeedle))?.body ?? null
}

// The 0.1.6-alpha.2 header adaptation block must be inert on pre-alpha.2
// hosts: only _headerLeading/_crumbCurrent/_crumbSeg/_headerCorner are
// alpha.2-only classes, so every cross-generation anchor in the block
// (_titleCluster/_crumbs/_headerActions/_headerUtilities/tablist/QsffPG_/
// ZKlsPq_/:first-child chains) has to sit behind a header:has existence gate.
test('every selector in the alpha.2 header block carries the _headerLeading generation gate', () => {
  const source = layoutSource()
  const start = source.indexOf('0.1.6-alpha.2 session-header adaptation')
  assert.ok(start > 0, 'alpha.2 header section marker not found')
  const end = source.indexOf('/* --- Settings dialog on mobile ---', start)
  assert.ok(end > start, 'settings section marker not found after the header block')
  const lines = source.slice(start, end).split('\n')
  const offenders = lines
    .filter((line) => line.includes('[data-phase] header'))
    .filter((line) => !line.includes('header:has([class*="_headerLeading"])'))
  assert.deepEqual(offenders, [], 'ungated cross-generation selectors in the alpha.2 block')
  const gates = lines.filter((line) => line.includes('header:has([class*="_headerLeading"])')).length
  assert.ok(gates >= 30, `expected the full gated block, found only ${gates} gates`)
})

// 0.2.0-rc.x moved the leading seat out of the title row and made it the
// header's own first grid column (grid-template-columns: auto minmax(0,1fr),
// seat grid-area 1/1, title row grid-column 2). The 32px seat that keeps the
// title clear of the toggle used to be titleRow's own content-box offset; on
// that generation it degrades into "grid column 1 happens to be 32px", so any
// rule that collapses the seat takes the title with it — measured on
// 0.2.0-rc.2: crumbs x=8 under the toggle at (8,6,28x28), i.e. the same failure
// the 2026-09-22 real-device run recorded on 0.1.6. The seat must therefore be
// carried by the title row itself. Behaviour is pinned at runtime by scene 4 of
// scripts/probes/header-files-pin-probe.mjs.
test('the 0.2.0 grid header carries its seat on the title row, not on the seat box', () => {
  const source = layoutSource()
  const grid = '[data-phase] header:has([class*="_headerLeading"]):has(> [data-conversation-header-leading])'
  assert.ok(source.includes(grid), 'the 0.2.0 grid-header gate is missing')
  const titleRule = source.slice(source.indexOf(`${grid} [class*="_titleRow"] {`))
  assert.ok(titleRule.startsWith(grid), 'title-row seat rule not found')
  const declarations = titleRule.slice(0, 240)
  assert.ok(declarations.includes('padding-left: 32px !important'), 'title row must carry the 32px seat')
  assert.ok(declarations.includes('box-sizing: border-box !important'), 'border-box keeps the seat inside column 2')
  assert.ok(source.includes(`${grid} > [data-conversation-header-leading] {`), 'the seat box itself must be zeroed')
  assert.ok(
    source.includes('[data-slot="conversation.header.leading"] {'),
    'the leading slot must be hidden by slot name, not by a :last-child chain',
  )
})

// The old position:static containment has higher specificity than the new
// absolute chip rules; with both !important, specificity decides (not source
// order), so on alpha.2 it must be excluded or the chips never leave the row.
test('the static containment rule is excluded on alpha.2 so absolute chips win', () => {
  assert.ok(
    layoutSource().includes(
      'header:not(:has([class*="_headerLeading"])) [class*="_headerActions"] [class*="_root"]',
    ),
    'static containment rule must carry the alpha.2 exclusion gate',
  )
})

// rc hosts render the input.left seat but ship no input[type=file] (intake is
// paste/drop only there); without this hide the control is a dead button.
test('the file-upload control hides itself where the host has no file input', () => {
  assert.ok(layoutSource().includes(':not(:has(input[type=file])) [data-mobile-nav="file-upload"]'))
})

// alpha.2 renamed the hero-empty marker; both hide rules must coexist.
test('the hero empty-header hide covers both generation markers', () => {
  const source = layoutSource()
  assert.ok(source.includes('header[class*="_headerHidden"]'))
  assert.ok(source.includes('header[class*="headerBlank"]'))
})

// 2026-10-12 用户规格（第三批·B 方案，当前形态）：**后台任务 chip 进标题行**（手机档），
// 子智能体 chip 留在标签行右端（absolute + right:8 + top:42）。
// 为什么二选一：受控实测两颗同搬 ⇒ 标题触 72px 地板后右簇仍溢出 10px（带文案态直接盖住
// 文件夹按钮），故只能搬一颗。B 方案下标签行只剩子智能体 chip，公共车道最宽。
// 同时用户要求：**标题可扩展 + 省略号**（原为 100px 横滑窗 + text-overflow:clip，截断是硬切）。
//
// 2026-10-13 结构收敛：本批顶栏改动**只作用于手机档**，所以下面每条都断言「值出现在
// 手机档作用域里」+「共用移动档仍是本批之前的值」。为什么这么改（旧断言为什么不够）：
//   ① 旧写法把值直接写在共用移动档里，再在文件末尾用一整块「平板档回归」把旧值写回 ——
//      同一批改动写两遍，改一处要记得同步另一处（补丁抵消补丁）；
//   ② 那块回归里 5 条选择器带 `_SEAT`/`_BTN`/`_YIELD`/`_BEFORE`/`SEG` 这类**字面占位
//      token**（插入脚本的占位符没被替换），是非法选择器 ⇒ Chromium 整条丢弃。也就是说
//      平板档当时并没有真的拿到「旧值」，只是看起来写了；
//   ③ 于是「平板不变」既没有单点表达，也没有可靠的兜底。
// 现在的形状：共用移动档一律本批之前的值（平板档因此天然一致），手机档差异全在嵌套的
// (max-width: 767px) and (pointer: coarse) 里，一处表达、一处修改。
test('header chips (2026-10-12 换位后，手机档作用域): jobs dot in the title row, lineage chip in the tab row', () => {
  const scoped = scopedRules(layoutSource())

  // ⓪ 前提：本批的顶栏改动确实都在手机档作用域里（不是散在共用档）
  assert.ok(scoped.some(inPhone), '手机档作用域统一条件缺失')

  // ① 后台任务 chip：宿主 0.2.1 起包裹 div 无类名，QsffPG_root 那套座位规则已整块
  //    删除（2026-10-17）。现行规则按「trigger 直接挂 _count」的形状锚收窄，钉在
  //    文件末那条「job chip collapses by shape」里；这里只守「旧钥匙不得复活」。
  //     唯一的合法残留是命中盒归零规则里的 :not(...) 排除项（它的特异性承重，不能删），
  //     故这里只禁「正向锚」：注释挖空后每一处出现都必须紧跟在 :not( 之后。
  const css = layoutSource().replace(/\/\*[\s\S]*?\*\//g, '')
  for (let i = css.indexOf('[class*="QsffPG_root"]'); i !== -1; i = css.indexOf('[class*="QsffPG_root"]', i + 1)) {
    assert.equal(css.slice(Math.max(0, i - 5), i), ':not(',
      'QsffPG_root 只能作为 :not() 排除项存在；正向座位规则复活即静默死代码')
  }
  assert.doesNotMatch(css, /\[class\*="_root"\][^{]*\[class\*="_count"\]/,
    '宽度门控的冗长计数隐藏规则已被形状锚规则取代，不得复活')

  // ② 子智能体 chip：标签行右端；top 值手机档 42 / 共用档 48
  assert.equal(sharedDecl(scoped, 'ZKlsPq_root', 'top: 48px !important'), true,
    '共用移动档里聚合 chip 的 top 必须是本批之前的 48px')
  assert.equal(sharedDecl(scoped, 'ZKlsPq_root', 'position: absolute !important'), true,
    '共用移动档里聚合 chip 必须是绝对定位（贴标签行右缘）')
  assert.equal(phoneDecl(scoped, 'ZKlsPq_root', 'top: 42px !important'), true,
    '手机档作用域里 chip 的 top 必须是 42px（页签行被压到 26px 后的基线对齐）')
  assert.doesNotMatch(layoutSource(), /max-width: 124px !important/, '标题行才需要的封顶应随换位撤掉')
  const lineageBtn = phoneRule(scoped, 'ZKlsPq_root')
  assert.ok(lineageBtn !== null, '手机档作用域里子智能体 chip 的规则缺失')
  assert.match(layoutSource(), /\[class\*="ZKlsPq_root"\] > button \{[^}]*padding: 0 4px 9px !important;/,
    '子智能体 chip 的按钮要保持贴底对齐的 9px 下内边距')

  // ③ 标题：手机档可扩展 + 省略号；共用档仍是本批之前的 100px 横滑窗 + 硬切
  const crumb = phoneRule(scoped, '_crumbs')
  assert.ok(crumb !== null, '手机档作用域里标题本体规则缺失')
  assert.match(crumb, /max-width: 100% !important/, '标题要能吃掉腾出来的空间（不得写死像素顶）')
  assert.match(crumb, /overflow-x: hidden !important/, '标题不再靠横滑去够剩下的字')
  assert.match(crumb, /text-overflow: ellipsis !important/, '截断必须是省略号')
  const crumbShared = sharedRule(scoped, '_crumbCurrent')
  assert.ok(crumbShared !== null, '共用移动档里标题本体规则缺失')
  assert.match(crumbShared, /max-width: 100px !important/, '共用档标题窗口必须是本批之前的 100px')
  assert.match(crumbShared, /text-overflow: clip !important/, '共用档标题截断必须是本批之前的 clip')

  // ④ 预设 chip：手机档不可见胶囊（透明底 + 占一点点 px）；共用档一条都不许有
  const preset = phoneRule(scoped, 'SVAs4q_label')
  assert.ok(preset !== null, '手机档作用域里预设 chip 的胶囊规则缺失')
  assert.match(preset, /border-radius: 999px !important/)
  assert.match(preset, /margin-right: [1-9]\d*px !important/, '外包裹层要占一点点 px（不能为 0）')
  const presetBefore = scoped.find((r) => inPhone(r) && r.sel.includes('SVAs4q_label') && r.sel.includes('::before'))
  assert.ok(presetBefore !== undefined, '手机档作用域里外包裹层外壳缺失')
  assert.match(presetBefore.body, /background: transparent !important/, '灰色层当前不显现（透明底）')
  assert.match(presetBefore.body, /pointer-events: none !important/, '外壳不得吃掉点击')
  assert.equal(sharedRule(scoped, 'SVAs4q_label'), null,
    '共用移动档里不许再出现预设 chip 规则（本批之前那里本来就没有，平板档走宿主原样）')

  // ⑤ 团队 chip 的左内边距（那段间距的大头）：手机档 2px，共用档写都不写（= 宿主 7px）
  assert.equal(phoneDecl(scoped, 'VoX2oq_trigger', 'padding-left: 2px !important'), true,
    '团队 chip 左内边距 2px 必须在手机档作用域里')
  assert.equal(sharedRule(scoped, 'VoX2oq_trigger'), null,
    '共用移动档里不许出现团队 chip 的内边距覆盖（本批之前没有这条，平板档吃宿主值）')
  assert.equal(phoneDecl(scoped, 'VoX2oq_trigger', 'padding-left: 7px !important'), false,
    '平板档才需要的 7px 不该出现在手机档作用域里')
})

// ── 平板档不变现在由「共用移动档 = 本批之前的值 + 平板块已删除」单点保证 ──────────────
// 旧断言钉的是「文件末尾必须存在一整块平板档回归」，理由是"手机档改动写在共用移动档里，
// 平板会跟着变，只能把旧值写回"。那个理由现在不成立，所以旧断言**不该继续钉**：
//   ① 改动的表达位置换了：手机档差异已全部收进 (max-width: 767px) 的嵌套媒体查询，
//      共用移动档一律本批之前的值 ⇒ 平板档天然不再受影响，不需要再写回层；
//   ② 原来那块回归本身是坏的：5 条选择器带占位 token（见上一个测试的注释），Chromium
//      整条丢弃 —— 「平板与本批之前逐像素一致」当时并没有被它真正保证；
//   ③ 留着它就会重新长成"补丁抵消补丁"：本批的值一要改两处，且第二处没有任何机制
//      保证它跟得住。
// 平板档的几何现在由两道**可重跑的**检查保证：本测试的源码锚（共用档 = 旧值），以及
// 受控环境里「基准产物（b78babc，上游 v3.0.6）vs 当前产物」的同环境几何对照。
test('tablet tier keeps the pre-batch geometry through the shared mobile block (no regression block)', () => {
  const layout = layoutSource()
  const scoped = scopedRules(layout)

  // 平板块必须**整块不存在**（含它的 @patch 标记块）
  assert.ok(!layout.includes('平板档回归'), '平板档回归块必须已整块删除（不再需要用补丁抵消补丁）')
  assert.ok(!layout.includes('tablet-tier-regression'), 'tablet-tier-regression 的 @patch 标记块也该一并删掉')
  assert.ok(!/\[class\*="_SEAT"\]|_SEAT \{|_BTN \{|_YIELD \{/.test(layout), '占位 token 选择器不得残留')
  assert.doesNotMatch(layout, /min-width: 768px\) and \(max-width: 1023px\)/,
    'layout.css.ts 里不该再有平板档专用块')

  // 两条已删除的让位/预留规则都不得回来。判据是「两档都不再需要它」：
  //   · 让位 right:126px 的语义是「后台任务圆点也在标签行时，谱系 chip 往左让一格」。
  //     手机档本批已把后台任务 chip 搬进标题行 ⇒ 标签行不再有同场的第二颗 chip；
  //     平板档在本批之前那条让位本来就是按"旧代 84 宽 chip"推的惰性兜底（受控实测
  //     平板宽度下本文档流里无位移）⇒ 删掉后平板几何与本批之前一致。
  //   · 预留 padding-right:118px 已由受控实测证明是惰性的（同 DOM 上切 8px ↔ 118px，
  //     tablist 的 rect/clientWidth/注入元素 x 差量全为 0；border-box + overflow-x:auto
  //     的滚动容器让 padding 区挡不住任何视觉重叠），两档都不需要。
  assert.doesNotMatch(layout, /right: 126px !important/, '让位锚点 right:126px 不得回来')
  assert.doesNotMatch(layout, /padding-right: 118px !important/, '惰性预留规则不得回来')

  // 共用移动档 = 本批之前的值：这几条是「平板档不变」的源码级锚
  assert.equal(sharedDecl(scoped, 'wSkVaW_titleCluster', 'margin-right: 46px !important'), true,
    '共用档标题簇预留必须是本批之前的 46px')
  assert.equal(sharedDecl(scoped, 'wSkVaW_titleCluster', 'padding-right: 0 !important'), true,
    '预留必须记在 margin 上：padding 预留挡不住溢出（滚动容器的裁剪线在 padding box）')
  assert.equal(sharedDecl(scoped, '[data-mobile-nav="files"]', 'right: 8px !important'), true,
    '共用档文件夹按钮必须是本批之前的 right:8px')
  assert.equal(sharedDecl(scoped, 'header:has([class*="_headerLeading"]) [data-mobile-nav="files"]', 'flex: 0 0 36px !important'), true,
    '共用档文件夹座位必须是本批之前的 36px')
  assert.equal(sharedDecl(scoped, 'header:has([class*="_headerLeading"]) [data-mobile-nav="files"]', 'top: 2px !important'), true,
    '共用档文件夹座位必须是本批之前的 top:2px')
  assert.equal(sharedDecl(scoped, '_titleCluster', 'gap: 0 4px !important'), true,
    '共用档标题簇间距必须是本批之前的 0 4px')
  assert.equal(sharedDecl(scoped, '_headerActions', 'gap: 4px !important'), true,
    '共用档动作行间距必须是本批之前的 4px')
  // 手机档的四个新值必须与共用档成对存在（否则就是漏搬，平板会被迫吃新值）
  assert.equal(phoneDecl(scoped, 'wSkVaW_titleCluster', 'margin-right: 34px !important'), true)
  assert.equal(phoneDecl(scoped, '_titleCluster', 'gap: 0 6px !important'), true)
  assert.equal(phoneDecl(scoped, '_headerActions', 'gap: 6px !important'), true)
  assert.equal(phoneDecl(scoped, 'header:has([class*="_headerLeading"]) [data-mobile-nav="files"]', 'flex: 0 0 30px !important'), true)
})

// 2026-10-17 真机：宿主 0.2.1 的后台任务 chip 只渲染一个**无类名**包裹 div
// (旧代是 QsffPG_root)。全库以那个 root 为钥匙的规则（隐藏冗长计数 / absolute
// 座位 / order 搬位）因此全部静默失配 —— 8 字文案回到标题行，标题簇 scrollWidth
// 372 > clientWidth 342，溢出的 30px 画进文件按钮的预留带、被文件夹图标压住。
// 这条测试把「不依赖包裹类名」的选择器形状钉住：谁把锚改回 [_root]，手机端就
// 会再长回那颗长文案 chip。
test('the job chip collapses by shape, not by the host root class', () => {
  const scoped = scopedRules(layoutSource())
  const orderRule = scoped.find((r) => inPhone(r) && r.sel.includes('_headerActions') && r.sel.includes('div:has(> button[class*="_trigger"] > [class*="_count"])'))
  assert.ok(orderRule !== undefined, 'job chip order rule missing (phone scope)')
  assert.ok(orderRule.body.includes('order: 9 !important'), 'job chip must sort after the team chip (order 2)')
  assert.equal(orderRule.sel.includes('_root'), false, 'the 0.2.1 wrapper has no class: do not key on _root')

  const hideRule = scoped.find((r) => inPhone(r) && r.sel.includes('[class*="_headerActions"] button[class*="_trigger"] > [class*="_count"]'))
  assert.ok(hideRule !== undefined, 'job chip label-collapse rule missing (phone scope)')
  assert.ok(hideRule.body.includes('display: none !important'), 'the verbose count label must be hidden')
  assert.equal(hideRule.sel.includes('_root'), false, 'the 0.2.1 wrapper has no class: do not key on _root')

  // 预留必须记在 margin 上：标题簇是滚动容器，padding 预留挡不住溢出。
  for (const r of scoped.filter((x) => x.sel.includes('wSkVaW_titleCluster'))) {
    assert.equal(/padding-right:\s*(?!0)[0-9]+px/.test(r.body), false, `reservation must not ride on padding: ${r.sel}`)
  }
})
