const $ = (id) => document.getElementById(id);

let isPaused = false;

function setStatus(text) {
  $("status").innerHTML = `Status: <strong>${text}</strong>`;
}

function syncVals() {
  $("wpmVal").textContent = $("wpm").value;
  $("fluctVal").textContent = $("fluct").value;
  $("typoVal").textContent = $("typo").value;
  $("pauseVal").textContent = Number($("maxPause").value).toFixed(1);
}

["wpm","fluct","typo","maxPause"].forEach(id => $(id).addEventListener("input", syncVals));

$("perfectMode").addEventListener("change", () => {
  if ($("perfectMode").checked) {
    $("badMode").checked = false;
    $("badMode").disabled = true;
  } else {
    $("badMode").disabled = false;
  }
});

async function send(msg) {
  return await chrome.runtime.sendMessage(msg);
}

function setPauseButton(paused) {
  isPaused = !!paused;
  $("pauseBtn").textContent = isPaused ? "Resume" : "Pause";
}

async function refreshState() {
  const res = await send({ type: "GET_ACTIVE_TAB" });
  if (!res.ok) {
    setStatus("No active tab");
    return;
  }

  setPauseButton(res.paused);

  if (!res.attached) setStatus("Idle");
  else if (res.running) setStatus(res.paused ? "Paused (at boundary)" : "Attached + typing");
  else setStatus(res.paused ? "Attached (paused)" : "Attached");
}

$("attachBtn").addEventListener("click", async () => {
  setStatus("Attaching…");
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) { setStatus("No active tab"); return; }

  const res = await send({ type: "ATTACH", tabId: info.tabId });
  if (!res.ok) {
    alert(res.message || "Attach failed");
    setStatus("Attach failed");
    return;
  }
  setStatus("Attached");
});

$("detachBtn").addEventListener("click", async () => {
  setStatus("Detaching…");
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) { setStatus("No active tab"); return; }

  await send({ type: "DETACH", tabId: info.tabId });
  setPauseButton(false);
  setStatus("Idle");
});

$("startBtn").addEventListener("click", async () => {
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) { setStatus("No active tab"); return; }

  // Auto-attach if needed
  if (!info.attached) {
    setStatus("Attaching… (approve the prompt)");
    const a = await send({ type: "ATTACH", tabId: info.tabId });
    if (!a.ok) {
      alert(a.message || "Attach failed (did you cancel the prompt?)");
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

  // Starting should clear paused so it runs immediately
  await send({ type: "RESUME", tabId: info.tabId });
  setPauseButton(false);

  setStatus("Typing… (make sure the cursor is in the doc)");
  const res = await send({ type: "START", tabId: info.tabId, payload });

  if (!res.ok) {
    alert(res.message || "Start failed");
    setStatus("Error");
    return;
  }
  setStatus(res.message || "Done");
});

$("pauseBtn").addEventListener("click", async () => {
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) { setStatus("No active tab"); return; }

  const res = await send({ type: "TOGGLE_PAUSE", tabId: info.tabId });
  if (!res.ok) {
    setStatus("Pause failed");
    return;
  }

  setPauseButton(res.paused);
  setStatus(res.paused ? "Pausing… (at next boundary)" : "Typing…");
});

$("stopBtn").addEventListener("click", async () => {
  const info = await send({ type: "GET_ACTIVE_TAB" });
  if (!info.ok) { setStatus("No active tab"); return; }

  await send({ type: "STOP", tabId: info.tabId });
  setPauseButton(false);
  setStatus("Stopped");
});

syncVals();
refreshState();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshState();
});
