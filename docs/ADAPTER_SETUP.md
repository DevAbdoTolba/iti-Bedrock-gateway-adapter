# Adapter setup

Use your ITI Student Bedrock API key with OpenClaude, OpenCode, Aider, and other OpenAI-compatible tools.

[![Tests](https://github.com/DevAbdoTolba/iti-Bedrock-gateway-adapter/actions/workflows/test.yml/badge.svg)](https://github.com/DevAbdoTolba/iti-Bedrock-gateway-adapter/actions/workflows/test.yml)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/DevAbdoTolba/iti-Bedrock-gateway-adapter)

## What does this adapter do?

ITI uses this API:

```text
/api/v1/student/chat
```

Most AI tools use this API:

```text
/v1/chat/completions
```

This adapter translates between them.

```text
Your AI tool → This adapter → ITI Bedrock
```

The adapter is small. It has no database. It does not save your API key or prompts.

## Start

You need [Node.js 20+](https://nodejs.org/).

```bash
git clone https://github.com/DevAbdoTolba/iti-Bedrock-gateway-adapter.git
cd iti-Bedrock-gateway-adapter
npm start
```

You should see:

```text
ITI adapter is ready on http://0.0.0.0:8787/v1
```

Keep this terminal open.

## OpenClaude

Open a second terminal:

```bash
openclaude
```

Run `/provider`, then choose `Add provider` → `Custom`.

Use:

```text
Name: ITI Bedrock
Base URL: http://127.0.0.1:8787/v1
API key: your sbg_ key
Model: anthropic.claude-sonnet-4-6
API format: Chat Completions
```

## OpenCode

Add this to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "iti-bedrock": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "ITI Bedrock",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "{env:SBG_API_KEY}"
      },
      "models": {
        "anthropic.claude-sonnet-4-6": {
          "name": "Claude Sonnet 4.6"
        }
      }
    }
  },
  "model": "iti-bedrock/anthropic.claude-sonnet-4-6"
}
```

Set your key, then run OpenCode:

**PowerShell**

```powershell
$env:SBG_API_KEY="sbg_your_key"
opencode
```

**Linux/macOS**

```bash
export SBG_API_KEY="sbg_your_key"
opencode
```

## Aider

```bash
export OPENAI_API_BASE="http://127.0.0.1:8787/v1"
export OPENAI_API_KEY="sbg_your_key"
aider --model openai/anthropic.claude-sonnet-4-6 --edit-format whole
```

PowerShell uses `$env:NAME="value"` instead of `export`.

## Docker

```bash
docker compose up -d --build
```

Stop it:

```bash
docker compose down
```

## Online deployment

Click **Deploy to Render** at the top of this page. You can also use Railway, Fly.io, or any Docker server.

After deployment, replace:

```text
http://127.0.0.1:8787/v1
```

with:

```text
https://your-adapter-domain.com/v1
```

Each user still enters their own `sbg_` key.

## API example

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sbg_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic.claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Important limits

- ITI returns normal text. It does not return native tool calls.
- The adapter asks the model to write tool calls as text, then translates them.
- Tool use may be less stable than a normal OpenAI or Anthropic API.
- Streaming is buffered. You get an SSE response after ITI finishes.
- ITI currently shows an HTTP upstream URL. Do not use unknown public adapters. Self-host when possible.
- This adapter supports chat models. It does not provide an embeddings API.

## Settings

All settings are optional:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Adapter port |
| `ITI_API_URL` | ITI student chat URL | ITI endpoint |
| `REQUEST_TIMEOUT_MS` | `600000` | Request timeout |
| `MAX_BODY_BYTES` | `10000000` | Maximum request size |
| `ITI_MODELS` | Built-in model list | Comma-separated model IDs |

## Test

```bash
npm test
```

## License

MIT
