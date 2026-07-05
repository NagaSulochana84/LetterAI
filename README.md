# AI Letter Generator

A chat-based assistant that asks clarifying questions and writes properly
formatted formal letters (leave letters, RTI applications, tender
applications, government office letters, business correspondence, and more)
for Indian users — then lets you download the result as a PDF.

- **Cost: ₹0.** Uses Groq's free API tier (no credit card) and Netlify's free
  hosting tier.
- **Your API key is never exposed.** It lives only in a Netlify server-side
  environment variable and is read by a serverless function — the browser
  never sees it.

---

## 1. Get a free Groq API key

1. Go to **[console.groq.com](https://console.groq.com)** and sign up (email
   or Google/GitHub login — no credit card required).
2. Open **API Keys** in the console and click **Create API Key**.
3. Copy the key (it starts with `gsk_...`). You'll paste it into Netlify in
   step 3 below — you won't need it anywhere else.

> Groq's free tier is rate-limited (a generous number of requests per minute
> and per day, per Groq's account, not per key) but requires no payment
> details. If you ever outgrow it, current limits and paid tiers are listed
> at console.groq.com — nothing in this app needs to change, you'd just
> upgrade the same key.

---

## 2. Deploy to Netlify (free)

**Option A — drag & drop (fastest, no Git required)**

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the entire project folder onto the page.
3. Netlify deploys it and gives you a live URL immediately.

**Option B — connect a Git repository (recommended if you'll keep editing)**

1. Push this folder to a new GitHub repository.
2. In Netlify: **Add new site → Import an existing project → GitHub** → pick
   the repo.
3. Build settings can stay as detected (`netlify.toml` already configures
   `publish = "."` and `functions = "netlify/functions"`) — just click
   **Deploy**.

---

## 3. Add your API key to Netlify (this is what keeps it hidden)

1. In your Netlify site dashboard: **Site configuration → Environment
   variables → Add a variable**.
2. Add:
   - **Key:** `GROQ_API_KEY`
   - **Value:** the `gsk_...` key you copied earlier
3. (Optional) Add a second variable `GROQ_MODEL` if you want to use a
   different Groq model than the default `llama-3.3-70b-versatile`.
4. Trigger a redeploy (**Deploys → Trigger deploy**) so the function picks up
   the new variable.

That's it — your site is live, and the API key only exists inside Netlify's
environment, read server-side by `netlify/functions/chat.mjs`. It is never
sent to, or visible in, the browser.

---

## How it works

```
Browser (index.html/app.js)
      │  POST /.netlify/functions/chat   { messages: [...] }
      ▼
Netlify Function (netlify/functions/chat.mjs)
      │  adds the system prompt + your GROQ_API_KEY (server-side only)
      ▼
Groq API (streaming)
      │  streams tokens back
      ▼
Netlify Function streams the same response straight through
      ▼
Browser renders it token-by-token: normal text → chat bubble,
text between ===LETTER_START=== / ===LETTER_END=== markers → preview panel
```

The AI is instructed (in the function's system prompt) to wrap the actual
letter text in `===LETTER_START===` / `===LETTER_END===` markers every time
it produces or revises a letter. The frontend watches the stream for those
markers so it can:
- keep clarifying questions in the chat panel,
- show the finished letter live in the preview panel as it streams in,
- enable and highlight **Download PDF** only once a complete letter has
  actually been produced.

**Download PDF** simply calls the browser's native `window.print()`. A print
stylesheet in `style.css` hides everything except the letter itself, so the
browser's "Save as PDF" print destination produces a clean document.

---

## Local testing (optional)

You need the [Netlify CLI](https://docs.netlify.com/cli/get-started/) to run
the serverless function locally:

```bash
npm install -g netlify-cli
cd letter-app
netlify env:set GROQ_API_KEY gsk_your_key_here
netlify dev
```

This serves the site (and the function) at `http://localhost:8888`.

---

## Customizing

- **System prompt / letter rules:** edit `SYSTEM_PROMPT` in
  `netlify/functions/chat.mjs`.
- **AI model:** set the `GROQ_MODEL` environment variable in Netlify (any
  chat model available on your Groq account), or edit the default in
  `chat.mjs`.
- **Colors / branding:** edit the `:root` CSS variables at the top of
  `style.css`.

---

## Privacy

There is no database and no analytics in this app. Each conversation lives
only in the visitor's browser tab for the duration of their session and is
sent turn-by-turn to your Netlify function, which forwards it to Groq to get
the next reply. Nothing is written to disk anywhere in this stack.
