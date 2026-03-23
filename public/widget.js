/**
 * Chatbot Widget
 *
 * Drop-in embeddable chat widget powered by Claude.
 *
 * Usage — add ONE line to any HTML page:
 *   <script src="https://your-server.com/widget.js" data-server="https://your-server.com"></script>
 *
 * Optional attributes on the <script> tag:
 *   data-server      — base URL of the backend (default: same origin as the script)
 *   data-title       — header text shown in the chat window (default: "Chat with us")
 *   data-placeholder — input placeholder text
 *   data-theme       — accent color in CSS hex/rgb (default: "#2563eb")
 */
(function () {
  "use strict";

  // ── Config ──────────────────────────────────────────────────────────────────

  const scriptTag =
    document.currentScript ||
    document.querySelector('script[src*="widget.js"]');

  const SERVER =
    (scriptTag && scriptTag.getAttribute("data-server")) ||
    (scriptTag &&
      new URL(scriptTag.src).origin !== window.location.origin &&
      new URL(scriptTag.src).origin) ||
    "";

  const TITLE =
    (scriptTag && scriptTag.getAttribute("data-title")) || "Chat with us";
  const PLACEHOLDER =
    (scriptTag && scriptTag.getAttribute("data-placeholder")) ||
    "Type a message…";
  const THEME =
    (scriptTag && scriptTag.getAttribute("data-theme")) || "#2563eb";

  // ── State ───────────────────────────────────────────────────────────────────

  /** @type {{ role: "user" | "assistant", content: string }[]} */
  let conversationHistory = [];
  let isOpen = false;
  let isStreaming = false;

  // ── Styles ──────────────────────────────────────────────────────────────────

  const css = `
    #cw-root * { box-sizing: border-box; font-family: system-ui, sans-serif; margin: 0; padding: 0; }

    /* Floating button */
    #cw-toggle {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 56px; height: 56px; border-radius: 50%;
      background: ${THEME}; color: #fff; border: none; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s, box-shadow .15s;
    }
    #cw-toggle:hover { transform: scale(1.07); box-shadow: 0 6px 18px rgba(0,0,0,.3); }
    #cw-toggle svg { width: 26px; height: 26px; fill: #fff; }

    /* Chat window */
    #cw-window {
      position: fixed; bottom: 92px; right: 24px; z-index: 9999;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 120px);
      border-radius: 16px; overflow: hidden;
      display: flex; flex-direction: column;
      box-shadow: 0 8px 32px rgba(0,0,0,.18);
      background: #fff;
      transition: opacity .18s, transform .18s;
    }
    #cw-window.cw-hidden { opacity: 0; pointer-events: none; transform: translateY(12px) scale(.98); }

    /* Header */
    #cw-header {
      background: ${THEME}; color: #fff;
      padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;
    }
    #cw-header-title { font-size: 15px; font-weight: 600; }
    #cw-close {
      background: none; border: none; color: #fff; cursor: pointer;
      font-size: 20px; line-height: 1; opacity: .85;
    }
    #cw-close:hover { opacity: 1; }

    /* Messages */
    #cw-messages {
      flex: 1; overflow-y: auto; padding: 16px 12px;
      display: flex; flex-direction: column; gap: 10px;
      background: #f8f9fc;
    }
    .cw-msg { max-width: 82%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.5; word-break: break-word; }
    .cw-msg.cw-user { background: ${THEME}; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .cw-msg.cw-assistant { background: #fff; color: #1a1a1a; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .cw-msg.cw-typing { opacity: .6; font-style: italic; }

    /* Input row */
    #cw-input-row {
      display: flex; gap: 8px; padding: 12px;
      border-top: 1px solid #e8eaf0; background: #fff;
    }
    #cw-input {
      flex: 1; border: 1px solid #d1d5db; border-radius: 10px;
      padding: 9px 12px; font-size: 14px; outline: none; resize: none;
      max-height: 100px; overflow-y: auto;
      transition: border-color .15s;
    }
    #cw-input:focus { border-color: ${THEME}; }
    #cw-send {
      background: ${THEME}; color: #fff; border: none; border-radius: 10px;
      padding: 0 14px; font-size: 20px; cursor: pointer;
      transition: opacity .15s;
    }
    #cw-send:disabled { opacity: .45; cursor: default; }
    #cw-send:not(:disabled):hover { opacity: .88; }
  `;

  // ── DOM ─────────────────────────────────────────────────────────────────────

  function buildDOM() {
    const root = document.createElement("div");
    root.id = "cw-root";

    const style = document.createElement("style");
    style.textContent = css;
    root.appendChild(style);

    // Toggle button
    const btn = document.createElement("button");
    btn.id = "cw-toggle";
    btn.setAttribute("aria-label", "Open chat");
    btn.innerHTML = iconChat();
    btn.addEventListener("click", toggleWindow);
    root.appendChild(btn);

    // Chat window
    const win = document.createElement("div");
    win.id = "cw-window";
    win.className = "cw-hidden";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", TITLE);
    win.innerHTML = `
      <div id="cw-header">
        <span id="cw-header-title">${escHtml(TITLE)}</span>
        <button id="cw-close" aria-label="Close chat">×</button>
      </div>
      <div id="cw-messages" aria-live="polite"></div>
      <div id="cw-input-row">
        <textarea
          id="cw-input"
          placeholder="${escHtml(PLACEHOLDER)}"
          rows="1"
          aria-label="Your message"
        ></textarea>
        <button id="cw-send" aria-label="Send">↑</button>
      </div>
    `;
    root.appendChild(win);

    document.body.appendChild(root);

    // Wire up events
    document.getElementById("cw-close").addEventListener("click", closeWindow);
    document.getElementById("cw-send").addEventListener("click", sendMessage);
    document.getElementById("cw-input").addEventListener("keydown", (e) => {
      // Send on Enter; allow Shift+Enter for newlines
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    // Auto-resize textarea
    document.getElementById("cw-input").addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 100) + "px";
    });
  }

  // ── Window toggle ───────────────────────────────────────────────────────────

  function toggleWindow() {
    isOpen ? closeWindow() : openWindow();
  }

  function openWindow() {
    isOpen = true;
    document.getElementById("cw-window").classList.remove("cw-hidden");
    document.getElementById("cw-toggle").innerHTML = iconClose();
    document.getElementById("cw-input").focus();
  }

  function closeWindow() {
    isOpen = false;
    document.getElementById("cw-window").classList.add("cw-hidden");
    document.getElementById("cw-toggle").innerHTML = iconChat();
  }

  // ── Messaging ───────────────────────────────────────────────────────────────

  function sendMessage() {
    if (isStreaming) return;
    const input = document.getElementById("cw-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.style.height = "auto";

    // Add the user bubble immediately
    conversationHistory.push({ role: "user", content: text });
    appendBubble("user", text);
    scrollToBottom();

    // Add a placeholder bubble for the assistant's streaming response
    const assistantEl = appendBubble("assistant", "…", "cw-typing");
    scrollToBottom();

    document.getElementById("cw-send").disabled = true;
    isStreaming = true;

    // Open SSE connection to the backend
    let accumulatedText = "";
    const es = new EventSource(
      SERVER + "/chat?" + new URLSearchParams({ _: Date.now() })
    );

    // We can't POST via EventSource, so we use fetch + SSE manually
    es.close(); // Close immediately, we'll use fetch + ReadableStream instead

    fetchStream(text, assistantEl, accumulatedText);
  }

  /**
   * Uses the Fetch API to POST the conversation and reads the SSE stream
   * from the response body. This way we can send POST with a JSON body.
   */
  function fetchStream(userText, assistantEl, _unused) {
    let buffer = "";

    fetch(SERVER + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Server responded with " + res.status);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        let accumulated = "";

        function read() {
          reader.read().then(({ done, value }) => {
            if (done) {
              finishStream(assistantEl, accumulated);
              return;
            }

            buffer += decoder.decode(value, { stream: true });

            // SSE lines are separated by "\n\n"
            const parts = buffer.split("\n\n");
            buffer = parts.pop(); // Keep any incomplete chunk

            parts.forEach((part) => {
              const lines = part.trim().split("\n");
              let eventName = "message";
              let dataLine = "";

              lines.forEach((line) => {
                if (line.startsWith("event: ")) eventName = line.slice(7);
                if (line.startsWith("data: ")) dataLine = line.slice(6);
              });

              if (!dataLine) return;

              try {
                const payload = JSON.parse(dataLine);
                if (eventName === "delta" && payload.text) {
                  accumulated += payload.text;
                  assistantEl.classList.remove("cw-typing");
                  assistantEl.textContent = accumulated;
                  scrollToBottom();
                } else if (eventName === "done") {
                  finishStream(assistantEl, accumulated);
                } else if (eventName === "error") {
                  assistantEl.textContent =
                    payload.error || "An error occurred.";
                  assistantEl.style.color = "#dc2626";
                  endStreaming();
                }
              } catch (_) {
                /* ignore malformed lines */
              }
            });

            read();
          });
        }

        read();
      })
      .catch((err) => {
        assistantEl.textContent = "Could not reach the server. " + err.message;
        assistantEl.style.color = "#dc2626";
        endStreaming();
      });
  }

  function finishStream(assistantEl, text) {
    if (text) {
      assistantEl.textContent = text;
      // Store the full assistant reply in history so Claude has context
      conversationHistory.push({ role: "assistant", content: text });
    } else {
      assistantEl.textContent = "No response received.";
    }
    endStreaming();
    scrollToBottom();
  }

  function endStreaming() {
    isStreaming = false;
    document.getElementById("cw-send").disabled = false;
    document.getElementById("cw-input").focus();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function appendBubble(role, text, extraClass) {
    const msgs = document.getElementById("cw-messages");
    const div = document.createElement("div");
    div.className = "cw-msg cw-" + role + (extraClass ? " " + extraClass : "");
    div.textContent = text;
    msgs.appendChild(div);
    return div;
  }

  function scrollToBottom() {
    const msgs = document.getElementById("cw-messages");
    msgs.scrollTop = msgs.scrollHeight;
  }

  function escHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function iconChat() {
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
    </svg>`;
  }

  function iconClose() {
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6 6 18M6 6l12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    </svg>`;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildDOM);
  } else {
    buildDOM();
  }
})();
