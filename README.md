# Use ITI Bedrock in your project

Use your ITI Student Bedrock key in a normal app, a RAG system, or an AI agent.

This project gives ITI an OpenAI-compatible chat API.

```text
Your project → This adapter → ITI Bedrock
```

> First time here? Start the adapter with the [setup guide](docs/ADAPTER_SETUP.md).

## TL;DR

```text
Base URL: http://127.0.0.1:8787/v1
API key:  your sbg_ key
Model:    anthropic.claude-sonnet-4-6
```

Use this adapter for:

- A simple AI response
- The answer-generation step in RAG
- Agentic tools such as OpenCode, OpenClaude, and Aider
- Any client that supports OpenAI Chat Completions

It does **not** create embeddings. Keep Jina, Cohere, OpenAI, Ollama, or another embedding model for that step.

## 1. Get one response

Start the adapter first. Then send a normal OpenAI request.

### JavaScript

Install the OpenAI package:

```bash
npm install openai
```

Set your key:

```bash
export SBG_API_KEY="sbg_your_key"
```

PowerShell:

```powershell
$env:SBG_API_KEY="sbg_your_key"
```

Create `ask.mjs`:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.SBG_API_KEY,
  baseURL: "http://127.0.0.1:8787/v1"
});

const result = await client.chat.completions.create({
  model: "anthropic.claude-sonnet-4-6",
  messages: [{ role: "user", content: "Explain binary search simply." }]
});

console.log(result.choices[0].message.content);
```

Run:

```bash
node ask.mjs
```

### Python

Install the OpenAI package:

```bash
pip install openai
```

Create `ask.py`:

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["SBG_API_KEY"],
    base_url="http://127.0.0.1:8787/v1",
)

result = client.chat.completions.create(
    model="anthropic.claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Explain binary search simply."}],
)

print(result.choices[0].message.content)
```

Run:

```bash
python ask.py
```

## 2. Use it in RAG with Qdrant

RAG has two different jobs:

```text
Embedding model → makes vectors → Qdrant stores and finds them
ITI chat model  → reads found text → writes the final answer
```

The ITI adapter does the second job.

This complete example uses FastEmbed instead of Jina. It runs Qdrant in memory, so you do not need a Qdrant server for this test.

Install:

```bash
pip install openai "qdrant-client[fastembed]>=1.14.2"
```

Create `rag.py`:

```python
import os
from openai import OpenAI
from qdrant_client import QdrantClient, models

llm = OpenAI(
    api_key=os.environ["SBG_API_KEY"],
    base_url="http://127.0.0.1:8787/v1",
)

qdrant = QdrantClient(":memory:")
embedding_model = "BAAI/bge-small-en"

documents = [
    "Binary search finds an item in a sorted list.",
    "It checks the middle item and removes half of the search area.",
    "A linear search checks items one by one.",
]

qdrant.create_collection(
    collection_name="books",
    vectors_config=models.VectorParams(
        size=qdrant.get_embedding_size(embedding_model),
        distance=models.Distance.COSINE,
    ),
)

qdrant.upload_collection(
    collection_name="books",
    vectors=[
        models.Document(text=text, model=embedding_model)
        for text in documents
    ],
    payload=[{"text": text} for text in documents],
    ids=list(range(len(documents))),
)

question = "How does binary search work?"
hits = qdrant.query_points(
    collection_name="books",
    query=models.Document(text=question, model=embedding_model),
    limit=2,
).points

context = "\n\n".join(hit.payload["text"] for hit in hits)

result = llm.chat.completions.create(
    model="anthropic.claude-sonnet-4-6",
    messages=[
        {
            "role": "system",
            "content": "Answer only from the supplied context.",
        },
        {
            "role": "user",
            "content": f"Context:\n{context}\n\nQuestion: {question}",
        },
    ],
)

print(result.choices[0].message.content)
```

Run:

```bash
python rag.py
```

The first run downloads the small embedding model. For a real project, connect `QdrantClient` to your Qdrant server instead of using `:memory:`.

### Can it replace Jina embeddings?

The adapter cannot replace Jina by itself. But the example above uses the free local FastEmbed model instead of Jina.

The ITI student API gives us generated text. It does not give us an embedding vector such as:

```json
{"embedding": [0.12, -0.04, 0.88]}
```

Do not ask a chat model to print fake vectors. They will not be stable or useful for search.

You can still use ITI for the expensive answer step and use a small local embedding model for free.

## 3. Use it in an agentic workflow

The adapter accepts OpenAI-style `tools` and changes model tool text into `tool_calls`.

For ready-to-use coding agents:

- [OpenCode setup](docs/ADAPTER_SETUP.md#opencode)
- [OpenClaude setup](docs/ADAPTER_SETUP.md#openclaude)
- [Aider setup](docs/ADAPTER_SETUP.md#aider)

Important: ITI does not return native tool calls. The adapter uses a text translation fallback. Simple actions can work, but complex agents may make mistakes.

## 4. Use plain HTTP

You do not need an SDK:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sbg_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic.claude-sonnet-4-6",
    "messages": [
      {"role": "user", "content": "Say hello in simple English."}
    ]
  }'
```

Read the answer from:

```text
choices[0].message.content
```

## Common errors

### `ECONNREFUSED 127.0.0.1:8787`

The adapter is not running. Open its folder and run:

```bash
npm start
```

Keep that terminal open.

### `401 Missing API key`

Send your ITI `sbg_` key:

```text
Authorization: Bearer sbg_your_key
```

Do not use the temporary browser login token.

### `404 Route not found`

Your base URL is wrong.

Use:

```text
http://127.0.0.1:8787/v1
```

Your app will add `/chat/completions`.

### `model not found` or ITI rejects the model

Use a model that appears in your ITI dashboard. Model access can be different for each student.

### The agent talks but does not edit files

Tool calling is a fallback, not native ITI behavior. Try Aider with whole-file editing, use a stronger model, or ask for one small task at a time.

### The request waits for a long time

ITI may take time to answer. Streaming is buffered, so text appears after ITI finishes.

## Security

- Never commit your `sbg_` key.
- Each user should use their own key.
- The adapter does not save keys or prompts.
- Self-host it when possible. The known ITI upstream URL uses HTTP.

## More

- [Install, Docker, deployment, and coding-agent setup](docs/ADAPTER_SETUP.md)
- [Run tests](docs/ADAPTER_SETUP.md#test)
- License: [MIT](LICENSE)
