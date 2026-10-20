import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findRuleBlocks, matchesSelectorText, fontSizeFor } from '../src/client/core/css-rules.ts'
import { LAYOUT_CSS } from '../src/client/styles/layout.css.ts'
import { BASE_CSS } from '../src/client/styles/base.css.ts'
import { COMPAT_CSS } from '../src/client/styles/compat.css.ts'
import { MISC_CSS } from '../src/client/styles/misc.css.ts'

const MESSAGE_P: any = {
  tag: 'p',
  ancestors: [{ tag: 'div', classes: ['abc_scroll'] }],
}

test('findRuleBlocks descends into at-rules and keeps selector/body pairs', () => {
  const css = '@keyframes spin { from { opacity: 0 } to { opacity: 1 } }\n@media (max-width: 700px) { .x:has(p) { font-size: 15px !important; } }'
  const blocks = findRuleBlocks(css)
  assert.equal(blocks.length, 1)
  assert.match(blocks[0].selector, /:has\(p\)/)
  assert.match(blocks[0].body, /15px/)
})

test('matchesSelectorText handles plain, class-substring and :has() arms', () => {
  assert.equal(matchesSelectorText('[class*="_scroll"]:has(p)', MESSAGE_P), true)
  assert.equal(matchesSelectorText('[class*="_scrollBody"]:has(p)', MESSAGE_P), false)
  // The wrapped spelling this repo writes for long arms (layout.css.ts:327-329)
  // must stay readable, or a px rule whose only subject arm is wrapped is invisible.
  assert.equal(matchesSelectorText('[ class*="abc_scroll" ]', MESSAGE_P), true)
  assert.equal(matchesSelectorText('p', MESSAGE_P), true)
  assert.equal(matchesSelectorText('li', MESSAGE_P), false)
})

test('the message text family carries no hardcoded px font-size', () => {
  const hit = fontSizeFor(LAYOUT_CSS, MESSAGE_P)
  assert.ok(hit !== null, 'expected a message text rule to match the fixture')
  assert.doesNotMatch(hit.value, /^\s*[\d.]+px/, `hardcoded size in: ${hit.selector}`)
  assert.match(hit.value, /var\(/)
})

test('long-conversation message blocks skip off-screen layout (2026-10-07 实测)', () => {
  // 真宿主取证：点抽屉在长会话上 236ms longtask、短会话 0ms；profile 显示代价在宿主渲染
  // （(program) 1216ms + 宿主 getAnimations 75ms），插件 JS 仅 ~8ms。
  // 靠给会话滚动区里的直接子块 content-visibility:auto 削掉（A/B：247/62/143ms → 57/61/70ms）。
  const selector = '[data-mobile-nav="frame"] [class*="scrollBody"] [class*="_scroll"]:not([class*="scrollBody"]) > *'
  assert.ok(LAYOUT_CSS.includes(selector), '窄选择器（只打滚动区的直接子块）在位')
  assert.ok(LAYOUT_CSS.includes('content-visibility: auto'), 'content-visibility 在位')
  assert.ok(LAYOUT_CSS.includes('contain-intrinsic-size: auto 320px'), '记住真实高度、只给未渲染块兜底')
  // 滚动容器自身绝不能被设成 content-visibility（那会把整段会话藏掉）。
  assert.ok(!LAYOUT_CSS.includes('[class*="scrollBody"] {'), '没有把 scrollBody 自身当选择器')
})

test('document preview code lines skip off-screen layout (2026-10-09 实测)', () => {
  // 报障：打开 13.4k 行文件的文档预览（DOM 23,662 节点）后整页卡死。
  // 单帧最差 269/310/395/485/530ms、rAF 帧率 2/5/17、长任务每秒最高 1031ms；
  // 加规则后最长帧 33ms、帧率 88–119、长任务归零。
  // 代码行行高统一（约 20px），所以估值用 20px —— 与消息块那条的 320px 粗兜底
  // 分开写；scrollBody 那条不适合复用（消息高度差异大）。
  const selector = '[data-mobile-nav="frame"] [class*="_textDocument"] [class*="_line"]'
  assert.ok(LAYOUT_CSS.includes(selector), '窄选择器：只在移动 frame 的文档预览代码行容器内')
  assert.ok(LAYOUT_CSS.includes('contain-intrinsic-size: auto 20px'), '代码行估值 20px')
  // 泛词根不许进：_preview 同模块也有，但 chat / conversation / deliverables
  // 这些别的宿主模块同样带这个名字，纳入就会越界改到它们的面板。
  assert.ok(
    !LAYOUT_CSS.includes('[class*="_preview"] [class*="_line"]'),
    '不收 _preview 词根',
  )
})

test('the phone stats row keeps its tightened spacing (2026-10-07)', () => {
  // 宿主三层叠出来的空隙：root gap 12 + sep margin 6/6 + pill padding 8/8。
  // 手机档收成 6 / 2 / 6 —— 三条都必须带 stats 标记作用域，换代后只会惰性化。
  const scope = '[data-mobile-nav="frame"] [data-phase] [data-mobile-nav="stats"]'
  const blocks = findRuleBlocks(LAYOUT_CSS).filter((block) => block.selector.includes(scope))
  const row = blocks.find((block) => block.body.includes('gap:'))
  assert.ok(row !== undefined, 'stats 行的手机规则块在位')
  assert.match(row.body, /gap: 6px !important/)
  const sep = blocks.find((block) => block.selector.includes('[class*="_sep"]'))
  assert.ok(sep !== undefined, '分隔符规则块在位')
  assert.match(sep.body, /margin: 0 2px !important/)
  const pill = blocks.find((block) => block.selector.includes('[class*="_pill"]'))
  assert.ok(pill !== undefined, '指标胶囊规则块在位')
  assert.match(pill.body, /padding-left: 6px !important/)
  assert.match(pill.body, /padding-right: 6px !important/)
})

test('the composer file button paints one pill, not two (2026-10-07 店主报障)', () => {
  // 真机实测（按下瞬间像素剖面）：外圈 130 设备px 的 233（宿主按钮盒底色，圆角 8）
  // + 内圈 108 设备px 的 222（我们 ::before 胶囊）—— 半透明叠半透明，重叠区更深。
  // 压层叠（!important）在真机上压不住那一层，于是改成**结构上只有一层**：
  // 可见胶囊 = 按钮盒本身（28x28、全圆），::before 永久透明。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const box = blocks.find((block) =>
    !block.selector.includes('::before') && !block.selector.includes(':hover')
    && block.selector.includes('[data-mobile-nav="file-upload"]') && /width:\s*28px !important/.test(block.body))
  assert.ok(box !== undefined, '盒子必须是可见胶囊尺寸 28x28')
  assert.match(box.body, /border-radius:\s*999px/, '盒子本身要是全圆（与加号同尺寸的圆胶囊）')
  assert.match(box.body, /margin:\s*0 0 0 -8px !important/, '盒宽 34→28 后 margin 要跟着收，图标中心不动')
  const before = blocks.find((block) => block.selector.includes('[data-mobile-nav="file-upload"]::before') && block.selector.includes(':hover'))
  assert.equal(before, undefined, '胶囊不再由 ::before 画（否则又是两层）')
  const painted = blocks.find((block) =>
    block.selector.includes('[data-mobile-nav="file-upload"]:hover')
    && block.selector.includes('file-upload"]:focus-visible'))
  assert.ok(painted !== undefined, '盒子的按下反馈规则在位')
  assert.match(painted.body, /background:\s*var\(--dsw-alias-interactive-bg-hover/)
  assert.match(painted.body, /box-shadow:\s*none !important/, '万一那一层是 inset shadow 画的，一并压掉')
  const hit = blocks.find((block) => block.selector.includes('[data-mobile-nav="file-upload"]::after'))
  assert.match(hit.body, /inset:\s*-7px/, '命中区仍外扩（28 盒 ⇒ -7 保持约 42）')
})

test('plugin-manager cards and rows are tappable as a whole on mobile (2026-10-07 店主报障)', () => {
  // 宿主只把标题做成 <button>（cardOpen / rowOpen），图标、徽标、描述、留白都不响应；
  // 整卡/整行可点靠给那颗按钮铺一层绝对定位覆盖层，因此根节点必须自身定位（否则覆盖层
  // 会以更外层的定位祖先为包含块，落成「点哪都开第一个插件的详情」）。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const cardOverlay = blocks.find((block) => block.selector.includes('button[class*="_cardOpen"]::after'))
  assert.ok(cardOverlay !== undefined, '卡片标题按钮的覆盖层在位')
  assert.match(cardOverlay.body, /position:\s*absolute/)
  assert.match(cardOverlay.body, /inset:\s*0/)
  const rowOverlay = blocks.find((block) => block.selector.includes('button[class*="_rowOpen"]::after'))
  assert.ok(rowOverlay !== undefined, '行式条目的覆盖层在位')
  assert.match(rowOverlay.body, /inset:\s*0/)
  const anchored = blocks.find((block) =>
    block.selector.includes('li[data-plugin-package]')
    && block.selector.includes('li[data-plugin-row]')
    && block.selector.includes('li[data-plugin-item]')
    && /position:\s*relative\s*!important/.test(block.body))
  assert.ok(anchored !== undefined, '三种根节点都必须钉住定位（包卡片 / 行式 / item 卡）')
  // 2026-10-08：宿主「官方」组 = 包卡片 + item 卡（`plugins.item` 槽）两类，第一版漏了后者，
  // 真机症状是「有开关的能整卡点，从『终端』起那四张只有加黑标题能点」。
  assert.ok(cardOverlay.selector.includes('li[data-plugin-item]'), 'item 卡的标题按钮也要有覆盖层')
  const itemOverlayLift = blocks.find((block) =>
    block.selector.includes('li[data-plugin-item]')
    && block.selector.includes('button:not([class*="_cardOpen"])'))
  assert.ok(itemOverlayLift !== undefined, 'item 卡里的交互件同样要抬到覆盖层之上')
  // 宿主已经铺了覆盖层，但描述盒子（-webkit-box）在 DOM 里排在按钮之后、绘制更晚，
  // 会把点击整块吃掉 —— 所以覆盖层必须自带 z-index，交互件再高一档。
  assert.match(cardOverlay.body, /z-index:\s*1/, '覆盖层要抬到描述之上，否则点了没反应')
  assert.match(rowOverlay.body, /z-index:\s*1/, '行式覆盖层同理')
  const lifted = blocks.filter((block) =>
    block.selector.includes('button:not([class*="_cardOpen"])')
    && block.selector.includes('button:not([class*="_rowOpen"])'))
  assert.ok(lifted.some((block) => /z-index:\s*2/.test(block.body)), '开关等交互件要比覆盖层再高一档')
})

test('the image lightbox backdrop takes the full phone viewport (2026-10-20)', () => {
  // 宿主 primitives 的 ImageLightbox 是 body 直挂的 dialog，stage 末孩子是关闭按钮
  // 本身，所以上方「非设置形状弹层」的 max-width:calc(100vw - 32px) 不会排除它，
  // 遮罩右侧会漏画 32px；平板档还有 misc.css 的 720px 居中规则。正向覆盖必须
  // 同时把 left/right/width/max-width/margin 都拉回铺满，并且压住页面级 pinch。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const selector = 'div[role="dialog"][aria-modal="true"]:has(> :first-child > img)'
  const rule = blocks.find((block) => block.selector === selector)
  assert.ok(rule !== undefined, '灯箱铺满规则在位')
  assert.match(rule.body, /left:\s*0 !important/, '左缘回 0')
  assert.match(rule.body, /right:\s*0 !important/, '右缘回 0')
  assert.match(rule.body, /width:\s*auto !important/, '宽度交给 left/right 撑满')
  assert.match(rule.body, /max-width:\s*none !important/, '不被导出弹层的 100vw - 32px 收窄')
  assert.match(rule.body, /margin-left:\s*0 !important/, '不被平板档的 auto 居中规则推走')
  assert.match(rule.body, /margin-right:\s*0 !important/, '不被平板档的 auto 居中规则推走')
  assert.match(rule.body, /touch-action:\s*none !important/, '灯箱自己的手势层接管 pinch')
  // 位置契约：必须在要覆盖的导出弹层规则之后、并且在唯一的顶层移动块里面。
  const exportRuleAt = LAYOUT_CSS.indexOf('[aria-modal="true"]:not(:has(> :first-child > :last-child > button)) {')
  const ruleAt = LAYOUT_CSS.indexOf(selector + ' {')
  assert.ok(exportRuleAt >= 0 && ruleAt > exportRuleAt, '覆盖规则必须写在导出弹层规则之后')
  assert.ok(
    ruleAt > LAYOUT_CSS.indexOf('@media (max-width: 1023px) and (pointer: coarse) {'),
    '规则必须留在顶层移动块内（桌面档零影响）',
  )
  // Two-space indentation = a direct child of that top-level block (the reader
  // flattens at-rule conditions, so the text position is the only depth signal).
  assert.ok(
    LAYOUT_CSS.includes('\n  ' + selector + ' {'),
    '灯箱规则必须直接挂在顶层移动块里，不许缩进进更窄的子档',
  )
  // 多出来的 type 选择器不是装饰：misc.css.ts 拼在 layout 之后，平板档那条
  // 720px 居中规则与不带 div 的写法同为 (0,3,1)，按拼接顺序会赢；带上 div 才是
  // (0,3,2)。这条断言把「为什么可以多写一个 div」钉在测试里。
  assert.ok(/^div/.test(selector), '灯箱覆盖规则必须靠 div 抬一级特异性压过 misc 的平板规则')
})

test('the plugin-manager page head is left-aligned on phones (2026-10-20)', () => {
  // 页首容器与页首标题互为子串（_pageHead 命中 _pageHeading），两条让位规则叠加
  // 后页首离左缘过远。手机档的三条规则：改 clearance 口径 + 归零两级 margin。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const clearance = blocks.find(
    (block) =>
      block.selector === '[data-mobile-nav="frame"] section[data-plugin-panel] > [class*="_pageHead"]'
      && block.body.includes('--dsh-web-mobile-panel-clearance'),
  )
  assert.ok(clearance !== undefined, '页首 clearance 覆盖规则在位')
  assert.match(
    clearance.body,
    /--dsh-web-mobile-panel-clearance:\s*calc\(60px - clamp\(24px, 4vw, 48px\)\);/,
    'clearance 改吃 60px 口径',
  )
  const heading = blocks.find(
    (block) => block.selector === '[data-mobile-nav="frame"] section[data-plugin-panel] [class*="_pageHeading"]',
  )
  assert.ok(heading !== undefined, '_pageHeading 归零规则在位')
  assert.match(heading.body, /margin-left:\s*0 !important/)
  assert.match(heading.body, /width:\s*auto !important/)
  // 2026-10-20 参考图：页首一行内排 —— 禁止换行 + heading 可收缩 + 工具栏贴右。
  assert.match(clearance.body, /flex-wrap:\s*nowrap !important/, '页首禁止折行')
  assert.match(heading.body, /min-width:\s*0 !important/, 'heading 必须能收缩，否则工具栏仍被挤下去')
  const toolbar = blocks.find(
    (block) => block.selector === '[data-mobile-nav="frame"] section[data-plugin-panel] [class*="_toolbar"]',
  )
  assert.ok(toolbar !== undefined, '工具栏贴右规则在位')
  assert.match(toolbar.body, /margin-left:\s*auto !important/, '工具栏贴右')
  assert.match(toolbar.body, /flex:\s*0 0 auto !important/, '工具栏不被压缩')
  const title = blocks.find(
    (block) =>
      block.selector
      === '[data-mobile-nav="frame"] section[data-plugin-panel] [class*="_pageHeading"] > h1',
  )
  assert.ok(title !== undefined, '页首 h1 归零规则在位')
  assert.match(title.body, /margin-left:\s*0 !important/)
})

test('the header team / lineage chips carry no touch press tint (2026-10-20)', () => {
  // 店主报障：点头部「智能体团队」图标打开面板、再点它关闭时，图标周围会闪一块浅灰；
  // 「子智能体 / N 个子代理」芯片同样。那块灰是本文件 touch press feedback 的
  // :active inset 填充（外加图标 scale .96）。这两颗平时没有底色，所以格外显眼。
  // 只给它们清掉，其它按钮的按压反馈保留 —— 断言把「哪两颗」和「只清这两颗」都钉住。
  const blocks = findRuleBlocks(BASE_CSS)
  const exception = blocks.find((block) => block.selector.includes('[data-team-action] > button:active'))
  assert.ok(exception !== undefined, '团队芯片的按压例外规则在位')
  assert.match(exception.selector, /\[data-dsha-lineage-trigger\]:active/, '子智能体芯片同一条例外')
  assert.match(exception.body, /box-shadow:\s*none/, '不再浮一层浅灰')
  assert.match(exception.body, /transform:\s*none/, '也不再缩放')
  // 位置契约：例外必须在通用按压规则之后 —— 写在前面会被同块里后面的规则重新盖回来
  // （两条 :where() 特异性都是 (0,0,0)，靠源码顺序分胜负）。
  const tintAt = BASE_CSS.indexOf('box-shadow: inset 0 0 0 100vmax')
  const exceptionAt = BASE_CSS.indexOf('[data-team-action] > button:active')
  assert.ok(tintAt >= 0, '通用按压填充规则还在（没有误删全站反馈）')
  assert.ok(exceptionAt > tintAt, '例外必须写在通用按压规则之后')
  // 通用规则本身不许被改成排除式：其它按钮（抽屉行 / 菜单项）必须继续有反馈。
  assert.ok(
    BASE_CSS.includes(':where(button, [role="button"], [role="menuitem"]'),
    '通用按压反馈规则保持不变（影响面只限这两颗芯片）',
  )
})

test('the ask-question card title is not swallowed by the mobile header block (2026-10-20)', () => {
  // 店主报障：提问卡（ask_user_question）只显示 eyebrow 和选项，问题正文整行不见
  // ——「你提的问题被吞掉了」。真机 DOM 取证：问题正文 .Mbwy4a_title 的 computed
  // display 是 none；逐条禁用插件样式表定位到顶栏「隐藏日志胶囊」那条裸 header 规则：
  // 提问卡渲染在 composerSeat 里、同样在 [data-phase] 之下，它的
  // Mbwy4a_header > headingBlock > :last-child 正是问题正文 <h2>。
  // 契约：作用在会话顶栏结构/后代上的规则必须锚宿主顶栏类 header.wSkVaW_header；
  // 裸 header 只允许按钮级 polish（tap-highlight / :active 压暗）。
  const blocks = findRuleBlocks(LAYOUT_CSS)
  const structural = blocks.filter((block) =>
    /\[data-phase\] header(?:\.wSkVaW_header)?\s*>/.test(block.selector),
  )
  assert.ok(structural.length >= 3, '顶栏直系子元素规则还在（没有误删整块）')
  for (const block of structural) {
    assert.match(
      block.selector,
      /header\.wSkVaW_header/,
      `裸 header 的直系子元素规则会把提问卡一起命中：${block.selector}`,
    )
  }
  const hide = blocks.find(
    (block) =>
      block.selector
      === '[data-mobile-nav="frame"] [data-phase] header.wSkVaW_header > :first-child > :last-child',
  )
  assert.ok(hide !== undefined, '隐藏顶栏日志胶囊的规则仍在位（只是收到顶栏类上）')
  assert.match(hide.body, /display:\s*none !important/)
})

test('the ask-question card body stays selectable on phones (2026-10-20)', () => {
  // 第五轮把「隐藏日志胶囊」收窄到 header.wSkVaW_header 后，问题正文能看见了，
  // 但同族的 user-select:none（misc.css.ts 的 B1 选择收敛）仍是裸 header，
  // 而提问卡的 header 也是 [data-phase] 下的 <header> ⇒ 正文吃到 none，
  // 长按选不中、也复制不了问题。真机读数（inspector client realm 注入线上
  // 样式表的隐藏 iframe 360×792）：提问卡 header 与 h2 的 computed
  // user-select 都是 none。契约与会话顶栏同一条：锚宿主顶栏类。
  const blocks = findRuleBlocks(MISC_CSS)
  const headerRules = blocks.filter((block) => block.selector.includes('[data-phase] header'))
  assert.ok(headerRules.length >= 2, '禁选与输入框放行两条顶栏规则都在位（没有误删整块）')
  for (const block of headerRules) {
    assert.match(
      block.selector,
      /header\.wSkVaW_header/,
      `裸 header 会把提问卡正文一起禁选：${block.selector}`,
    )
  }
  const none = headerRules.find((block) => block.body.includes('user-select: none'))
  assert.ok(none !== undefined, '会话顶栏禁选规则仍在位（只是收到顶栏类上）')
  assert.match(none.body, /-webkit-user-select: none !important/)
  const text = headerRules.find((block) => block.selector.includes('header.wSkVaW_header input'))
  assert.ok(text !== undefined, '顶栏输入框仍放行（否则 WebKit 上没法输入/粘贴）')
  assert.match(text.body, /user-select: text !important/)
})

test('the session-inspector disclosure triangles are enlarged on phones (2026-10-20)', () => {
  // 店主报障：手机端「会话数据诊断」面板里那些深色小三角太小、点不准。
  // 行高 30px 是宿主虚拟化常量（estimateSize / sticky 偏移多处写死 30，且没有
  // measureElement），所以只放大控件本身：22px 盒 = 30px 行高 − 上下各 4px 内边距。
  const blocks = findRuleBlocks(COMPAT_CSS)
  const arrow = blocks.find((block) => block.selector.includes('[class*="_disclosure"][aria-expanded]'))
  assert.ok(arrow !== undefined, '行展开箭头的放大规则在位')
  assert.match(arrow.body, /width:\s*22px !important/, '可点宽度 16 → 22')
  assert.match(arrow.body, /height:\s*22px !important/, '可点高度 22（行内容盒）')
  assert.match(arrow.body, /font-size:\s*15px !important/, '字形 11 → 15')
  assert.ok(!arrow.body.includes('line-height: 30px'), '不许借放大改行高')
  // JSON 树是原生 details/summary，三角由 UA marker 画，只能打 ::marker。
  const marker = blocks.find((block) => block.selector.includes('summary::marker'))
  assert.ok(marker !== undefined, 'JSON 树 marker 的放大规则在位')
  assert.match(marker.body, /font-size:\s*15px !important/, 'marker 15px 正好卡进 16px 缩进槽')
  // 顶部「原始数据 ▾」是原生 select，直接长高即可（不在虚拟化区域）。
  const selector = blocks.find((block) => block.selector.includes('_modeSelector'))
  assert.ok(selector !== undefined, '顶部模式选择器的放大规则在位')
  assert.match(selector.body, /min-height:\s*32px !important/)
  // 吸顶祖先行在快速滑动时错乱：sticky <tr> + border-collapse:collapse 是
  // Chromium 的撕裂组合，换成 separate（只留每行的 border-bottom，视觉不变）。
  const table = blocks.find((block) => block.selector.includes('GTtnTq_table') && block.body.includes('border-collapse'))
  assert.ok(table !== undefined, '表格边框模型改动在位')
  assert.match(table.body, /border-collapse:\s*separate !important/)
  assert.match(table.body, /border-spacing:\s*0 !important/)
  const sticky = blocks.find((block) => block.selector.includes('GTtnTq_sticky') && block.body.includes('will-change'))
  assert.ok(sticky !== undefined, '吸顶行的合成层规则在位')
  assert.match(sticky.body, /will-change:\s*transform !important/)
})
