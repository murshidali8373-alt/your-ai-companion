const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://id-preview--142f3fbd-6878-42b4-9fe5-1517e2fe8f28.lovable.app";

let busy = false;
let currentAnswer = "";
let recognition = null;
let isRecognizing = false;

// Setup Web Speech recognition if available
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
    setEmotion("listening", "Listening…");
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
  if (!busy) setEmotion("neutral", "Idle");
}

function setEmotion(emotion, label) {
  $("buddyAvatar").dataset.emotion = emotion;
  $("buddyEmotionBadge").textContent = label || emotion.toUpperCase();
}

async function render() {
  const { session } = await chrome.storage.local.get("session");
  const isAuth = Boolean(session);
  $("signedOut").hidden = isAuth;
  $("signedIn").hidden = !isAuth;
  $("signoutBtn").hidden = !isAuth;

  if (session) {
    $("userAccount").textContent = `Signed in as ${session.email || "you"}`;
    if (session.apiBase) {
      chrome.storage.local.set({ lastBase: session.apiBase });
    }
  } else {
    $("userAccount").textContent = "Not connected";
    setEmotion("neutral", "Ready");
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
  if (!currentAnswer || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentAnswer);
  utterance.onstart = () => setEmotion("speaking", "Speaking");
  utterance.onend = () => setEmotion("neutral", "Idle");
  utterance.onerror = () => setEmotion("neutral", "Idle");
  window.speechSynthesis.speak(utterance);
};

async function sendQuery(question, intent) {
  if (busy || !question.trim()) return;
  busy = true;
  $("sendBtn").disabled = true;
  setEmotion("thinking", "Thinking…");
  $("statusText").className = "status-msg thinking";
  $("statusText").textContent = "Reading page context and analyzing…";
  $("answerCard").hidden = true;
  $("speakAnswerBtn").hidden = true;

  try {
    const res = await chrome.runtime.sendMessage({ type: "ASK", question, intent });
    if (res?.error) {
      setEmotion("concerned", "Notice");
      $("statusText").className = "status-msg";
      $("statusText").textContent = res.message || "Something went wrong. Please try again.";
      if (res.error === "signed_out") render();
      return;
    }

    currentAnswer = res.reply?.answer || "No response received.";
    $("answerText").textContent = currentAnswer;
    $("answerBuddy").textContent = res.reply?.buddyName || "Buddy";
    $("answerCard").hidden = false;
    $("speakAnswerBtn").hidden = false;

    const notes = [];
    if (!res.pageReadable) notes.push("Protected page — answered generally.");
    if (res.highlightSelector) notes.push("Element outlined on page.");
    $("pageNote").textContent = notes.join(" ");

    $("statusText").className = "status-msg";
    $("statusText").textContent = "";
    setEmotion("happy", "Answered");
  } catch (err) {
    setEmotion("concerned", "Error");
    $("statusText").className = "status-msg";
    $("statusText").textContent = "Could not reach AI Buddy. Please verify connection.";
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.session) {
    render();
  }
});

render();
