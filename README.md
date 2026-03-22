# Agent Gateway for TON

Give your AI agent access to blockchain. A secure gateway that lets Claude, GPT, Cursor, or any AI agent interact with the TON blockchain — check balances, send transfers, view NFTs, resolve .ton domains, and more.

**Live at [tongateway.ai](https://tongateway.ai)** | **API docs at [api.tongateway.ai/docs](https://api.tongateway.ai/docs)**

## Quick Start

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

1. **Install MCP server** — one command for Claude Code, Cursor, Codex, or OpenClaw
2. **Agent connects your wallet** — generates a link, you open it and connect via TON Connect
3. **Approve on your phone** — agent requests transfers, you approve in your wallet app

No private keys shared with agents. Token persists across restarts.

## Two modes

| Mode | How it works | Use case |
|------|-------------|----------|
| **Safe** (default) | Agent requests transfer → you approve on phone | Day-to-day tasks |
| **Autonomous** | Agent deploys its own wallet, signs transfers directly | Trading bots, automated systems |

## 14 MCP Tools

| Category | Tools |
|----------|-------|
| **Auth** | `request_auth`, `get_auth_token` |
| **Wallet** | `get_wallet_info`, `get_jetton_balances`, `get_transactions`, `get_nft_items` |
| **Transfers** | `request_transfer`, `get_request_status`, `list_pending_requests` |
| **Lookup** | `resolve_name`, `get_ton_price` |
| **Agent Wallet** | `deploy_agent_wallet`, `execute_agent_wallet_transfer`, `get_agent_wallet_info` |

## Repositories

| Repository | Description |
|---|---|
| [@tongateway/mcp](https://github.com/tongateway/mcp) | MCP server for AI agents (14 tools) |
| [ton-agent-gateway-api](https://github.com/tongateway/ton-agent-gateway-api) | Cloudflare Worker API |
| [ton-agent-gateway-client](https://github.com/tongateway/ton-agent-gateway-client) | Landing page + dashboard (tongateway.ai) |
| [ton-agent-gateway-contract](https://github.com/tongateway/ton-agent-gateway-contract) | Agent Wallet smart contract (FunC) |

## Links

- [tongateway.ai](https://tongateway.ai) — landing page with install guides
- [api.tongateway.ai/docs](https://api.tongateway.ai/docs) — Swagger API docs
- [Skill file](https://tongateway.ai/agent-gateway.md) — context file for AI agents
- [Documentation](https://tongateway.ai/docs.html) — full docs
