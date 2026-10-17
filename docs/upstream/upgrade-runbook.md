# DSH 宿主升级 Runbook

> 本仓库插件适配官方 DSH Web 宿主。宿主（或其 client-ui 子包）升级可能重排 CSS module 哈希、改 composer/端点形状——本清单把 AGENTS.md 里与宿主版本绑定的契约点汇总成升级后按序核对的电池。文档随仓库维护，但不进 npm 包。

## 0. 升级前快照

```sh
dsh --version                            # 宿主版本
git -C ~/dsh-mobile-nav status --short   # 必须干净
sha1sum ~/dsh-mobile-nav/lib/client.js   # 不要用它的前 12 位当 rev（见下方 bundle 端点条）
```

另记录当前安装的 client-ui 子包版本与 §2 哈希清单，升级后逐项比对。

## 1. 升级与重启

```sh
pnpm add -g @deepseek-ai/dsh@next   # 或目标版本
dsh --dump-config                    # 确认 dsh-web-mobile 行仍在
dsh web                              # 重启 127.0.0.1:3080
```

## 2. 哈希族对账（升级后必查）

CSS module 哈希是包版本的函数；下列前缀是本插件选择器/探针的契约锚点，升级后用 CDP 在真实页面逐一确认仍在（换了就改 `src/client/styles/` 与对应探针，并回填 AGENTS.md）。

本表已有机读版与自动对账探针（2026-09-18 复跑：`total=26 hit=17 skip=4 miss=5 green=no`，exit 1）：

- 数据：`docs/upstream/compat-contracts.json`（28 条，其中 11 条 `lazy`＝状态门控/懒加载条目）
- 执行：`node scripts/cdp-compat-contracts.mjs`（无需 `DSH_PROBE_SESSION_ID`，非 lazy 的 MISS 才 exit 1；SKIP/MISS 条目按其 `state` 提示手动复扫）
**2026-09-18 现状：`total=26 hit=20 skip=6 miss=0 green=yes`（exit 0）。**
**2026-09-23：0.1.7-alpha.2 静态对账见 `2026-09-23-dsh-0.1.7-alpha.2-compat-audit.md`** —— 28 条里 16 条两版逐字一致、8 条状态/运行时门控、3 条属第三方 dsh-web-all、1 条死哈希已改结构化 marker；**插件代码 0 处需要改**。

- **首批 5 条 MISS 的真因是上游改名（针已死），不是「该场景没渲染」**——全盘普查（`grep -rlF` 扫全局 dsh 与 profile 的 node_modules）：`qDHVXG_` / `gdEzaW_` / `_dialog_15u5s_22` / `bpnj3G_` / `jmhvDG_` **各 0 命中**；替代物已定位并回填：`wSkVaW_headerActions`（conversation）、`Sixlwa_bubble`（气泡已迁 `dsh-client-ui-chat`；goal 气泡 `oRe1gG_` 属 `dsh-client-ui-goal`）、`_dialog_w1urq_22`（web-frontend）。
- `group-card-1/3/5` 虽然 HIT，但**命中来自 dsh-web-all 的样式表选择器，不代表有元素渲染**（见下条）——这三条只是「样式表还在」的证据。
- `group-card-2/4` 改标 lazy 的**理由已实测**，不是放宽：0.1.5-rc.2 + dsh-web-all 0.3.20 的 Web Plugins 页**零 `[class*=_header]` 渲染**（整个 modal 62 个节点，只有工具栏 `VOzbGW_header`），该页形态已不存在，无处认领新哈希；`state` 写明「卡头复活时复扫」。
- **HIT 语义（探针头部已写死）**：`hit` ＝ 该串出现在 DOM class 属性**或任何已加载样式表的 `cssText`** 里，**不等于有元素渲染**——插件样式表里未使用的 CSS-module 类同样 HIT。要断言「渲染」必须靠探针的渲染级断言（`scripts/probes/plugin-card-header-bleed.mjs` 就是这么做的），别只看契约汇总。
- 记法教训：把这类 MISS 记成「场景没渲染」，死针就会被当成环境差异静静躺过去（首轮就是这么记的）；反过来，把 `hit` 当「渲染正常」也同样是误读。

| 哈希前缀 | 归属 | 涉及契约 |
| --- | --- | --- |
| `eGUBIq_` | dshmarket | 已安装列表 outer-row（`:not([class*="irowActions"]):not([class*="irowTrailing"])`）、标题行 wrap、Tasks 弹卡 fixed 居中；profile `^caret` 范围会静默升 minor，升级后按调试地图 §7 对账 |
| `cubgiG_` | agent-preset | 模式选择菜单底部弹层 `[role="menu"]:has([class*="cubgiG_item"])` |
| `ZKlsPq_` / `h8S2Va_` | dsh-client-ui-subagent 两代 | count 触摸兼容（hover 代/onClick 代）、lineage 计数钉宽、class 尾随空格坑；判定看 served bundle 行为，别看版本号 |
| `JObwrW_` | ContextMeter | trigger 无 `aria-haspopup="menu"`，右簇钉住规则依赖 |
| `uV2eYG_` | composer 卡 | hero/tools/scroll；Lexical `<p>` 命中 `_scroll` 的 `:not(:has([data-composer-input]))` 排除 |
| `pI_x6G_frame` | 会话 frame | box-sizing / safe-area 规则落点 |
| `wSkVaW_headerActions`（旧 `qDHVXG_`） | hero 相位 | 探针区分 hero 自有 headerActions 与 slot 容器 |
| `VOzbGW_close` | 设置对话框叉号 | dshmarket 反制 nav 的唯一关闭路径 |
| `Sixlwa_bubble`（chat）/ `oRe1gG_bubble`（goal） | 用户消息 / goal 气泡 | tooltip 压制规则的反断言元素（旧 `gdEzaW_` 属 conversation，已改名） |
| `-NprXq_searchInput` | 第三方 13px 搜索框 | iOS 16px 下限覆盖对象 |
| `wSkVaW_` | hero composer stack | 多 token class 子串匹配实证样例 |
| `_dialog_w1urq_22`（旧 `_dialog_15u5s_22`） | Session log 模态 | CDP 假阴性防护（后缀 `_22` 是模块序号） |
| `YyYd_a_`（官方 Plugins 卡）＋ `Kwoi6G_` / `bpnj3G_` / `Jh0q7G_` / `jmhvDG_` / `rUBhvW_`（dsh-web-ui-all 分组卡） | 插件设置卡头 | 工具栏三连规则结构化锚定的回归对象，`plugin-card-header-bleed.mjs` |

## 3. DOM / 端点契约分代（升级到 0.1.2-rc.1+ 时）

- composer 编辑面：`[data-composer-input]` 是 Lexical marker，`0.1.2-alpha.2` 起出现（`0.1.2-rc.1` 及以后都有；早于它只有 `data-composer-card`/`data-composer-seat`）；0.1.1-rc.2 只有 `data-composer-card`/`data-composer-seat`（guard/marker 逻辑按各文件头注释对账）。
- `[data-input-mirror]`/`[data-input-backdrop]` 自 0.1.2 被删（保留为旧宿主兜底，新宿主空转）。
- client bundle 端点：0.1.2-rc.1 起走合并式 `/plugins/??a/client.js,b/client.js&rev=<12位>`；**rev 既不是 `sha1sum lib/client.js` 也不是 served body 的 sha1**（0.1.5 一次性快照：rev `6d6b8afda63c` vs sha1(lib) `70e6f5deeb99`——bundle 每次提交都变，别当常量）——别拿 rev 对账。单包组合 URL 一律 404（空 body，sha1 恒 `da39a3ee5e6b`），只有 `__DSH_BOOT__` 里那条完整 URL 才 200；权威判据＝served body 是 `lib/client.js` 的**逐字节前缀 + 80 字节 `//# sourceMappingURL=…` 尾巴**（AGENTS.md「页面状态/bundle 校验」有完整命令）。
- `data-conversation-composer-overlay` 渲染在每个活跃 conversation.view 根上（轨迹 tab 同款）；marker 判定只认 `.dsfv-panel`。
- **composer 会被「链式叠加」整体顶掉**：`dsh-client-ui-renderer` 的 `renderChainResult(slotKey, elected, opts)` 在有 `opts.overlay` 时把 fallback 包进 `[data-chain-overlay-fallback="<slotKey>"]`——`elected === null` 时该包装 `display: contents`（正常），一旦有叠加被选中就写成**内联 `display: none`**，并把选中节点渲染成它的下一个兄弟。实测（2026-09-18）：会话里挂着未回答的提问卡（`dsh-client-ui-user-questions`，`Mbwy4a_frame[data-question-key]`）时，`conversation.composer` 的 fallback 被隐藏 → 整棵 composer（含本插件注入的控件）**仍连接、computed 仍是规则值，但 `getBoundingClientRect()` 全 0**。任何量 composer 的探针遇到该状态必须走 SKIP 并点名 elected 节点（不许当失败，也不许静默跳过）；`scripts/probes/composer-meter-hitbox-probe.mjs` 已实现。
- viewport meta：宿主各版都不带 `maximum-scale`；插件武装期接管并重申 `width=device-width, initial-scale=1, viewport-fit=cover`。

## 4. 升级后验证电池（按序）

```sh
cd ~/dsh-mobile-nav
pnpm verify && pnpm test:core && pnpm build && git diff --exit-code lib

# CDP（Termux 本机参数；SESSION_ID 取 ~/.dsh/sessions/--data-data-com.termux-files-home--/ 最新）
export TMPDIR=$HOME/tmp XDG_RUNTIME_DIR=$HOME/tmp
export DSH_PROBE_URL=http://127.0.0.1:3080/
export DSH_PROBE_CHROME=chromium-browser   # 2026-09-18 实测可 spawn；异常时直指真实 ELF /data/data/com.termux/files/usr/lib/chromium/chrome
node scripts/cdp-compat-contracts.mjs          # 契约对账（无需 SESSION_ID）；miss=0 才算过，SKIP 按提示手动复扫
DSH_PROBE_SESSION_ID=<id> pnpm smoke:cdp      # SUMMARY new=0 才算过；BASELINE 见探针内 EXPECTED_FAILURES
node scripts/cdp-swipe-failures.mjs           # 18 场景手势门
node scripts/cdp-zoom-probe.mjs               # 23 断言 iOS/viewport 守卫
for f in scripts/probes/*.mjs; do node "$f" || echo "FAIL $f"; done
```

契约探针 `miss=0`（SKIP 条目手动复扫）+ 历史回归锚点（`scripts/probes/`）全绿 + 主探针 `new=0` + 手势/zoom 门通过，才算对账完成。

## 5. 低危普查项

- 未守卫哈希候选 `_search/_searchInline/_searchBox`：升级后用 CDP 普查复核（见 AGENTS.md 哈希子串匹配条目）。
- 桌面隐藏块清单：新增任何 `data-mobile-nav` 注入控件必须同步进 misc.css 隐藏块（dispose 竞态防线）。
- 连续跑探针前先 `pgrep -c chrom` 清点残留 headless（泄漏会拖垮后续 boot）。

## 6. 0.1.6-alpha.2 已知连带失效（2026-09-19 静态对账，五路分区审查）

> 完整证据链（file:line 级）见 `2026-09-19-dsh-0.1.6-alpha.2-compat-audit.md` §10。升级前必修 3 项应在此清单确认完成后才升级：

1. **sessions 服务形状三重移除**（a2 删 `open()`/`clear()`/`SessionListState.current`+`currentAddress`，共 6 调用点）——未修则导出 pill 恒 disabled、#49 导航回归、tap-fallback TypeError。修法：feature-detect 降级 `armNav()` + `currentSessionIdOf()` 分代 helper（回退 `retainedBy.mainView` 推导）。
2. **permission 治理系列 6 规则打空**（layout.css.ts:457-499，rc.2 期已错位）——改锚 `div.modes`。
3. **session-delete-probe qDHVXG_ 死针**（installed rc.2 即红，与升级无关）——改 `_listArea`/`_rail` 子串。

升级时必修：headerHidden→headerBlank（layout.css.ts:668 + hero-composer-clip-probe 5b/6b 双死，补 headerBlank 空槽规则）；plugin-card 探针 YyYd_a_ 断言（EXPECTED_FAILURES 或改 pbvGtq_ 族）；flock 写锁注意（a2 新增 `session.lock` 跨进程锁，删除会话前确认无其他 DSH 实例在跑，否则 rm 绕锁致他实例写孤儿 inode）。
