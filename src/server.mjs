import http from "node:http";
import {
  DEFAULT_MODEL,
  DEFAULT_MODELS,
  openAiError,
  streamChunks,
  toItiRequest,
  toOpenAiResponse
} from "./adapter.mjs";

const port = positiveNumber(process.env.PORT, 8787);
const upstreamUrl =
  process.env.ITI_API_URL ||
  "http://apiaccess.iti.net.eg/api/v1/student/chat";
const timeoutMs = positiveNumber(process.env.REQUEST_TIMEOUT_MS, 600_000);
const maxBodyBytes = positiveNumber(process.env.MAX_BODY_BYTES, 10_000_000);
const models = parseModels(process.env.ITI_MODELS);

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseModels(value) {
  if (!value) return DEFAULT_MODELS;
  const parsed = value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_MODELS;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-expose-headers": "x-iti-request-id"
  };
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(),
    ...headers
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let data = "";
  request.setEncoding("utf8");

  for await (const chunk of request) {
    data += chunk;
    if (Buffer.byteLength(data) > maxBodyBytes) {
      throw Object.assign(new Error("Request body is too large"), {
        statusCode: 413
      });
    }
  }

  try {
    return JSON.parse(data || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      statusCode: 400
    });
  }
}

function getApiKey(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function sendStream(response, completion) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    ...corsHeaders()
  });

  for (const chunk of streamChunks(completion)) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

async function callIti(apiKey, body) {
  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const raw = await upstream.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Object.assign(
      new Error(`ITI returned non-JSON data (HTTP ${upstream.status})`),
      { statusCode: 502 }
    );
  }

  if (!upstream.ok) {
    const message =
      data?.detail || data?.message || data?.error || `ITI error ${upstream.status}`;
    throw Object.assign(
      new Error(typeof message === "string" ? message : JSON.stringify(message)),
      { statusCode: upstream.status >= 500 ? 502 : upstream.status }
    );
  }

  return data;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    return response.end();
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return sendJson(response, 200, {
      status: "ok",
      name: "ITI Bedrock Gateway Adapter",
      openai_base_url: `http://127.0.0.1:${port}/v1`,
      default_model: DEFAULT_MODEL
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/models") {
    return sendJson(response, 200, {
      object: "list",
      data: models.map((id) => ({
        id,
        object: "model",
        created: 0,
        owned_by: "iti-bedrock"
      }))
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/models/")) {
    const id = decodeURIComponent(url.pathname.slice("/v1/models/".length));
    if (!models.includes(id)) {
      return sendJson(response, 404, openAiError("Model not found", "invalid_request_error", "model_not_found"));
    }
    return sendJson(response, 200, {
      id,
      object: "model",
      created: 0,
      owned_by: "iti-bedrock"
    });
  }

  if (
    request.method !== "POST" ||
    !["/v1/chat/completions", "/chat/completions"].includes(url.pathname)
  ) {
    return sendJson(response, 404, openAiError("Route not found"));
  }

  const apiKey = getApiKey(request);
  if (!apiKey) {
    return sendJson(
      response,
      401,
      openAiError(
        "Missing API key. Send your SBG key as: Authorization: Bearer sbg_...",
        "authentication_error",
        "missing_api_key"
      )
    );
  }

  try {
    const openAiBody = await readJson(request);
    const itiRequest = toItiRequest(openAiBody);
    const itiResponse = await callIti(apiKey, itiRequest);
    const completion = toOpenAiResponse(itiResponse, itiRequest.model_id);

    if (openAiBody.stream) return sendStream(response, completion);

    return sendJson(
      response,
      200,
      completion,
      itiResponse.request_id
        ? { "x-iti-request-id": itiResponse.request_id }
        : {}
    );
  } catch (error) {
    const status = error.statusCode || (error.name === "TimeoutError" ? 504 : 502);
    return sendJson(
      response,
      status,
      openAiError(
        error.message || "Gateway request failed",
        status === 401 ? "authentication_error" : "gateway_error"
      )
    );
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ITI adapter is ready on http://0.0.0.0:${port}/v1`);
  console.log("The adapter does not store API keys or prompts.");
});
