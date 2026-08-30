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

- **侧栏变抽屉**：手机竖屏下侧栏收进 overlay 抽屉，会话区全宽，点会话行自动收起；屏幕左缘右滑呼出、抽屉内右滑收起
- **弹窗变浮层**：设置、文件树、预览改成底部 sheet，触屏好点
- **状态栏避让**：刘海安全区、深/浅主题、双击缩放都处理
- **输入区不打架**：权限胶囊、模型名、切换菜单在窄屏下不重叠
- **长会话不卡流量**：宿主返回的大 JSON（会话历史等）自动 gzip/brotli 压缩，手机端加载明显提速
- **平板也管**：768–1023px 限宽居中；桌面 ≥1024px 完全 no-op
- **诊断方便**：`?mobile-nav-debug=1` 显示悬浮诊断条（视口 / 浮层状态 / JS 错误）

---

## 效果

| 会话主页 | 目录抽屉 | 设置界面 |
| --- | --- | --- |
| ![移动端会话主页](assets/hero.png) | ![目录抽屉](assets/drawer.png) | ![移动端设置界面](assets/settings.png) |

## 安装

> [DSHA](https://github.com/qiannianhuanxiang/DSHA) 用户无需单独安装：DSHA 已内置本插件，装 APK 即用。

从 npm 一行装：

```sh
dsh plugin --profile web add dsh-web-mobile
```

仓库自带构建产物，无 `allowBuilds` 拦截。装完重启 `dsh web`。

> 包名说明：2026-08-30 起 npm 包名由 `dsh-mobile-nav` 更名为 `dsh-web-mobile`（与 GitHub 仓库名统一，旧 npm 名已整包撤下）；更早的 `@dsh-external/dsh-mobile-nav` 亦不复存在。装过旧版的用户请**先移除再装新名**（patch 行 id 随包名一起换了，新旧并存会把同一插件注册两份）：
>
> ```sh
> dsh plugin --profile web rm dsh-mobile-nav      # 2.1.x 及更早的装法键名是 @dsh-external/dsh-mobile-nav，同样先 rm
> dsh plugin --profile web add dsh-web-mobile     # GitHub 直装：dsh plugin --profile web add github:mexiaosqwq/dsh-web-mobile
> ```
>
> 不迁移的后果分路线：npm 装法留下死依赖，profile 里后续任何插件安装/更新都会 404；GitHub 直装拉到新代码后，旧键名与包内新名失配，重启 `dsh web` 时该插件加载失败。两种路线都是 `rm` 旧键名即解。

本地开发：

```sh
dsh plugin --profile web add link:/path/to/dsh-web-mobile
```

## 更新内容

### v2.3.0

**新功能**

- 侧边栏手势（#16，PR #37 by @wingsky-1）：屏幕左侧 45% 区域右滑呼出侧边栏,同样的可以左滑关闭,该PR功能本人做了一些“微调”

**优化**

- 流式输出时的每帧开销：状态栏 TPS 读出走锚点快路径、市场已安装列表按帧合并且市场未打开时直接跳过，不再全树扫描
- 抽屉会话树屏外部分跳过渲染，会话数多了以后抽屉依旧轻快

**修复**

- 手势打开侧边栏后点背板要点两次才关
- 手势后短时间内真实点按（如点会话行）偶尔无响应
- 滑动开侧边栏偶尔没反应或开了又弹回
- 真机（Android Chrome）贴左缘右滑呼出侧边栏会触发浏览器「返回上一页」：根元素 `overscroll-behavior-x: none` 抑制 Chrome 边缘历史导航手势
- 起指落在横向滚动容器（状态栏读出条、消息代码块）内时让位给原生滚动，不再误开侧边栏
- 系统开启「减弱动态效果」时侧边栏仍播放滑入滑出动画，现与设置面板一致直接禁用
- `?mobile-nav-debug=1` 诊断条在代码重组后没有接线，访问调试参数无任何显示

**重构**

- 侧边栏手势的左缘识别区改为纯几何判定：按视口宽度 45% 现算（390px 手机约 176px），横竖屏与平板自动跟随，不再注入宿主 DOM 的隐形热区元素

**兼容**

- 适配 dsh 0.1.2-alpha.1（会话日志下载接口两代类型并存）
- peer 依赖范围放宽到 0.1.2 预发布版，缺失的 UI peer 改为可选

### v2.2.0

**修复**

- 修复 v2.1.5 版本安装后 node 报错问题，绷不住了（#31 by @Yurzi）
- 手机上点抽屉历史会话仍可能「抽屉收起但对话不打开」（#32 by @chstd）
- 上游子代理插件 0.1.0-rc.6 起芯片「点开一闪即退」（PR #33 by @EricJin2002）
- 手机端点插件市场搜索框触发 iOS 强制放大且无法恢复：搜索框字号提到 16px（PR #35 by @BuvkB）
- 刘海屏上界面能被上滑抬起、输入框下方露白、最新消息被压住

### v2.1.5

**新功能**

- 大 JSON 响应透明压缩，减少流量消耗（移植自 fork wzxmt-zhc/dsh-web-mobile v2.5.0）

**修复**

- 顶部子代理 UI 弹出卡片点按不稳定，现可靠开合
- 触摸点选会话后抽屉正常自动收起
- 输入区右侧模型条、上下文圈、发送键固定贴近右侧，不再漂移
- dsh-web-ui 设置页错误显示

### v2.1.1

**修复**

- 设置「模型分组」区在手机上卡片宽窄不一、首尾卡超出屏幕右缘
- 后台任务触发器存在时，正在运行的子代理计数不准确
- 移动端会话头部标题栏布局异常，隐藏多余的路径分隔符
- 手机上打开插件市场后设置导航被隐藏、无路可退（dshmarket ≥1.20 反制）
- 市场 Tasks 弹卡贴边不居中；出现待更新按钮时标题行被压成逐词竖排
- 输入区发送、加号、上下文按钮窄屏下被挤压漂移，现固定尺寸钉位
- viewport meta 改写保留宿主 maximum-scale，页面缩放行为与官方一致

**优化**

- 插件 dsh-meme 移动端表现
- Agent preset 模式选择菜单改为底部弹层，不再撑满竖屏
- 适配最新 dshmarket 移动端 UI（卡片画廊、已安装列表、标签头部）

**重构**

- 完成 phase 2-4 代码重组，优化 !important 使用
- 哈希类选择器全量改为子串匹配并补 `:not` 守卫，救活一批静默失效的规则（PR #27/#28 系列）

## 兼容插件

- [dsh-web-ui](https://www.npmjs.com/package/@linxin666/dsh-web-ui-all)——**0.1.20**
- [dshmarket](https://www.npmjs.com/package/dshmarket)——**v1.20.2**
- [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)——**0.2.10**
- [dsh-genui](https://github.com/omdsh-dev/dsh-genui)——**0.9.1**
- [dsh-meme](https://github.com/mexiaosqwq/dsh-meme)——**v0.1.39**

## 构建

```sh
pnpm install
pnpm build
```

`lib/` 与源码同步入库，改动源码后重新构建再提交。

## License

[MIT](LICENSE)
