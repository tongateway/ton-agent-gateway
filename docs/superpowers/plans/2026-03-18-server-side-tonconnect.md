# Server-Side TON Connect Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move TON Connect signing from the browser dashboard to the API server so users approve transfers on their phone without keeping a tab open.

**Architecture:** The API worker stores the TON Connect session after initial dashboard setup. When an agent requests a transfer, the worker immediately sends a signing request to the wallet via the TON Connect HTTP bridge. A cron trigger and on-demand polling check for wallet responses, broadcast signed transactions, and update request status.

**Tech Stack:** Cloudflare Workers, KV, `tweetnacl` (NaCl box encryption), TON Connect bridge HTTP protocol

---

## File Structure

### API (`/Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `src/bridge.ts` | Create | TON Connect bridge client: encrypt/decrypt messages, send to bridge, poll responses |
| `src/worker.ts` | Modify | Add `/v1/auth/connect` endpoint, modify safe transfer flow to auto-push to bridge, add cron handler, add `/v1/auth/tx-log` |
| `wrangler.toml` | Modify | Add cron trigger |
| `package.json` | Modify | Add `tweetnacl` + `tweetnacl-util` dependencies |

### Client (`/Users/mac/WebstormProjects/tongateway/ton-agent-gateway-client/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `public/app.js` | Modify | After wallet connect, extract TC session state and POST to `/v1/auth/connect`. Remove auto-approve flow. Replace pending cards with transaction log. |
| `public/app.html` | Modify | Remove pending section and auto-approve toggle. Add transaction log section. |

---

### Task 1: Add `tweetnacl` dependency to API

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install tweetnacl**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api
npm install tweetnacl tweetnacl-util
```

- [ ] **Step 2: Verify it works in worker context**

Add a quick smoke test to confirm tweetnacl works with `nodejs_compat`:

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api
node -e "const nacl = require('tweetnacl'); const kp = nacl.box.keyPair(); console.log('keypair ok, pubkey length:', kp.publicKey.length)"
```

Expected: `keypair ok, pubkey length: 32`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add tweetnacl for TON Connect bridge encryption"
```

---

### Task 2: Create bridge client (`src/bridge.ts`)

**Files:**
- Create: `src/bridge.ts`

This file handles all TON Connect bridge communication: encrypting messages, sending transaction requests, polling for responses, decrypting wallet replies.

- [ ] **Step 1: Create the bridge client module**

```typescript
// src/bridge.ts
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

// --- Types ---

export interface TcSession {
  secretKey: string;    // hex-encoded dApp NaCl secret key
  publicKey: string;    // hex-encoded dApp NaCl public key
  walletPublicKey: string; // hex-encoded wallet's NaCl public key
  bridgeUrl: string;    // e.g. "https://bridge.tonapi.io/bridge"
  walletAddress: string;
}

interface SendTransactionRequest {
  method: 'sendTransaction';
  params: [string]; // JSON-encoded transaction
  id: string;
}

interface BridgeEvent {
  from: string;
  message: string; // base64-encoded encrypted message
}

export interface BridgeResponse {
  id: string;
  result?: string;  // signed BOC (base64)
  error?: { code: number; message: string };
}

// --- Helpers ---

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Encryption ---

function encrypt(message: string, secretKey: Uint8Array, receiverPublicKey: Uint8Array): Uint8Array {
  const encoded = naclUtil.decodeUTF8(message);
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box(encoded, nonce, receiverPublicKey, secretKey);
  // Concat nonce + encrypted
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  return result;
}

function decrypt(message: Uint8Array, secretKey: Uint8Array, senderPublicKey: Uint8Array): string {
  const nonce = message.slice(0, 24);
  const encrypted = message.slice(24);
  const decrypted = nacl.box.open(encrypted, nonce, senderPublicKey, secretKey);
  if (!decrypted) {
    throw new Error('Failed to decrypt bridge message');
  }
  return naclUtil.encodeUTF8(decrypted);
}

// --- Bridge Communication ---

/**
 * Send a sendTransaction request to the wallet via the TON Connect bridge.
 */
export async function bridgeSendTransaction(
  session: TcSession,
  requestId: string,
  to: string,
  amountNano: string,
  payloadBoc?: string,
): Promise<void> {
  const transaction = {
    valid_until: Math.floor(Date.now() / 1000) + 300,
    messages: [{
      address: to,
      amount: amountNano,
      ...(payloadBoc ? { payload: payloadBoc } : {}),
    }],
  };

  const request: SendTransactionRequest = {
    method: 'sendTransaction',
    params: [JSON.stringify(transaction)],
    id: requestId,
  };

  const secretKey = hexToBytes(session.secretKey);
  const walletPubKey = hexToBytes(session.walletPublicKey);
  const clientId = session.publicKey; // hex-encoded dApp public key

  const encrypted = encrypt(JSON.stringify(request), secretKey, walletPubKey);
  const body = naclUtil.encodeBase64(encrypted);

  const url = new URL(`${session.bridgeUrl}/message`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('to', session.walletPublicKey);
  url.searchParams.set('ttl', '300');
  url.searchParams.set('topic', 'sendTransaction');

  const res = await fetch(url.toString(), {
    method: 'POST',
    body,
  });

  if (!res.ok) {
    throw new Error(`Bridge send failed: ${res.status}`);
  }
}

/**
 * Poll the bridge for wallet responses.
 * Returns decoded responses (if any).
 */
export async function bridgePollResponses(
  session: TcSession,
  lastEventId?: string,
): Promise<{ responses: BridgeResponse[]; lastEventId?: string }> {
  const clientId = session.publicKey;
  const url = new URL(`${session.bridgeUrl}/events`);
  url.searchParams.set('client_id', clientId);
  if (lastEventId) {
    url.searchParams.set('last_event_id', lastEventId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      return { responses: [], lastEventId };
    }

    const text = await res.text();
    const secretKey = hexToBytes(session.secretKey);
    const walletPubKey = hexToBytes(session.walletPublicKey);

    const responses: BridgeResponse[] = [];
    let newLastEventId = lastEventId;

    // Parse SSE events
    const events = text.split('\n\n').filter(Boolean);
    for (const event of events) {
      const lines = event.split('\n');
      let id: string | undefined;
      let data: string | undefined;

      for (const line of lines) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        if (line.startsWith('data:')) data = line.slice(5).trim();
      }

      if (id) newLastEventId = id;
      if (!data || data === 'heartbeat') continue;

      try {
        const parsed: BridgeEvent = JSON.parse(data);
        if (parsed.from !== session.walletPublicKey) continue;

        const encryptedBytes = naclUtil.decodeBase64(parsed.message);
        const decrypted = decrypt(encryptedBytes, secretKey, walletPubKey);
        const response: BridgeResponse = JSON.parse(decrypted);
        responses.push(response);
      } catch {
        // Skip malformed events
      }
    }

    return { responses, lastEventId: newLastEventId };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { responses: [], lastEventId };
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/bridge.ts
git commit -m "feat: add TON Connect bridge client for server-side signing"
```

---

### Task 3: Add `/v1/auth/connect` endpoint and session storage

**Files:**
- Modify: `src/worker.ts` (lines ~340-370, auth section)

- [ ] **Step 1: Add TcSession storage helpers to worker.ts**

After the existing session helpers (around line 150), add:

```typescript
import { TcSession, bridgeSendTransaction, bridgePollResponses, BridgeResponse } from './bridge';

// --- TON Connect Session Storage ---

async function saveTcSession(kv: KVNamespace, address: string, session: TcSession): Promise<void> {
  await kv.put(`tc:${address}`, JSON.stringify(session));
}

async function loadTcSession(kv: KVNamespace, address: string): Promise<TcSession | null> {
  const raw = await kv.get(`tc:${address}`);
  return raw ? JSON.parse(raw) : null;
}

async function getTcLastEventId(kv: KVNamespace, address: string): Promise<string | undefined> {
  return (await kv.get(`tclast:${address}`)) ?? undefined;
}

async function setTcLastEventId(kv: KVNamespace, address: string, id: string): Promise<void> {
  await kv.put(`tclast:${address}`, id);
}
```

- [ ] **Step 2: Add POST /v1/auth/connect endpoint**

In the auth section of the handler (after the `/v1/auth/sessions` block), add:

```typescript
if (request.method === 'POST' && path === '/v1/auth/connect') {
  const user = await authenticate(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await parseJson(request) as Record<string, unknown>;
  const session: TcSession = {
    secretKey: body.secretKey as string,
    publicKey: body.publicKey as string,
    walletPublicKey: body.walletPublicKey as string,
    bridgeUrl: body.bridgeUrl as string,
    walletAddress: user.address,
  };

  if (!session.secretKey || !session.publicKey || !session.walletPublicKey || !session.bridgeUrl) {
    return json({ error: 'Missing TON Connect session fields' }, 400);
  }

  await saveTcSession(env.PENDING_STORE, user.address, session);
  return json({ ok: true });
}
```

- [ ] **Step 3: Add to OpenAPI spec**

Add to the `OPENAPI_SPEC.paths` object:

```typescript
'/v1/auth/connect': {
  post: {
    summary: 'Save TON Connect session',
    description: 'Persist the TON Connect session state so the server can send signing requests to the wallet directly.',
    tags: ['Auth'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: {
        type: 'object',
        required: ['secretKey', 'publicKey', 'walletPublicKey', 'bridgeUrl'],
        properties: {
          secretKey: { type: 'string', description: 'Hex-encoded dApp NaCl secret key' },
          publicKey: { type: 'string', description: 'Hex-encoded dApp NaCl public key' },
          walletPublicKey: { type: 'string', description: 'Hex-encoded wallet NaCl public key' },
          bridgeUrl: { type: 'string', description: 'TON Connect bridge URL' },
        },
      } } },
    },
    responses: {
      '200': { description: 'Session saved' },
      '400': { description: 'Missing fields', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
    },
  },
},
```

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat: add /v1/auth/connect endpoint to persist TON Connect session"
```

---

### Task 4: Modify safe transfer to auto-push to bridge

**Files:**
- Modify: `src/worker.ts` (the `POST /v1/safe/tx/transfer` handler)

- [ ] **Step 1: Update the transfer handler to push to bridge after creating pending request**

Find the existing `POST /v1/safe/tx/transfer` handler. After the `kvCreatePending` call, add bridge push logic:

```typescript
// Existing: create pending request
const pending = await kvCreatePending(
  env.PENDING_STORE,
  user.sessionId,
  user.address,
  to,
  amountNano,
  payloadBoc,
);

// NEW: auto-push to wallet via TON Connect bridge
try {
  const tcSession = await loadTcSession(env.PENDING_STORE, user.address);
  if (tcSession) {
    await bridgeSendTransaction(tcSession, pending.id, to, amountNano, payloadBoc);
  }
} catch (e) {
  // Bridge push failed — request is still pending, wallet can confirm manually
  console.error('Bridge send failed:', e);
}

return json(pending);
```

- [ ] **Step 2: Commit**

```bash
git add src/worker.ts
git commit -m "feat: auto-push safe transfer requests to wallet via bridge"
```

---

### Task 5: Add bridge response processing

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Create a response processing helper**

Add after the bridge session helpers:

```typescript
/**
 * Check bridge for wallet responses and process them.
 * Called both on-demand (when agent polls) and by cron.
 */
async function processBridgeResponses(
  kv: KVNamespace,
  address: string,
  broadcastUrl?: string,
  apiKey?: string,
  apiKeyHeader?: string,
): Promise<void> {
  const tcSession = await loadTcSession(kv, address);
  if (!tcSession) return;

  const lastEventId = await getTcLastEventId(kv, address);
  const { responses, lastEventId: newLastEventId } = await bridgePollResponses(tcSession, lastEventId);

  if (newLastEventId && newLastEventId !== lastEventId) {
    await setTcLastEventId(kv, address, newLastEventId);
  }

  for (const response of responses) {
    // response.id is the request ID we sent
    const reqId = response.id;
    const req = await kvGetByIdForWallet(kv, reqId, address);
    if (!req || req.status !== 'pending') continue;

    if (response.error) {
      // Wallet rejected
      req.status = 'rejected';
      await kvUpdate(kv, req);
    } else if (response.result) {
      // Wallet signed — broadcast the BOC
      try {
        if (broadcastUrl) {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (apiKey && apiKeyHeader) headers[apiKeyHeader] = apiKey;
          await fetch(broadcastUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ boc: response.result }),
          });
        }
        req.status = 'confirmed';
        req.txHash = response.result;
      } catch {
        req.status = 'confirmed';
        req.txHash = response.result;
      }
      await kvUpdate(kv, req);
    }
  }
}
```

- [ ] **Step 2: Call processBridgeResponses on GET /v1/safe/tx/{id}**

In the existing `GET /v1/safe/tx/{id}` handler, before returning the request, add:

```typescript
// Check bridge for updates before returning
if (req.status === 'pending') {
  await processBridgeResponses(
    env.PENDING_STORE,
    user.address,
    env.TON_BROADCAST_URL,
    env.TON_API_KEY,
    env.TON_API_KEY_HEADER,
  );
  // Re-read after processing
  const updated = await kvGetByIdForWallet(env.PENDING_STORE, id, user.address);
  if (updated) return json(updated);
}
```

- [ ] **Step 3: Call processBridgeResponses on GET /v1/safe/tx/pending**

Same pattern in the pending list handler:

```typescript
// Check bridge for updates before listing
await processBridgeResponses(
  env.PENDING_STORE,
  user.address,
  env.TON_BROADCAST_URL,
  env.TON_API_KEY,
  env.TON_API_KEY_HEADER,
);
```

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat: process bridge responses on-demand when agent polls status"
```

---

### Task 6: Add cron trigger for background processing

**Files:**
- Modify: `wrangler.toml`
- Modify: `src/worker.ts`

- [ ] **Step 1: Add cron trigger to wrangler.toml**

```toml
[triggers]
crons = ["*/1 * * * *"]
```

(Every 1 minute — Cloudflare Workers cron minimum is 1 minute)

- [ ] **Step 2: Add scheduled handler to worker.ts**

Add a `scheduled` handler to the exported handler object:

```typescript
const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    // ... existing fetch handler
  },

  async scheduled(event, env, ctx) {
    // Find all wallets with TC sessions and pending requests
    const tcKeys = await env.PENDING_STORE.list({ prefix: 'tc:' });
    for (const key of tcKeys.keys) {
      const address = key.name.slice(3); // Remove 'tc:' prefix
      try {
        await processBridgeResponses(
          env.PENDING_STORE,
          address,
          env.TON_BROADCAST_URL,
          env.TON_API_KEY,
          env.TON_API_KEY_HEADER,
        );
      } catch (e) {
        console.error(`Cron: bridge check failed for ${address}:`, e);
      }
    }
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add wrangler.toml src/worker.ts
git commit -m "feat: add cron trigger to poll bridge for wallet responses"
```

---

### Task 7: Add transaction log endpoint

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Add GET /v1/auth/tx-log endpoint**

```typescript
if (request.method === 'GET' && path === '/v1/auth/tx-log') {
  const user = await authenticate(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // Get all requests for this wallet (pending + historical)
  const list = await env.PENDING_STORE.list({ prefix: `widx:${user.address}:` });
  const requests: PendingRequest[] = [];
  for (const key of list.keys) {
    const id = key.name.split(':').pop();
    if (!id) continue;
    const raw = await env.PENDING_STORE.get(`req:${id}`);
    if (raw) requests.push(JSON.parse(raw));
  }

  // Sort by createdAt descending
  requests.sort((a, b) => b.createdAt - a.createdAt);
  return json({ transactions: requests });
}
```

- [ ] **Step 2: Add to OpenAPI spec**

```typescript
'/v1/auth/tx-log': {
  get: {
    summary: 'Transaction log',
    description: 'Returns recent transactions for the authenticated wallet.',
    tags: ['Auth'],
    security: [{ bearerAuth: [] }],
    responses: {
      '200': { description: 'Transaction log', content: { 'application/json': { schema: {
        type: 'object',
        properties: { transactions: { type: 'array', items: { '$ref': '#/components/schemas/PendingRequest' } } },
      } } } },
    },
  },
},
```

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat: add /v1/auth/tx-log endpoint for transaction history"
```

---

### Task 8: Update dashboard — persist TC session to server

**Files:**
- Modify: `public/app.js` in `/Users/mac/WebstormProjects/tongateway/ton-agent-gateway-client/`

- [ ] **Step 1: Extract TC session state after wallet connects and send to API**

In the `tonConnectUI.onStatusChange` callback, after `initSession()`, add:

```javascript
// Persist TON Connect session to server for server-side signing
async function persistTcSession() {
  try {
    // Access internal TC connection state
    const connector = tonConnectUI.connector;
    if (!connector || !connector._provider) return;

    const provider = connector._provider;
    const session = provider.session;
    if (!session || !session.sessionCrypto || !session.walletPublicKey) return;

    const crypto = session.sessionCrypto;
    const tcSession = {
      secretKey: Array.from(crypto.keyPair.secretKey).map(b => b.toString(16).padStart(2, '0')).join(''),
      publicKey: crypto.sessionId, // hex-encoded public key
      walletPublicKey: session.walletPublicKey,
      bridgeUrl: provider.gateway?.bridgeUrl || 'https://bridge.tonapi.io/bridge',
    };

    await fetch(API_URL + '/v1/auth/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + clientToken,
      },
      body: JSON.stringify(tcSession),
    });
    log('Wallet session saved for server-side signing', 'ok');
  } catch (e) {
    console.error('Failed to persist TC session:', e);
  }
}
```

Call `persistTcSession()` after `initSession()` in the `onStatusChange` callback.

- [ ] **Step 2: Commit**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-client
git add public/app.js
git commit -m "feat: persist TON Connect session to server after wallet connect"
```

---

### Task 9: Update dashboard — replace pending section with transaction log

**Files:**
- Modify: `public/app.js`
- Modify: `public/app.html`

- [ ] **Step 1: Remove auto-approve and pending polling from app.js**

Remove:
- `autoApprove` variable and `toggleAutoApprove()` function
- `autoApproveProcessing` set
- The auto-approve block in `poll()`
- The `approve()` function
- The `reject()` function
- `renderPending()` function

Replace `poll()` with a simpler transaction log poller:

```javascript
async function poll() {
  if (!clientToken) return;
  try {
    const res = await fetch(API_URL + '/v1/auth/tx-log', {
      headers: { Authorization: 'Bearer ' + clientToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    renderTxLog(data.transactions);
  } catch {}
}

function renderTxLog(transactions) {
  const list = document.getElementById('tx-log-list');
  if (!transactions.length) {
    list.innerHTML = '<p class="empty">No transactions yet</p>';
    return;
  }
  list.innerHTML = transactions.map(tx => {
    const statusClass = tx.status === 'confirmed' ? 'ok'
      : tx.status === 'rejected' ? 'err'
      : tx.status === 'expired' ? 'dim'
      : 'pending';
    return `
      <div class="tx-card">
        <div class="row"><span class="label">To</span><span class="value">${shortAddr(tx.to)}</span></div>
        <div class="row"><span class="label">Amount</span><span class="value">${formatNano(tx.amountNano)} TON</span></div>
        <div class="row"><span class="label">Status</span><span class="value status-${statusClass}">${tx.status}</span></div>
        <div class="row"><span class="label">Time</span><span class="value">${timeAgo(tx.createdAt)}</span></div>
      </div>
    `;
  }).join('');
}
```

- [ ] **Step 2: Update app.html — replace pending section with tx log**

Replace the pending section with:

```html
<section id="pending-section" class="card hidden">
  <h2>Transaction Log</h2>
  <p class="hint">Transfers requested by your agents. Approve in your wallet app.</p>
  <div id="tx-log-list">
    <p class="empty">No transactions yet</p>
  </div>
</section>
```

Remove:
- Auto-approve toggle checkbox
- Approve/reject buttons from pending cards

- [ ] **Step 3: Add status styling to style.css**

```css
.status-ok { color: var(--green); }
.status-err { color: var(--red); }
.status-dim { color: var(--text-dim); }
.status-pending { color: var(--amber); }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-client
git add public/app.js public/app.html public/style.css
git commit -m "feat: replace pending approval UI with transaction log"
```

---

### Task 10: Deploy and test end-to-end

**Files:**
- Both repos

- [ ] **Step 1: Deploy API**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api
git push
```

Wait for GitHub Actions deploy to complete.

- [ ] **Step 2: Deploy Client**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-client
git push
```

Wait for GitHub Actions deploy to complete.

- [ ] **Step 3: Test — connect wallet on dashboard**

1. Open https://tongateway.ai/app.html
2. Connect wallet via TON Connect
3. Check API logs to confirm TC session was saved
4. Verify `/v1/auth/connect` was called successfully

- [ ] **Step 4: Test — send transfer via MCP/API**

```bash
curl -X POST https://api.tongateway.ai/v1/safe/tx/transfer \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "YOUR_ADDRESS", "amountNano": "100000000"}'
```

Expected: Tonkeeper shows a push notification with the transaction to approve.

- [ ] **Step 5: Test — approve on phone**

Approve the transaction in Tonkeeper. Then check status:

```bash
curl https://api.tongateway.ai/v1/safe/tx/REQUEST_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: `status: "confirmed"` with `txHash` field.

- [ ] **Step 6: Commit any fixes and push**

```bash
git add -A && git commit -m "fix: end-to-end test fixes" && git push
```
