![dsh-web-mobile — 手机上也能好好用 DSH](assets/banner.png)

<p align="center">
  <strong>DSH Web UI 移动端适配：窄屏好用，宽屏适用</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/topic-dsh--plugin-amber?style=flat-square" alt="dsh-plugin" /></a>
  <a href="https://awesome-dsh-plugin.com/p/mexiaosqwq/dsh-web-mobile/"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="awesome · DSH plugin" /></a>
</p>

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

从 GitHub 一行装：

```sh
dsh plugin --profile web add github:mexiaosqwq/dsh-web-mobile
```

仓库自带构建产物，无 `allowBuilds` 拦截。装完重启 `dsh web`。

本地开发：

```sh
dsh plugin --profile web add link:/path/to/dsh-web-mobile
```

## 更新内容

### 未发布（v2.2.0 之后）

**新功能**

- 侧边栏抽屉手势（#16，PR #37 by @wingsky-1）：屏幕左缘右滑呼出抽屉、抽屉内容区右滑收起。

**修复**

- 手势打开抽屉后点背板要点两次才关
- 手势后短时间内真实点按（如点会话行）偶尔无响应
- 滑动开抽屉偶尔没反应或开了又弹回
- `?mobile-nav-debug=1` 诊断条在代码重组后没有接线，访问调试参数无任何显示
- 系统开启「减弱动态效果」时抽屉仍播放滑入滑出动画，现与设置面板一致直接禁用

**重构**

- 抽屉手势的左缘识别区改为纯几何判定（48px），移除注入宿主 DOM 的隐形热区元素

**兼容**

- 适配 dsh 0.1.2-alpha.1
- peer 依赖范围放宽到 0.1.2 预发布版

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
