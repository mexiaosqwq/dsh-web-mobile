# Requirements Document — 移动端图片上传入口（视图功能）

## Introduction

DSH Web UI 的移动端输入框没有任何图片上传入口：桌面端靠拖拽文件进输入框（0.1.1-rc.2 起图片草稿即走此通道），触屏设备无法拖拽，因此在 DSHA 以外的纯 WebUI 里用户无法把屏幕截图发给 AI 识别。本功能在移动端输入框左工具行新增一个「上传图片」按钮，通过系统相册/文件选择器选图，把图片送入宿主原生图片草稿通道——缩略图预览、消息内嵌图、模型视觉输入全部由宿主原生链路承担，插件只补「入口」。

## Glossary

- **宿主 Host**：DeepSeek Harness Web UI（`@deepseek-ai/dsh` 网页前端，目标分代 0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.2）
- **插件 Plugin**：本仓库 dsh-web-mobile（fork multielement）
- **移动端 Mobile**：`MOBILE_QUERY = '(max-width: 1023px) and (pointer: coarse)'`
- **图片草稿 Image draft**：浏览器端待发送的图片附件（宿主约定：发送时以图片内容块进入提示词）
- **收件通道 Intake path**：宿主 `conversation.input.attachments` 槽位的 onAddImages / onAddFiles 入口，由宿主 document 级 drop 监听器驱动
- **合成投放 Synthetic drop**：插件在 document 上派发携带 DataTransfer（含 Files 类型）的合成 drop 事件，触发宿主的原生收件监听器

## Requirements

### R1 移动端图片上传按钮

**User Story:** 作为手机用户，我想在输入框左工具行点「上传图片」按钮，以便从系统相册/文件选择器选图发送给 AI 识别。

#### Acceptance Criteria

1. WHEN 移动端会话输入框渲染，插件 SHALL 在 `conversation.input.left` 槽位注入一个「上传图片」按钮
2. WHEN 用户点按该按钮，插件 SHALL 打开系统图片选择器（`accept="image/*"`，支持多选）
3. WHEN 用户在桌面视口（`pointer: fine` 或视口 ≥1024px）打开会话，插件 SHALL 不渲染该按钮
4. WHEN 宿主不提供 `conversation.input.left` 槽位，插件 SHALL 保持惰性（不报错、不注入）

### R2 图片送入宿主收件通道

**User Story:** 作为手机用户，我想选中的图片进入宿主的图片草稿附件栏，以便按宿主既有流程发送。

#### Acceptance Criteria

1. WHEN 用户完成选图，插件 SHALL 将所选图片文件送入宿主收件通道（document 级 drop 合成事件）
2. WHEN 所选文件包含非图片类型，插件 SHALL 过滤非图片文件，仅投放 `image/*` 文件
3. WHEN 所选文件全部为非图片类型，插件 SHALL 不投放任何事件
4. WHEN 宿主收件通道拒绝接收（会话忙碌、子代理输入等），插件 SHALL 静默无副作用，不报错

### R3 缩略图与消息内嵌显示

**User Story:** 作为手机用户，我想看到选中的图片以缩小版预览显示在输入框附件栏、发送后以内嵌缩略图显示在对话里。

#### Acceptance Criteria

1. WHEN 图片草稿进入附件栏，宿主 SHALL 以缩小版图片预览显示该草稿（非文件格式条目）
2. WHEN 含图片草稿的消息发送，宿主 SHALL 在消息中以内嵌图片渲染该图片
3. WHEN 移动端视口渲染消息内嵌图片，插件 CSS SHALL 约束图片宽度不超过消息容器宽度

### R4 模型识别

**User Story:** 作为手机用户，我想 AI 收到图片内容并识别界面，以便不用 ADB/无障碍直接指导操作。

#### Acceptance Criteria

1. WHEN 含图片草稿的消息发送，宿主 SHALL 将图片作为消息图片内容块提供给模型
2. WHEN 已配置支持视觉的模型，模型 SHALL 收到图片内容并识别
3. IF 模型不支持视觉，宿主 SHALL 按既有策略降级（文本模型收到「图片已省略」提示），插件不干预

### R5 宿主分代兼容

**User Story:** 作为维护者，我想该功能在 0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.2 三代宿主上工作，以便不依赖宿主升级。

#### Acceptance Criteria

1. WHEN 宿主为 0.1.1-rc.2（仅 drop 收件、图片专用 onAddImages），插件 SHALL 通过合成 drop 事件送达图片
2. WHEN 宿主为 0.1.2-rc.1 或 0.1.5-rc.2（drop 收件 + onAddFiles），插件 SHALL 通过同一合成 drop 事件送达图片
3. WHEN 运行环境不支持 DragEvent 构造器带 dataTransfer，插件 SHALL 回退到 initDragEvent 路径
4. IF 两条构造路径均不可用，插件 SHALL 静默放弃投放
