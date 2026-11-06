const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://id-preview--142f3fbd-6878-42b4-9fe5-1517e2fe8f28.lovable.app";

let busy = false;
let currentAnswer = "";
let lastHighlightSelector = null;
let lastCallout = { title: null, description: null };

function pointAt() {
  setRigEmotion("pointing", "Pointing");
  setTimeout(() => { if (currentEmotion === "pointing") setRigEmotion("idle", "Idle"); }, 3500);
}
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
  rest: "M 46 51 Q 50 53 54 51",
  smile: "M 45 51 Q 50 55 55 51",
  wide_smile: "M 44 51 Q 50 58 56 51 Q 50 49 44 51 Z",
  open_o: "M 47 51 C 47 48 53 48 53 51 C 53 55 47 55 47 51 Z",
  open_a: "M 45 51 Q 50 57 55 51 Q 50 48 45 51 Z",
  open_e: "M 45 51 Q 50 54 55 51 Q 50 49 45 51 Z",
  frown: "M 45 51 Q 50 47 55 51",
  laugh: "M 43 51 Q 50 59 57 51 Q 50 48 43 51 Z",
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

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Maps Gemini backend emotion response keys (idle, thinking, happy, pointing, speaking, listening)
 * to setRigEmotion() to unify animation states.
 */
function mapBackendEmotion(rawEmotion, hasHighlight) {
  if (hasHighlight) return "pointing";
  const e = String(rawEmotion || "").toLowerCase().trim();
  switch (e) {
    case "thinking":
      return "thinking";
    case "happy":
    case "celebrate":
    case "excited":
    case "success":
      return "happy";
    case "pointing":
      return "pointing";
    case "speaking":
      return "speaking";
    case "listening":
      return "listening";
    case "concerned":
    case "error":
      return "error";
    case "curious":
    case "confused":
      return "confused";
    case "idle":
    case "neutral":
    default:
      return "idle";
  }
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
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-8)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(8)");
      setMouthShape("wide_smile");
      if (armLeft) armLeft.setAttribute("transform", "translate(0, -3)");
      if (armRight) armRight.setAttribute("transform", "translate(0, -3)");
      break;
    case "thinking":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-10)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(6)");
      setMouthShape("rest");
      if (armLeft) armLeft.setAttribute("transform", "translate(2, -3)");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "pointing":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-5)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(5)");
      setMouthShape("smile");
      if (armLeft) armLeft.setAttribute("transform", "rotate(58 34 62) scale(1.2 1)");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "confused":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-12)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(10)");
      setMouthShape("frown");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "listening":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-6)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(6)");
      setMouthShape("smile");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "speaking":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-4)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(4)");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "error":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(10)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(-10)");
      setMouthShape("frown");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "idle":
    default:
      browLeft.setAttribute("transform", "translate(40, 36) rotate(0)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(0)");
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
  const dx = ((e.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2)) * 1.1;
  const dy = ((e.clientY - (rect.top + rect.height * 0.4)) / (window.innerHeight / 2)) * 0.8;
  const pupilLeft = $("rigPupilLeft");
  const pupilRight = $("rigPupilRight");
  if (pupilLeft && pupilRight) {
    const clampX = Math.max(-1.1, Math.min(1.1, dx));
    const clampY = Math.max(-0.8, Math.min(0.8, dy));
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

// Maintain a buffer of the last 3 turns of conversation
const MAX_CONVERSATION_TURNS = 3;
const conversationBuffer = [];
const conversationTurns = [];

function appendHistory(role, text) {
  conversationTurns.push({ role, text });
  if (conversationTurns.length > 20) conversationTurns.shift();
  const box = $("historyBox");
  if (!box) return;
  const bubble = document.createElement("div");
  bubble.className = `msg-bubble ${role === "user" ? "msg-user" : "msg-buddy"}`;
  bubble.textContent = text;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

function getRecentHistoryContext() {
  // Returns context of the last 3 turns of conversation formatted for Gemini
  return conversationBuffer.slice(-MAX_CONVERSATION_TURNS).flatMap((turn) => [
    { role: "user", content: turn.user },
    { role: "assistant", content: turn.assistant },
  ]);
}

function recordConversationTurn(userQuestion, assistantAnswer) {
  if (!userQuestion || !assistantAnswer) return;
  conversationBuffer.push({ user: userQuestion, assistant: assistantAnswer });
  if (conversationBuffer.length > MAX_CONVERSATION_TURNS) {
    conversationBuffer.shift();
  }
  chrome.storage.local.set({ conversationBuffer }).catch(() => {});
}

// Speak out answer with lip synchronization
function speakResponse(text, finishEmotion = "idle") {
  if (isMuted || !window.speechSynthesis) {
    setRigEmotion(finishEmotion, capitalize(finishEmotion));
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";

  utterance.onstart = () => {
    setRigEmotion("speaking", "Speaking");
    startSpeechMouthCycle();
  };

  utterance.onend = () => {
    stopSpeechMouthCycle();
    setRigEmotion(finishEmotion, capitalize(finishEmotion));
  };

  utterance.onerror = () => {
    stopSpeechMouthCycle();
    setRigEmotion(finishEmotion, capitalize(finishEmotion));
  };

  window.speechSynthesis.speak(utterance);
}

async function render() {
  const { session } = await chrome.storage.local.get("session");
  const isAuth = Boolean(session);
  $("signedOut").hidden = isAuth;
  $("signedIn").hidden = false;
  $("signoutBtn").hidden = !isAuth;

  if (session) {
    $("userAccount").textContent = `Connected: ${session.email || "User"}`;
    if (session.apiBase) {
      chrome.storage.local.set({ lastBase: session.apiBase });
    }
  } else {
    $("userAccount").textContent = "Guest Mode (Sign in optional)";
    setRigEmotion("idle", "Ready");
  }

  // Restore conversationBuffer from storage if available
  chrome.storage.local
    .get("conversationBuffer")
    .then((data) => {
      if (Array.isArray(data.conversationBuffer) && data.conversationBuffer.length > 0) {
        conversationBuffer.length = 0;
        const recent = data.conversationBuffer.slice(-MAX_CONVERSATION_TURNS);
        recent.forEach((t) => conversationBuffer.push(t));
        const box = $("historyBox");
        if (box && box.children.length === 0) {
          recent.forEach((t) => {
            appendHistory("user", t.user);
            appendHistory("buddy", t.assistant);
          });
        }
      }
    })
    .catch(() => {});

  checkPageForErrors();
}

async function checkPageForErrors() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || /^(chrome|edge|about|devtools):/i.test(tab.url)) return;

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["snapshot.js"],
    });
    const snapshot = res?.result;
    if (!snapshot) return;

    const alerts = snapshot.alerts || [];
    const invalidForms = (snapshot.forms || []).filter((f) => f.invalid);

    const banner = $("pageErrorBanner");
    const text = $("pageErrorText");
    if (!banner || !text) return;

    if (alerts.length > 0 || invalidForms.length > 0) {
      const parts = [];
      if (alerts.length > 0) {
        const preview = alerts[0].name.slice(0, 80);
        parts.push(`${alerts.length} alert(s): "${preview}"`);
      }
      if (invalidForms.length > 0) {
        parts.push(`${invalidForms.length} invalid form field(s) require attention.`);
      }
      text.textContent = parts.join(" — ");
      banner.hidden = false;
      setRigEmotion("confused", "Issues Found");
    } else {
      banner.hidden = true;
    }
  } catch {
    // Non-fatal
  }
}

$("fixErrorsBtn").onclick = () => {
  sendQuery(
    "Analyze the errors, alerts, and invalid form fields on this page. Explain why they occurred and give me step-by-step instructions to fix them.",
    "classify",
  );
};

$("dismissErrorsBtn").onclick = () => {
  if ($("pageErrorBanner")) $("pageErrorBanner").hidden = true;
};

$("connectBtn").onclick = async () => {
  const { lastBase } = await chrome.storage.local.get("lastBase");
  chrome.tabs.create({ url: `${lastBase || DEFAULT_BASE}/connect` });
};

$("signoutBtn").onclick = async () => {
  conversationBuffer.length = 0;
  conversationTurns.length = 0;
  if ($("historyBox")) $("historyBox").innerHTML = "";
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
    title: lastCallout.title,
    description: lastCallout.description,
  });
  if (res?.ok) {
    pointAt();
    $("statusText").textContent = "Buddy is pointing at it on the page.";
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

  // Extract the last 3 turns of conversation as context for Gemini
  const historyPayload = getRecentHistoryContext();

  appendHistory("user", question.trim());
  $("promptInput").value = "";

  setRigEmotion("thinking", "Thinking…");
  $("statusText").textContent = "Reading page snapshot & analyzing…";
  $("highlightBtn").hidden = true;
  $("speakAnswerBtn").hidden = true;

  try {
    const res = await chrome.runtime.sendMessage({
      type: "ASK",
      question,
      intent,
      history: historyPayload,
    });
    if (res?.error) {
      setRigEmotion("error", "Notice");
      $("statusText").textContent = res.message || "Could not finish that. Please try again.";
      appendHistory("buddy", res.message || "An error occurred.");
      if (res.error === "signed_out") render();
      return;
    }

    currentAnswer = res.reply?.answer || "No response received.";
    appendHistory("buddy", currentAnswer);
    recordConversationTurn(question.trim(), currentAnswer);

    lastHighlightSelector = res.highlightSelector || null;
    lastCallout = { title: res.calloutTitle || null, description: res.calloutDescription || null };
    if (lastHighlightSelector) {
      $("highlightBtn").hidden = false;
      pointAt();
    }
    $("speakAnswerBtn").hidden = false;

    const backendEmotion = res.reply?.emotion;
    const resolvedEmotion = mapBackendEmotion(backendEmotion, Boolean(lastHighlightSelector));

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
      if (lastHighlightSelector) {
        setRigEmotion("pointing", "Pointing");
      } else {
        setRigEmotion(resolvedEmotion, capitalize(resolvedEmotion));
      }
      speakResponse(currentAnswer, resolvedEmotion);
    }

    if (res.guest) {
      $("statusText").textContent = res.pageReadable
        ? "Page analyzed (Guest Mode)."
        : "Answered (Guest Mode).";
    } else {
      $("statusText").textContent = res.pageReadable ? "Snapshot analyzed." : "Answered generally.";
    }
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
