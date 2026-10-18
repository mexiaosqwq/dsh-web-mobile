# 抽屉与 Files 面板的共存契约（sidebar ⇄ files）

> **评审状态**：M0 方案（删除抽屉底部的文件入口 + 把两侧栏共存规则显式化）经用户 2026-09-17 拍板；替代方案 M1（修好该入口）与 M2（单栏互斥）已评估，否决理由见 §4。
> **定位**：本文是「抽屉（插件 overlay 化的宿主左栏）与 Files 面板（宿主右栏 `ui-sidebar-right`）同时存在时的行为契约」的权威文档——负责**入口清单**与**层叠/生命周期规则**。手势判定矩阵仍以 `docs/specs/2026-09-13-files-swipe-gesture-design.md` 为准，本文不重复。

## §1 背景与问题

2026-09-17 在 390×844 coarse 的活页面上做了五轮实测（宿主 0.1.5 + 本机 profile 的第三方插件全装），暴露出**四条互不相同**的冲突面。它们看起来像「抽屉和文件管理打架」，实际是三套独立机制叠在一起：

1. **抽屉里点「文件」→ 抽屉收起、文件面板不出**（硬缺陷）。`MobileDrawerFooter` 的 Files 入口先 `openFilesPanel()`（对宿主 `[data-sidebar-right-expand]` 做 `.click()`）再 `toggleSidebar()`；而抽屉开着时第三方 `@linxin666/dsh-web-all` 的 `installMobileSidebarDismiss` 在 **frame 捕获阶段**吞掉「抽屉外」的一切点击（`preventDefault + stopPropagation`，并顺手 `toggle.click()`），展开按钮正在 frame 内、抽屉外——**连程序化 click 也被吞**，面板永不打开，只剩抽屉收起这一个可见结果。
2. **Files 面板开着时，顶栏两个角按钮不可达**。面板是宿主自己的全屏 fixed sheet（z-index 40），插件顶栏没有 z-index（header `position:relative; z-index:auto`）⇒ 面板画在顶栏之上，两个角按钮位置上落的是**面板自己的控件**。
3. **两侧栏可以同时存在**（抽屉 z 1300 压在面板 z 40 之上），此前这条层叠规则只隐含在实现里，既无文档也无回归锚点。
4. **右缘滑动在面板开着时的语义**（`docs/specs/2026-09-13-files-swipe-gesture-design.md` 的矩阵）。

用户的取舍（2026-09-17 原话）：① 那条入口「荒废了、没什么用了，可以直接去掉」，其点击无效的 bug 一直没管；② 左上角按钮点不动「无关紧要」，可以直接左滑或点空白收回；③ 层叠关系「可改可不改」→ 本文定为「现状即契约」；④ 右缘语义不动。

## §2 结构事实（本次实测，作为契约的地基）

| 元素 | 实测 |
|---|---|
| Files 面板 `[data-sidebar-right-panel]` | 手机档渲染为 `P3OORG_panel[data-sidebar-right-panel=fullscreen]`：`position:fixed; inset:0; **z-index:40**`，且**在 frame 内部**（`frame > … > pI_x6G_rightbarCol > panel`）。关态＝`visibility:hidden` + `transform:translate(100%)`（rect `[390,0,390,844]`），**DOM 常驻** |
| 抽屉列 | 插件的 overlay 列，`z-index:1300`；关态槽位 = 自身宽 × 110%（390px 下 `[-308,0,280,844]`） |
| backdrop | `z-index:1250`，铺满抽屉之外 |
| 顶栏两个角按钮 | `z-index:2`，header `position:relative; z-index:auto`（base.css 的 55/56/57 属于删除确认卡、compat.css 的 55/56 属于 aionui explorer/preview 两列，都不在 header 上） |

命中测试（`elementFromPoint`，LTR）：

| 状态 | 左上角 (22,26) | 右上角 (368,26) |
|---|---|---|
| 两侧栏都关 | `[data-mobile-nav="toggle"]` | `[data-mobile-nav="files"]` |
| 面板开 | 面板自己的 tab（`_tabStrip_17p4l_*`）→ 点了无动作 | `P3OORG_iconButton` → **点了会关面板**（面板自己的收起键） |
| 抽屉开 | 抽屉自己的 logo 行（`hHd-Xa_brandIdentity`） | 插件的 backdrop（点了收抽屉） |
| 抽屉 + 面板同时开 | 抽屉自己的会话树（`YDXeBa_*`/`bhn1Oq_*`，`inDrawer === true`） | 插件的 backdrop |

由此得到两条关键事实，本文其余内容都从它们推出：

- **抽屉永远压在面板之上**，且命中不穿透（点抽屉区域操作的是抽屉，不是下面的面板）。
- **面板开着时插件顶栏整体不可达**（不是"被禁用"，而是被面板自身的控件覆盖）。

第三方 shim 的吞点击规则（本机 profile 实测；未装该插件时该分支不存在）：

- 条件：`max-width: 768px` 命中 **且** frame 上无 `data-sidebar-collapsed`（＝抽屉或宿主左栏开着）**且** 点击目标不在 `[data-pane="sidebar"]` 子树内；
- 动作：`preventDefault()` + `stopPropagation()`，并点一次宿主自己的 `[data-dsh-responsive-part="sidebar-toggle"]`；
- 证据：抽屉开着时点击 `[data-sidebar-right-expand]` ⇒ 按钮自身捕获监听 `listenerFired: 0`、面板 `data-sidebar-right-open` 零变化；抽屉关着时同一点击 90ms 后置 `data-sidebar-right-open="true"`。

## §3 行为契约（本次定稿）

### §3.1 入口清单（删除后）

| 目标 | 入口 |
|---|---|
| 打开文件列表 | 顶栏右上角 Files 按钮（抽屉关闭时可达）；右缘 45% 区**左滑**（两侧栏都关时） |
| 关闭文件列表 | 面板自己的收起键；右缘 45% 区**右滑**（抽屉关 + 面板开） |
| 打开抽屉 | 顶栏左上角抽屉按钮；左缘 45% 区**右滑**（面板开着同样有效） |
| 关闭抽屉 | 抽屉本体/左区**左滑**；抽屉右缘之外**右滑**；点 backdrop；Escape；导航项 click（顶栏抽屉按钮**只作开启用**——抽屉开着时它被抽屉盖住，点击又被 shim 吞掉，不构成关闭入口，§2） |

抽屉底部**不再**提供文件入口（§3.3）。表里「顶栏两个角按钮」只在**文件面板关闭时**可达——面板打开时它画在顶栏之上（§3.2 末条），那一段的「打开抽屉」实际只剩左缘右滑一条路。

### §3.2 层叠与生命周期

- 抽屉恒在文件面板之上；**打开抽屉不关闭、也不销毁文件面板**——实测面板在所有抽屉开/关往返中保持 `visibility:visible`，收掉抽屉即原样回到面板。
- 面板开着时左缘右滑叫出抽屉（压在面板上）＝**允许并保留**。
- 抽屉开着时右缘左滑＝**刻意无动作**（沿用 2026-09-13 的收窄：面板挂上也会被抽屉压住，且宿主此时不接受右栏展开）。
- 面板开着时顶栏两个角按钮不可达＝**接受，不修**（用户判定无关紧要：左缘右滑或点空白即可收回抽屉）。
- 以上规则与书写方向无关（z 与生命周期不含方向分量）。

### §3.3 删除项

删除抽屉底部 `[data-mobile-nav="drawer-actions"]` 内的 Files 入口（`[data-mobile-nav="explorer"]`），`sidebar.footer.action` 只保留「会话日志」；随之移除 `MobileDrawerFooter` 的 `toggleSidebar` prop 与 `openFilesPanel` import。

> **2026-10-18 更新**：会话日志入口已从抽屉页脚移到抽屉品牌行的图标按钮，`MobileDrawerFooter` 与
> 页脚胶囊的描述随 `docs/specs/2026-10-18-drawer-session-log-icon.md` 作废；本 spec 其余条目（Files 入口、层叠、手势）不变。

理由（两条独立机制都指向同一结论）：

1. 抽屉开着时，任何指向 `[data-sidebar-right-expand]` 的点击都会被第三方 shim 吞掉（§2 证据）；
2. 即便绕过 shim，宿主自身在左栏开着时也不接受右栏展开——实测「先收抽屉 → 延迟点展开」矩阵：**0ms 失败 / 120ms 失败 / 320ms 成功 / 600ms 成功**（插件关抽屉是晚提交，marker 在 280ms 动画落地才翻，shim 守卫与宿主状态都到那时才放开）。

即：该入口要能用，必须引入「先收抽屉 → 等落地 → 再开面板」的时序契约；用户判定收益不值，直接删除。

## §4 被否决的方案

- **M1 保留并修好入口**：`MobileDrawerFooter.openExplorer` 改为「先走 `closeDrawerAnimated` 并拿到落地回调 → 再 `openFilesPanel()`」。代价＝`closeDrawerAnimated`（`sidebar-swipe.ts`）要暴露落地回调、两栏先后关系变成长期要用探针钉的契约；收益只是从抽屉到文件列表少一步。
- **M2 单栏互斥**：任何时刻只显示一侧（开面板收抽屉、开抽屉收面板）。代价＝插件的开抽屉路径要主动去收宿主的面板（多一处与宿主面板状态的耦合），并失去「面板还在下面等着」的便利；用户判定「可改可不改」。

## §5 已知不修清单（防返工）

1. 面板开着时顶栏两个角按钮不可达；点右上角实际触发的是**面板自己的收起键**（用户接受）。
2. 抽屉开着时 frame 内、抽屉外的点击会被第三方 shim 吞掉并顺手收抽屉——那是该 shim 的设计目的，不是缺陷；顶栏抽屉按钮同理既被抽屉盖住、点击也被吞掉，只作开启用（§3.1）。
3. 左缘右滑在面板开着时会叫出抽屉压上去（面板不被销毁，收抽屉即恢复）。

## §6 改动点

- `src/client/components/MobileDrawerFooter.tsx`：删除 Files 按钮、`openExplorer`、随之失效的 `toggleSidebar` prop 与 `IconPanelLeftOutline16` / `openFilesPanel` import。
- `src/client/index.tsx`：`sidebar.footer.action` 的 `inject` 去掉 `toggleSidebar` 传参。
- `src/client/styles/base.css.ts`：共享按钮规则列表去掉 `[data-mobile-nav="explorer"]` 那半、删掉它的 `:hover` 规则（删按钮后都是死选择器）。
- `src/client/styles/misc.css.ts`：桌面隐藏块里的 `[data-mobile-nav="explorer"]` 条目同样删除（清单必须与实际注入控件一致）。
- `src/client/styles/compat.css.ts` 规则不动（只刷新了描述该行的注释）：`[data-mobile-nav="drawer-actions"] > button { flex: 1 1 0 }` 会让剩下的「会话日志」独占整行（原来是两个按钮平分），属视觉细节，按浏览器审查结论定夺。
- `scripts/probes/files-swipe-probe.mjs`：**扩existing**（不新增探针文件，README/AGENTS 的探针文件计数不变），新增两侧栏共存场景与「抽屉 footer 已无文件入口」断言。
- 文档：本文（权威契约）＋ `docs/maintenance/pitfalls.md` 详细节 ＋ `AGENTS.md` 压缩条目 ＋ README「未发布」一条（只写最终状态）。
- `open-files-panel.ts` 不动（顶栏按钮仍在用）；`files` 这个 locale key 不动（顶栏按钮仍在用）。

## §7 验证标准

`scripts/probes/files-swipe-probe.mjs` 由 8 场景**扩到 11 场景**（其中 9/10 两项带 `elementFromPoint` 命中测试——「会话日志」按钮本体与抽屉子树的 `inDrawer`；1 只验入口在场、11 只验面板仍可见，其余为手势行为断言——避免「渲染了 ≠ 可点到」；不新增探针文件，README/AGENTS 的文件计数不变，该探针的「8 场景」描述同步改）：

- `9.footer-no-files-entry`：抽屉 footer 内 `[data-mobile-nav="explorer"]` **缺席**，`[data-mobile-nav="drawer-actions"]` 与「会话日志」按钮在场且命中本体；
- `10.panel-survives-drawer-overlay`：面板开 → 左缘 45% 右滑开抽屉，抽屉矩形内命中元素属于抽屉子树（`inDrawer === true`）、抽屉为 open、且面板仍 `visibility:visible`；
- `11.panel-visible-after-drawer-close`：点 backdrop 收掉抽屉后，面板仍 `visibility:visible`（生命周期契约的落点）。

既有场景 2/3（右缘左滑开面板、面板开右滑关面板）、5/6（抽屉开着时右缘左滑无动作、右滑收抽屉）不得回退——「面板开 + 右滑关面板」已由场景 3 覆盖，不重复新增。

门：`pnpm verify`、`pnpm test:core`、`pnpm build`（lib 与源码同提交）、`node scripts/probes/files-swipe-probe.mjs`、主探针 `pnpm smoke:cdp`（20 项：14 核心 + 6 集成，含 3 项机读基线，`new=0`）、桌面 pointer:fine 零影响。
