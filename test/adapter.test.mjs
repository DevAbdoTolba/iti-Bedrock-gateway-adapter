import test from "node:test";
import assert from "node:assert/strict";
import {
  buildToolPrompt,
  extractToolCalls,
  streamChunks,
  toItiRequest,
  toOpenAiResponse,
  translateMessages
} from "../src/adapter.mjs";

test("converts an OpenAI request to an ITI request", () => {
  const result = toItiRequest({
    model: "anthropic.claude-sonnet-4-6",
    messages: [
      { role: "system", content: "Be short." },
      { role: "user", content: "Hello" }
    ],
    max_tokens: 200
  });

  assert.deepEqual(result, {
    model_id: "anthropic.claude-sonnet-4-6",
    messages: [{ role: "user", content: "Hello" }],
    system_prompt: "Be short.",
    max_tokens: 200
  });
});

test("adds tool instructions when tools exist", () => {
  const prompt = buildToolPrompt([
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read one file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"]
        }
      }
    }
  ]);

  assert.match(prompt, /read_file/);
  assert.match(prompt, /<tool_call>/);
});

test("converts tool history into plain ITI messages", () => {
  const result = translateMessages([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"app.js"}' }
        }
      ]
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: "console.log('ok')"
    }
  ]);

  assert.match(result.messages[0].content, /read_file/);
  assert.match(result.messages[1].content, /tool_result/);
});

test("extracts a structured tool call from model text", () => {
  const calls = extractToolCalls(
    '<tool_call>{"name":"read_file","arguments":{"path":"app.js"}}</tool_call>'
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "read_file");
  assert.equal(calls[0].function.arguments, '{"path":"app.js"}');
});

test("converts an ITI answer to an OpenAI answer", () => {
  const result = toOpenAiResponse({
    request_id: "request-1",
    model_id: "deepseek.v3.2",
    output_text: "Hello!",
    usage: {
      input_tokens: 4,
      output_tokens: 2,
      total_tokens: 6
    },
    actual_cost_usd: "0.0001"
  });

  assert.equal(result.choices[0].message.content, "Hello!");
  assert.equal(result.usage.total_tokens, 6);
  assert.equal(result.iti.request_id, "request-1");
});

test("creates buffered OpenAI stream chunks", () => {
  const completion = toOpenAiResponse({
    model_id: "deepseek.v3.2",
    output_text: "Hello!"
  });
  const chunks = streamChunks(completion);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].choices[0].delta.content, "Hello!");
  assert.equal(chunks[1].choices[0].finish_reason, "stop");
});

test("rejects a request without messages", () => {
  assert.throws(() => toItiRequest({ messages: [] }), /messages/);
});
