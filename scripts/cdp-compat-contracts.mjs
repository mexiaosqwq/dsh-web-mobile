// Upstream-compatibility contract checker for dsh-web-mobile.
// Machine-readable counterpart of docs/upstream/upgrade-runbook.md §2.
// Consumes docs/upstream/compat-contracts.json; scans the live page
// (DOM class attributes + every reachable CSSRule's cssText) for each
// needle. **HIT means the string exists in the DOM or in any loaded
// stylesheet — NOT that an element renders with it**: a CSS-module class
// that ships in a plugin's sheet but is used by no element still HITs
// (2026-09-18 实测 group-card-1/3/5 即此情况), so pair a hash contract with
// a rendering assertion in a probe when the page shape matters.
// A lazy contract whose needle is absent is SKIP (state-gated or
// not yet loaded; see its "state" note); a non-lazy MISS exits 1 so a host
// upgrade surfaces rehash drift immediately.
// Inputs (environment): DSH_PROBE_URL (default http://127.0.0.1:3080/),
// DSH_PROBE_CHROME (default chromium), DSH_PROBE_TIMEOUT_MS (default 30000),
// DSH_PROBE_REQUEST_MS (per-CDP-request deadline, default 15000),
// DSH_CONTRACTS_FILE (optional path override for the contracts JSON).
// Exits 0 when miss=0, 1 when miss>0, on a fatal error, or when cleanup cannot
// prove the child exited and the profile is gone. Never calls process.exit().
// C13 (2026-10-13): connection / timeout / cleanup now come from the shared
// probe helpers (lib/probe-cdp-client.mjs + lib/probe-cdp-lifecycle.mjs) —
// this file used to carry its own CDP client with no request deadline, and its
// teardown was a bare `chrome.kill` plus a 300ms sleep (no PID proof, no
// cleanup verdict). Assertions and scenes are untouched.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCdpClient } from './lib/probe-cdp-client.mjs';
import { installExitGuard, REQUEST_DEADLINE_MS, createCleanup } from './lib/probe-cdp-lifecycle.mjs';

// C13：进程级句柄放模块级，这样正常尾部、致命错误与早退都能回收（同 cdp-zoom-probe.mjs）。
let chrome = null;
let profileDir = null;
let missCount = 0;
let finished = false;

const DEFAULT_URL = 'http://127.0.0.1:3080/';
const DEFAULT_TIMEOUT_MS = 30_000;
const SETTLE_STABLE_SAMPLES = 2;
const SETTLE_SAMPLE_INTERVAL_MS = 1_500;
const SETTLE_MAX_SAMPLES = 14;

function readConfig(env = process.env) {
  const parsedUrl = new URL(env.DSH_PROBE_URL || DEFAULT_URL);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('DSH_PROBE_URL must use http or https');
  }
  const timeoutMs = Number(env.DSH_PROBE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('DSH_PROBE_TIMEOUT_MS must be a positive integer');
  }
  const contractsFile = env.DSH_CONTRACTS_FILE?.trim()
    || join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'upstream', 'compat-contracts.json');
  return { url: parsedUrl.toString(), chromePath: env.DSH_PROBE_CHROME || 'chromium', timeoutMs, contractsFile };
}

async function loadContracts(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const contracts = raw.contracts;
  if (!Array.isArray(contracts) || contracts.length === 0) {
    throw new Error(`contracts file has no entries: ${path}`);
  }
  for (const contract of contracts) {
    if (!contract.id || !contract.needle) {
      throw new Error(`contract entry missing id/needle: ${JSON.stringify(contract)}`);
    }
    if (contract.kind !== 'hash' && contract.kind !== 'marker') {
      throw new Error(`contract ${contract.id} has unknown kind: ${contract.kind}`);
    }
  }
  return contracts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The tab we own: extension background pages are not `type: page`.
 *
 * This step is plain HTTP against the DevTools endpoint, not a CDP request —
 * the shared client needs a socket before it exists — so its deadline is the
 * bounded loop below. A chromium that fails to launch rejects through the race
 * instead of burning the whole settle timeout (the old code threw from inside
 * its probe; the shared waitFor treats a thrown probe as "not ready yet").
 */
function waitForTarget(chromeProcess, timeoutMs, port) {
  const launchFailure = new Promise((_resolve, reject) => {
    chromeProcess.once('error', (error) => reject(new Error(`chromium launch failed: ${error.message}`)));
    chromeProcess.once('exit', (code, signalCode) => {
      reject(new Error(`chromium exited early (code=${code}, signal=${signalCode})`));
    });
  });
  // 正常收尾时 chrome 一定会退出：那条拒绝没人 await，别让它变成 unhandled rejection。
  launchFailure.catch(() => {});
  const poll = (async () => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`);
        if (response.ok) {
          const targets = await response.json();
          if (targets.length) return targets[0];
        }
      } catch { /* 端口还没上线 */ }
      if (Date.now() >= deadline) throw new Error(`timeout after ${timeoutMs}ms: chrome target`);
      await sleep(100);
    }
  })();
  return Promise.race([poll, launchFailure]);
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * The shared client speaks send/waitFor; this probe reads values through
 * Runtime.evaluate everywhere, so the evaluate face is rebuilt on top of it
 * (identical exception-to-Error semantics as the local client it replaces).
 */
function withEvaluate(client) {
  return {
    send: client.send,
    waitFor: client.waitFor,
    evaluate: async (expression) => {
      const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      }
      return response.result.value;
    },
  };
}

// One snapshot of everything a hash needle could live in: class attributes
// of every element plus the cssText of every reachable style rule (recursed
// through media/grouping rules; cross-origin access is ignored).
const SCAN_TEXT_EXPRESSION = `(() => {
  const chunks = [];
  document.querySelectorAll('*').forEach((el) => {
    if (typeof el.className === 'string') chunks.push(el.className);
  });
  const collect = (list) => {
    for (const rule of list) {
      try { chunks.push(rule.cssText || ''); } catch { /* skip single rule */ }
      try { if (rule.cssRules) collect(rule.cssRules); } catch { /* skip subtree */ }
    }
  };
  try { collect(document.styleSheets); } catch { /* skip sheet */ }
  return chunks.join('\\n');
})()`;

async function main() {
  let client = null;
  let ws = null;

  try {
    const config = readConfig();
    const contracts = await loadContracts(config.contractsFile);
    console.log(`contracts file: ${config.contractsFile} (${contracts.length} entries)`);

    const port = await allocatePort();
    const cacheRoot = join(homedir(), '.cache');
    await mkdir(cacheRoot, { recursive: true });
    profileDir = await mkdtemp(join(cacheRoot, 'dsh-web-mobile-contracts-'));

    chrome = spawn(config.chromePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profileDir,
      '--window-size=390,844',
      'about:blank',
    ], { stdio: 'ignore' });

    // C13：CDP 连接与每请求 deadline 全部来自共享 client（send 带 deadline +
    // readyState 门，waitFor 的总 deadline 由它自己强制）。
    const target = await waitForTarget(chrome, config.timeoutMs, port);

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('CDP WebSocket connection failed'));
    });

    client = withEvaluate(createCdpClient({ ws, requestDeadlineMs: REQUEST_DEADLINE_MS }));
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    if (process.env.DSH_PROBE_COOKIE) {
      const raw = process.env.DSH_PROBE_COOKIE
      const eq = raw.indexOf('=')
      await client.send('Network.setCookie', { name: raw.slice(0, eq), value: raw.slice(eq + 1), url: config.url })
    }
    await client.send('Page.navigate', { url: config.url });

    await client.waitFor('page load complete', config.timeoutMs, async () => {
      try {
        const state = await client.evaluate(`({ ready: document.readyState === 'complete', href: location.href })`);
        return state.ready && state.href.startsWith(config.url) ? state : null;
      } catch {
        return null;
      }
    });

    // Let lazy plugin bundles inject their style tags: wait until the
    // (style tag count, rule count) fingerprint is stable for two
    // consecutive samples, then scan.
    let previous = null;
    let stable = 0;
    for (let sample = 0; sample < SETTLE_MAX_SAMPLES; sample += 1) {
      const fingerprint = await client.evaluate(`(() => ({
        styles: document.querySelectorAll('style').length,
        rules: (() => { let n = 0; for (const sheet of document.styleSheets) { try { n += sheet.cssRules.length; } catch { /* skip */ } } return n; })(),
      }))()`);
      if (previous && fingerprint.styles === previous.styles && fingerprint.rules === previous.rules) {
        stable += 1;
        if (stable >= SETTLE_STABLE_SAMPLES) break;
      } else {
        stable = 0;
      }
      previous = fingerprint;
      await sleep(SETTLE_SAMPLE_INTERVAL_MS);
    }

    const scanText = await client.evaluate(SCAN_TEXT_EXPRESSION);
    const statuses = [];

    for (const contract of contracts) {
      let found = false;
      try {
        if (contract.kind === 'hash') {
          found = scanText.includes(contract.needle);
        } else {
          found = await client.evaluate(`!!document.querySelector(${JSON.stringify(contract.needle)})`);
        }
      } catch (error) {
        console.log(`CONTRACT ERROR ${contract.id} (${contract.owner}) — evaluation failed: ${error.message}`);
        missCount += 1;
        continue;
      }
      const status = found ? 'hit' : (contract.lazy ? 'skip' : 'miss');
      statuses.push(status);
      if (found) {
        console.log(`CONTRACT HIT  ${contract.id} (${contract.owner}) ${contract.needle}`);
      } else if (contract.lazy) {
        console.log(`CONTRACT SKIP ${contract.id} (${contract.owner}) ${contract.needle} — lazy${contract.state ? `; ${contract.state}` : ''}`);
      } else {
        console.log(`CONTRACT MISS ${contract.id} (${contract.owner}) ${contract.needle} — manual audit: ${contract.note || '(no note)'}`);
        missCount += 1;
      }
    }

    const hits = statuses.filter((status) => status === 'hit').length;
    const skips = statuses.filter((status) => status === 'skip').length;
    console.log(`SUMMARY CONTRACTS total=${contracts.length} hit=${hits} skip=${skips} miss=${missCount} green=${missCount === 0 ? 'yes' : 'no'}`);
  } finally {
    try { if (ws !== null) ws.close(); } catch { /* 已关闭 */ }
  }
}

/**
 * C13：单一收口出口 —— 正常尾部、致命错误与 SIGINT/SIGTERM 早退都走它。
 * createCleanup 自带精确 PID 判定（SIGTERM → 等退出 → SIGKILL → 再确认 → 才删
 * profile）与幂等；进程没退 / profile 没删一律判红并让退出码非零，不再是把
 * chrome.kill 后睡 300ms 当作已清理。
 */
async function finishProbe(error) {
  if (finished) return;
  finished = true;
  if (error) {
    console.error(error);
    missCount += 1;
  }
  const evidence = await createCleanup({ child: chrome, profileDir, rm })().catch((error) => {
    console.error(error);
    return null;
  });
  console.log('CLEANUP ' + JSON.stringify(evidence));
  // profile 没建过就不要求 removed（spawn 之前就失败的那条路）；
  // 只要回收本身没做成旁证，一律判红并让退出码非零。
  const cleanupOk = evidence !== null
    && evidence.exited === true
    && (profileDir === null || evidence.removed === true);
  if (!cleanupOk) {
    console.log(`CLEANUP FAIL ${evidence === null ? 'cleanup threw' : `exited=${evidence.exited} removed=${evidence.removed}`}`);
    missCount += 1;
  }
  process.exitCode = missCount > 0 ? 1 : 0;
}

installExitGuard({ getChild: () => chrome, getProfileDir: () => profileDir });
// 早退（Ctrl-C / kill）也要回收自有 PID 与 profile，并如实给非零退出码。
for (const signalName of ['SIGINT', 'SIGTERM']) {
  process.once(signalName, () => {
    missCount += 1;
    void finishProbe(new Error(`received ${signalName}`));
  });
}

try {
  await main();
} catch (error) {
  await finishProbe(error);
}
await finishProbe(null);
