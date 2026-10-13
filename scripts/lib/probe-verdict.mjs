// 探针公共收口：PASS / FAIL / SKIP / BASELINE 四类计数 + 退出码。
//
// 为什么单独一个文件（C11–C13 共用）：这些探针此前各自 `process.exit(0)`，
// 断言失败只打印 OBS/FAIL 却不影响退出码 —— 绿退出被当成"全部断言绿"。
// 统一收口后，规则只有三条：
//   1. **必需断言失败 ⇒ exit 非零**（失败数 > 0 ⇒ 1）；
//   2. SKIP（可选/惰性未执行）**不计 PASS**，也**不能**用来声称完整验收通过；
//   3. BASELINE（按签名+URL+到期时间命中的已知基线）单独计数，不计 PASS 也不计 FAIL。
//
// 用法：
//   import { createVerdict } from './lib/probe-verdict.mjs'
//   const verdict = createVerdict('cdp-swipe-failures')
//   verdict.pass('A1 …', 'detail') / verdict.fail(…) / verdict.skip(…) / verdict.baseline(…)
//   console.log(verdict.summary())
//   process.exit(verdict.exitCode())
//
// 故意失败自证：`PROBE_SELFTEST=1 node <script>` 必须 exit 1（脚本内注入一条合成 FAIL）。

export const VERDICT_KINDS = ['PASS', 'FAIL', 'SKIP', 'BASELINE']

export function createVerdict(label) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0, BASELINE: 0 }
  const rows = { PASS: [], FAIL: [], SKIP: [], BASELINE: [] }

  const add = (kind, name, note) => {
    if (!VERDICT_KINDS.includes(kind)) throw new Error(`unknown verdict kind: ${kind}`)
    counts[kind] += 1
    rows[kind].push({ name, note: note ?? '' })
  }

  return {
    label,
    counts,
    rows,
    pass: (name, note) => add('PASS', name, note),
    fail: (name, note) => add('FAIL', name, note),
    skip: (name, note) => add('SKIP', name, note),
    baseline: (name, note) => add('BASELINE', name, note),
    /** 有失败 ⇒ 1；否则 0（SKIP 不改变退出码，但不等于验收通过）。 */
    exitCode() {
      return counts.FAIL > 0 ? 1 : 0
    },
    /** 人类可读汇总；`完整验收通过` 只在零失败且零 SKIP 时才成立。 */
    summary() {
      const head = `[${label}] PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP} BASELINE=${counts.BASELINE}`
      const lines = [head]
      for (const kind of ['FAIL', 'SKIP', 'BASELINE']) {
        for (const row of rows[kind]) lines.push(`  ${kind}: ${row.name}${row.note ? ' — ' + row.note : ''}`)
      }
      const full = counts.FAIL === 0 && counts.SKIP === 0
      lines.push(full
        ? '  结论：全部已执行断言通过（完整验收通过）'
        : `  结论：${counts.FAIL > 0 ? `${counts.FAIL} 条断言失败` : '无失败'}${counts.SKIP > 0 ? `；${counts.SKIP} 条 SKIP ⇒ 验收未完成（不计 PASS）` : ''}`)
      return lines.join('\n')
    },
  }
}
