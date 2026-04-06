# Agent Gateway for TON

TON blockchain from your terminal and AI agents. Manage wallets, send transfers, swap tokens on DEX, resolve .ton names, and deploy autonomous agent wallets.

**Live at [tongateway.ai](https://tongateway.ai)** | **API docs at [api.tongateway.ai/docs](https://api.tongateway.ai/docs)**

## Quick Start

### CLI

```bash
npm i -g @tongateway/cli
tgw auth
tgw wallet info
tgw transfer send --to alice.ton --amount 1.5
tgw dex swap --from USDT --to BUILD --amount 10 --price 500
```

### MCP (for AI agents)

```bash
claude mcp add-json tongateway '{
  "command": "npx",
  "args": ["-y", "@tongateway/mcp"],
  "env": {
    "AGENT_GATEWAY_API_URL": "https://api.tongateway.ai"
  }
}' --scope user
```

Then just say: *"Send 1 TON to alice.ton"*

## How it works

1. **Install** — `npm i -g @tongateway/cli` or add the MCP server
2. **Connect your wallet** — `tgw auth` generates a link, you open it and connect via TON Connect
3. **Approve on your phone** — transfers get a push notification, approve with one tap

No private keys shared. Token persists across restarts.

## Two modes

| Mode | How it works | Use case |
|------|-------------|----------|
| **Safe** (default) | Request transfer → approve on phone | Day-to-day tasks |
| **Autonomous** | Agent wallet signs directly, no approval | Trading bots, automated systems |

## 16 Tools

| Category | CLI | MCP |
|----------|-----|-----|
| **Auth** | `tgw auth` | `auth.request`, `auth.get_token` |
| **Wallet** | `tgw wallet info/jettons/transactions/nfts` | `wallet.info`, `wallet.jettons`, `wallet.transactions`, `wallet.nfts` |
| **Transfers** | `tgw transfer send/status/pending/batch` | `transfer.request`, `transfer.status`, `transfer.pending`, `transfer.batch` |
| **Lookup** | `tgw lookup resolve/price` | `lookup.resolve_name`, `lookup.price` |
| **DEX** | `tgw dex pairs/swap` | `dex.create_order`, `dex.pairs` |
| **Agent Wallet** | `tgw agent deploy/info/transfer/batch` | `agent_wallet.deploy`, `agent_wallet.transfer`, `agent_wallet.info`, `agent_wallet.batch_transfer` |

## Repositories

| Repository | Description |
|---|---|
| [@tongateway/cli](https://github.com/tongateway/cli) | CLI tool — `npm i -g @tongateway/cli` |
| [@tongateway/mcp](https://github.com/tongateway/mcp) | MCP server for AI agents (16 tools) |
| [ton-agent-gateway-api](https://github.com/tongateway/ton-agent-gateway-api) | Cloudflare Worker API |
| [ton-agent-gateway-client](https://github.com/tongateway/ton-agent-gateway-client) | Landing page + dashboard (tongateway.ai) |
| [ton-agent-gateway-contract](https://github.com/tongateway/ton-agent-gateway-contract) | Agent Wallet smart contract (FunC) |

## Links

- [tongateway.ai](https://tongateway.ai) — landing page with install guides
- [api.tongateway.ai/docs](https://api.tongateway.ai/docs) — Swagger API docs
- [Skill file](https://tongateway.ai/agent-gateway.md) — context file for AI agents
- [Documentation](https://tongateway.ai/docs.html) — full docs
