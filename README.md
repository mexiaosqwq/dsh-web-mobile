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

### v3.1.0 (兼容 0.1.7-rc.1 及以后)

- 顶栏座位重做、性能第一批与补丁秩序上线
- 这也是第一次大规模重构：TS / JS 源文件拆得更工整，随之而来的是更顺手的后续维护

**新功能**

- 自定义 API 里声明不支持自定义思考强度的模型自动归入「跟随模型默认」，不再因强行写入档位而报错
- 兼容补丁登记门禁：每个补丁必须自报用途与对应测试，登记表与源码不一致时构建直接失败

**修复**

- 状态栏 TPS 读数有时停在旧宽度——纯文本更新唤不醒排版任务
- 侧边栏面板退出途中出错时，屏幕上会留下一张永不自清的全屏快照
- 快速重进面板时，上一次退场的清理会误删这一次刚挂上的快照
- 市场「已安装」列表的行样式在列表根节点换代的宿主上可能整列表静默漏写
- TPS 缺席时状态行的多余全表扫描（改为可短路）
- 顶栏拥挤的几处：后台任务圆点移入标题行、子智能体 chip 钉在标签行右端、长标题改省略号且可展开、预设 chip 不再贴住邻居
- 顶栏、TPS 读数、模型菜单、回形针浮层各自反复读尺寸的问题——合并到每帧一次，滚动与流式输出更顺
- 市场「已安装」列表每帧重复定位整个列表容器——现在缓存容器、只在容器内扫描
- 本批手机档改动收进 ≤767px 作用域，平板档几何与本批之前零差异

### v3.0.6 (兼容 0.2.0-rc.1 / rc.2)

- 移动端交互、布局与性能整批修复：会话行单击切换、文件面板工具栏、0.2.0 会话头部、推理等级面板宽度、流式状态条去重、深色顶栏衔接、上下文环落位。0.1.x 全线照常支持，0.1.6-alpha.2 建议维持 3.0.0、0.1.5 之前仍建议 2.4.1。

**新功能**

- 回形针「上传附件」接上 App 的文件选择通道（桥优先，无桥回落系统选择器）
- 会话行的归档 / 置顶快捷按钮在手机档收进 ⋯ 菜单（#154）

**修复**

- 与 dsh-pocket 同装时不再因 locale 命名空间重名把整站启动打挂（#165）
- 会话行单击即可切换，并修掉随之而来的重复选中
- 文件面板在手机档固定只留「收起右侧边栏」，分栏与退出全屏不再误触
- 0.2.0 的会话头部标题不再压到左上角开关上
- 子代理运行时的停止键与发送键贴回右缘（#191）
- 抽屉底色跟随宿主主题，暗色下不再发白（#192）
- 底部安全区补齐：769–1023px 触屏设备的会话内容不再压进系统手势条（#193）
- 流式输出期间状态条的重复读写收敛（#194）
- 设置面板遮罩淡入恢复正常（此前一条非法选择器让整条规则被静默丢弃）
- 竖屏下 mattskills 状态栏胶囊的尾巴（技能 ⊞ / 收起 ⌄）不再被裁掉
- 手机上的推理等级面板收窄到内容宽度，不再占掉半屏
- 正在输出时输入内容，上下文环不再压住停止键
- 深色下会话头部与页面底色一致，顶部不再出现一条突兀的灰带（#176）
- 文档预览与插件页一批：屏外代码行不再参与布局、插件条目整卡可点、Models 页模型行不再被超长 chip 挤成竖条

### v3.0.5 (兼容 0.2.0-rc.1 / rc.2)

- 自定义 API 的模型开箱可选思考等级，并收掉一批手机端交互问题：0.1.x 全线照常支持，0.1.6-alpha.2 建议维持 3.0.0、0.1.5 之前仍建议 2.4.1。

**新功能**

- 自定义 API 的模型开箱可选思考等级：手写的供应商模型不必再逐条补档位配置，官方「推理等级」控件直接可用（默认给出 off / low / medium / high / max，只补用户自己层里没写档位的模型、不覆盖已写档位）
- 手机上的文件分享入口：文件树行尾与预览头部各一个按钮，可一键把文件送出去；当前环境不支持系统分享时（如内置 WebView），按钮如实显示为「下载「x」」并走系统保存流程，不拿「分享」二字骗人

**修复**

- 删除会话不再误报失败：宿主先把会话落库、随后把响应掐断时，改以会话列表为准判定结果
- 模型与推理等级菜单在手机上不再自动弹出软键盘（点搜索框仍然照常输入）
- 回形针两选项浮层不再「弹一下」：定位稳定后再显形
- 第三方模型档位面板在手机上不再移出屏幕（#152 by @BuvkB）
- iOS 输入框不再沉到系统辅助条下面（#149, PR #150）
- 长按选区拖拽手柄不再把视口带到会话顶部，并落地一批手机端修复（PR #155）

## 兼容插件

下列版本为**实装并验证过**的版本（判据是 profile `cordis.patch.yml` 的行启用状态——包在 `node_modules` 里 ≠ 插件生效；profile 用 `^` 范围会静默升 minor，升级后重新对账）。

- [@linxin666/dsh-web-all](https://www.npmjs.com/package/@linxin666/dsh-web-all)——**0.3.20**
- [@linxin666/dsh-client-ui-market](https://www.npmjs.com/package/@linxin666/dsh-client-ui-market)——**0.3.20**
- [@ychris12138/dsh-usage-stats](https://www.npmjs.com/package/@ychris12138/dsh-usage-stats)——**0.3.1**
- [@changfenhuang/dsh-genui](https://www.npmjs.com/package/@changfenhuang/dsh-genui)——**0.10.0**
- [dsh-meme](https://www.npmjs.com/package/dsh-meme)——**0.1.39**
- [dsh-file-viewer](https://www.npmjs.com/package/dsh-file-viewer)——**未安装**（0.3.1 时期验证过布局兼容，装回后需复验）

**与 dsh-pocket 同装**：[dsh-pocket](https://github.com/shaobeichen/dsh-pocket) 内嵌了本插件的移动端适配副本（`client/mobile/`，保留 `mobileNav` 命名空间）。与 3.0.5 及更早版本同装时，两者抢同一个 locale 命名空间会让本插件注册抛错、进而把整个 Web 端打成错误页（#165；桌面宽屏不受影响，因为它的移动端适配在 desktop 下会提前 return）。此后版本改用独立命名空间，崩溃不再发生，但两套移动端适配仍会同时生效——**建议二选一**，或给 dsh-pocket 传 `?dsh-layout=desktop` 让它让位。

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
