// 页错误基线：**逐条**匹配（签名 + 资源 URL + 到期时间），不再用
// 「首条错误的详情里含某子串 ⇒ 整批吸收」这种批量豁免（C12 缺口的根因）。
//
// 规则：
//   • 每条错误单独与基线表比对；命中的标 BASELINE，**未命中的一律 NEW**；
//   • 条目必须带 `expiresAt`（ISO 日期）；**过期条目不再命中**，并在汇总里报出来
//     （避免"一劳永逸的豁免"随时间变成永久伪造绿）；
//   • `signature` 支持字符串（精确子串）或 RegExp；`url` 支持字符串（精确子串）或 RegExp；
//   • 判定只看语义字段，不看错误条数/顺序 —— 旧 404 与新错误共存时，新错误仍是 NEW。
//
// 用法：
//   import { partitionErrors, summarizeNew } from './lib/probe-baseline.mjs'
//   const { baselined, fresh, expired } = partitionErrors(errors, PAGE_ERROR_BASELINE, now)

/** 字符串（子串）或 RegExp 皆可匹配。 */
const matches = (value, rule) => {
  if (value === undefined || value === null) return false
  if (rule instanceof RegExp) return rule.test(String(value))
  return String(value).includes(String(rule))
}

/**
 * @param {Array<{signature?: string, url?: string}>} errors 捕获到的错误（每条一条记录）
 * @param {Array<{signature?: string|RegExp, url?: string|RegExp, expiresAt: string, note?: string}>} baseline
 * @param {Date} now
 */
export function partitionErrors(errors, baseline, now = new Date()) {
  const live = []
  const expired = []
  for (const entry of baseline) {
    const at = new Date(entry.expiresAt).getTime()
    // fail-closed：非法/缺失 expiresAt（NaN）**不得**成为永久豁免；记入 expired 并标注原因。
    if (Number.isNaN(at)) { expired.push({ ...entry, invalid: true }); continue }
    if (at > now.getTime()) live.push(entry)
    else expired.push(entry)
  }
  const baselined = []
  const fresh = []
  for (const error of errors) {
    const hit = live.find((entry) =>
      (entry.signature === undefined || matches(error.signature, entry.signature))
      && (entry.url === undefined || matches(error.url, entry.url)))
    if (hit === undefined) fresh.push(error)
    else baselined.push({ error, entry: hit })
  }
  return { baselined, fresh, expired }
}

/** 给探针用的一行汇总（未命中条目要把可复制的标识打出来，便于加基线或修 bug）。 */
export function summarizeNew(fresh) {
  if (fresh.length === 0) return 'new=0'
  const head = fresh[0]
  const sig = (head.signature ?? '').slice(0, 120)
  const url = head.url === undefined ? '' : ` url=${String(head.url).slice(0, 120)}`
  return `new=${fresh.length} first=${sig}${url}`
}
