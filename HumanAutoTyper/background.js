const DEBUGGER_PROTOCOL_VERSION = "1.3";

// Per-tab state
// { attached:boolean, stop:boolean, running:boolean, paused:boolean }
const tabState = new Map();

function getState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, {
      attached: false,
      stop: false,
      running: false,
      paused: false
    });
  }
  return tabState.get(tabId);
}

async function getCandidateTabs() {
  return await chrome.tabs.query({ lastFocusedWindow: true });
}

function isRestrictedUrl(url = "") {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  );
}

function isDocsUrl(url = "") {
  return (
    url.startsWith("https://docs.google.com/document/") ||
    url.startsWith("https://docs.google.com/")
  );
}

async function getActiveTabId() {
  const tabs = await getCandidateTabs();

  if (!tabs.length) {
    throw new Error("No browser tabs found.");
  }

  // Prefer the active usable Docs tab
  const activeDocsTab = tabs.find((tab) =>
    tab.active &&
    tab.id != null &&
    !isRestrictedUrl(tab.url) &&
    isDocsUrl(tab.url)
  );
  if (activeDocsTab) return activeDocsTab.id;

  // Otherwise prefer any active usable normal web tab
  const activeUsable = tabs.find((tab) =>
    tab.active &&
    tab.id != null &&
    !isRestrictedUrl(tab.url) &&
    /^https?:\/\//.test(tab.url || "")
  );
  if (activeUsable) return activeUsable.id;

  // Otherwise prefer any Docs tab
  const docsTab = tabs.find((tab) =>
    tab.id != null &&
    !isRestrictedUrl(tab.url) &&
    isDocsUrl(tab.url)
  );
  if (docsTab) return docsTab.id;

  // Otherwise any normal web tab
  const normalTab = tabs.find((tab) =>
    tab.id != null &&
    !isRestrictedUrl(tab.url) &&
    /^https?:\/\//.test(tab.url || "")
  );
  if (normalTab) return normalTab.id;

  throw new Error("No usable tab found. Open and focus a Google Docs tab, then try again.");
}

async function getTabOrThrow(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || tab.id == null) {
    throw new Error("Target tab was not found.");
  }
  return tab;
}

function assertAttachableTab(tab) {
  const url = tab?.url || "";

  if (isRestrictedUrl(url)) {
    throw new Error(
      "Cannot use Human Typer on browser internal pages or extension pages. Please switch to a Google Docs document tab."
    );
  }

  if (!isDocsUrl(url)) {
    throw new Error("Please open a Google Docs document tab before attaching.");
  }
}

async function attachDebugger(tabId) {
  const tab = await getTabOrThrow(tabId);
  assertAttachableTab(tab);

  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      const s = getState(tabId);
      s.attached = true;
      resolve(true);
    });
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      const s = getState(tabId);
      s.attached = false;
      s.running = false;
      s.stop = false;
      s.paused = false;
      resolve(true);
    });
  });
}

function sendCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(result);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function isWhitespace(ch) {
  return /\s/.test(ch);
}

// Simple keyboard-neighbor typo simulation
function neighborKey(ch) {
  const map = {
    a: ["s", "q", "w", "z"],
    b: ["v", "g", "h", "n"],
    c: ["x", "d", "f", "v"],
    d: ["s", "e", "r", "f", "c", "x"],
    e: ["w", "s", "d", "r"],
    f: ["d", "r", "t", "g", "v", "c"],
    g: ["f", "t", "y", "h", "b", "v"],
    h: ["g", "y", "u", "j", "n", "b"],
    i: ["u", "j", "k", "o"],
    j: ["h", "u", "i", "k", "m", "n"],
    k: ["j", "i", "o", "l", "m"],
    l: ["k", "o", "p"],
    m: ["n", "j", "k"],
    n: ["b", "h", "j", "m"],
    o: ["i", "k", "l", "p"],
    p: ["o", "l"],
    q: ["w", "a"],
    r: ["e", "d", "f", "t"],
    s: ["a", "w", "e", "d", "x", "z"],
    t: ["r", "f", "g", "y"],
    u: ["y", "h", "j", "i"],
    v: ["c", "f", "g", "b"],
    w: ["q", "a", "s", "e"],
    x: ["z", "s", "d", "c"],
    y: ["t", "g", "h", "u"],
    z: ["a", "s", "x"]
  };

  const lower = ch.toLowerCase();
  const choices = map[lower];
  if (!choices || !choices.length) return "e";

  const pick = choices[randInt(0, choices.length - 1)];
  return ch === lower ? pick : pick.toUpperCase();
}

async function keyDownUp(tabId, opts) {
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    ...opts
  });
  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    ...opts
  });
}

async function typeChar(tabId, ch) {
  if (ch === "\n") {
    await keyDownUp(tabId, {
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13
    });
    return;
  }

  if (ch === "\t") {
    await keyDownUp(tabId, {
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9
    });
    return;
  }

  await sendCommand(tabId, "Input.dispatchKeyEvent", {
    type: "char",
    text: ch
  });
}

async function backspace(tabId) {
  await keyDownUp(tabId, {
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8
  });
}

async function waitWhilePaused(tabId) {
  const state = getState(tabId);
  while (state.paused && !state.stop) {
    await sleep(80);
  }
}

async function maybePauseAtBoundaryBeforeChar(tabId, text, i) {
  const state = getState(tabId);
  if (!state.paused) return;

  if (i === 0 || isWhitespace(text[i - 1])) {
    await waitWhilePaused(tabId);
  }
}

async function maybePauseAtBoundaryAfterChar(tabId, ch) {
  const state = getState(tabId);
  if (!state.paused) return;

  if (isWhitespace(ch)) {
    await waitWhilePaused(tabId);
  }
}

async function maybeRandomBadPause(tabId, ch, modeBad, maxPauseMs) {
  const state = getState(tabId);
  if (!modeBad) return;
  if (maxPauseMs <= 0) return;
  if (state.stop) return;

  const p = isWhitespace(ch) ? 0.08 : 0.025;
  if (Math.random() >= p) return;

  const pauseMs = Math.round(Math.pow(Math.random(), 0.55) * maxPauseMs);
  if (pauseMs < 30) return;

  await sleep(pauseMs);
}

async function runTyping(tabId, payload) {
  const state = getState(tabId);

  if (!state.attached) {
    throw new Error("Not attached. Click Start (auto-attach) or Attach first.");
  }

  if (state.running) {
    throw new Error("Already running.");
  }

  const tab = await getTabOrThrow(tabId);
  assertAttachableTab(tab);

  state.running = true;
  state.stop = false;

  const text = String(payload.text || "");
  if (!text.trim()) {
    state.running = false;
    return { ok: false, message: "No text provided." };
  }

  const baseWpm = clamp(Number(payload.wpm ?? 60), 5, 240);
  const fluct = clamp(Number(payload.fluct ?? 0), 0, 160);
  const typoChance = clamp(Number(payload.typoChance ?? 0), 0, 100) / 100;
  const badMode = !!payload.badMode;
  const perfectMode = !!payload.perfectMode;
  const maxPauseSec = clamp(Number(payload.maxPauseSec ?? 0), 0, 30);
  const maxPauseMs = Math.round(maxPauseSec * 1000);

  const modeBad = perfectMode ? false : badMode;
  const modePerfect = !!perfectMode;

  try {
    for (let i = 0; i < text.length; i++) {
      if (state.stop) {
        return { ok: true, message: "Stopped." };
      }

      await maybePauseAtBoundaryBeforeChar(tabId, text, i);
      if (state.stop) {
        return { ok: true, message: "Stopped." };
      }

      const ch = text[i];

      let effectiveWpm = baseWpm;
      if (modeBad && fluct > 0) {
        effectiveWpm = clamp(baseWpm + randFloat(-fluct, fluct), 5, 260);
      } else if (!modePerfect && fluct > 0) {
        effectiveWpm = clamp(baseWpm + randFloat(-fluct * 0.25, fluct * 0.25), 5, 260);
      }

      let msPerChar = Math.round(60000 / (effectiveWpm * 5));

      if (modeBad) {
        if (Math.random() < 0.05) msPerChar += randInt(80, 350);
        if (isWhitespace(ch) && Math.random() < 0.12) {
          msPerChar += randInt(250, 1200);
        }
      } else if (modePerfect) {
        msPerChar += randInt(-5, 10);
      } else {
        if (Math.random() < 0.02) msPerChar += randInt(60, 220);
        msPerChar += randInt(-10, 25);
      }

      const doTypo = modeBad && /[A-Za-z]/.test(ch) && Math.random() < typoChance;

      if (!doTypo) {
        await typeChar(tabId, ch);
      } else {
        const wrong = neighborKey(ch);
        await typeChar(tabId, wrong);

        await sleep(randInt(120, 520));
        if (state.stop) {
          return { ok: true, message: "Stopped." };
        }

        await backspace(tabId);
        await sleep(randInt(40, 140));
        await typeChar(tabId, ch);
      }

      await maybePauseAtBoundaryAfterChar(tabId, ch);
      if (state.stop) {
        return { ok: true, message: "Stopped." };
      }

      await maybeRandomBadPause(tabId, ch, modeBad, maxPauseMs);
      if (state.stop) {
        return { ok: true, message: "Stopped." };
      }

      await sleep(clamp(msPerChar, 5, 2000));
    }

    return { ok: true, message: "Done." };
  } finally {
    state.running = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_ACTIVE_TAB") {
      const tabId = await getActiveTabId();
      const s = getState(tabId);
      sendResponse({
        ok: true,
        tabId,
        attached: s.attached,
        running: s.running,
        paused: s.paused
      });
      return;
    }

    if (msg?.type === "ATTACH") {
      const tabId = msg.tabId ?? await getActiveTabId();
      await attachDebugger(tabId);
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "DETACH") {
      const tabId = msg.tabId ?? await getActiveTabId();
      await detachDebugger(tabId);
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "START") {
      const tabId = msg.tabId ?? await getActiveTabId();
      const s = getState(tabId);
      s.stop = false;

      const res = await runTyping(tabId, msg.payload || {});
      sendResponse(res);
      return;
    }

    if (msg?.type === "STOP") {
      const tabId = msg.tabId ?? await getActiveTabId();
      const s = getState(tabId);
      s.stop = true;
      s.paused = false;
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "PAUSE") {
      const tabId = msg.tabId ?? await getActiveTabId();
      const s = getState(tabId);
      s.paused = true;
      sendResponse({ ok: true, paused: true });
      return;
    }

    if (msg?.type === "RESUME") {
      const tabId = msg.tabId ?? await getActiveTabId();
      const s = getState(tabId);
      s.paused = false;
      sendResponse({ ok: true, paused: false });
      return;
    }

    if (msg?.type === "TOGGLE_PAUSE") {
      const tabId = msg.tabId ?? await getActiveTabId();
      const s = getState(tabId);
      s.paused = !s.paused;
      sendResponse({ ok: true, paused: s.paused });
      return;
    }

    sendResponse({ ok: false, message: "Unknown message." });
  })().catch((err) => {
    sendResponse({ ok: false, message: err?.message || String(err) });
  });

  return true;
});