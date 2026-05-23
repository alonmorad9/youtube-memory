import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const root = process.cwd();
const memoryFile = join(root, "memories.json");
const envFile = join(root, ".env");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/api/memories") {
    await handleMemoriesApi(request, response);
    return;
  }

  if (url.pathname === "/api/gemini") {
    await handleGeminiApi(request, response);
    return;
  }

  if (url.pathname === "/api/config") {
    await handleConfigApi(request, response);
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(root, requested));

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`YouTube Memory is running at http://localhost:${port}`);
  for (const address of localAddresses()) {
    console.log(`On another device on this Wi-Fi, open http://${address}:${port}`);
  }
});

async function handleMemoriesApi(request, response) {
  if (request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(await readMemories()));
    return;
  }

  if (request.method === "PUT") {
    try {
      const body = await readBody(request);
      const memories = JSON.parse(body || "[]");
      if (!Array.isArray(memories)) throw new Error("Expected an array");
      await writeFile(memoryFile, JSON.stringify(memories, null, 2));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
    } catch {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "Invalid memories payload" }));
    }
    return;
  }

  response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Method not allowed");
}

async function handleGeminiApi(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  try {
    const body = JSON.parse(await readBody(request));
    const apiKey = (await getGeminiApiKey()) || String(body.apiKey || "").trim();
    const videoUrl = String(body.videoUrl || "").trim();
    const model = String(body.model || "gemini-3.5-flash").trim();
    const prompt = String(body.prompt || "").trim();

    if (!apiKey || !videoUrl || !prompt) {
      throw new Error("Missing API key, YouTube URL, or prompt");
    }

    const text = await summarizeWithGemini({ apiKey, videoUrl, model, prompt });
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ text }));
  } catch (error) {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message || "Gemini request failed" }));
  }
}

async function handleConfigApi(request, response) {
  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ hasServerGeminiKey: Boolean(await getGeminiApiKey()) }));
}

async function getGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();

  try {
    const env = await readFile(envFile, "utf8");
    const line = env
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item && !item.startsWith("#") && item.startsWith("GEMINI_API_KEY="));
    if (!line) return "";
    return line.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

async function summarizeWithGemini({ apiKey, videoUrl, model, prompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              file_data: {
                file_uri: videoUrl,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || `Gemini returned ${response.status}`);
  }

  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!text) throw new Error("Gemini did not return a summary");
  return text;
}

async function fetchWithTimeout(url, options, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Gemini request timed out after 2 minutes");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readMemories() {
  try {
    return JSON.parse(await readFile(memoryFile, "utf8"));
  } catch {
    return [];
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        request.destroy();
        reject(new Error("Body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function localAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
