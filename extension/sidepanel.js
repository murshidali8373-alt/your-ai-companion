const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://id-preview--142f3fbd-6878-42b4-9fe5-1517e2fe8f28.lovable.app";

let busy = false;
let currentAnswer = "";
let lastHighlightSelector = null;
let pendingAction = null;
let recognition = null;
let isRecognizing = false;
let isMuted = false;
let isLowGraphics = false;

// --- Rigged SVG Animation Controller ---
let currentEmotion = "idle";
let blinkInterval = null;
let speechMouthInterval = null;

const MOUTH_SHAPES = {
  rest: "M 92 126 Q 100 131 108 126",
  smile: "M 90 126 Q 100 136 110 126",
  wide_smile: "M 88 126 Q 100 144 112 126 Z",
  open_o: "M 94 125 C 94 120 106 120 106 125 C 106 133 94 133 94 125 Z",
  open_a: "M 90 124 Q 100 142 110 124 Q 100 122 90 124 Z",
  open_e: "M 88 125 Q 100 133 112 125 Q 100 128 88 125 Z",
  frown: "M 90 130 Q 100 123 110 130",
  laugh: "M 86 124 Q 100 146 114 124 Z",
};

function setMouthShape(shape) {
  const mouthEl = $("rigMouth");
  if (!mouthEl) return;
  const path = MOUTH_SHAPES[shape] || MOUTH_SHAPES.rest;
  mouthEl.setAttribute("d", path);
  mouthEl.setAttribute(
    "fill",
    shape === "wide_smile" || shape === "open_o" || shape === "open_a" || shape === "laugh"
      ? "#b91c1c"
      : "none",
  );
}

function setEmotion(emotion, label) {
  setRigEmotion(emotion, label);
}

function setRigEmotion(emotion, label) {
  currentEmotion = emotion;
  const badge = $("buddyEmotionBadge");
  if (badge) {
    badge.textContent = label || emotion.toUpperCase();
    badge.className = `status-badge ${emotion}`;
  }

  const browLeft = $("rigBrowLeft");
  const browRight = $("rigBrowRight");
  const armLeft = $("rigArmLeft");
  const armRight = $("rigArmRight");

  if (!browLeft || !browRight) return;

  switch (emotion) {
    case "happy":
    case "excited":
      browLeft.setAttribute("transform", "translate(80, 64) rotate(-8)");
      browRight.setAttribute("transform", "translate(120, 64) rotate(8)");
      setMouthShape("wide_smile");
      if (armLeft) armLeft.setAttribute("transform", "translate(0, -6)");
      break;
    case "thinking":
      browLeft.setAttribute("transform", "translate(80, 66) rotate(-10)");
      browRight.setAttribute("transform", "translate(120, 66) rotate(6)");
      setMouthShape("rest");
      if (armLeft) armLeft.setAttribute("transform", "translate(12, -14)");
      break;
    case "confused":
      browLeft.setAttribute("transform", "translate(80, 67) rotate(-14)");
      browRight.setAttribute("transform", "translate(120, 67) rotate(10)");
      setMouthShape("frown");
      break;
    case "listening":
      browLeft.setAttribute("transform", "translate(80, 65) rotate(-5)");
      browRight.setAttribute("transform", "translate(120, 65) rotate(5)");
      setMouthShape("smile");
      break;
    case "speaking":
      browLeft.setAttribute("transform", "translate(80, 65) rotate(-6)");
      browRight.setAttribute("transform", "translate(120, 65) rotate(6)");
      break;
    case "error":
      browLeft.setAttribute("transform", "translate(80, 70) rotate(10)");
      browRight.setAttribute("transform", "translate(120, 70) rotate(-10)");
      setMouthShape("frown");
      break;
    case "idle":
    default:
      browLeft.setAttribute("transform", "translate(80, 68) rotate(0)");
      browRight.setAttribute("transform", "translate(120, 68) rotate(0)");
      setMouthShape("smile");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
  }
}

// Mouse pupil tracking
window.addEventListener("mousemove", (e) => {
  if (isLowGraphics) return;
  const stage = $("characterStage");
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const dx = ((e.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2)) * 1.2;
  const dy = ((e.clientY - (rect.top + rect.height * 0.4)) / (window.innerHeight / 2)) * 1.0;
  const pupilLeft = $("rigPupilLeft");
  const pupilRight = $("rigPupilRight");
  if (pupilLeft && pupilRight) {
    const clampX = Math.max(-1.2, Math.min(1.2, dx));
    const clampY = Math.max(-1.0, Math.min(1.0, dy));
    pupilLeft.setAttribute("transform", `translate(${clampX.toFixed(2)}, ${clampY.toFixed(2)})`);
    pupilRight.setAttribute("transform", `translate(${clampX.toFixed(2)}, ${clampY.toFixed(2)})`);
  }
});

// Natural blinking
function setupBlinking() {
  if (blinkInterval) clearInterval(blinkInterval);
  blinkInterval = setInterval(() => {
    const lidLeft = $("rigLidLeft");
    const lidRight = $("rigLidRight");
    const pupilLeft = $("rigPupilLeft");
    const pupilRight = $("rigPupilRight");
    if (!lidLeft || !lidRight) return;

    lidLeft.style.display = "block";
    lidRight.style.display = "block";
    if (pupilLeft) pupilLeft.style.display = "none";
    if (pupilRight) pupilRight.style.display = "none";

    setTimeout(() => {
      lidLeft.style.display = "none";
      lidRight.style.display = "none";
      if (pupilLeft) pupilLeft.style.display = "block";
      if (pupilRight) pupilRight.style.display = "block";
    }, 180);
  }, 3800);
}
setupBlinking();

// Speech mouth cycling
function startSpeechMouthCycle() {
  if (speechMouthInterval) clearInterval(speechMouthInterval);
  const shapes = ["open_a", "open_o", "open_e", "wide_smile", "rest", "open_a"];
  let idx = 0;
  speechMouthInterval = setInterval(() => {
    idx = (idx + 1) % shapes.length;
    setMouthShape(shapes[idx]);
  }, 130);
}

function stopSpeechMouthCycle() {
  if (speechMouthInterval) {
    clearInterval(speechMouthInterval);
    speechMouthInterval = null;
  }
  setMouthShape("smile");
}

// Tap Buddy to trigger giggle
$("characterStage").addEventListener("click", () => {
  if (busy || isRecognizing) return;
  setRigEmotion("happy", "Giggle");
  setMouthShape("laugh");
  setTimeout(() => {
    setRigEmotion("idle", "Idle");
  }, 900);
});

// Setup Web Speech recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-IN";

  recognition.onstart = () => {
    isRecognizing = true;
    $("voiceBtn").classList.add("active");
    $("voiceBtn").textContent = "🛑 Listening…";
    setRigEmotion("listening", "Listening");
    $("statusText").textContent = "Listening to your voice…";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript || "";
    if (transcript.trim()) {
      $("promptInput").value = transcript;
      sendQuery(transcript, "answer");
    }
  };

  recognition.onerror = () => {
    stopVoice();
  };

  recognition.onend = () => {
    stopVoice();
  };
}

function stopVoice() {
  isRecognizing = false;
  $("voiceBtn").classList.remove("active");
  $("voiceBtn").textContent = "🎤 Talk";
  if (!busy) setRigEmotion("idle", "Idle");
}

function appendHistory(role, text) {
  const box = $("historyBox");
  if (!box) return;
  const bubble = document.createElement("div");
  bubble.className = `msg-bubble ${role === "user" ? "msg-user" : "msg-buddy"}`;
  bubble.textContent = text;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

// Speak out answer with lip synchronization
function speakResponse(text) {
  if (isMuted || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";

  utterance.onstart = () => {
    setRigEmotion("speaking", "Speaking");
    startSpeechMouthCycle();
  };

  utterance.onend = () => {
    stopSpeechMouthCycle();
    setRigEmotion("idle", "Idle");
  };

  utterance.onerror = () => {
    stopSpeechMouthCycle();
    setRigEmotion("idle", "Idle");
  };

  window.speechSynthesis.speak(utterance);
}

async function render() {
  const { session } = await chrome.storage.local.get("session");
  const isAuth = Boolean(session);
  $("signedOut").hidden = isAuth;
  $("signedIn").hidden = !isAuth;
  $("signoutBtn").hidden = !isAuth;

  if (session) {
    $("userAccount").textContent = `Connected: ${session.email || "User"}`;
    if (session.apiBase) {
      chrome.storage.local.set({ lastBase: session.apiBase });
    }
  } else {
    $("userAccount").textContent = "Not connected";
    setRigEmotion("idle", "Ready");
  }
}

$("connectBtn").onclick = async () => {
  const { lastBase } = await chrome.storage.local.get("lastBase");
  chrome.tabs.create({ url: `${lastBase || DEFAULT_BASE}/connect` });
};

$("signoutBtn").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  render();
};

$("voiceBtn").onclick = () => {
  if (!recognition) {
    alert("Speech recognition is not supported in this browser window.");
    return;
  }
  if (isRecognizing) {
    recognition.stop();
  } else {
    try {
      recognition.start();
    } catch {
      stopVoice();
    }
  }
};

$("speakAnswerBtn").onclick = () => {
  if (!currentAnswer) return;
  speakResponse(currentAnswer);
};

$("highlightBtn").onclick = async () => {
  if (!lastHighlightSelector) return;
  $("statusText").textContent = `Highlighting ${lastHighlightSelector}…`;
  const res = await chrome.runtime.sendMessage({
    type: "HIGHLIGHT",
    selector: lastHighlightSelector,
  });
  if (res?.ok) {
    setRigEmotion("happy", "Located");
    $("statusText").textContent = "Outlined target element on page.";
    setTimeout(() => setRigEmotion("idle", "Idle"), 2000);
  } else {
    $("statusText").textContent = "Could not find element on active page.";
  }
};

// Consequential action confirmation handling
$("confirmApproveBtn").onclick = async () => {
  if (!pendingAction) return;
  $("confirmCard").hidden = true;
  $("statusText").textContent = `Executing ${pendingAction.type}…`;
  setRigEmotion("working", "Acting");

  const res = await chrome.runtime.sendMessage({
    type: "EXECUTE_ACTION",
    action: pendingAction.type,
    selector: pendingAction.selector,
    value: pendingAction.value,
  });

  if (res?.ok) {
    setRigEmotion("happy", "Done");
    $("statusText").textContent = res.message || "Action finished successfully.";
    appendHistory("buddy", `✅ Done: ${res.message || "Action completed."}`);
  } else {
    setRigEmotion("error", "Notice");
    $("statusText").textContent = res?.message || "Action failed or was blocked.";
  }
  pendingAction = null;
  setTimeout(() => setRigEmotion("idle", "Idle"), 2500);
};

$("confirmCancelBtn").onclick = () => {
  $("confirmCard").hidden = true;
  pendingAction = null;
  setRigEmotion("idle", "Idle");
  $("statusText").textContent = "Action cancelled.";
};

async function sendQuery(question, intent) {
  if (busy || !question.trim()) return;
  busy = true;
  $("sendBtn").disabled = true;
  appendHistory("user", question.trim());
  $("promptInput").value = "";

  setRigEmotion("thinking", "Thinking…");
  $("statusText").textContent = "Reading page snapshot & analyzing…";
  $("highlightBtn").hidden = true;
  $("speakAnswerBtn").hidden = true;

  try {
    const res = await chrome.runtime.sendMessage({ type: "ASK", question, intent });
    if (res?.error) {
      setRigEmotion("error", "Notice");
      $("statusText").textContent = res.message || "Could not finish that. Please try again.";
      appendHistory("buddy", res.message || "An error occurred.");
      if (res.error === "signed_out") render();
      return;
    }

    currentAnswer = res.reply?.answer || "No response received.";
    appendHistory("buddy", currentAnswer);

    lastHighlightSelector = res.highlightSelector || null;
    if (lastHighlightSelector) {
      $("highlightBtn").hidden = false;
    }
    $("speakAnswerBtn").hidden = false;

    // Detect if high-impact action needs confirmation
    const qLower = question.toLowerCase();
    if (
      qLower.includes("submit") ||
      qLower.includes("click") ||
      qLower.includes("pay") ||
      qLower.includes("delete")
    ) {
      pendingAction = {
        type: qLower.includes("click") ? "click" : "scroll",
        selector: lastHighlightSelector,
        value: "",
      };
      $("confirmDesc").textContent =
        `Buddy is asking approval before acting on: "${question.slice(0, 80)}"`;
      $("confirmCard").hidden = false;
      setRigEmotion("thinking", "Confirm");
    } else {
      setRigEmotion("happy", "Answered");
      speakResponse(currentAnswer);
    }

    $("statusText").textContent = res.pageReadable ? "Snapshot analyzed." : "Answered generally.";
  } catch (err) {
    setRigEmotion("error", "Error");
    $("statusText").textContent = "Could not reach AI service. Please verify connection.";
  } finally {
    busy = false;
    $("sendBtn").disabled = false;
  }
}

$("sendBtn").onclick = () => sendQuery($("promptInput").value, "answer");

$("promptInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendQuery($("promptInput").value, "answer");
  }
});

document.querySelectorAll("[data-q]").forEach((btn) => {
  btn.onclick = () => sendQuery(btn.dataset.q, btn.dataset.i);
});

// Settings toggles
$("settingsToggle").onclick = () => {
  $("settingsBox").hidden = !$("settingsBox").hidden;
};

$("muteToggle").onchange = (e) => {
  isMuted = e.target.checked;
  if (isMuted && window.speechSynthesis) window.speechSynthesis.cancel();
};

$("lowGraphicsToggle").onchange = (e) => {
  isLowGraphics = e.target.checked;
};

$("sizeSelect").onchange = (e) => {
  const stage = $("characterStage");
  if (!stage) return;
  if (e.target.value === "hidden") {
    stage.style.display = "none";
  } else if (e.target.value === "compact") {
    stage.style.display = "flex";
    $("characterSvg").style.width = "90px";
    $("characterSvg").style.height = "105px";
  } else {
    stage.style.display = "flex";
    $("characterSvg").style.width = "140px";
    $("characterSvg").style.height = "160px";
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.session) {
    render();
  }
});

render();
