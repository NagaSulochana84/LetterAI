/* ==========================================================================
   Netlify serverless function: /.netlify/functions/chat
   - Holds the AI provider's API key server-side (Netlify env var), so it is
     NEVER exposed to the browser / frontend code.
   - Forwards the conversation to Groq's free, OpenAI-compatible API
     (https://console.groq.com) and streams the response straight back
     to the browser as Server-Sent Events.
   ========================================================================== */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// The full behaviour spec for the assistant, plus a strict instruction on
// how to mark the actual letter text so the frontend can show it live in
// the preview panel and know exactly when it's complete.
const SYSTEM_PROMPT = `You are a professional letter writing assistant for Indian users — students, small business owners doing BHEL and government tender work, government employees, and everyday people who may be literate or semi-literate in English.

When the user describes their letter need — even in casual, broken, or grammatically incorrect language — do not hallucinate. First get clarity on exactly what type of letter they need (leave letter, tender application, RTI application, government office letter, business correspondence, resignation, complaint, or general purpose letter, etc). If the request is ambiguous, ask a short clarifying question before assuming a format.

Once you know the letter type, ask for the required details ONE AT A TIME, in a friendly, conversational, short tone (name, recipient / designated authority, date, subject / purpose, specific points, and anything else that specific letter format legally or conventionally requires in India). Do not ask everything in one message. Do not ask for details you can reasonably infer or that don't apply to this letter type.

Once — and only once — you have all the necessary details for that specific letter format, generate the COMPLETE, formally formatted Indian letter: proper date, sender address (if applicable), recipient address, subject line, salutation, well-structured body paragraphs, and a closing signature block. Follow the correct real-world convention for that letter type (e.g. RTI applications must cite the RTI Act 2005 and include the required legal structure; tender applications must follow standard commercial tender format; leave letters must be concise; government office letters must use formal bureaucratic tone with reference/subject lines).

CRITICAL OUTPUT RULE FOR THE FINAL LETTER:
Whenever you output the actual letter (first version OR any revised version after the user asks for changes), you MUST wrap ONLY the letter content — nothing else — exactly between these two marker lines, each on their own line, with nothing else on those lines:
===LETTER_START===
(full letter text here, using plain text and line breaks only — no markdown symbols like ** or #)
===LETTER_END===

You may include a short, separate friendly sentence before or after the markers in the same message (e.g. "Here's your letter — let me know if you'd like any changes!"), but that sentence must stay OUTSIDE the markers, and the letter itself must be COMPLETE inside the markers every single time you produce or revise it — never a partial or diffed letter.

After generating or revising the letter, ask the user if they would like any changes. If the user asks for an edit, apply it and output the FULL updated letter again between fresh markers — never assume the user can see a previous version, always give the complete letter text.

Never use the markers for anything other than an actual finished letter. Do not put clarifying questions or partial drafts inside the markers.`;

export default async (req) => {
  if (req.method !== "POST") {
    return jsonError("Method not allowed.", 405);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonError(
      "The server is missing its AI API key. If you're the site owner, add GROQ_API_KEY in Netlify → Site settings → Environment variables.",
      500
    );
  }

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return jsonError("Invalid request body.", 400);
  }

  const incoming = Array.isArray(body && body.messages) ? body.messages : [];

  // Sanitize: only allow user/assistant roles with string content, cap
  // history length and per-message size so one bad request can't blow up
  // token usage or crash the function.
  const cleanHistory = incoming
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-40)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (cleanHistory.length === 0) {
    return jsonError("No message provided.", 400);
  }

  const payload = {
    model: MODEL,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...cleanHistory],
    temperature: 0.4,
    max_tokens: 2048,
    stream: true,
  };

  let upstream;
  try {
    upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return jsonError("Could not reach the AI service. Please check your connection and try again.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      detail = await upstream.text();
    } catch (_) {
      /* ignore */
    }
    const status = upstream.status === 429 ? 429 : 502;
    const friendly =
      status === 429
        ? "The AI service is receiving too many requests right now. Please wait a moment and try again."
        : "The AI service returned an error. Please try again in a moment.";
    console.error("Groq API error:", upstream.status, detail.slice(0, 500));
    return jsonError(friendly, status);
  }

  // Stream Groq's Server-Sent Events straight through to the browser.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
