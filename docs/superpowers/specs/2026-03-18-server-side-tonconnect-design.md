# Server-Side TON Connect for Safe Endpoints

**Date:** 2026-03-18
**Status:** Approved

## Problem

Safe transfer endpoints require the dashboard tab to be open for TON Connect signing. If the user closes the tab, pending requests can't be approved. This creates a poor UX — the user must keep a browser tab open at all times.

## Solution

Move TON Connect session management to the API server (Cloudflare Worker). The server maintains the wallet connection and pushes signing requests directly to the user's Tonkeeper wallet. The user approves on their phone. No dashboard tab needed.

## Architecture

```
Agent                    API Worker                TON Connect Bridge        Tonkeeper (phone)
  │                         │                            │                        │
  │ POST /safe/tx/transfer  │                            │                        │
  │────────────────────────>│                            │                        │
  │                         │ create pending request     │                        │
  │                         │ load TC session from KV    │                        │
  │                         │ POST signing request ─────>│                        │
  │                         │                            │ push notification ────>│
  │   { id, status:pending }│                            │                        │
  │<────────────────────────│                            │                        │
  │                         │                            │                        │
  │                         │                            │    user approves       │
  │                         │                            │<───── signed BOC ──────│
  │                         │                            │                        │
  │ GET /safe/tx/{id}       │                            │                        │
  │────────────────────────>│                            │                        │
  │                         │ check bridge for response  │                        │
  │                         │ GET ─────────────────────->│                        │
  │                         │ <── signed BOC ────────────│                        │
  │                         │ broadcast to TON network   │                        │
  │                         │ update status: confirmed   │                        │
  │  { status: confirmed }  │                            │                        │
  │<────────────────────────│                            │                        │
```

## Components

### 1. Dashboard — Setup Only

The dashboard's role changes to:
- **One-time wallet connection** via TON Connect UI
- **Persist session to server** — after connecting, sends TC session state to `POST /v1/auth/connect`
- **Token management** — create/revoke agent tokens (unchanged)
- **Transaction log** — read-only view of past transactions and their statuses

The dashboard no longer polls for pending requests or signs transactions.

### 2. API Worker — TON Connect Session Storage

New endpoint: `POST /v1/auth/connect`

Receives the TON Connect session state from the dashboard after initial wallet connection. Stores in KV:

| Key | Value | TTL |
|-----|-------|-----|
| `tc:{walletAddress}` | Serialized TC session (keypair, bridge URL, wallet public key, client ID) | No expiry |

The session state includes:
- `secretKey` — dApp-side NaCl keypair secret (for encrypting bridge messages)
- `publicKey` — dApp-side public key
- `walletPublicKey` — Wallet's public key (for encryption)
- `bridgeUrl` — Bridge server URL
- `clientId` — Hex-encoded dApp public key (used as client ID on bridge)

### 3. API Worker — Auto-Sign Flow

When `POST /v1/safe/tx/transfer` is called:

1. Create pending request in KV (same as now)
2. Load TC session from `tc:{walletAddress}`
3. If no session found, return the pending request as-is (dashboard fallback)
4. Build a `sendTransaction` request per TON Connect protocol:
   - Construct the transaction message (to, amount, payload)
   - Encrypt with NaCl using session keys
   - POST to bridge URL with wallet's client ID as recipient
5. Store bridge correlation: `bridge:{walletAddress}:{requestId}` → request ID
6. Return pending request to agent

### 4. API Worker — Bridge Response Handling

Two triggers for checking bridge responses:

**a) On-demand (when agent polls):**
When `GET /v1/safe/tx/{id}` or `GET /v1/safe/tx/pending` is called:
- If request is still pending, check bridge for wallet response
- GET from bridge URL using dApp's client ID
- If response received:
  - Decrypt with NaCl
  - If success: extract signed BOC, broadcast to TON network, update status to `confirmed`
  - If error/reject: update status to `rejected`
- Return current status

**b) Scheduled (cron trigger):**
A Cloudflare Workers cron trigger runs every 30 seconds:
- Lists all pending requests (`widx:{address}:*`)
- For each, checks bridge for responses
- Processes any received responses (broadcast + confirm, or reject)
- Expires requests past 5-minute TTL

### 5. Bridge Communication Protocol

TON Connect bridge protocol (HTTP-based):

**Send message to wallet:**
```
POST {bridgeUrl}/message?client_id={dAppClientId}&to={walletClientId}&ttl=300
Content-Type: text/plain

{base64-encoded-encrypted-message}
```

**Receive messages from wallet:**
```
GET {bridgeUrl}/events?client_id={dAppClientId}&last_event_id={lastEventId}
```
Returns SSE stream. In Workers context, we use single GET with timeout.

**Message encryption:**
- Uses NaCl box (x25519-xsalsa20-poly1305)
- dApp encrypts with: dApp secret key + wallet public key
- Wallet encrypts responses with: wallet secret key + dApp public key

### 6. KV Schema Changes

New keys:

| Key Pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `tc:{walletAddress}` | JSON: TC session state | None | Persisted wallet connection |
| `tclast:{walletAddress}` | Last bridge event ID | None | Bridge SSE cursor |

Modified behavior:
- `req:{id}` — No change to structure, but `status` transitions happen server-side
- Confirm/reject endpoints remain for backward compatibility but are also triggered automatically

### 7. Transaction Log

New endpoint: `GET /v1/auth/tx-log`

Returns recent transactions (confirmed, rejected, expired) for the authenticated wallet. Reads from `widx:{address}:*` index and returns enriched request objects.

Dashboard displays this as a chronological log with status badges.

## Security Considerations

- TC session secret key is stored in KV. KV is encrypted at rest by Cloudflare. The secret key is only used for bridge message encryption, not for signing transactions. The wallet still signs.
- The bridge protocol is end-to-end encrypted. The bridge server cannot read message contents.
- The wallet (Tonkeeper) always shows the transaction details and requires explicit user approval. The server cannot forge signatures.

## Migration

- Existing dashboard users need to reconnect their wallet once to establish the server-side session
- Existing agent tokens continue to work unchanged
- The confirm/reject endpoints remain functional for backward compatibility

## Dashboard Changes

The dashboard becomes a setup + monitoring tool:
- **Setup section:** Connect wallet (persists to server), create agent tokens
- **Log section:** Real-time transaction log (pending, confirmed, rejected, expired)
- **Remove:** Auto-approve toggle, pending request cards with approve/reject buttons

## Dependencies

- `@tonconnect/protocol` — For SessionCrypto, message encoding/decoding
- `tweetnacl` or Web Crypto — For NaCl box encryption (Cloudflare Workers support Web Crypto)

## Out of Scope

- AgentVault contract integration for non-safe endpoints (future work)
- Multiple wallet support per account
- Push notifications beyond Tonkeeper's built-in TON Connect notifications
