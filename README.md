![dsh-web-mobile — 手机上也能好好用 DSH](assets/banner.png)

<p align="center">
  <strong>DSH Web UI 移动端适配：窄屏好用，宽屏适用</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/topic-dsh--plugin-amber?style=flat-square" alt="dsh-plugin" /></a>
  <a href="https://awesome-dsh-plugin.com/p/mexiaosqwq/dsh-web-mobile/"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="awesome · DSH plugin" /></a>
</p>

> 📦 **已内置于 [DSHA](https://github.com/qiannianhuanxiang/DSHA)** —— DeepSeek Harness 安卓启动器把本插件作为内置移动端适配，装 APK 开箱即用。感谢作者 [@qiannianhuanxiang](https://github.com/qiannianhuanxiang) 的集成与推广 🙏

---

**dsh-web-mobile** 是 DeepSeek Harness Web UI 的移动端适配插件——让 DSH 在手机竖屏下也能好好用：

- **弹窗变浮层**：设置、文件树、预览改成底部 sheet，触屏好点
- **状态栏避让**：刘海安全区、深/浅主题、双击缩放都处理
- **输入区不打架**：权限胶囊、模型名、切换菜单在窄屏下不重叠
- **长会话不卡流量**：宿主返回的大 JSON（会话历史等）自动 gzip/brotli 压缩，手机端加载明显提速
- **平板也管**：768–1023px 触屏设备限宽居中，≥1024px 触屏大平板的会话行 ⋯ 菜单仍带「删除会话」；桌面端（鼠标指针）任何宽度都是完全 no-op，窄窗口/系统缩放也不会误启移动 UI

---

## 效果

| 会话主页 | 目录抽屉 | 设置界面 |
| --- | --- | --- |
| ![移动端会话主页](assets/hero.png) | ![目录抽屉](assets/drawer.png) | ![移动端设置界面](assets/settings.png) |

## 更新内容

### v3.0.4 (兼容 0.2.0-rc.1 / rc.2)

- 兼容声明修正 + rc.2 时代移动端修复合集：0.1.x 全线照常支持，0.1.6-alpha.2 建议维持 3.0.0、0.1.5 之前仍建议 2.4.1。

**修复**

- peerDependencies 补声明 0.2.x、移除已失效的 `dsh-client-runtime` peer（#145 by @IPF-Sinon）：0.2.0-rc.2 宿主实测一直正常，现在声明与实际一致，npm 不再误报不兼容
- 进入会话不再自动弹软键盘，ContextMeter 环径与触摸命中盒按真机验收校准（#140 by @FanetheDivine）
- ContextMeter 环道色跟随宿主主题，暗色下不再退化成「残缺加载圈」（#142 by @nanami-0713）
- 快捷键弹层手机端一批（PR #122/#123/#125/#128 by @133563825as-ai）：crumb 不再压住 FAB、排版错位与开合抖动修复、不再被插件抽屉带压住、打开不再全屏闪、卡片不随软键盘改大小、手机档收掉弹层搜索行、团队 chip 图标居中
- 设置面板入场滑入替代淡入，消除入场闪烁（#124, PR #126）

### v3.0.3 (兼容 0.1.7-rc.1 / rc.2)

- 3.0.1 / 3.0.2 只有 tag 与 GitHub Release、从未发布 npm，两个版本的内容全部并入本版：npm 用户从 3.0.0 直升即得全部改动。宿主 0.1.6-alpha.2 建议维持 3.0.0、0.1.5 之前建议 2.4.1。

**新功能**

- 会话删除端点安全加固（#114, PR #117）：跨源请求一律 403（Origin 同源校验）、请求体上限 1 MiB（超限 413）、删除改走 `.sessions-trash` 回收站——删除的会话先改名再整目录移入回收站，`manifest.json` 记录恢复映射（零解压可还原），超过 24 小时的回收站条目在下次删除时顺带清理
- 宿主图标跨代兼容（PR #88/#89 by @133563825as-ai）：宿主 rc 代与 0.1.7 代的图标导出名互不相交，写死任何一代都会白屏，新增运行时取用层两代通吃
- DSHA（Android 启动器）内置适配层落地（PR #81）：装 APK 即用，无需单独安装本插件

**修复**

- 加号菜单三连（PR #88/#89 by @133563825as-ai）：加号「再点关闭」恢复可关；点加号不再把软键盘顶起导致第二击落空；点两下后输入框永久失焦、键盘再也弹不出来的问题修复
- 输入区与头部批（PR #90–#99）：模型菜单锚定/居中修正、点开时才发请求；模式与预设 chip 的 caret 方向、按压反馈；行内 pill 不再出现两个；谱系 chip 基线对齐；触屏点按高亮治理
- 「再点关不掉」两处 + 层带（#102 by @133563825as-ai）：工作区 chip 与智能体团队 chip 第二击恢复关闭；全屏右侧面板不再压住悬浮球（唯一的返回入口）；头部右侧留白 26 → 10px
- 设置区批：开关不再被拉成整行宽、内容区不再横向溢出 36px、会话头部页签条收紧 77 → 67px（PR #88/#89）；0.1.7 紧凑行重设计适配（#111, PR #109）；工具栏改纯 CSS 锚定、两个 reparent 任务删除（#105, PR #107）；手机档魔数收口进手机 media、平板档 768–1023px 回上游排布（PR #88）
- 会话菜单与删除：0.1.7 宿主会话菜单再换形适配（菜单项识别跟随新形态、归档行不再误注入删除项、删除确认卡重设计为居中毛玻璃卡、点遮罩才关）；删除活跃会话在清理阶段失败时如实改报并补 workspace 记账，不再误报可重试（#115, PR #117）
- 0.1.7-rc.2 弹窗回归（PR #116 by @BuvkB）：宿主把设置弹窗 portal 到 body 后插件整族规则失效——设置导航恢复单行横滚、右上角工具栏不再遮挡内容且 ✕ 扩大热区、市场 byline 恢复单行、市场页顶恢复留白
- 其余修复：模型选择 chip 窄屏分档（#101, PR #108/#109）；stats 环在离线会话不再残留（#104, PR #106）；第三方 thinking-effort 插件座位冲突（#60, PR #87）；抽屉长按误触（#82, PR #83）与抽屉弹层层带（PR #85）；面板头部按钮净空（PR #77 by @133563825as-ai）；usage-stats 面板层级（PR #75）；响应压缩写回调顺序与 end 参数（#80, PR #79 by @nanami-0713 / PR #86）；样式 effect 热重载先删旧表再挂新表，不再残留旧样式

**兼容与安全**

- 0.1.7-alpha.2 静态对账 28 条：插件代码 0 处需改（PR #88/#89 配套审计）
- js-yaml 升至 4.3.2（GHSA 安全通告，PR #74）


## 兼容插件

下列版本为**实装并验证过**的版本（判据是 profile `cordis.patch.yml` 的行启用状态——包在 `node_modules` 里 ≠ 插件生效；profile 用 `^` 范围会静默升 minor，升级后重新对账）。

- [@linxin666/dsh-web-all](https://www.npmjs.com/package/@linxin666/dsh-web-all)——**0.3.20**
- [@linxin666/dsh-client-ui-market](https://www.npmjs.com/package/@linxin666/dsh-client-ui-market)——**0.3.20**
- [@ychris12138/dsh-usage-stats](https://www.npmjs.com/package/@ychris12138/dsh-usage-stats)——**0.3.1**
- [@changfenhuang/dsh-genui](https://www.npmjs.com/package/@changfenhuang/dsh-genui)——**0.10.0**
- [dsh-meme](https://www.npmjs.com/package/dsh-meme)——**0.1.39**
- [dsh-file-viewer](https://www.npmjs.com/package/dsh-file-viewer)——**未安装**（0.3.1 时期验证过布局兼容，装回后需复验）

## 安装

> [DSHA](https://github.com/qiannianhuanxiang/DSHA) 用户无需单独安装：DSHA 已内置本插件，装 APK 即用。

从 npm 一行装（仓库自带构建产物，无需构建配置），装完重启 `dsh web`：

```sh
dsh plugin --profile web add dsh-web-mobile
```

> **旧版迁移**：装过旧名 `dsh-mobile-nav`（更早为 `@dsh-external/dsh-mobile-nav`）的用户请**先移除再装新名**——`dsh plugin --profile web rm <旧键名>`；patch 行 id 随包名一起换了，新旧并存会把同一插件注册两份，不迁移也会留下死依赖或加载失败。

GitHub 直装：`dsh plugin --profile web add github:mexiaosqwq/dsh-web-mobile`

本地开发：

```sh
dsh plugin --profile web add link:/path/to/dsh-web-mobile
```

## 构建

```sh
pnpm install
pnpm build
```

`lib/` 与源码同步入库，改动源码后重新构建再提交。

## 贡献与工程

欢迎大家的 issue 和 PR，我会尽可能地进行解决!

工程约定见 [AGENTS.md](AGENTS.md)；回归探针 `scripts/probes/` 22 个锚点可单跑，兼作宿主升级绊线。

## License

[MIT](LICENSE)
