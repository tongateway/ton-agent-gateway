# Agent Gateway API

Fastify API with Swagger for TON AgentVault execution.

## What it does

- Builds signed external transfer for `AgentVault`
- Broadcasts external message BOC to TON endpoint
- Supports raw execute for pre-built BOCs
- Exposes Swagger UI at `/docs`

## Important security note

For production, prefer giving the AI agent a limited **session key** that can only sign bounded actions in `AgentVault`.

The `sign-and-execute` endpoint accepts `privateKeyHex` for convenience/prototyping, but the safer pattern is:

1. Agent signs client-side.
2. API receives signed body (`execute-signed`) or full external BOC (`raw-execute`).

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open Swagger: `http://localhost:8080/docs`

## Cloudflare Worker

```bash
npm install
npm run worker:deploy
```

After deploy:

- Swagger UI: `https://<worker-subdomain>/docs`
- OpenAPI JSON: `https://<worker-subdomain>/openapi.json`

## Environment

- `HOST` - API bind host
- `PORT` - API port
- `TON_BROADCAST_URL` - endpoint expecting `POST {"boc":"..."}`
- `TON_API_KEY` - optional key
- `TON_API_KEY_HEADER` - header name for API key

## Endpoints

- `GET /health`
- `POST /v1/tx/sign-and-execute`
- `POST /v1/tx/execute-signed`
- `POST /v1/tx/raw-execute`
- `POST /v1/open4dev/orders/create-ton`
- `POST /v1/open4dev/orders/create-jetton`

## open4dev order-book notes

- `create-ton` builds payload with `TonTransfer` opcode `0xcbcd047e` and sends to open4dev `VaultTon`.
- `create-jetton` builds a Jetton `transfer` body (`0x0f8a7ea5`) with open4dev forward payload and sends to the user's Jetton wallet.
- Both endpoints support `dryRun=true` to preview `orderPayloadBoc`, `signedBodyBoc`, and `externalMessageBoc` without broadcasting.
