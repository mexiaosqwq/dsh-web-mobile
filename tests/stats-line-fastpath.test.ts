import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  resolveTpsForKey,
  statsAnchorAlive,
  tpsSlotsSettled,
} from '../src/client/effects/stats-line.ts'

const fake = (opts: { connected?: boolean; phase?: boolean; stack?: boolean }): Element =>
  ({
    isConnected: opts.connected !== false,
    closest(sel: string): Element | null {
      if (sel === '[data-phase]') return opts.phase === false ? null : ({} as Element)
      if (sel === '[class*="_composerStack"]') return opts.stack === false ? null : ({} as Element)
      return null
    },
  }) as unknown as Element

test('statsAnchorAlive decision table', () => {
  assert.equal(statsAnchorAlive(null), false)
  assert.equal(statsAnchorAlive(fake({ connected: false })), false)
  assert.equal(statsAnchorAlive(fake({ phase: false })), false)
  assert.equal(statsAnchorAlive(fake({ stack: false })), false)
  assert.equal(statsAnchorAlive(fake({})), true)
})

// ═══════════════════════════════════════════════════════════════════════════
// 2026-10-13：本效果仅存的每帧查询（locateTps 里那条 `stack.querySelectorAll('div')`）
//
// 症状（读码数出来的，不是感觉）：
//   · `locateTps(anchor)` 在 key 比较**之前**无条件执行 ⇒ 只要这条 task 被唤醒
//     （scopes:['*']，流式期间每个 mutation 批次都唤醒），就 materialize 整个 composer 栈的
//     div 列表、并对每个候选各读一次 textContent（各自还要走整棵子树）。
//   · TPS 缺席时 `stillFolded(null, 'stats-tps')` 恒 false ⇒ 跳过判定**永不成立** ⇒
//     每一趟都把 measure + write 那串（含强制同步布局）白做一遍。
// 修法：TPS 那一段改成三级短路（resolveTpsForKey），跳过判据里 TPS 两个槽改成
// `tpsSlotsSettled`（缺席 + 上一趟也缺席 = 定态）。
// ═══════════════════════════════════════════════════════════════════════════

const TPS_EL = { live: '' } as unknown as Parameters<typeof resolveTpsForKey>[0]

/** 记录三个输入各自被调用了几次 —— 「短路」这件事只有计数能证明。 */
function probe(options: { remembered?: boolean; rememberedText?: string; stackText: string; located?: boolean }) {
  const calls = { rememberedText: 0, stackText: 0, locate: 0 }
  const remembered = options.remembered === true
    ? { el: {} as Element, reserve: {} as Element, live: 'TPS 1.0 tok/s' }
    : null
  const result = resolveTpsForKey(
    remembered,
    (() => { calls.rememberedText += 1; return options.rememberedText ?? 'TPS 42.0 tok/s' })(),
    () => { calls.stackText += 1; return options.stackText },
    () => {
      calls.locate += 1
      return options.located === false ? null : { el: {} as Element, reserve: {} as Element, live: 'TPS 88.4 tok/s' }
    },
  )
  return { calls, result }
}

test('TPS 三级短路：记得住的读数还活着 ⇒ 零查询、零预筛', () => {
  const { calls, result } = probe({ remembered: true, rememberedText: 'TPS 42.0 tok/s', stackText: 'TPS 42.0 tok/s' })
  assert.equal(calls.locate, 0, '记得住就不许再查询（这就是被消掉的那条全栈 div 查询）')
  assert.equal(calls.stackText, 0, '连预筛都不该做')
  assert.equal(result?.live, 'TPS 42.0 tok/s', 'key 用实时文本，读数变了仍会被发现')
})

test('TPS 三级短路：没有记得住的读数时，先零查询预筛，命中才真查询', () => {
  const miss = probe({ remembered: false, stackText: '8 turns 582 steps · 103 tok/s' })
  assert.equal(miss.calls.locate, 0, '栈内文本里没有 TPS 形状 ⇒ 直接判缺席，不许查询')
  assert.equal(miss.calls.stackText, 1)
  assert.equal(miss.result, null, '缺席')

  const hit = probe({ remembered: false, stackText: 'TPS 88.4 tok/s' })
  assert.equal(hit.calls.locate, 1, '预筛命中才做那条全栈 div 查询，且只做一次')
  assert.equal(hit.result?.live, 'TPS 88.4 tok/s')

  // 预筛命中但查询没找到（例如候选是带子节点的 wrapper）：结果仍是缺席，不是「用旧值」。
  const empty = probe({ remembered: false, stackText: 'TPS 88.4 tok/s', located: false })
  assert.equal(empty.calls.locate, 1)
  assert.equal(empty.result, null)
})

test('TPS 槽的定态判据：缺席 + 上一趟也缺席 ⇒ 允许跳过（旧版恒 false）', () => {
  // 修复点：本趟缺席、上一趟也缺席 ⇒ 定态。旧版这里问的是「折过的读数还活着吗」，
  // 缺席时它必然是 null ⇒ 恒 false ⇒ 永不 skip ⇒ 每帧白折一遍。
  assert.equal(tpsSlotsSettled(true, true, false, false), true, '缺席是稳定态，必须能跳过')
  // 非空转：读数刚消失（上一趟还在）那一趟必须真折，把 foldedTps 收干净。
  assert.equal(tpsSlotsSettled(true, false, false, false), false)
  // 本趟在：仍按 liveness 判 —— 两个槽都活着才算定态（#194 的守卫语义没变）。
  assert.equal(tpsSlotsSettled(false, false, true, true), true)
  assert.equal(tpsSlotsSettled(false, false, true, false), false, '占位被 React 换掉 ⇒ 必须重折')
  assert.equal(tpsSlotsSettled(false, false, false, true), false, '读数节点断开 ⇒ 必须重折')
  // 上一趟缺席但本趟在（读数刚出现）⇒ 不在定态里（absentNow=false 走 liveness 分支，
  // 而缺席过的那两个槽都是 null）⇒ 必须真折。
  assert.equal(tpsSlotsSettled(false, true, false, false), false)
})

test('快路径形状：locateTps 只在短路之后被调用，且跳过判定先比 key', () => {
  const src = readFileSync(new URL('../src/client/effects/stats-line.ts', import.meta.url), 'utf8')
  // 只取 mark() 的快路径那一段：relayoutNow（视口重排路径）允许查询，不在这条判据里。
  const fast = src.slice(src.indexOf('const tpsAlive = stillFolded('), src.indexOf('// Stale marker on a node that left'))
  // locateTps 的**唯一**直接调用点必须挂在短路解析的注入参数上（而不是无条件先跑）。
  const direct = fast.match(/locateTps\(anchor\)/g) ?? []
  assert.equal(direct.length, 2, '只许出现在「短路解析的 locate 参数」与「真折那一趟的重解析」两处')
  const resolvedAt = fast.indexOf('const located = resolveTpsForKey(')
  const keyAt = fast.indexOf('const key = ')
  const skipAt = fast.indexOf('key === fastKey')
  assert.ok(resolvedAt > 0 && keyAt > resolvedAt && skipAt > keyAt, '顺序必须是：短路解析 → 建 key → 比 key')
  // 旧形态（无条件先 locateTps）不允许回来。
  assert.doesNotMatch(fast, /const located = locateTps\(anchor\)/)
  // 跳过判据：key 先比，TPS 定态次之，环形两个槽最后（短路顺序 = 花费顺序）。
  assert.match(
    fast,
    /key === fastKey &&\n        tpsSettled &&\n        stillFolded\(foldedRing, 'stats-ring'\) &&/,
  )
  // 身份校验（零查询）排在最后：前四条都过了才需要扫 dock 的 children，流式那种
  // key 每趟都变的路不该白跑这一趟。
  assert.ok(
    fast.indexOf('ringIdentitySettled(anchor)') > fast.indexOf('stillFolded(foldedRing'),
    '身份校验必须是最后一道（短路顺序 = 花费顺序）',
  )
  const witness = src.slice(src.indexOf('const ringIdentitySettled ='), src.indexOf('const mark = '))
  assert.doesNotMatch(witness, /querySelector/, '身份校验必须零查询（只扫 dock 的 children）')
  // 2026-10-17：判据本体收敛进 locateRing 一处。0.2.1 起统计条标记可能落在 slot 包装上，
  // 环到 dock 的层数不再固定，两处写死的两级上溯由同一个助手取代。本条要钉的语义是
  // 「身份校验与 measureRing 共用同一条选取判据」——所以校验必须走那个助手。
  assert.match(witness, /locateRing\(stats\)/, '与 measureRing 共用同一条选取判据')
  assert.equal((src.match(/isRingCandidate\(child, stats\)/g) ?? []).length, 1, '判据本体只许有一处（locateRing 内）')
  // 定态判据走纯函数（上面那条 transition table 钉的就是它）。
  assert.match(fast, /const tpsSettled = tpsSlotsSettled\(/)
  // 注释里记下来的两个硬指标口径必须与代码一致（免得下一位只改一半）。
  assert.match(src, /stack\.querySelectorAll\('div'\)/)
})
