# Agent Gateway Contract (TON)

This folder contains a TON FunC smart contract for a user-owned vault that can authorize an AI agent through a delegated key.

## Security model

- User keeps mnemonic/private wallet key out of the API.
- User deploys `AgentVault` with:
  - `ownerPublicKey` (can sign privileged actions)
  - `adminAddress` (can rotate/revoke keys by internal admin messages)
- Agent gets a delegated `agentPublicKey` with policy:
  - `agentValidUntil`
  - `dailyLimit` in nanotons
- Contract enforces limits for `exec_transfer` signed by the agent key.

## Storage

1. `signatureAllowed` (bool)
2. `seqno` (uint32)
3. `walletId` (uint32)
4. `ownerPublicKey` (uint256)
5. `adminAddress` (msg address)
6. `agentPublicKey` (uint256, `0` means revoked)
7. `agentValidUntil` (uint32 unix seconds)
8. `dailyLimit` (coins)
9. `spentToday` (coins)
10. `spentDay` (uint32 day index)

## Signed external operations

All signed external requests share this envelope:

- `prefix` (`0x7369676e`)
- `walletId` (uint32)
- `validUntil` (uint32)
- `seqno` (uint32)
- operation-specific payload
- `signature` (ed25519, 64 bytes)

Operations:

- `exec_transfer` (`0x65786563`) - owner or agent
- `set_agent` (`0x7365746b`) - owner only
- `revoke_agent` (`0x7265766b`) - owner only
- `set_owner_key` (`0x736f776b`) - owner only

## Internal admin operations

Only `adminAddress` can send:

- `admin_set_agent` (`0x61677374`)
- `admin_revoke_agent` (`0x6172766b`)
- `admin_set_owner_key` (`0x616f776b`)

## Commands

```bash
npm install
npm run build
npm test
npm run start
```

## Deploy

```bash
OWNER_PUBLIC_KEY_HEX=<32-byte-hex> ADMIN_ADDRESS=<admin-ton-address> npm run start -- run deployAgentVault
```
