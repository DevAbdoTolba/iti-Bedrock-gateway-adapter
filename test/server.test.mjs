import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function waitUntilReady(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Adapter did not start");
}

test("HTTP server forwards and translates a chat request", async (context) => {
  const upstreamPort = await freePort();
  const adapterPort = await freePort();
  let receivedAuthorization = "";
  let receivedBody = null;

  const upstream = http.createServer(async (request, response) => {
    receivedAuthorization = request.headers.authorization;
    let raw = "";
    for await (const chunk of request) raw += chunk;
    receivedBody = JSON.parse(raw);

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        request_id: "test-request",
        model_id: receivedBody.model_id,
        output_text: "Hello from ITI",
        usage: { input_tokens: 3, output_tokens: 3, total_tokens: 6 }
      })
    );
  });
  await listen(upstream, upstreamPort);
  context.after(() => close(upstream));

  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(adapterPort),
      ITI_API_URL: `http://127.0.0.1:${upstreamPort}/student/chat`
    },
    stdio: "ignore"
  });
  context.after(() => child.kill());

  await waitUntilReady(`http://127.0.0.1:${adapterPort}/health`);

  const response = await fetch(
    `http://127.0.0.1:${adapterPort}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer sbg_test_key",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "anthropic.claude-sonnet-4-6",
        messages: [{ role: "user", content: "Hello" }]
      })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(receivedAuthorization, "Bearer sbg_test_key");
  assert.equal(receivedBody.model_id, "anthropic.claude-sonnet-4-6");
  assert.equal(receivedBody.messages[0].content, "Hello");
  assert.equal(body.choices[0].message.content, "Hello from ITI");
  assert.equal(body.usage.total_tokens, 6);
});

test("HTTP server rejects requests without an API key", async (context) => {
  const adapterPort = await freePort();
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(adapterPort) },
    stdio: "ignore"
  });
  context.after(() => child.kill());

  await waitUntilReady(`http://127.0.0.1:${adapterPort}/health`);

  const response = await fetch(
    `http://127.0.0.1:${adapterPort}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }]
      })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "missing_api_key");
});
