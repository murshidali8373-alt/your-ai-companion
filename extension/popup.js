const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://ais-dev-5t53lwemhepi2nbkqb2reo-152127168827.asia-east1.run.app";

async function render() {
  const { session } = await chrome.storage.local.get("session");
  $("signedOut").hidden = Boolean(session);
  $("signedIn").hidden = !session;
  if (session) $("who").textContent = `Signed in as ${session.email || "you"}`;
}

$("connect").onclick = async () => {
  const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
  let targetBase = session?.apiBase || lastBase;
  if (!targetBase) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const u = new URL(tab.url);
        if (
          u.protocol.startsWith("http") &&
          (u.hostname.includes("run.app") ||
            u.hostname === "localhost" ||
            u.hostname === "127.0.0.1" ||
            tab.title?.includes("AI Buddy") ||
            tab.title?.includes("your-ai-companion") ||
            u.hostname.includes("aistudio.google.com"))
        ) {
          targetBase = u.hostname.includes("aistudio.google.com") ? DEFAULT_BASE : u.origin;
        }
      }
    } catch {}
  }
  const resolvedBase = targetBase || DEFAULT_BASE;
  await chrome.storage.local.set({ lastBase: resolvedBase });

  const connectUrl = new URL(`${resolvedBase}/connect`);
  if (session?.accessToken) {
    connectUrl.searchParams.set("ext_session", "active");
    if (session.email) connectUrl.searchParams.set("email", session.email);
  }
  connectUrl.searchParams.set("src", "extension_popup");

  chrome.tabs.create({ url: connectUrl.toString() });
};

$("signout").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  render();
};

let busy = false;
async function send(question, intent) {
  if (busy || !question.trim()) return;
  busy = true;
  $("send").disabled = true;
  $("status").textContent = "Reading the page and thinking…";
  $("answer").hidden = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "ASK", question, intent });
    if (res?.error) {
      $("status").textContent = res.message || "Something went wrong. Try again.";
      if (res.error === "signed_out") render();
      return;
    }
    $("answer").textContent = res.reply?.answer || "No answer came back.";
    $("answer").hidden = false;
    const notes = [];
    if (!res.pageReadable)
      notes.push("I could not read this page (browser-protected), so I answered generally.");
    if (res.highlightSelector) notes.push("I outlined the element on the page.");
    $("status").textContent = notes.join(" ");
  } catch {
    $("status").textContent = "Buddy could not be reached. Check your connection.";
  } finally {
    busy = false;
    $("send").disabled = false;
  }
}

$("send").onclick = () => send($("q").value, "answer");
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send($("q").value, "answer");
  }
});
document
  .querySelectorAll("[data-q]")
  .forEach((b) => (b.onclick = () => send(b.dataset.q, b.dataset.i)));
chrome.storage.local.get("session").then(({ session }) => {
  if (session?.apiBase) chrome.storage.local.set({ lastBase: session.apiBase });
});
render();

if ($("openSidePanel")) {
  $("openSidePanel").onclick = async () => {
    if (chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId });
        window.close();
        return;
      }
    }
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
    window.close();
  };
}
