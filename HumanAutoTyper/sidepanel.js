const $ = (id) => document.getElementById(id);

function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = text;
}

function setPauseButton(paused) {
  const btn = $("pauseBtn");
  if (!btn) return;
  btn.textContent = paused ? "Resume" : "Pause";
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    return {
      ok: false,
      message: err?.message || String(err)
    };
  }
}

async function refreshState() {
  const info = await send({ type: "GET_ACTIVE_TAB" });

  if (!info.ok) {
    setStatus(info.message || "No active tab");
    setPauseButton(false);
    return;
  }

  if (info.running) {
    setStatus(info.paused ? "Paused" : "Typing…");
  } else if (info.attached) {
    setStatus("Attached");
  } else {
    setStatus("Ready");
  }

  setPauseButton(!!info.paused);
}

$("attachBtn").addEventListener("click", async () => {
  setStatus("Attaching…");

  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) {
    alert(info.message || "No usable tab found. Open a Google Docs tab and try again.");
    setStatus("No active tab");
    return;
  }

  const res = await send({ type: "ATTACH", tabId: info.tabId });
  if (!res.ok) {
    alert(res.message || "Attach failed");
    setStatus("Attach failed");
    return;
  }

  setStatus("Attached");
});

$("detachBtn").addEventListener("click", async () => {
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) {
    alert(info.message || "No usable tab found.");
    setStatus("No active tab");
    return;
  }

  const res = await send({ type: "DETACH", tabId: info.tabId });
  if (!res.ok) {
    alert(res.message || "Detach failed");
    return;
  }

  setStatus("Detached");
  setPauseButton(false);
});

$("startBtn").addEventListener("click", async () => {
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) {
    alert(info.message || "No usable tab found. Open a Google Docs tab and try again.");
    setStatus("No active tab");
    return;
  }

  if (!info.attached) {
    setStatus("Attaching… (approve the prompt)");
    const attachRes = await send({ type: "ATTACH", tabId: info.tabId });

    if (!attachRes.ok) {
      alert(attachRes.message || "Attach failed (did you cancel the prompt?)");
      setStatus("Not attached");
      return;
    }
  }

  const payload = {
    text: $("text").value,
    wpm: Number($("wpm").value),
    fluct: Number($("fluct").value),
    typoChance: Number($("typo").value),
    maxPauseSec: Number($("maxPause").value),
    badMode: $("badMode").checked,
    perfectMode: $("perfectMode").checked
  };

  await send({ type: "RESUME", tabId: info.tabId });
  setPauseButton(false);

  setStatus("Typing… (make sure the cursor is in the doc)");

  const res = await send({
    type: "START",
    tabId: info.tabId,
    payload
  });

  if (!res.ok) {
    alert(res.message || "Start failed");
    setStatus("Error");
    return;
  }

  setStatus(res.message || "Done");
});

$("stopBtn").addEventListener("click", async () => {
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) {
    alert(info.message || "No usable tab found.");
    return;
  }

  const res = await send({ type: "STOP", tabId: info.tabId });
  if (!res.ok) {
    alert(res.message || "Stop failed");
    return;
  }

  setStatus("Stopped");
  setPauseButton(false);
});

$("pauseBtn").addEventListener("click", async () => {
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) {
    alert(info.message || "No usable tab found.");
    return;
  }

  const res = await send({ type: "TOGGLE_PAUSE", tabId: info.tabId });
  if (!res.ok) {
    alert(res.message || "Pause/Resume failed");
    return;
  }

  setPauseButton(!!res.paused);
  setStatus(res.paused ? "Paused" : "Typing…");
});

document.addEventListener("DOMContentLoaded", () => {
  refreshState();
});