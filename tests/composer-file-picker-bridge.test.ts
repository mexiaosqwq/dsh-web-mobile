// 「上传附件」的桥路线（2026-10-08，DSH-APP/DSHA#101）。
//
// 形态归属已查清：弹出来是安卓文件管理还是系统「打开方式」，只由 App 侧
// WebChromeClient.onShowFileChooser 决定（现在是 params.createIntent() 直接 launch，
// 少包一层 Intent.createChooser）；插件能改的只有 accept，换不出 chooser。
//
// 所以附件那一路排三档：① App 侧给了 window.DSHA.pickFile 桥 → 走桥；
// ② 没有桥但合入了 #101 → 仍走宿主 hidden input，系统这次会弹 chooser；
// ③ 都没有 → 现状。这些测试钉住桥的选择、结果分类、取消语义与「仍归宿主 intake」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bridgePickFile,
  classifyBridgeResult,
  pickResultFiles,
} from '../src/client/effects/composer-file-picker.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/client/effects/composer-file-picker.ts'), 'utf8')

test('bridgePickFile：认得方法、绑好 this；半实现的桥等于没有桥', () => {
  const plain = { pickFile: () => Promise.resolve([]) }
  assert.equal(typeof bridgePickFile(plain), 'function')
  const unbound = { value: 7, pickFile() { return this.value } }
  const bound = bridgePickFile(unbound)
  assert.equal(bound?.({ accept: [], multiple: true, title: 'x' }), 7, 'this 必须绑在桥上')
  // 桥对象在、方法不在（半实现）也要回落，不能把附件路带进死胡同。
  assert.equal(bridgePickFile({}), undefined)
  assert.equal(bridgePickFile({ pickFile: 42 } as never), undefined)
  assert.equal(bridgePickFile(undefined), undefined)
})

test('pickResultFiles：只收真 File，脏数据一律丢掉', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })
  assert.deepEqual(pickResultFiles([file]), [file])
  assert.deepEqual(pickResultFiles([file, 'b.txt', null, undefined, { name: 'c' }]), [file])
  assert.deepEqual(pickResultFiles(null), [])
  assert.deepEqual(pickResultFiles('a.txt'), [])
})

test('classifyBridgeResult：取消不回落，抛错/脏返回才回落', () => {
  const file = new File([new Uint8Array([1])], 'a.txt')
  assert.equal(classifyBridgeResult([file], false), 'files')
  // 用户取消的三副面孔：null / undefined / 空数组 —— 都要静默，否则一次取消弹两次选择器。
  assert.equal(classifyBridgeResult(null, false), 'cancelled')
  assert.equal(classifyBridgeResult(undefined, false), 'cancelled')
  assert.equal(classifyBridgeResult([], false), 'cancelled')
  // 桥抛错、返回非数组、返回的全是脏数据 ⇒ 都回落，宁可回落也不能点了没反应。
  assert.equal(classifyBridgeResult(null, true), 'fallback')
  assert.equal(classifyBridgeResult({ files: [file] }, false), 'fallback')
  assert.equal(classifyBridgeResult(['a.txt'], false), 'fallback')
})

test('附件那一路：桥优先，没有桥/桥抛错/注入失败都回落宿主 input', () => {
  // 桥在就只走桥；桥不在直接回落（不 await 一个不存在的对象）。
  assert.match(SRC, /const bridge = \(window as unknown as \{ DSHA\?: DshaPickFileBridge \}\)\.DSHA/)
  assert.match(SRC, /if \(pick === undefined\) \{\n    openHostPicker\('file'\)\n    return\n  \}/)
  // 结果分类 + 取消静默 + 注入成功即结束。
  assert.match(SRC, /const outcome = classifyBridgeResult\(value, failed\)/)
  assert.match(SRC, /if \(outcome === 'cancelled'\) return/)
  assert.match(SRC, /if \(outcome === 'files' && handFilesToHost\(pickResultFiles\(value\)\)\) return/)
  // 兜底仍然把点击交回宿主 input（那时若 #101 已合入，系统自己会弹 chooser）。
  const route = SRC.slice(SRC.indexOf('export async function openAttachmentPicker'))
  assert.ok(
    route.indexOf("openHostPicker('file')") > -1 && route.indexOf('await pick(') > -1,
    'bridge first, host input as the fallback',
  )
})

test('桥拿到的文件仍走宿主 intake：写 hidden input 再派发 change，不另起上传', () => {
  // 与 input.click() 那条路同一个入口：校验/大小/数量策略/上传/草稿全归宿主。
  assert.match(SRC, /const transfer = new DataTransfer\(\)/)
  assert.match(SRC, /for \(const file of files\) transfer\.items\.add\(file\)/)
  assert.match(SRC, /input\.files = transfer\.files/)
  assert.match(SRC, /input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/)
  // 注入失败要能被调用方看见（false ⇒ 回落），不能吞掉当成成功。
  assert.match(SRC, /export function handFilesToHost\(files: File\[\]\): boolean \{/)
  // 不许在插件里另开上传通道（fetch 上传 / 自建 FormData 都不该出现）。
  assert.doesNotMatch(SRC, /FormData|XMLHttpRequest|fetch\(/)
})

test('图片那一路仍只走宿主 input 的 accept="image/*"，不上桥', () => {
  assert.match(SRC, /if \(row\.kind === 'file'\) void openAttachmentPicker\(t\)\n      else openHostPicker\(row\.kind\)/)
})
