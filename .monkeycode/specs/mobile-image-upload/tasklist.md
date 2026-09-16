# mobile-image-upload 实施任务清单

Feature Name: mobile-image-upload
Updated: 2026-09-16

- [x] T1 纯核 `src/client/core/image-intake.ts`：图片过滤（image/* MIME）、合成 drop 事件暂存（DataTransfer 注入构造、DragEvent 主路径 + initDragEvent 回退、全路径失败静默放弃），零 import
- [x] T2 槽位组件 `src/client/components/MobileImagePicker.tsx`：`conversation.input.left` 注册、回形针图标按钮（`aria-label`/`title` 走 i18n）、动态 `<input type=file accept="image/*" multiple>` 选择器、change 后派发合成 drop 并移除 input
- [x] T3 入口注册 `src/client/index.tsx`：`ctx.slots.inject('conversation.input.left', ...)`，id `mobile-nav-image-picker`，order 10
- [x] T4 i18n `src/client/i18n/locales.ts`：zh `uploadImage: '上传图片'` + en `uploadImage: 'Upload image'`
- [x] T5 样式 `src/client/styles/misc.css.ts`：移动块内 28px 按钮几何 + 防收缩 pin（对齐 `_add` 豁免）+ 按压反馈；桌面隐藏块清单追加 `[data-mobile-nav="image-picker"]`
- [x] T6 单测 `tests/image-intake.test.ts`：8 用例（分类 / 暂存内容与事件参数 / 全非图 null / 无 DataTransfer null / 构造抛错回退 / 主路径 null 回退 / 双路径失败 null）
- [x] T7 门禁：`pnpm verify`、`pnpm test:core`（95/95）、`pnpm build`（lib 刷新）、`git diff --check`
- [x] T8 文档：AGENTS.md（3 槽位、测试计数）、README（功能条目 + 本 Fork 改动 + v2.5.0）、需求/设计文档入库
- [ ] T9 真机验证（待用户设备）：按钮在场 → 选图后附件栏出现缩略图 → 发送后消息内嵌图 → 多模态模型可描述图片；0.1.1-rc.2 宿主走 drop-only 路径复核
- [ ] T10 消息内嵌图宽度约束（R3-AC3）：宿主原生 MessageImage 若在窄屏溢出，按实测 DOM 补结构性 CSS
