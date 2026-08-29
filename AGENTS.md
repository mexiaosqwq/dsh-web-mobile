��的 TMPDIR 与 XDG_RUNTIME_DIR**（spawn env 指到 `~/tmp` 下自建目录），否则 ProcessSingleton 建 socket 失败报「Failed to create a ProcessSingleton」直接退出、CDP 端口永不上线。临时脚本与截图放 `~/tmp/` 用完清理；视觉工具（vision_glance/describe_image）只接受 workspace 内路径且依赖外部视觉凭证（401=凭证失效，别硬重试）。
- Validate compatible third-party versions when exercising integrations: `@linxin666/dsh-web-ui-all` 0.1.20, `dshmarket` 1.20.2, `dsh-usage-stats` (github), `@omdsh-dev/dsh-genui` (github)。以 `~/.dsh/profiles/web/package.json` 实装为准，升级后回来对账。

## Maintenance

- This file is a living reference. Whenever you discover a new repo-specific command, convention, or pitfall, update it in place.
- Keep it accurate and concise; remove stale entries as the codebase changes (e.g. removed features, renamed files, new scripts).
- Verify claims against source before writing them; do not preserve guidance that no longer matches the current tree.

- **流式期插件每帧热点的性能契约（2026-08-29，抽屉卡顿排查收尾）**：三个已落地优化——① stats-line 快路径：`statsAnchorAlive(el)`（纯判定，tests/stats-line-fastpath.test.ts）锚点仍在位（isConnected + [data-phase] 内 + composerStack 内）时 O(1) 返回；失位必须先摘旧标记再回落慢路径，scopes 仍须 `["*"]`。② installed-list 观察者经 `core/raf-scheduler.ts`（createRafScheduler，零 import 可测）rAF 合并，flush 时重验 mq 防桌面误写，dispose 必须 cancel。③ 抽屉会话树 `content-visibility: auto`（misc.css.ts，`[data-mobile-nav="frame"] > :first-child [role="tree"]` + `contain-intrinsic-size: auto 600px`）——屏外挂载与流式期跳过树 layout/paint。真会话差分实测（2026-08-29 补正）：抽屉树仅 15 行会话时该规则无可测收益（hero 相位早前的 104→66ms 系单轮噪声，cvOn/cvOff 差异在噪声内），保留仅作为会话数增大后的渐进增强，无成本。arm-open 冻结主因＝宿主 React 互斥子树同步挂载（rail 79→drawer 389 节点，4x 节流下 308ms longtask / rAF 间隙 225ms），插件 CSS 只能消 layout/paint 份额，治本在宿主（挂载分帧或双子树常驻）。测量方法论：这版 chromium trace 无 RunTask 事件，用最大 FunctionCall 锚点 + 功能族归因；窗口求和会混入后台线程 GC 事件，主线程结论只看 biggestJs。

- **宿主 Shiki 高亮止血 patch（2026-08-29，B 方案）**：`tokenizeTimeLimit:0`（单块不限时）→ `100`ms，消除大 code 块高亮尖刺。文件：`~/../usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-ClqxG24t.js`（宿主前端是独立依赖 dsh-web-frontend 的 dist，发布包内无源码）。重放命令（宿主升级后，文件名 hash 可能变化，先 `grep -rl tokenizeTimeLimit` 重新定位）：`cp <file> ~/dsh-mobile-nav/.local-tests/<name>.bak-pre-shiki && sed -i "s/tokenizeTimeLimit:0/tokenizeTimeLimit:100/" <file>`。备份在 `~/dsh-mobile-nav/.local-tests/index-ClqxG24t.js.bak-pre-shiki`（恢复即还原）。已验证：served 生效 + 真 6.8MB 会话 boot 正常 phase=active；超时降级行为（超预算块变纯文本、内容完整）未在真块上实测——真机若见个别块无语法色即此降级，属预期，可调大数值。
