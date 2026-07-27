import crypto from "node:crypto";

export const DEFAULT_MODEL = "anthropic.claude-sonnet-4-6";

export const DEFAULT_MODELS = [
  "anthropic.claude-sonnet-4-6",
  "anthropic.claude-opus-4-7",
  "anthropic.claude-haiku-4-5-20251001-v1:0",
  "deepseek.v3.2",
  "deepseek.r1-v1:0",
  "openai.gpt-oss-120b-1:0",
  "openai.gpt-oss-20b-1:0",
  "qwen.qwen3-vl-235b-a22b",
  "us.amazon.nova-2-lite-v1:0",
  "us.meta.llama3-3-70b-instruct-v1:0"
];

export function textContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) return JSON.stringify(content);

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" || part?.type === "input_text") {
        return part.text || "";
      }
      return `[Unsupported content: ${part?.type || "unknown"}]`;
    })
    .join("\n");
}

export function parseArguments(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return { input: String(value || "") };
  }
}

export function translateMessages(inputMessages = []) {
  const systemParts = [];
  const messages = [];

  for (const message of inputMessages) {
    const content = textContent(message.content);

    if (message.role === "system" || message.role === "developer") {
      systemParts.push(content);
      continue;
    }

    if (message.role === "tool") {
      messages.push({
        role: "user",
        content:
          `<tool_result id="${message.tool_call_id || "unknown"}"` +
          `${message.name ? ` name="${message.name}"` : ""}>` +
          `\n${content}\n</tool_result>`
      });
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls
        .map((call) => {
          const name = call?.function?.name;
          if (!name) return "";
          return `<tool_call>${JSON.stringify({
            name,
            arguments: parseArguments(call.function.arguments)
          })}</tool_call>`;
        })
        .filter(Boolean)
        .join("\n");

      messages.push({
        role: "assistant",
        content: [content, calls].filter(Boolean).join("\n")
      });
      continue;
    }

    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content
    });
  }

  return { systemParts, messages };
}

export function buildToolPrompt(tools = [], toolChoice) {
  if (!tools.length || toolChoice === "none") return "";

  const definitions = tools
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || "",
      parameters: tool.function.parameters || { type: "object", properties: {} }
    }));

  if (!definitions.length) return "";

  const forcedTool =
    typeof toolChoice === "object" ? toolChoice?.function?.name : null;

  return [
    "You are inside a coding agent.",
    "You can use the tools below.",
    forcedTool ? `You must call this tool now: ${forcedTool}` : "",
    "When you need a tool, output only this format:",
    '<tool_call>{"name":"tool_name","arguments":{"key":"value"}}</tool_call>',
    "Do not use Markdown around a tool call.",
    "You may output more than one <tool_call> block.",
    "After a <tool_result>, continue the task.",
    "",
    "TOOLS:",
    JSON.stringify(definitions)
  ]
    .filter(Boolean)
    .join("\n");
}

export function toItiRequest(openAiBody) {
  if (!Array.isArray(openAiBody.messages) || openAiBody.messages.length === 0) {
    throw new TypeError("messages must be a non-empty array");
  }

  const { systemParts, messages } = translateMessages(openAiBody.messages);
  const toolPrompt = buildToolPrompt(openAiBody.tools, openAiBody.tool_choice);

  const maxTokens =
    openAiBody.max_completion_tokens ?? openAiBody.max_tokens ?? 4096;

  return {
    model_id: openAiBody.model || DEFAULT_MODEL,
    messages,
    system_prompt: [...systemParts, toolPrompt].filter(Boolean).join("\n\n"),
    max_tokens: Math.max(1, Math.min(Number(maxTokens) || 4096, 32768))
  };
}

function tryParseToolObject(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = value.function
    ? {
        name: value.function.name,
        arguments: value.function.arguments
      }
    : value;

  if (!candidate.name || candidate.arguments === undefined) return null;
  return {
    id: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
    type: "function",
    function: {
      name: String(candidate.name),
      arguments: JSON.stringify(parseArguments(candidate.arguments))
    }
  };
}

export function extractToolCalls(outputText = "") {
  const calls = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match;

  while ((match = pattern.exec(outputText)) !== null) {
    try {
      const call = tryParseToolObject(JSON.parse(match[1]));
      if (call) calls.push(call);
    } catch {
      // Keep the model's text as a normal answer if JSON is invalid.
    }
  }

  if (calls.length) return calls;

  const plainJson = outputText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(plainJson);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.map(tryParseToolObject).filter(Boolean);
  } catch {
    return [];
  }
}

export function toOpenAiResponse(itiBody, requestedModel) {
  const outputText = itiBody?.output_text || "";
  const toolCalls = extractToolCalls(outputText);
  const cleanText = toolCalls.length
    ? outputText.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim()
    : outputText;

  return {
    id: `chatcmpl-${itiBody?.request_id || crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: itiBody?.model_id || requestedModel || DEFAULT_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: cleanText || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length ? "tool_calls" : "stop"
      }
    ],
    usage: {
      prompt_tokens: itiBody?.usage?.input_tokens || 0,
      completion_tokens: itiBody?.usage?.output_tokens || 0,
      total_tokens: itiBody?.usage?.total_tokens || 0
    },
    iti: {
      request_id: itiBody?.request_id || null,
      estimated_cost_usd: itiBody?.estimated_cost_usd ?? null,
      actual_cost_usd: itiBody?.actual_cost_usd ?? null,
      budget_state: itiBody?.usage?.budget_state ?? null
    }
  };
}

export function openAiError(message, type = "invalid_request_error", code = null) {
  return { error: { message, type, param: null, code } };
}

export function streamChunks(completion) {
  const choice = completion.choices[0];
  const firstDelta = choice.message.tool_calls
    ? {
        role: "assistant",
        tool_calls: choice.message.tool_calls.map((call, index) => ({
          index,
          ...call
        }))
      }
    : { role: "assistant", content: choice.message.content || "" };

  return [
    {
      id: completion.id,
      object: "chat.completion.chunk",
      created: completion.created,
      model: completion.model,
      choices: [{ index: 0, delta: firstDelta, finish_reason: null }]
    },
    {
      id: completion.id,
      object: "chat.completion.chunk",
      created: completion.created,
      model: completion.model,
      choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
      usage: completion.usage
    }
  ];
}
