# Wallet Read Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AI agents read access to wallet data — balances, jettons, transactions, NFTs, DNS resolution, and prices — via the API gateway and MCP tools.

**Architecture:** The API worker proxies read requests to tonapi.io (v2). Authenticated endpoints use the wallet address from the JWT. Public endpoints (DNS, prices) need no auth. Each API endpoint gets a corresponding MCP tool. Tests use a mock tonapi.io response pattern.

**Tech Stack:** Cloudflare Workers, tonapi.io v2 REST API, MCP SDK, vitest (API tests), node test runner (MCP tests)

---

## File Structure

### API (`/Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tonapi.ts` | Create | tonapi.io client — single fetch wrapper for all tonapi calls |
| `src/worker.ts` | Modify | Add 6 new read endpoints under `/v1/wallet/*` and `/v1/dns/*` and `/v1/market/*` |
| `wrangler.toml` | Modify | Add `TONAPI_BASE_URL` and `TONAPI_KEY` env vars |
| `tests/tonapi.test.ts` | Create | Unit tests for tonapi client |
| `tests/wallet-endpoints.test.ts` | Create | Integration tests for wallet read endpoints |

### MCP (`/Users/mac/WebstormProjects/tongateway/agent-gateway-mcp/`)

| File | Action | Responsibility |
|------|--------|---------------|
| `src/index.ts` | Modify | Add 6 new MCP tools |
| `tests/tools.test.ts` | Create | Tests for MCP tool formatting |

---

### Task 1: Create tonapi.io client (`src/tonapi.ts`)

**Files:**
- Create: `src/tonapi.ts`
- Create: `tests/tonapi.test.ts`

- [ ] **Step 1: Write tests for the tonapi client**

Create `tests/tonapi.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTonApiClient } from '../src/tonapi';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('TonApiClient', () => {
  const client = createTonApiClient('https://tonapi.io', 'test-key');

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('getAccount returns balance and status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: '0:abc123',
        balance: 5000000000,
        status: 'active',
        last_activity: 1700000000,
      }),
    });

    const result = await client.getAccount('0:abc123');
    expect(result.balance).toBe(5000000000);
    expect(result.status).toBe('active');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://tonapi.io/v2/accounts/0%3Aabc123',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }),
    );
  });

  it('getJettonBalances returns token list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [
          {
            balance: '1000000',
            jetton: {
              address: '0:usdt',
              name: 'Tether USD',
              symbol: 'USDT',
              decimals: 6,
              image: 'https://example.com/usdt.png',
            },
          },
        ],
      }),
    });

    const result = await client.getJettonBalances('0:abc123');
    expect(result.balances).toHaveLength(1);
    expect(result.balances[0].jetton.symbol).toBe('USDT');
  });

  it('getTransactions returns events', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [
          { event_id: 'evt1', timestamp: 1700000000, actions: [], is_scam: false },
        ],
      }),
    });

    const result = await client.getTransactions('0:abc123', 10);
    expect(result.events).toHaveLength(1);
  });

  it('getNftItems returns NFT list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nft_items: [
          {
            address: '0:nft1',
            metadata: { name: 'Cool NFT', image: 'https://example.com/nft.png' },
            collection: { name: 'Cool Collection' },
          },
        ],
      }),
    });

    const result = await client.getNftItems('0:abc123');
    expect(result.nft_items).toHaveLength(1);
  });

  it('resolveDns returns resolved address', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        wallet: { address: '0:resolved_address', name: 'alice.ton' },
      }),
    });

    const result = await client.resolveDns('alice.ton');
    expect(result.wallet.address).toBe('0:resolved_address');
  });

  it('getRates returns TON price', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rates: {
          TON: { prices: { USD: 2.45, EUR: 2.21 } },
        },
      }),
    });

    const result = await client.getRates(['TON'], ['USD', 'EUR']);
    expect(result.rates.TON.prices.USD).toBe(2.45);
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    });

    await expect(client.getAccount('0:bad')).rejects.toThrow('tonapi error 404');
  });

  it('works without API key', async () => {
    const noKeyClient = createTonApiClient('https://tonapi.io');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rates: {} }),
    });

    await noKeyClient.getRates(['TON'], ['USD']);
    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api
npx vitest run tests/tonapi.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/tonapi.ts`**

```typescript
// src/tonapi.ts — tonapi.io v2 client

export interface TonApiClient {
  getAccount(address: string): Promise<any>;
  getJettonBalances(address: string): Promise<any>;
  getTransactions(address: string, limit?: number): Promise<any>;
  getNftItems(address: string, limit?: number): Promise<any>;
  resolveDns(domain: string): Promise<any>;
  getRates(tokens: string[], currencies: string[]): Promise<any>;
}

export function createTonApiClient(baseUrl: string, apiKey?: string): TonApiClient {
  async function call(path: string): Promise<any> {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/v2${path}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`tonapi error ${res.status}: ${data.error ?? JSON.stringify(data)}`);
    }
    return data;
  }

  return {
    getAccount: (address) => call(`/accounts/${encodeURIComponent(address)}`),
    getJettonBalances: (address) => call(`/accounts/${encodeURIComponent(address)}/jettons`),
    getTransactions: (address, limit = 20) => call(`/accounts/${encodeURIComponent(address)}/events?limit=${limit}`),
    getNftItems: (address, limit = 50) => call(`/accounts/${encodeURIComponent(address)}/nfts?limit=${limit}`),
    resolveDns: (domain) => call(`/dns/${encodeURIComponent(domain)}/resolve`),
    getRates: (tokens, currencies) => call(`/rates?tokens=${tokens.join(',')}&currencies=${currencies.join(',')}`),
  };
}
```

- [ ] **Step 4: Install vitest and run tests**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api
npm install -D vitest
npx vitest run tests/tonapi.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/tonapi.ts tests/tonapi.test.ts package.json package-lock.json
git commit -m "feat: add tonapi.io client with tests"
```

---

### Task 2: Add wallet read endpoints to API worker

**Files:**
- Modify: `src/worker.ts`
- Modify: `wrangler.toml`

- [ ] **Step 1: Add env vars to wrangler.toml**

Add after the existing `[vars]` section:

```toml
TONAPI_BASE_URL = "https://tonapi.io"
```

Note: `TONAPI_KEY` should be set as a secret via `wrangler secret put TONAPI_KEY` (not in toml).

- [ ] **Step 2: Update Env interface in worker.ts**

Add to the `Env` interface:

```typescript
interface Env {
  TON_BROADCAST_URL?: string;
  TON_API_KEY?: string;
  TON_API_KEY_HEADER?: string;
  JWT_SECRET?: string;
  PENDING_STORE: KVNamespace;
  TONAPI_BASE_URL?: string;
  TONAPI_KEY?: string;
}
```

- [ ] **Step 3: Import tonapi client and add endpoints**

Add import at top of worker.ts:

```typescript
import { createTonApiClient } from './tonapi';
```

Add these endpoints BEFORE the `// --- Safe TX ---` comment:

```typescript
      // --- Wallet Read ---

      if (request.method === 'GET' && path === '/v1/wallet/balance') {
        const user = await authenticate(request, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        const client = createTonApiClient(env.TONAPI_BASE_URL ?? 'https://tonapi.io', env.TONAPI_KEY);
        try {
          const data = await client.getAccount(user.address);
          return json({
            address: data.address,
            balance: String(data.balance),
            status: data.status,
          });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      }

      if (request.method === 'GET' && path === '/v1/wallet/jettons') {
        const user = await authenticate(request, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        const client = createTonApiClient(env.TONAPI_BASE_URL ?? 'https://tonapi.io', env.TONAPI_KEY);
        try {
          const data = await client.getJettonBalances(user.address);
          const balances = (data.balances ?? []).map((b: any) => ({
            balance: b.balance,
            symbol: b.jetton?.symbol,
            name: b.jetton?.name,
            decimals: b.jetton?.decimals,
            address: b.jetton?.address,
          }));
          return json({ balances });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      }

      if (request.method === 'GET' && path === '/v1/wallet/transactions') {
        const user = await authenticate(request, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        const limit = Number(new URL(request.url).searchParams.get('limit') ?? '20');
        const client = createTonApiClient(env.TONAPI_BASE_URL ?? 'https://tonapi.io', env.TONAPI_KEY);
        try {
          const data = await client.getTransactions(user.address, limit);
          return json({ events: data.events ?? [] });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      }

      if (request.method === 'GET' && path === '/v1/wallet/nfts') {
        const user = await authenticate(request, env);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        const client = createTonApiClient(env.TONAPI_BASE_URL ?? 'https://tonapi.io', env.TONAPI_KEY);
        try {
          const data = await client.getNftItems(user.address);
          const items = (data.nft_items ?? []).map((n: any) => ({
            address: n.address,
            name: n.metadata?.name,
            image: n.metadata?.image,
            collection: n.collection?.name,
          }));
          return json({ nfts: items });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      }

      // --- Public Read (no auth) ---

      const dnsMatch = path.match(/^\/v1\/dns\/([^/]+)\/resolve$/);
      if (dnsMatch && request.method === 'GET') {
        const domain = decodeURIComponent(dnsMatch[1]);
        const client = createTonApiClient(env.TONAPI_BASE_URL ?? 'https://tonapi.io', env.TONAPI_KEY);
        try {
          const data = await client.resolveDns(domain);
          return json({
            domain,
            address: data.wallet?.address ?? null,
            name: data.wallet?.name ?? null,
          });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      }

      if (request.method === 'GET' && path === '/v1/market/price') {
        const params = new URL(request.url).searchParams;
        const tokens = (params.get('tokens') ?? 'TON').split(',');
        const currencies = (params.get('currencies') ?? 'USD').split(',');
        const client = createTonApiClient(env.TONAPI_BASE_URL ?? 'https://tonapi.io', env.TONAPI_KEY);
        try {
          const data = await client.getRates(tokens, currencies);
          return json({ rates: data.rates ?? {} });
        } catch (e: any) {
          return json({ error: e.message }, 502);
        }
      }
```

- [ ] **Step 4: Add to OpenAPI spec**

Add these entries to `OPENAPI_SPEC.paths`:

```typescript
    '/v1/wallet/balance': {
      get: {
        summary: 'Get wallet balance',
        description: 'Returns TON balance and account status.',
        tags: ['Wallet'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Wallet balance', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              balance: { type: 'string', description: 'Balance in nanoTON' },
              status: { type: 'string' },
            },
          } } } },
        },
      },
    },
    '/v1/wallet/jettons': {
      get: {
        summary: 'Get jetton balances',
        description: 'Returns all jetton (token) balances for the wallet.',
        tags: ['Wallet'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Jetton balances', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              balances: { type: 'array', items: { type: 'object', properties: {
                balance: { type: 'string' },
                symbol: { type: 'string' },
                name: { type: 'string' },
                decimals: { type: 'number' },
                address: { type: 'string' },
              } } },
            },
          } } } },
        },
      },
    },
    '/v1/wallet/transactions': {
      get: {
        summary: 'Get transaction history',
        description: 'Returns recent transactions for the wallet.',
        tags: ['Wallet'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'number', default: 20 } }],
        responses: {
          '200': { description: 'Transactions' },
        },
      },
    },
    '/v1/wallet/nfts': {
      get: {
        summary: 'Get NFTs',
        description: 'Returns NFTs owned by the wallet.',
        tags: ['Wallet'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'NFT list' },
        },
      },
    },
    '/v1/dns/{domain}/resolve': {
      get: {
        summary: 'Resolve .ton domain',
        description: 'Resolve a .ton domain name to a wallet address.',
        tags: ['Wallet'],
        parameters: [{ name: 'domain', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Resolved address', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              domain: { type: 'string' },
              address: { type: 'string' },
            },
          } } } },
        },
      },
    },
    '/v1/market/price': {
      get: {
        summary: 'Get token prices',
        description: 'Get current prices for TON and jettons.',
        tags: ['Wallet'],
        parameters: [
          { name: 'tokens', in: 'query', schema: { type: 'string', default: 'TON' } },
          { name: 'currencies', in: 'query', schema: { type: 'string', default: 'USD' } },
        ],
        responses: {
          '200': { description: 'Price rates' },
        },
      },
    },
```

Add `Wallet` to the tags array:

```typescript
{ name: 'Wallet', description: 'Wallet data — balances, tokens, NFTs, DNS, prices' },
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api
npx wrangler deploy --dry-run 2>&1 | tail -5
```

Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts wrangler.toml
git commit -m "feat: add wallet read endpoints — balance, jettons, transactions, NFTs, DNS, prices"
```

---

### Task 3: Add MCP tools for wallet reads

**Files:**
- Modify: `/Users/mac/WebstormProjects/tongateway/agent-gateway-mcp/src/index.ts`

- [ ] **Step 1: Add 6 new MCP tools**

Add AFTER the existing `list_pending_requests` tool and BEFORE `const transport = ...`:

```typescript
server.tool(
  'get_wallet_info',
  'Get the connected wallet address, TON balance, and account status.',
  {},
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/wallet/balance');
      const balanceTon = (BigInt(result.balance) / 1000000000n).toString();
      const balanceFrac = (BigInt(result.balance) % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '') || '0';
      return {
        content: [{
          type: 'text' as const,
          text: [
            `Address: ${result.address}`,
            `Balance: ${balanceTon}.${balanceFrac} TON (${result.balance} nanoTON)`,
            `Status: ${result.status}`,
          ].join('\n'),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'get_jetton_balances',
  'Get all jetton (token) balances in the connected wallet. Shows USDT, NOT, DOGS, and other tokens.',
  {},
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/wallet/jettons');
      if (!result.balances?.length) {
        return { content: [{ type: 'text' as const, text: 'No jettons found in this wallet.' }] };
      }
      const lines = result.balances.map((b: any) => {
        const decimals = b.decimals ?? 9;
        const raw = BigInt(b.balance);
        const divisor = BigInt(10 ** decimals);
        const whole = (raw / divisor).toString();
        const frac = (raw % divisor).toString().padStart(decimals, '0').replace(/0+$/, '') || '0';
        return `- ${b.symbol ?? b.name ?? 'Unknown'}: ${whole}.${frac} (${b.address})`;
      });
      return {
        content: [{ type: 'text' as const, text: `Jetton balances:\n${lines.join('\n')}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'get_transactions',
  'Get recent transaction history for the connected wallet.',
  {
    limit: z.number().optional().describe('Number of transactions to return (default 10)'),
  },
  async ({ limit }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
    }
    try {
      const result = await apiCall(`/v1/wallet/transactions?limit=${limit ?? 10}`);
      const events = result.events ?? [];
      if (!events.length) {
        return { content: [{ type: 'text' as const, text: 'No recent transactions.' }] };
      }
      const lines = events.map((e: any) => {
        const time = new Date(e.timestamp * 1000).toISOString();
        const actions = (e.actions ?? []).map((a: any) => a.type).join(', ');
        return `- ${time}: ${actions || 'unknown'} ${e.is_scam ? '[SCAM]' : ''}`;
      });
      return {
        content: [{ type: 'text' as const, text: `Recent transactions:\n${lines.join('\n')}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'get_nft_items',
  'List NFTs owned by the connected wallet.',
  {},
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/wallet/nfts');
      const nfts = result.nfts ?? [];
      if (!nfts.length) {
        return { content: [{ type: 'text' as const, text: 'No NFTs found in this wallet.' }] };
      }
      const lines = nfts.map((n: any) =>
        `- ${n.name ?? 'Unnamed'} ${n.collection ? `(${n.collection})` : ''} — ${n.address}`
      );
      return {
        content: [{ type: 'text' as const, text: `NFTs (${nfts.length}):\n${lines.join('\n')}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'resolve_name',
  'Resolve a .ton domain name to a wallet address. Use this when the user says "send to alice.ton" instead of a raw address.',
  {
    domain: z.string().describe('The .ton domain name to resolve (e.g. "alice.ton")'),
  },
  async ({ domain }) => {
    try {
      const result = await fetch(`${API_URL}/v1/dns/${encodeURIComponent(domain)}/resolve`);
      const data = await result.json() as any;
      if (!result.ok) throw new Error(data.error ?? 'Failed');
      if (!data.address) {
        return { content: [{ type: 'text' as const, text: `Domain "${domain}" not found or has no wallet address.` }] };
      }
      return {
        content: [{ type: 'text' as const, text: `${domain} → ${data.address}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'get_ton_price',
  'Get the current price of TON in USD and other currencies.',
  {
    currencies: z.string().optional().describe('Comma-separated currencies (default "USD")'),
  },
  async ({ currencies }) => {
    try {
      const curr = currencies || 'USD';
      const result = await fetch(`${API_URL}/v1/market/price?tokens=TON&currencies=${curr}`);
      const data = await result.json() as any;
      if (!result.ok) throw new Error(data.error ?? 'Failed');
      const tonRates = data.rates?.TON?.prices ?? {};
      const lines = Object.entries(tonRates).map(([c, p]) => `1 TON = ${p} ${c}`);
      return {
        content: [{ type: 'text' as const, text: lines.length ? lines.join('\n') : 'Price data unavailable.' }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);
```

- [ ] **Step 2: Build MCP**

```bash
cd /Users/mac/WebstormProjects/tongateway/agent-gateway-mcp
npm run build
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add wallet read tools — balance, jettons, transactions, NFTs, DNS, prices"
```

---

### Task 4: Bump MCP version and deploy everything

**Files:**
- Modify: `package.json` (MCP)

- [ ] **Step 1: Bump MCP version**

```bash
cd /Users/mac/WebstormProjects/tongateway/agent-gateway-mcp
npm version 0.3.0 --no-git-tag-version
git add package.json
git commit -m "chore: bump version to 0.3.0"
```

- [ ] **Step 2: Push all repos**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api && git push
cd /Users/mac/WebstormProjects/tongateway/agent-gateway-mcp && git push
```

- [ ] **Step 3: Verify API deploy**

```bash
cd /Users/mac/WebstormProjects/tongateway/ton-agent-gateway-api && gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
```

- [ ] **Step 4: Verify MCP publish**

```bash
npm view @tongateway/mcp version
```

Expected: `0.3.0`

---

### Task 5: End-to-end test

- [ ] **Step 1: Test wallet balance**

```bash
curl -s https://api.tongateway.ai/v1/wallet/balance -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 2: Test jetton balances**

```bash
curl -s https://api.tongateway.ai/v1/wallet/jettons -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 3: Test transactions**

```bash
curl -s "https://api.tongateway.ai/v1/wallet/transactions?limit=5" -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 4: Test NFTs**

```bash
curl -s https://api.tongateway.ai/v1/wallet/nfts -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 5: Test DNS resolution**

```bash
curl -s https://api.tongateway.ai/v1/dns/foundation.ton/resolve
```

- [ ] **Step 6: Test prices**

```bash
curl -s "https://api.tongateway.ai/v1/market/price?tokens=TON&currencies=USD,EUR"
```
