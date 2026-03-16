# Agent Gateway for TON

A secure gateway that lets AI agents request TON blockchain transactions while wallet owners keep full signing control via TON Connect.

**Live at [tongateway.ai](https://tongateway.ai)** | **API docs at [api.tongateway.ai/docs](https://api.tongateway.ai/docs)**

## Repositories

| Repository | Description |
|---|---|
| [ton-agent-gateway-api](https://github.com/pewpewgogo/ton-agent-gateway-api) | Cloudflare Worker API and skill definitions |
| [ton-agent-gateway-client](https://github.com/pewpewgogo/ton-agent-gateway-client) | Dashboard and landing page (tongateway.ai) |
| [ton-agent-gateway-contract](https://github.com/pewpewgogo/ton-agent-gateway-contract) | AgentVault smart contract (FunC) |
| [agent-gateway-mcp](https://github.com/pewpewgogo/agent-gateway-mcp) | MCP server for AI agents (`npm install -g agent-gateway-mcp`) |

## How it works

1. **Connect wallet** — owner links their TON wallet on the dashboard
2. **Create agent token** — generate a Bearer token for each AI agent
3. **Agent requests transactions** — via REST API or MCP server, requests go to a pending queue
4. **Owner approves** — the dashboard sends pending transactions to TON Connect for signing (auto-approve available)

## Integration

- **REST API** — `POST /v1/safe/tx/transfer` with `Authorization: Bearer TOKEN`
- **MCP Server** — `npm install -g agent-gateway-mcp` for Claude, OpenClaw, and other MCP-compatible agents
- **Claude Code Skill** — install from [tongateway.ai/skills.html](https://tongateway.ai/skills.html)
