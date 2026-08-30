// CDP regression probe for dsh-web-mobile.
// Inputs (environment): DSH_PROBE_URL (default http://127.0.0.1:3080/),
// DSH_PROBE_SESSION_ID (required), DSH_PROBE_CHROME (default chromium),
// DSH_PROBE_TIMEOUT_MS (default 30000), DSH_PROBE_REQUIRE_CHIP (0 or 1, default 0).
// Exits 0 only when every required check passes; any FAIL, timeout, page error,
// or strict integration absence exits 1. Never calls process.exit().
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:3080/';
const DEFAULT_TIMEOUT_MS = 30_000;
const CHROME_GRACE_MS = 5_000;
const CHIP_SELECTOR = '[data-gitgraph-chip-anchor] [data-gitgraph-chip]';
const MOBILE_STYLE_SELECTOR = 'style[data-plugin="dsh-web-mobile"]';
const MOBILE_FRAME_SELECTOR = '[data-mobile-nav="frame"]';
const MOBILE_DRAWER_SELECTOR = '[data-mobile-nav="frame"] > :first-child';
const MOBILE_BACKDROP_SELECTOR = '[data-mobile-nav="backdrop"]';
const MOBILE_TOGGLE_SELECTOR = '[data-mobile-nav="toggle"]';
const MOBILE_FAB_SELECTOR = '[data-mobile-nav="fab"]';
const MOBILE_CONTROL_SELECTORS = [MOBILE_TOGGLE_SELECTOR, MOBILE_FAB_SELECTOR];

function readConfig(env = process.env) {
  const sessionId = env.DSH_PROBE_SESSION_ID?.trim();
  if (!sessionId) throw new Error('DSH_PROBE_SESSION_ID is required');

  const parsedUrl = new URL(env.DSH_PROBE_URL || DEFAULT_URL);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('DSH_PROBE_URL must use http or https');
  }

  const timeoutMs = Number(env.DSH_PROBE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('DSH_PROBE_TIMEOUT_MS must be a positive integer');
  }

  const requireChipFlag = env.DSH_PROBE_REQUIRE_CHIP || '0';
  if (requireChipFlag !== '0' && requireChipFlag !== '1') {
    throw new Error('DSH_PROBE_REQUIRE_CHIP must be 0 or 1');
  }

  return {
    url: parsedUrl.href,
    sessionId,
    chromePath: env.DSH_PROBE_CHROME || 'chromium',
    timeoutMs,
    requireChip: requireChipFlag === '1',
  };
}

const results = [];

class ProbeFailure extends Error {
  constructor(name, detail = '') {
    super(`${name}: ${detail || 'assertion failed'}`);
    this.name = 'ProbeFailure';
  }
}

class TimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

function record(status, name, detail = '') {
  results.push({ status, name, detail });
  console.log(`${status} ${name}${detail ? ` ${detail}` : ''}`);
}

const pass = (name, detail = '') => record('PASS', name, detail);
const skip = (name, detail = '') => record('SKIP', name, detail);
const fail = (name, detail = '') => record('FAIL', name, detail);

// Non-throwing check: records PASS/FAIL and returns the condition so callers
// can keep collecting independent failures instead of stopping at the first.
function check(name, condition, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
  return condition;
}

function assertCheck(name, condition, detail = '') {
  return check(name, condition, detail);
}

function printSummary() {
  const count = (status) => results.filter((result) => result.status === status).length;
  const passCount = count('PASS');
  const skipCount = count('SKIP');
  const failCount = count('FAIL');
  const green = failCount === 0 && skipCount === 0;
  console.log(`SUMMARY pass=${passCount} skip=${skipCount} fail=${failCount} green=${green}`);
  return failCount;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason || new Error('aborted'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitFor(label, timeoutMs, signal, probe) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(100, signal);
  }
  throw new TimeoutError(label, timeoutMs);
}

async function setViewport(client, width, height, mobile) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile: !!mobile,
  });
}

async function rectFor(client, selector) {
  return client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return null;
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, x: rect.x, y: rect.y };
  })()`);
}

async function clickPoint(client, x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function clickSelector(client, selector) {
  const rect = await rectFor(client, selector);
  if (!rect) {
    fail('geometry.click-target', `selector=${selector} not visible`);
    throw new ProbeFailure('geometry.click-target', `selector=${selector} not visible`);
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = await client.evaluate(`(() => {
    const element = document.elementFromPoint(${x}, ${y});
    const target = document.querySelector(${JSON.stringify(selector)});
    return element !== null && target !== null && (element === target || target.contains(element));
  })()`);
  if (!hit) {
    fail('geometry.element-from-point', `(${Math.round(x)}, ${Math.round(y)}) not over ${selector}`);
    throw new ProbeFailure('geometry.element-from-point', `(${Math.round(x)}, ${Math.round(y)}) not over ${selector}`);
  }
  await clickPoint(client, x, y);
  return { x, y, rect };
}

async function pressEscape(client) {
  const keyParams = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyParams });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyParams });
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

function createCdpClient(ws, signal) {
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();

  const rejectPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
      return;
    }
    for (const handler of listeners.get(message.method) || []) handler(message.params);
  };
  ws.onerror = () => rejectPending(new Error('CDP WebSocket error'));
  ws.onclose = () => rejectPending(new Error('CDP WebSocket closed'));

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason || new Error('aborted'));
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  };

  return {
    send,
    evaluate,
    on(method, handler) {
      const handlers = listeners.get(method) || [];
      handlers.push(handler);
      listeners.set(method, handlers);
    },
    close(error = new Error('CDP client closed')) {
      rejectPending(error);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  };
}

async function runCoreScenario(client, config, signal, pageErrors) {
  // Narrow plugin startup: exactly one plugin style tag plus the frame marker.
  const boot = await waitFor('mobile plugin boot', config.timeoutMs, signal, async () => {
    const state = await client.evaluate(`(() => ({
      styleCount: document.querySelectorAll(${JSON.stringify(MOBILE_STYLE_SELECTOR)}).length,
      frame: document.querySelector(${JSON.stringify(MOBILE_FRAME_SELECTOR)}) !== null,
    }))()`);
    return state.styleCount === 1 && state.frame ? state : null;
  });
  pass('core.plugin-style', `count=${boot.styleCount}`);
  pass('mobile.frame-marker', 'present=true');

  // Drawer state: open = backdrop present, frame without data-sidebar-collapsed,
  // first frame child (the drawer) with positive size; closed = collapsed frame
  // and no backdrop.
  const drawerStateProbe = async () => client.evaluate(`(() => {
    const frame = document.querySelector(${JSON.stringify(MOBILE_FRAME_SELECTOR)});
    const drawer = document.querySelector(${JSON.stringify(MOBILE_DRAWER_SELECTOR)});
    const rect = drawer === null ? null : drawer.getBoundingClientRect();
    return {
      backdrop: document.querySelector(${JSON.stringify(MOBILE_BACKDROP_SELECTOR)}) !== null,
      collapsed: frame === null ? null : frame.hasAttribute('data-sidebar-collapsed'),
      drawerWidth: rect === null ? 0 : rect.width,
      drawerHeight: rect === null ? 0 : rect.height,
    };
  })()`);
  const waitDrawerState = (label, wantOpen) => waitFor(label, config.timeoutMs, signal, async () => {
    try {
      const state = await drawerStateProbe();
      if (wantOpen) {
        return state.backdrop && state.collapsed === false && state.drawerWidth > 0 && state.drawerHeight > 0 ? state : null;
      }
      return state.collapsed === true && !state.backdrop ? state : null;
    } catch {
      return null;
    }
  });

  // Wrapper that records a normal FAIL on timeout so the core scenario can keep
  // collecting independent failures instead of aborting at the first drawer
  // transition problem.
  const waitDrawerChecked = async (label, wantOpen, checkName) => {
    try {
      await waitDrawerState(label, wantOpen);
      pass(checkName, wantOpen ? 'open=true' : 'closed=true');
      return true;
    } catch (error) {
      if (error instanceof TimeoutError) {
        check(checkName, false, `${label} timed out`);
        return false;
      }
      throw error;
    }
  };

  // An open control is usable only when its center hit-tests back to it: the
  // sliding drawer can cover the toggle while animating out after a close.
  const waitControlReachable = (label, selector) => waitFor(label, config.timeoutMs, signal, async () => {
    try {
      const rect = await rectFor(client, selector);
      if (rect === null) return null;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return client.evaluate(`(() => {
        const element = document.elementFromPoint(${x}, ${y});
        const target = document.querySelector(${JSON.stringify(selector)});
        return element !== null && target !== null && (element === target || target.contains(element));
      })()`);
    } catch {
      return null;
    }
  });

  // Pick the first visible open control: header toggle, else floating fab.
  let drawerUsable = true;
  let openSelector = null;
  for (const selector of MOBILE_CONTROL_SELECTORS) {
    try {
      await waitControlReachable(`mobile open control ${selector}`, selector);
      openSelector = selector;
      break;
    } catch (error) {
      if (!(error instanceof TimeoutError)) throw error;
    }
  }
  if (openSelector === null) {
    check('mobile.open-control', false, 'neither toggle nor fab became visible before deadline');
    drawerUsable = false;
  }

  if (drawerUsable) {
    // Open the drawer with the selected control and assert the expanded state.
    await clickSelector(client, openSelector);
    if (!(await waitDrawerChecked('mobile drawer open', true, 'mobile.drawer.open'))) drawerUsable = false;

    // Close via the backdrop, at a point derived from live geometry: midway
    // between the open drawer's right edge and the viewport right edge.
    const drawerRect = await rectFor(client, MOBILE_DRAWER_SELECTOR);
    if (drawerRect === null) {
      check('geometry.drawer', false, 'drawer rect unavailable while open');
      drawerUsable = false;
    } else {
      const viewport = await client.evaluate('({ width: innerWidth, height: innerHeight })');
      const backdropX = (drawerRect.right + viewport.width) / 2;
      const backdropY = viewport.height / 2;
      const overBackdrop = await client.evaluate(`(() => {
        const element = document.elementFromPoint(${backdropX}, ${backdropY});
        return element !== null && element.closest(${JSON.stringify(MOBILE_BACKDROP_SELECTOR)}) !== null;
      })()`);
      if (!overBackdrop) {
        check('mobile.backdrop.point', false, `(${Math.round(backdropX)}, ${Math.round(backdropY)}) not over backdrop`);
        drawerUsable = false;
      } else {
        await clickPoint(client, backdropX, backdropY);
        if (!(await waitDrawerChecked('mobile backdrop close', false, 'mobile.drawer.backdrop-close'))) drawerUsable = false;
        if (drawerUsable) pass('mobile.drawer.backdrop', `drawerWidth=${Math.round(drawerRect.width)} clickX=${Math.round(backdropX)}`);
      }
    }

    if (drawerUsable) {
      // Reopen with the same live selector, then close with a real Escape key.
      await waitControlReachable('mobile reopen control', openSelector);
      await clickSelector(client, openSelector);
      if (!(await waitDrawerChecked('mobile drawer reopen', true, 'mobile.drawer.reopen'))) drawerUsable = false;
      await pressEscape(client);
      if (!(await waitDrawerChecked('mobile escape close', false, 'mobile.drawer.escape-close'))) drawerUsable = false;
      if (drawerUsable) pass('mobile.drawer.escape', 'collapsed=true');
    }
  }

  // Desktop: the plugin must be a no-op at 1280x800.
  await setViewport(client, 1280, 800, false);
  await waitFor('desktop no-op', config.timeoutMs, signal, async () => {
    const state = await client.evaluate(`(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      return {
        frame: document.querySelector(${JSON.stringify(MOBILE_FRAME_SELECTOR)}) !== null,
        preview: document.querySelector('[data-mobile-preview-full]') !== null,
        toggleVisible: visible(${JSON.stringify(MOBILE_TOGGLE_SELECTOR)}),
        fabVisible: visible(${JSON.stringify(MOBILE_FAB_SELECTOR)}),
      };
    })()`);
    return !state.frame && !state.preview && !state.toggleVisible && !state.fabVisible ? state : null;
  });
  pass('desktop.no-op', 'frame=absent preview=absent controls=hidden');

  // Exact 1024px boundary: still desktop (mobile query is max-width: 1023px).
  await setViewport(client, 1024, 800, false);
  await waitFor('desktop boundary 1024 no-op', config.timeoutMs, signal, async () => {
    const state = await client.evaluate(`(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      return {
        frame: document.querySelector(${JSON.stringify(MOBILE_FRAME_SELECTOR)}) !== null,
        preview: document.querySelector('[data-mobile-preview-full]') !== null,
        toggleVisible: visible(${JSON.stringify(MOBILE_TOGGLE_SELECTOR)}),
        fabVisible: visible(${JSON.stringify(MOBILE_FAB_SELECTOR)}),
      };
    })()`);
    return !state.frame && !state.preview && !state.toggleVisible && !state.fabVisible ? state : null;
  });
  pass('desktop.boundary-1024', 'frame=absent preview=absent controls=hidden');

  // Exact 1023px boundary: still mobile, so the frame and an open control must
  // come back.
  await setViewport(client, 1023, 800, true);
  await waitFor('mobile boundary 1023 re-arm', config.timeoutMs, signal, async () => {
    const state = await client.evaluate(`(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const frame = document.querySelector(${JSON.stringify(MOBILE_FRAME_SELECTOR)});
      return {
        frame: frame !== null,
        collapsed: frame === null ? null : frame.hasAttribute('data-sidebar-collapsed'),
        toggleVisible: visible(${JSON.stringify(MOBILE_TOGGLE_SELECTOR)}),
        fabVisible: visible(${JSON.stringify(MOBILE_FAB_SELECTOR)}),
      };
    })()`);
    return state.frame && state.collapsed === true && (state.toggleVisible || state.fabVisible) ? state : null;
  });
  pass('mobile.boundary-1023', 'frame=present control=visible collapsed=true');

  // Narrow breakpoint re-arm: frame back, an open control visible, and the
  // drawer closed again so the next scenario starts from a stable state.
  await setViewport(client, 390, 844, true);
  await waitFor('mobile breakpoint re-arm', config.timeoutMs, signal, async () => {
    const state = await client.evaluate(`(() => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const frame = document.querySelector(${JSON.stringify(MOBILE_FRAME_SELECTOR)});
      return {
        frame: frame !== null,
        collapsed: frame === null ? null : frame.hasAttribute('data-sidebar-collapsed'),
        toggleVisible: visible(${JSON.stringify(MOBILE_TOGGLE_SELECTOR)}),
        fabVisible: visible(${JSON.stringify(MOBILE_FAB_SELECTOR)}),
      };
    })()`);
    return state.frame && state.collapsed === true && (state.toggleVisible || state.fabVisible) ? state : null;
  });
  pass('mobile.breakpoint-rearm', 'frame=present control=visible collapsed=true');

  // Surface captured page errors (deduplicated); a real-combination gate must
  // fail on them.
  const uniqueErrors = [...new Set(pageErrors)];
  check('page.errors', uniqueErrors.length === 0, uniqueErrors.length > 0
    ? `count=${uniqueErrors.length} first=${uniqueErrors[0].slice(0, 160)}`
    : 'count=0');
}

async function runGitgraphScenario(client, config, signal) {
  // Step 1: explicit missing-chip semantics. Absence is a hard failure under
  // DSH_PROBE_REQUIRE_CHIP=1 and a SKIP otherwise; once the chip exists every
  // following assertion is required even when strict mode is off, so a
  // detected-but-broken integration can never silently skip.
  const chipPresent = await client.evaluate(`document.querySelector(${JSON.stringify(CHIP_SELECTOR)}) !== null`);
  if (!chipPresent) {
    if (config.requireChip) {
      fail('integration.gitgraph', 'reason=chip-not-present required=true');
      throw new ProbeFailure('integration.gitgraph', 'reason=chip-not-present required=true');
    }
    skip('integration.gitgraph', 'reason=chip-not-present');
    return;
  }
  pass('chip.present', 'found=true');

  // Step 2: the chip must have been reparented into the composer card
  // (textarea's closest element whose class ends with `_card`).
  const placement = await client.evaluate(`(() => {
    const chip = document.querySelector(${JSON.stringify(CHIP_SELECTOR)});
    const card = document.querySelector('textarea')?.closest('[class$="_card"]');
    return { hasCard: card !== null, reparented: chip?.parentElement === card };
  })()`);
  assertCheck('integration.gitgraph.reparented', placement.hasCard && placement.reparented, `hasCard=${placement.hasCard} reparented=${placement.reparented}`);

  // Step 3: real pressed feedback. Press at the live chip center and hold
  // ~120ms so `:active` stays applied, then require both `:active` and a
  // non-identity DOMMatrix transform. Release always happens via the local
  // finally, so a failed assertion cannot leave the pointer pressed.
  const chipRect = await rectFor(client, CHIP_SELECTOR);
  if (chipRect === null) {
    check('integration.gitgraph.chip-geometry', false, 'chip not visible');
    return;
  }
  const pressX = chipRect.left + chipRect.width / 2;
  const pressY = chipRect.top + chipRect.height / 2;
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pressX, y: pressY });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pressX, y: pressY, button: 'left', clickCount: 1 });
  try {
    await sleep(120, signal);
    const pressed = await client.evaluate(`(() => {
      const chip = document.querySelector(${JSON.stringify(CHIP_SELECTOR)});
      const transform = getComputedStyle(chip).transform;
      const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
      const transformed = matrix !== null
        && (matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1 || matrix.e !== 0 || matrix.f !== 0);
      return { active: chip.matches(':active'), transformed, transform };
    })()`);
    assertCheck('integration.gitgraph.pressed', pressed.active && pressed.transformed, `active=${pressed.active} transformed=${pressed.transformed} transform=${pressed.transform}`);
  } finally {
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pressX, y: pressY, button: 'left', clickCount: 1 });
  }

  // Step 4: popover geometry after release: in-viewport rect with options.
  // A timeout is recorded as a normal FAIL so later cleanup still runs and the
  // run can continue collecting other failures.
  let popoverState = null;
  try {
    popoverState = await waitFor('gitgraph popover', config.timeoutMs, signal, async () => {
      const state = await client.evaluate(`(() => {
        const popover = document.querySelector('[data-gitgraph-popover]');
        if (!popover) return null;
        const rect = popover.getBoundingClientRect();
        return {
          optionCount: popover.querySelectorAll('[role="option"]').length,
          inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      })()`);
      return state || null;
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      check('integration.gitgraph.popover', false, 'popover did not open before deadline');
    } else {
      throw error;
    }
  }
  try {
    if (popoverState !== null) {
      assertCheck('integration.gitgraph.popover', popoverState.optionCount > 0 && popoverState.inViewport, `options=${popoverState.optionCount} rect=${JSON.stringify(popoverState.rect)}`);
    }
  } finally {
    // Escape cleanup runs even when the popover assertion fails, so teardown
    // always starts from a neutral UI state; a cleanup timeout on the failure
    // path is logged but must not mask the original failure.
    await pressEscape(client);
    try {
      await waitFor('gitgraph popover closed', config.timeoutMs, signal, async () => {
        const present = await client.evaluate(`document.querySelector('[data-gitgraph-popover]') !== null`);
        return !present || null;
      });
      pass('integration.gitgraph.cleanup', 'popover=closed');
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.error('cleanup: gitgraph popover did not close after Escape');
      } else {
        throw error;
      }
    }
  }
}

async function main() {
  const abortController = new AbortController();
  const onSignal = (signalName) => abortController.abort(new Error(`received ${signalName}`));
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const signal = abortController.signal;

  let client = null;
  let chrome = null;
  let profileDir = null;
  let chromeFailure = null;
  let chromeExit = null;

  try {
    const config = readConfig();

    const port = await allocatePort();
    const cacheRoot = join(homedir(), '.cache');
    await mkdir(cacheRoot, { recursive: true });
    profileDir = await mkdtemp(join(cacheRoot, 'dsh-web-mobile-probe-'));

    chrome = spawn(config.chromePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profileDir,
      '--window-size=390,844',
      'about:blank',
    ], { stdio: 'ignore' });
    chrome.once('error', (error) => { chromeFailure = error; });
    chrome.once('exit', (code, signalCode) => { chromeExit = { code, signalCode }; });

    const target = await waitFor('chrome target', config.timeoutMs, signal, async () => {
      if (chromeFailure) throw new Error(`chromium launch failed: ${chromeFailure.message}`);
      if (chromeExit) throw new Error(`chromium exited early (code=${chromeExit.code}, signal=${chromeExit.signalCode})`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`);
        if (!response.ok) return null;
        const targets = await response.json();
        return targets.length ? targets[0] : null;
      } catch {
        return null;
      }
    });

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        try { ws.close(); } catch { /* best effort */ }
        reject(signal.reason || new Error('aborted'));
      };
      if (signal.aborted) { onAbort(); return; }
      ws.onopen = () => { signal.removeEventListener('abort', onAbort); resolve(); };
      ws.onerror = () => { signal.removeEventListener('abort', onAbort); reject(new Error('CDP WebSocket connection failed')); };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    client = createCdpClient(ws, signal);
    if (signal.aborted) {
      client.close(signal.reason || new Error('aborted'));
    } else {
      signal.addEventListener('abort', () => client.close(signal.reason || new Error('aborted')), { once: true });
    }

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    // Page-error capture: registered before any navigation so boot-time
    // exceptions, console errors, and log errors all land in the gate.
    const pageErrors = [];
    client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      pageErrors.push(exceptionDetails.exception?.description || exceptionDetails.text);
    });
    client.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') pageErrors.push(args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
    client.on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error') pageErrors.push(entry.text);
    });

    // Inject the current session before the first navigation (no
    // navigate-then-reload dance): the plugin sees it on first boot.
    const currentSession = JSON.stringify({ sessionId: config.sessionId });
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('dsh.sessions.current', ${JSON.stringify(currentSession)})`,
    });
    await setViewport(client, 390, 844, true);
    await client.send('Page.navigate', { url: config.url });

    const waitForPageLoad = (label) => waitFor(label, config.timeoutMs, signal, async () => {
      try {
        const state = await client.evaluate(`({ ready: document.readyState === 'complete', href: location.href })`);
        return state.ready && state.href.startsWith(config.url) ? state : null;
      } catch {
        return null;
      }
    });

    await waitForPageLoad('page load');

    await runCoreScenario(client, config, signal, pageErrors);

    // Optional/strict gitgraph integration gate; the core scenario has already
    // restored the narrow viewport with the drawer closed. The scenario closes
    // any popover it opens before returning.
    await runGitgraphScenario(client, config, signal);
  } catch (error) {
    if (!(error instanceof ProbeFailure)) {
      fail('fatal', error instanceof Error ? error.message : String(error));
    }
  } finally {
    try {
      if (client) client.close();
    } catch (error) {
      console.error('teardown: close client failed:', error.message);
    }
    try {
      if (chrome && !chromeFailure) {
        if (!chromeExit) {
          chrome.kill('SIGTERM');
          const exited = once(chrome, 'exit').catch(() => {});
          const grace = new Promise((resolve) => setTimeout(resolve, CHROME_GRACE_MS));
          await Promise.race([exited, grace]);
          if (!chromeExit) {
            chrome.kill('SIGKILL');
            await exited;
          }
        }
      }
    } catch (error) {
      console.error('teardown: stop chromium failed:', error.message);
    }
    try {
      if (profileDir) await rm(profileDir, { recursive: true, force: true });
    } catch (error) {
      console.error('teardown: remove profile failed:', error.message);
    }
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof ProbeFailure)) {
    fail('fatal', error instanceof Error ? error.message : String(error));
  }
}
process.exitCode = printSummary() > 0 ? 1 : 0;
