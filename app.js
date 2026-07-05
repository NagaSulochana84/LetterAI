/* ==========================================================================
   AI Letter Generator — frontend logic
   Talks only to our own Netlify function ("/.netlify/functions/chat").
   The Groq API key never touches this file or the browser.
   ========================================================================== */

(() => {
  "use strict";

  // ---- DOM references ----
  const chatMessages = document.getElementById("chatMessages");
  const typingIndicator = document.getElementById("typingIndicator");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const newLetterBtn = document.getElementById("newLetterBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const previewPlaceholder = document.getElementById("previewPlaceholder");
  const letterPaper = document.getElementById("letterPaper");

  const CHAT_ENDPOINT = "/.netlify/functions/chat";
  const START_MARKER = "===LETTER_START===";
  const END_MARKER = "===LETTER_END===";

  // ---- Conversation state (sent to the API on every turn) ----
  let messages = []; // { role: 'user' | 'assistant', content: string }
  let isStreaming = false;
  let letterReady = false;

  // ==========================================================================
  // Small utilities
  // ==========================================================================

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function textToHtml(str) {
    return escapeHtml(str).replace(/\n/g, "<br>");
  }

  function scrollChatToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTyping(show) {
    typingIndicator.hidden = !show;
    if (show) scrollChatToBottom();
  }

  function setInputEnabled(enabled) {
    chatInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    if (enabled) chatInput.focus();
  }

  function autoResizeTextarea() {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  }

  // ==========================================================================
  // Rendering chat bubbles
  // ==========================================================================

  function renderUserBubble(text) {
    const wrap = document.createElement("div");
    wrap.className = "msg msg-user";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = textToHtml(text);
    wrap.appendChild(bubble);
    chatMessages.appendChild(wrap);
    scrollChatToBottom();
  }

  function createEmptyAiBubble() {
    const wrap = document.createElement("div");
    wrap.className = "msg msg-ai";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    wrap.appendChild(bubble);
    chatMessages.appendChild(wrap);
    scrollChatToBottom();
    return bubble;
  }

  // ==========================================================================
  // Marker-aware streaming parser.
  // The AI is instructed (server-side system prompt) to wrap the actual
  // letter content between ===LETTER_START=== and ===LETTER_END=== markers.
  // Everything outside the markers is normal chat text; everything inside
  // is routed live into the preview panel instead of the chat bubble.
  // ==========================================================================

  class MarkerStreamParser {
    constructor({ onChatText, onLetterStart, onLetterChunk, onLetterEnd }) {
      this.buffer = "";
      this.inLetter = false;
      this.onChatText = onChatText;
      this.onLetterStart = onLetterStart;
      this.onLetterChunk = onLetterChunk;
      this.onLetterEnd = onLetterEnd;
    }

    feed(text) {
      this.buffer += text;
      this._process(false);
    }

    finish() {
      this._process(true);
    }

    _process(isFinal) {
      // Loop so we can handle multiple marker transitions within one chunk.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!this.inLetter) {
          const idx = this.buffer.indexOf(START_MARKER);
          if (idx !== -1) {
            const before = this.buffer.slice(0, idx);
            if (before) this.onChatText(before);
            this.buffer = this.buffer.slice(idx + START_MARKER.length);
            this.inLetter = true;
            this.onLetterStart();
            continue;
          }
          // No marker yet — flush everything except a small tail that could
          // be the start of a split marker, so we don't leak partial markers
          // into the chat bubble.
          const keep = isFinal ? 0 : START_MARKER.length - 1;
          const safeLen = Math.max(0, this.buffer.length - keep);
          if (safeLen > 0) {
            this.onChatText(this.buffer.slice(0, safeLen));
            this.buffer = this.buffer.slice(safeLen);
          }
          break;
        } else {
          const idx = this.buffer.indexOf(END_MARKER);
          if (idx !== -1) {
            const before = this.buffer.slice(0, idx);
            if (before) this.onLetterChunk(before);
            this.buffer = this.buffer.slice(idx + END_MARKER.length);
            this.inLetter = false;
            this.onLetterEnd();
            continue;
          }
          const keep = isFinal ? 0 : END_MARKER.length - 1;
          const safeLen = Math.max(0, this.buffer.length - keep);
          if (safeLen > 0) {
            this.onLetterChunk(this.buffer.slice(0, safeLen));
            this.buffer = this.buffer.slice(safeLen);
          }
          break;
        }
      }
    }
  }

  // ==========================================================================
  // Core: send a user message, stream the AI response, update UI live
  // ==========================================================================

  async function sendMessage(userText) {
    if (isStreaming) return;
    isStreaming = true;

    messages.push({ role: "user", content: userText });
    renderUserBubble(userText);

    chatInput.value = "";
    autoResizeTextarea();
    setInputEnabled(false);
    showTyping(true);

    let aiBubble = null;
    let chatDisplay = "";
    let rawAssistantText = "";
    let receivedAnyToken = false;
    let firstTokenSeen = false;

    const parser = new MarkerStreamParser({
      onChatText: (t) => {
        chatDisplay += t;
        if (!aiBubble) aiBubble = createEmptyAiBubble();
        aiBubble.innerHTML = textToHtml(chatDisplay);
        scrollChatToBottom();
      },
      onLetterStart: () => {
        previewPlaceholder.hidden = true;
        letterPaper.hidden = false;
        letterPaper.textContent = "";
      },
      onLetterChunk: (t) => {
        letterPaper.textContent += t;
        letterPaper.scrollTop = letterPaper.scrollHeight;
      },
      onLetterEnd: () => {
        letterReady = true;
        downloadBtn.disabled = false;
        downloadBtn.classList.add("pulse");
        setTimeout(() => downloadBtn.classList.remove("pulse"), 4500);
      },
    });

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      if (!res.ok || !res.body) {
        let errMsg = "The letter assistant is temporarily unavailable. Please try again in a moment.";
        try {
          const errJson = await res.json();
          if (errJson && errJson.error) errMsg = errJson.error;
        } catch (_) {
          /* response wasn't JSON, use default message */
        }
        throw new Error(errMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || ""; // keep any incomplete trailing line

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          let json;
          try {
            json = JSON.parse(payload);
          } catch (_) {
            continue; // ignore malformed / partial SSE fragment
          }

          const delta =
            (json.choices &&
              json.choices[0] &&
              json.choices[0].delta &&
              json.choices[0].delta.content) ||
            "";

          if (delta) {
            receivedAnyToken = true;
            rawAssistantText += delta;
            if (!firstTokenSeen) {
              firstTokenSeen = true;
              showTyping(false);
            }
            parser.feed(delta);
          }
        }
      }

      parser.finish();

      if (!receivedAnyToken) {
        throw new Error("The assistant didn't send a reply. Please try again.");
      }

      // If the AI only produced a letter with no surrounding chat text,
      // give the user a short confirmation bubble instead of leaving it blank.
      if (!chatDisplay.trim() && !aiBubble) {
        aiBubble = createEmptyAiBubble();
        aiBubble.innerHTML = textToHtml(
          "✅ Your letter is ready in the preview panel. Let me know if you'd like any changes."
        );
      }

      messages.push({ role: "assistant", content: rawAssistantText });
    } catch (err) {
      console.error("Letter assistant error:", err);
      if (!aiBubble) aiBubble = createEmptyAiBubble();
      aiBubble.classList.add("error-bubble");
      aiBubble.innerHTML = textToHtml(
        "⚠️ " + (err && err.message ? err.message : "Something went wrong. Please try again.")
      );
    } finally {
      showTyping(false);
      setInputEnabled(true);
      isStreaming = false;
      scrollChatToBottom();
    }
  }

  // ==========================================================================
  // Event wiring
  // ==========================================================================

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || isStreaming) return;
    sendMessage(text);
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  chatInput.addEventListener("input", autoResizeTextarea);

  downloadBtn.addEventListener("click", () => {
    if (!letterReady) return;
    window.print();
  });

  newLetterBtn.addEventListener("click", () => {
    if (isStreaming) return;
    const confirmed = messages.length === 0 || window.confirm("Start a new letter? This will clear the current conversation.");
    if (!confirmed) return;

    messages = [];
    letterReady = false;
    isStreaming = false;

    chatMessages.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "msg msg-ai";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML =
      "Namaste! 🙏 I can help you write any formal letter — leave letter, tender application, RTI request, " +
      "government office letter, business letter, and more.<br><br>" +
      "Just tell me what you need in your own words, and I'll ask a few quick questions to get every detail right.";
    wrap.appendChild(bubble);
    chatMessages.appendChild(wrap);

    letterPaper.hidden = true;
    letterPaper.textContent = "";
    previewPlaceholder.hidden = false;
    downloadBtn.disabled = true;
    downloadBtn.classList.remove("pulse");

    chatInput.value = "";
    autoResizeTextarea();
    setInputEnabled(true);
  });

  // Initial state
  setInputEnabled(true);
})();
