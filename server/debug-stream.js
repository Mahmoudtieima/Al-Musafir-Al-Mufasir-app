// Debug script to see raw Gemini streaming output
import dotenv from "dotenv";
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyC2cxiqRwt4Ci9p1TH6rVytdkCyzpkxq2U";

async function testStream() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`;

  console.log("Making request to Gemini...\n");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Write a 500 word essay about the importance of water for human civilization" }] }],
    }),
  });

  console.log("Response status:", response.status);
  console.log("Content-Type:", response.headers.get("content-type"));
  console.log("\n--- Raw chunks as they arrive ---\n");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunkCount++;
    const text = decoder.decode(value, { stream: true });
    console.log(`\n=== CHUNK ${chunkCount} (${value.length} bytes) ===`);
    console.log(text);
  }

  console.log(`\n--- Total chunks received: ${chunkCount} ---`);
}

testStream().catch(console.error);
