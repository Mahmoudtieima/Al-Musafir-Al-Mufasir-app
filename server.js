import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();
const PORT = process.env.PORT || 3001;

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}
const API_VERSION = "v1beta";

// Model options
const MODELS = {
  fast: "gemini-2.5-flash",
  thinking: "gemini-2.5-pro",
};

const DEFAULT_MODEL = "fast";

// Middleware
app.use("*", cors());

/**
 * Helper function to format chunk as SSE
 */
function formatChunkAsSSE(chunkText) {
  if (!chunkText) return "";

  const escapedText = chunkText
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");

  return `data: {"text": "${escapedText}"}\n\n`;
}

// Serve the main HTML file
app.get("/", (c) => {
  const html = readFileSync(join(__dirname, "index.html"), "utf-8");
  return c.html(html);
});

app.get("/health", (c) => c.json({ status: "ok" }));

/**
 * Always stream - starts immediately on request
 */
app.post("/api/gemini", async (c) => {
  let data;
  const contentType = c.req.header("content-type") || "";

  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.parseBody();
      data = JSON.parse(formData.data);
    } else {
      data = await c.req.json();
    }
  } catch (error) {
    return c.json({ error: { message: "Invalid request body", code: 400 } }, 400);
  }

  const modelType = data.modelType || DEFAULT_MODEL;
  const modelName = MODELS[modelType] || MODELS[DEFAULT_MODEL];
  const contents = data.contents || [];
  const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${modelName}:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`;

  return stream(c, async (s) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = "API request failed";
        try {
          errorMsg = JSON.parse(errorText).error?.message || errorMsg;
        } catch {
          errorMsg = errorText.substring(0, 200);
        }
        await s.write(`data: {"error": {"message": "${errorMsg.replace(/"/g, '\\"')}"}}\n\n`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const parts = parsed.candidates?.[0]?.content?.parts || [];
            const text = parts.map((p) => p.text || "").join("");

            if (text) await s.write(formatChunkAsSSE(text));
            if (parsed.error) {
              await s.write(`data: {"error": {"message": "${(parsed.error.message || "").replace(/"/g, '\\"')}"}}\n\n`);
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim().startsWith("data: ")) {
        const data = buffer.trim().slice(6).trim();
        if (data !== "[DONE]") {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
            if (text) await s.write(formatChunkAsSSE(text));
          } catch {}
        }
      }

      await s.write("data: [DONE]\n\n");
    } catch (error) {
      const msg = error.toString().replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      await s.write(`data: {"error": {"message": "${msg}"}}\n\n`);
    }
  });
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Streaming server: http://localhost:${info.port}/api/gemini`);
});
