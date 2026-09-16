# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[推送提交需逐步说明]
- Date: 2026-09-16
- Context: 用户要求推送全部更新到仓库时提出
- Instructions:
  - 每次向仓库推送更新时，向用户逐步说明每一步操作及其结果
  - 仓库 README 需持续保持：Fork 来源声明（fork 自 mexiaosqwq/dsh-web-mobile，由 multielement 维护）、本 Fork 的改动说明、免责声明（违规违法内容可经 GitHub Issues 联系删除）
  - 新功能开发按规范走 .monkeycode/specs/<feature>/ 流程（requirements.md → design.md → tasklist.md）
