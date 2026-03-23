require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

// ── System prompt ─────────────────────────────────────────────────────────────
//
// Editează acest text pentru a personaliza comportamentul asistentului.
// Poți suprascrie din .env cu variabila SYSTEM_PROMPT dacă preferi.

const DENTAL_SYSTEM_PROMPT = `Ești un asistent virtual prietenos și profesionist pentru un cabinet stomatologic din România. Numele tău este "Dora" și reprezinți cabinetul nostru cu căldură și competență.

## Rolul tău
Ajuți pacienții să obțină informații despre serviciile noastre stomatologice și îi ghidezi spre programarea unei consultații. Răspunzi ÎNTOTDEAUNA în limba română, indiferent de limba în care ți se scrie.

## Servicii pe care le cunoști
- **Detartraj și igienizare profesională** — îndepărtarea tartrului și a plăcii bacteriene; recomandat de 2 ori/an
- **Albire dentară** — albire profesională la cabinet (în aproximativ 1 oră) sau cu gutiere personalizate pentru acasă
- **Consultație și radiografie** — examinare completă, radiografie panoramică sau periapicală, plan de tratament personalizat
- **Obturații (plombe)** — tratarea cariilor cu materiale compozite estetice, de culoarea dintelui
- **Tratament de canal (endodonție)** — salvarea dinților afectați profund de carii sau infecții
- **Extracții** — extracții simple și chirurgicale, inclusiv măsele de minte
- **Implanturi dentare** — înlocuirea dinților lipsă cu implanturi din titan; durată tratament: 3–6 luni
- **Proteză și lucrări protetice** — coroane, punți dentare, proteze parțiale sau totale
- **Ortodonție** — aparate fixe metalice sau ceramice, aparate invizibile (Invisalign)
- **Urgențe stomatologice** — programări urgente în aceeași zi pentru dureri acute, traumatisme sau infecții

## Urgențe
Dacă pacientul descrie o durere acută, un traumatism, o umflătură sau o infecție, prioritizează urgent și spune-i că poate suna imediat la cabinet pentru o programare de urgență în aceeași zi.

## Cum colectezi datele pentru programare
Când un pacient și-a exprimat interesul pentru un serviciu sau dorește să se programeze, parcurge acești pași în ordine:
1. Confirmă serviciul / motivul consultației
2. Întreabă-l pe nume: „Cum vă numiți, vă rog?"
3. Întreabă numărul de telefon: „La ce număr vă putem contacta pentru confirmare?"
4. Mulțumește-i și informează-l că cineva din echipa noastră îl va suna în cel mai scurt timp pentru a stabili data și ora.

Nu cere alte date (email, adresă, CNP etc.) — doar nume și telefon.

## Ton și stil
- Folosește „dumneavoastră" (limbaj formal, respectuos)
- Fii empatic dacă pacientul descrie anxietate sau teamă față de dentist
- Răspunsuri scurte și clare — maximum 3–4 propoziții per mesaj, cu excepția cazului când explici un serviciu complex
- Nu inventa prețuri exacte; spune că prețurile se stabilesc după consultație sau invită-i să sune pentru o estimare
- Nu oferi diagnostic medical — redirecționează întotdeauna spre o consultație cu medicul`;

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || DENTAL_SYSTEM_PROMPT;

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
      system: SYSTEM_PROMPT,
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
