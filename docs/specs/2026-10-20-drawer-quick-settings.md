# 抽屉一键设置：账户行右端齿轮

> 状态：2026-10-20 用户拍板（「侧边栏需要点击最下方的头像之后才能有二级 UI…之后还得继续点一遍才能打开」）。本文件定**入口位置、与宿主连接条的共存方式、点击链语义**；实现见 `src/client/effects/drawer-quick-settings.ts`。

## §1 问题

宿主把「设置入口」和「账户入口」合并成了同一个 launcher：`settingsArea` 渲染 `renderSlot("settings.launcher", { openSettings })`，而 `@deepseek-ai/dsh-client-ui-settings-account` 占用了该槽，注册成账户菜单（`AccountMenu`）。宿主自带的一键齿轮 fallback（`settings.trigger`）因此**永不渲染**。

390×844 coarse 实测（0.2.1-rc.2 + 本仓 v3.2.1）：

| 步骤 | 实测 |
| --- | --- |
| 抽屉页脚账户行 | `260×44`（y 790–834），整行一颗 `button[aria-haspopup="menu"]`（`aria-label="Account menu"`） |
| 点该行 | 向上弹出 3 项菜单 `144×110`（Settings / Feedback / Sign out），第一项即设置 |
| 点 Settings | 设置面板才打开（`374×372` sheet，抽屉留在背后未关） |

即：**打开设置固定两步，且第二步藏在一个账户语义的菜单里**。

同一行右端还被宿主的连接状态条占用（`@deepseek-ai/dsh-client-ui-primitives` 的 `ConnectionIndicator`）：`connecting` / `disconnected` 渲染 `button[data-phase]`，`recovered` 渲染 `div[role="status"]`，正常连接时渲染 `null`。它 `flex: none`（不收缩），高 28、`padding: 0 8px`、字号 12，中文文案约 136px、英文文案约 190px。

## §2 决定

账户行右端新增一颗插件自有齿轮，**一击打开设置**；**账户菜单里的同一项收起**（2026-10-21 用户追加：「把原来的打开方式进行删除，只保留这个」）。

- 节点：`<span data-mobile-nav="quick-settings-wrap"><button data-mobile-nav="quick-settings">`，**30×30 盒 / 17px 描边图标**（宿主 `IconSettingsOutlineMedium` 同款两条 path，`stroke-width: 1.3`，viewBox 仍 16 格按 17px 渲染；尺寸走过三轮：2026-10-20 初版 28×28 / 16px → 2026-10-21 用户「UI太小了!」放大到 36×36 / 20px → 2026-10-22 用户「还是太大了」按同比例缩到 30×30 / 17px），`aria-label` + `title` = `quickSettings` 文案，`aria-haspopup="dialog"`。套一层 `<span>` 与「抽屉品牌行导出图标」同因：不让行内启发式把插件节点认成宿主控件。
- 注入点：`[class*="sidebarCol"] [class*="triggerRow"]`（纯 DOM 注入，reconciler task，`scopes: ['*']`，宿主 React 重建行时幂等重挂）。
- 位置：行右端，`margin-right: 6px`（2026-10-21 用户「UI应该再向左调整一下」）。该行 `width: calc(100% + 4px)` / `margin: 4px -2px`、账户 launcher `padding: 6px`，6px 恰好把齿轮右缘对到 launcher 的内容右缘（column − 4px）。
- 点击语义：**复刻用户路径**——点账户 launcher，下一帧点菜单第一项（宿主的 `AccountMenu` items 顺序固定以 `settings` 开头）。没有更短的官方通道：设置面板的状态在 settings shell 自己的 store 里，`settings.open` 快捷键命令不向第三方插件开放调用，fallback 齿轮不渲染。合成快捷键实测无效（2026-10-20：`Ctrl/⌘+Alt+,` 派发 `KeyboardEvent` 不打开面板）。
- 菜单里的设置项：宿主 items 数组写死 `settings` 打头、DOM 无 id 可读、插件不改宿主源码，所以由 task 在**那一个**菜单节点上打 `data-mobile-nav-quick-menu`，CSS 收起 `role="menu" > div[role="presentation"] > :first-child > [role="menuitem"]`（登记为 `drawer-quick-settings-menu-entry` 补丁）。认菜单的判据与点击链同一套：账户 launcher `aria-expanded="true"` 时文档里最后一个 `[role="menu"]` 就是它。点击链仍点「第一个 menuitem」——被 `display: none` 收起不影响 `click()`，改成「点第一个可见项」会点到 Feedback。
- 中间帧不闪：链运行期间在 `<html>` 挂 `data-mobile-nav-quick`，CSS 让 `[role="menu"]` `visibility: hidden`（`el.click()` 不要求可见）；点完即摘标记。
- 降级：找不到 launcher 或菜单没出现就不动；菜单开了但项点不到，400ms 后回点 launcher 收起（不把菜单留在屏幕上）。
- **连接条在场时齿轮隐藏**（`:has(> button[data-phase], > [role="status"])` 守卫，登记为 `drawer-quick-settings-chip-guard` 补丁）。该行只有 260px：连接条中文占 ~136、英文 ~190，齿轮常驻在英文下会把账户按钮挤到 ~26px、头像被裁。**隐藏期间菜单里的设置项同时恢复**（task 的 `gearAvailable()` 镜像同一判据，摘掉菜单标记）——那段时间账户菜单是设置的唯一入口。连接恢复后齿轮回来、菜单项再收起。
- 桌面与键鼠窗口不出现：task 只在 mobile frame 存在时注入；misc.css 桌面隐藏清单保留两个 marker 作为 dispose 竞态兜底。桌面没有齿轮，账户菜单两项路径原样保留。

## §3 与既有契约的关系

- 不改宿主 `settings.launcher` / `settings.trigger` 槽的归属；账户菜单的 Settings 项由**本插件 CSS 收起**（不改宿主源码、不删宿主节点），Sign out 与 Feedback 入口保持原位，账户语义不变。
- 不改抽屉行的换行与高度（连接条在场与否都不改变页脚几何，只切换齿轮的显隐）。
- 与 `docs/specs/2026-10-18-drawer-session-log-icon.md` 同族：抽屉内的低频/次入口以图标注入宿主行，不占列表高度。


## §4 被否决的备选

| 方案 | 否决理由 |
| --- | --- |
| 账户菜单保留设置项（齿轮 + 原路径并存） | 2026-10-20 先选后改：2026-10-21 用户「把原来的打开方式进行删除，只保留这个」——同一功能两条入口，第二条永远只会在齿轮让位时才有意义，日常纯属噪声 |
| 改宿主 `AccountMenu` items 数组（删 settings 项） | 第三方源码不可改（本仓硬规矩），npm 重装即失效；CSS 收起宿主节点是本仓既有做法（会话菜单同理） |
| 头像直接开设置、长按出账户菜单 | 设置面板的 Account 页没有退出登录（实测只有登录态/余额/平台页），等于把 Sign out 藏进隐藏手势；且与宿主 `aria-haspopup="menu"` 语义冲突 |
| 齿轮常驻 + 连接条换行到第二行 | 2026-10-20 先选后改主意：异常时页脚临时长 36px、会话列表少一行，换来的是任何语言下都不裁头像；用户最终选「异常时让位」 |
| 齿轮放抽屉品牌行（与导出图标同排） | 注入最省事且永不相撞，但手机单手持握够不到顶行——正是本条要解决的「最下方」问题 |
| 恢复宿主 `settings.trigger` fallback（拿掉账户 launcher） | 会丢掉账户菜单（Sign out / Feedback / 登录态），归还宿主 UI 不属本插件职责 |
| 用 `settings.open` 快捷键命令开面板 | 该命令由 settings shell 私有注册，`ctx.shortcuts` 不暴露 `invoke`；合成按键实测无效 |

## §5 验证

- 门禁：`pnpm verify` / `pnpm test:core` / `pnpm build` / `node scripts/client-bundle-smoke.mjs` / lib 新鲜度（`git diff --exit-code HEAD -- lib` + `git status --porcelain --ignored lib` 为空）。
- 单测 `tests/drawer-quick-settings.test.ts`：注入位置与 marker、`<span>` 包装（行内直接 button 只有宿主那两颗）、点击链顺序（launcher → 下一帧 → 菜单第一项）、标记挂/摘、链路失败回点收起、dispose 移除；CSS 侧钉住连接条守卫、桌面隐藏清单、30×30 盒 + 17px 图标 + 6px 右距、菜单第一项收起规则；行为侧钉住「菜单打开才打标记 / 连接条在场时摘标记 / 齿轮回来再打回 / dispose 不留标记」。
- 390×844 coarse（真宿主）：点齿轮一击开设置；**点账户行只剩 Feedback + Sign out 两项**；连接条出现时齿轮隐藏**且菜单里设置项回来**；宿主重建行后齿轮仍在；齿轮与账户按钮不重叠、右缘与账户按钮内容右缘齐平。
- 768–1023 平板同手机档；≥1024 桌面与键鼠窄窗零变化（无齿轮、账户菜单三项原样）。
