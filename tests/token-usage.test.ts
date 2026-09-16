import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateTokenUsage, type TokenUsageDeps } from '../src/token-usage.ts'

function usage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    reasoningTokens: 7,
    ...overrides,
  }
}

function assistantEvent(data: unknown): unknown {
  return { type: 'assistant/message', data }
}

function session(id: string, events: unknown[]): { header: { id: string }, events: unknown[] } {
  return { header: { id }, events }
}

function depsWith(sessions: Array<{ header: { id: string }, events: unknown[] }>): TokenUsageDeps {
  return {
    sessionQuery: {
      listSessions: async () => sessions,
      readSession: async (id: string) => sessions.find((s) => s.header.id === id),
    },
  }
}

test('folds input, output, cache and reasoning tokens across every session', async () => {
  const deps = depsWith([
    session('a', [
      assistantEvent({ usage: usage() }),
      assistantEvent({ usage: usage({ inputTokens: 20 }) }),
    ]),
    session('b', [
      assistantEvent({ usage: usage({ outputTokens: 0, cacheReadTokens: 0 }) }),
    ]),
  ])
  const result = await aggregateTokenUsage(deps)
  assert.equal(result.ok, true)
  // 100+50+10+5+7 = 172; 20+50+10+5+7 = 92; 100+0+0+5+7 = 112
  assert.equal(result.totalTokens, 172 + 92 + 112)
  assert.equal(result.sessions, 2)
  assert.equal(result.failed, 0)
})

test('ignores events that are not assistant messages and data without usage', async () => {
  const deps = depsWith([
    session('a', [
      { type: 'turn/end' },
      { type: 'user/message', data: { usage: usage() } },
      assistantEvent({}),
      assistantEvent(undefined),
      { type: 'assistant/message', data: 'plain' },
      assistantEvent({ usage: usage() }),
    ]),
  ])
  const result = await aggregateTokenUsage(deps)
  assert.equal(result.ok, true)
  assert.equal(result.totalTokens, 172)
  assert.equal(result.sessions, 1)
})

test('guards non-finite and negative usage numbers down to zero', async () => {
  const deps = depsWith([
    session('a', [
      assistantEvent({
        usage: usage({
          inputTokens: Number.NaN,
          outputTokens: Infinity,
          cacheReadTokens: -5,
          cacheWriteTokens: '12',
          reasoningTokens: 3,
        }),
      }),
    ]),
  ])
  const result = await aggregateTokenUsage(deps)
  assert.equal(result.ok, true)
  assert.equal(result.totalTokens, 3)
})

test('skips unreadable sessions and counts them as failed', async () => {
  const query = {
    listSessions: async () => [session('ok', [assistantEvent({ usage: usage() })]), { header: { id: 'broken' } }],
    readSession: async (id: string) => {
      if (id === 'broken') throw new Error('boom')
      return session(id, [assistantEvent({ usage: usage() })])
    },
  }
  const result = await aggregateTokenUsage({ sessionQuery: query })
  assert.equal(result.ok, true)
  assert.equal(result.totalTokens, 172)
  assert.equal(result.sessions, 1)
  assert.equal(result.failed, 1)
})

test('counts records without a usable session id as failed', async () => {
  const query = {
    listSessions: async () => [{ header: {} }, null, { id: 7 }, session('ok', [assistantEvent({ usage: usage() })])],
    readSession: async (id: string) => session(id, [assistantEvent({ usage: usage() })]),
  }
  const result = await aggregateTokenUsage({ sessionQuery: query })
  assert.equal(result.ok, true)
  assert.equal(result.totalTokens, 172)
  assert.equal(result.sessions, 1)
  assert.equal(result.failed, 3)
})

test('returns ok false when the sessionQuery service is missing', async () => {
  const result = await aggregateTokenUsage({})
  assert.equal(result.ok, false)
  assert.equal(result.totalTokens, 0)
  assert.equal(result.sessions, 0)
  assert.equal(result.failed, 0)
})

test('returns ok false when listing sessions throws', async () => {
  const query = {
    listSessions: async () => { throw new Error('unavailable') },
    readSession: async () => { throw new Error('never called') },
  }
  const result = await aggregateTokenUsage({ sessionQuery: query })
  assert.equal(result.ok, false)
  assert.equal(result.totalTokens, 0)
})
