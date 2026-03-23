require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Middleware ────────────────────────────────────────────────────────────────

// Parse allowed origins from .env (comma-separated list or "*")
const allowedOrigins = process.env.ALLOWED_ORIGINS || "*";
app.use(
  cors({
    origin:
      allowedOrigins === "*"
        ? "*"
        : allowedOrigins.split(",").map((o) => o.trim()),
    methods: ["POST", "GET"],
  })
);

app.use(express.json());

// Serve the widget.js file as a static asset from /public
app.use(express.static(path.join(__dirname, "public")));

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /chat
 *
 * Receives a conversation history from the widget and streams Claude's reply
 * back using Server-Sent Events (SSE). This keeps the UI responsive for
 * longer answers without waiting for the full response.
 *
 * Expected request body:
 * {
 *   messages: [{ role: "user" | "assistant", content: string }, ...]
 * }
 */
app.post("/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // Validate that every message has the expected shape
  const isValid = messages.every(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0
  );
  if (!isValid) {
    return res.status(400).json({ error: "Invalid message format" });
  }

  // Set up SSE headers so the browser can read chunks as they arrive
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: process.env.SYSTEM_PROMPT || "You are a helpful assistant.",
      messages,
    });

    // Forward each text delta to the client as an SSE "delta" event
    stream.on("text", (delta) => {
      res.write(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`);
    });

    // When streaming is done, send a "done" event and close the connection
    stream.on("finalMessage", () => {
      res.write("event: done\ndata: {}\n\n");
      res.end();
    });

    // Forward any API-level errors to the client
    stream.on("error", (err) => {
      console.error("Claude stream error:", err);
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: "AI error, please try again." })}\n\n`
      );
      res.end();
    });
  } catch (err) {
    console.error("Server error:", err);
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: "Server error, please try again." })}\n\n`
    );
    res.end();
  }
});

/**
 * GET /health
 * Simple health-check endpoint — useful for uptime monitors.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Chatbot server running on http://localhost:${PORT}`);
  console.log(`Widget URL:  http://localhost:${PORT}/widget.js`);
});
