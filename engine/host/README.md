# Hosting the engine as an Azure Function

The engine is transport-agnostic: `handleReviewRequest(body, aiCfg)` does the
work. An Azure Function (Node v4 programming model) is a thin wrapper. Example
`function/review.mjs` (after `npm run build`, importing from `dist/`):

```js
import { app } from '@azure/functions';
import { handleReviewRequest } from '@betarover/flow-review-engine';

app.http('review', {
  methods: ['POST'],
  authLevel: 'function', // the connector sends x-functions-key
  handler: async (request, context) => {
    const body = await request.json();
    const aiCfg = process.env.AZURE_OPENAI_ENDPOINT
      ? {
          endpoint: process.env.AZURE_OPENAI_ENDPOINT,
          apiKey: process.env.AZURE_OPENAI_KEY,
          deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
        }
      : undefined;
    const { status, body: out } = await handleReviewRequest(body, aiCfg);
    return { status, jsonBody: out };
  },
});
```

## App settings

| Setting | Purpose |
|---------|---------|
| `AZURE_OPENAI_ENDPOINT` | e.g. `https://my-aoai.openai.azure.com` (omit to disable the AI pass) |
| `AZURE_OPENAI_KEY` | Azure OpenAI key |
| `AZURE_OPENAI_DEPLOYMENT` | chat deployment name, e.g. `gpt-4o` |

Keep secrets in Function app settings / Key Vault — never in flow definitions or
this repo. The connector authenticates with the Function key (`x-functions-key`).

## Wiring to the connector

`connector/flow-review-connector.swagger.json` targets `POST /api/review`. Set
its `host` to your Function app and create the connection with the Function key.
