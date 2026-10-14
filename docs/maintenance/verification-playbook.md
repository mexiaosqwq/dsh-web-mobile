# 验证手册（本仓的验收场景与探针环境）

改动 `src/` 之后要做浏览器/真机验收、或要起探针环境时读这份。根 `AGENTS.md` 只留门禁命令与一行指针，
流程细节在这里；探针环境的**坑**（不是流程）在 `docs/maintenance/pitfalls.md` §探针运行环境。

来源：原根 `AGENTS.md` 的「Testing & QA」节（2026-10-14 下沉，原文未改写）。

## 三道门与本地检查

`pnpm verify`（typecheck）与 `pnpm test:core`（59 个测试文件，glob 覆盖 `tests/` 全部）。`test:core` 另含
两道结构门：`css-structure-check.mjs`（CSS 结构）与 `patch-registry-check.mjs`（兼容补丁四要素与登记表
一致性，2026-10-13 接入）——两者都由 `tests/css-structure.test.ts` 驱动，且都带变异用例（缺字段/指向不
存在的测试必须红），不做摆设门。`pnpm build` 另外会跑自研客户端打包器。空白卫生用 `git diff --check`。

本仓没有 linter/formatter/coverage；CI 另外跑 bundle smoke 与 lib 新鲜度门 `git diff --exit-code lib`。

## 验收场景（改源码/布局之后）

把 link 安装的插件装进真实 DSH Web profile，重启 `dsh web`，两侧断点都要看：

- **窄手机（~390px）**：rail 隐藏；抽屉/FAB/backdrop 开合正常；Escape 生效；会话行操作菜单不关抽屉；
  设置区可用；Files 打开 explorer/preview 面板；会话日志/footer 动作可用；预览全屏可开可复位。
- **平板（768–1023px）**：居中且限宽的面板几何要与手机档分开验。
- **桌面（≥1024px）与窄桌面窗口（鼠标指针，如 900×700 分屏）**：与禁用插件时对照，**任何宽度**都不许有
  布局或交互变化——指针门让键鼠窗口在 1024px 以下也保持桌面形态（headless：这些场景**不要**开触摸仿真）。
  唯一例外（v2.4.1）：宽触屏（≥1024px、pointer coarse，如横屏平板）会拿到注入的「删除会话」项 + 确认
  弹层（session-delete 探针场景 16a-16d）；键鼠窗口仍必须一个都没有（场景 15c/15d）。

手机端调试加 `?mobile-nav-debug=1`，显示实时 viewport、frame/标记、浮层与捕获到的 JS 错误状态。可选的
`pnpm smoke:cdp` 是定点冒烟探针，**不能替代**真实 profile 验收。

## 设备仿真与 CDP 配方

- **设备仿真优先用 Playwright MCP，脚本化回归走原生 CDP**（`playwright-core` 在 android 抛
  `Unsupported platform`，仓库内脚本一律原生 CDP）。MCP 配方：新
  `browser.newContext({ viewport: 390x844, isMobile: true, hasTouch: true })` + 复制 cookie + 写
  `localStorage['dsh.sessions.current']`；**被桌面布局隐藏的元素用
  `document.querySelector(sel).click()`**（`page.click()` 可见性检查必失败）。完整步骤/坑 →
  `docs/maintenance/pitfalls.md` §探针运行环境。
- Playwright 验证必须用**全新 browser context** + `addInitScript` 写
  `localStorage['dsh.sessions.current']`；复用长活 context 会出现「fence-only」假象。点 backdrop 关抽屉
  要点抽屉右侧露出区域（`page.mouse.click(x,y)`）。细节见 `docs/maintenance/pitfalls.md` §探针运行环境。
- **不要**用 Playwright route 拦截插件 `client.js` 并 fulfill 空 body 做 A/B 实验：空响应被缓存后 boot 会
  报「loaded without registering」并挂起。A/B 用 `git show <commit>:lib/client.js > lib/client.js` 换文件。
- **Termux 上 headless chromium 必须给可写的 `TMPDIR` 与 `XDG_RUNTIME_DIR`**（指到 `~/tmp` 下自建
  目录），否则 ProcessSingleton 建 socket 失败、CDP 端口永不上线。完整命令与 cookie TTL →
  `docs/maintenance/pitfalls.md` §探针运行环境。

## 真机读数通道（2026-09-14）

`?mobile-nav-debug=1` 除页面徽章外，还把同一份读数 POST 到本机监听器（默认
`http://127.0.0.1:3199/diag`，`?beacon=<url>` 可覆盖）——「看不到设备屏幕」时用它取证。payload 字段
（`build`/`framePad`/`rightPanel`/各 rect/UA/visualViewport）与本地监听服务搭法见
`docs/maintenance/pitfalls.md` §探针运行环境。

## 认证与第三方版本口径

- **认证 token 向用户索要（用户要求，2026-09-21）**：需认证访问本机 dsh web 时先向用户要 token
  （重启输出的 `?token=…` URL 即可用），不要自行跑 `.local-tests/mint-cookie.mjs` 铸 cookie。
- Validate compatible third-party versions：**判据是 `~/.dsh/profiles/web/cordis.patch.yml` 的行启用
  状态，不是 node_modules 里装没装**；包在树里 ≠ DOM 在场。当前实装：`dsh-web-mobile`、
  `@dsh-external/seshat`、`@linxin666/dsh-web-all`（仅 git-graph 行）。行状态变更后先重跑
  `docs/debug/settings-market-debug-map.md` §5。
- **未安装的第三方插件不做实机复现（用户要求，2026-09-22）**：修复目标插件本机从未安装时，验证止步于
  静态对账 + 单元锚 + 报障者实测数据交叉验证，不装插件、不上机索 token；用户装好后主动要实机验收再说。
- **外部贡献合并前必须过「与既有体系冲突」检查**（#47 教训）：外部贡献者不知道仓库已有什么。合并
  fork/PR 前先盘点同域既有机制（viewport 所有权、16px 下限、手势让位、marker 契约清单、composer 固定
  控件三件套），逐一判断冗余/冲突/互补；冗余砍掉、冲突以仓库体系为准、互补才并入。
