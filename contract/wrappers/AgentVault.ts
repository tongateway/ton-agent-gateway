import {
  Address,
  beginCell,
  Cell,
  Contract,
  ContractABI,
  contractAddress,
  ContractProvider,
  Sender,
  SendMode,
  external,
  storeMessage,
} from '@ton/core';
import { keyPairFromSeed, sign } from '@ton/crypto';

export const Opcodes = {
  signedExternal: 0x7369676e,
  actionSendMsg: 0x0ec3c86d,
  adminSetAgent: 0x61677374,
  adminRevokeAgent: 0x6172766b,
  adminSetOwnerKey: 0x616f776b,
};

export type AgentVaultConfig = {
  signatureAllowed: boolean;
  seqno: number;
  walletId: number;
  ownerPublicKey: Buffer;
  adminAddress: Address;
  agentPublicKey?: Buffer;
  agentValidUntil?: number;
};

export function agentVaultConfigToCell(config: AgentVaultConfig): Cell {
  return beginCell()
    .storeBit(config.signatureAllowed)
    .storeUint(config.seqno, 32)
    .storeUint(config.walletId, 32)
    .storeBuffer(config.ownerPublicKey, 32)
    .storeAddress(config.adminAddress)
    .storeBuffer(config.agentPublicKey ?? Buffer.alloc(32), 32)
    .storeUint(config.agentValidUntil ?? 0, 32)
    .endCell();
}

export type SignedEnvelope = {
  walletId: number;
  seqno: number;
  validUntil: number;
};

export type OutAction = {
  sendMode: number;
  message: Cell;
};

export class AgentVault implements Contract {
  abi: ContractABI = { name: 'AgentVault' };

  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static createFromAddress(address: Address) {
    return new AgentVault(address);
  }

  static createFromConfig(config: AgentVaultConfig, code: Cell, workchain = 0) {
    const data = agentVaultConfigToCell(config);
    const init = { code, data };
    return new AgentVault(contractAddress(workchain, init), init);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    });
  }

  async getSeqno(provider: ContractProvider): Promise<number> {
    const result = await provider.get('seqno', []);
    return result.stack.readNumber();
  }

  // ===== Admin internal methods =====

  async sendAdminSetAgent(provider: ContractProvider, via: Sender, opts: {
    value: bigint;
    queryId?: bigint;
    agentPublicKey: Buffer;
    validUntil: number;
  }) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(Opcodes.adminSetAgent, 32)
        .storeUint(opts.queryId ?? 0n, 64)
        .storeBuffer(opts.agentPublicKey, 32)
        .storeUint(opts.validUntil, 32)
        .endCell(),
    });
  }

  async sendAdminRevokeAgent(provider: ContractProvider, via: Sender, opts: {
    value: bigint;
    queryId?: bigint;
  }) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(Opcodes.adminRevokeAgent, 32)
        .storeUint(opts.queryId ?? 0n, 64)
        .endCell(),
    });
  }

  async sendAdminSetOwnerKey(provider: ContractProvider, via: Sender, opts: {
    value: bigint;
    queryId?: bigint;
    ownerPublicKey: Buffer;
  }) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(Opcodes.adminSetOwnerKey, 32)
        .storeUint(opts.queryId ?? 0n, 64)
        .storeBuffer(opts.ownerPublicKey, 32)
        .endCell(),
    });
  }

  // ===== C5 Action Builders =====

  static buildActionsList(actions: OutAction[]): Cell {
    let list = beginCell().endCell();
    for (const action of actions) {
      list = beginCell()
        .storeRef(list)
        .storeUint(Opcodes.actionSendMsg, 32)
        .storeUint(action.sendMode, 8)
        .storeRef(action.message)
        .endCell();
    }
    return list;
  }

  static buildTransferMessage(to: Address, amount: bigint, payload?: Cell): Cell {
    const builder = beginCell()
      .storeUint(0x18, 6)
      .storeAddress(to)
      .storeCoins(amount);

    if (payload) {
      builder.storeUint(1, 1 + 4 + 4 + 64 + 32 + 1 + 1).storeRef(payload);
    } else {
      builder.storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1);
    }

    return builder.endCell();
  }

  // ===== Signed External Builders =====

  static buildSignedBody(
    envelope: SignedEnvelope,
    actions: OutAction[],
    secretOrSeedKey: Buffer,
  ): Cell {
    const actionsCell = actions.length > 0 ? AgentVault.buildActionsList(actions) : null;

    const unsignedBody = beginCell()
      .storeUint(Opcodes.signedExternal, 32)
      .storeUint(envelope.walletId, 32)
      .storeUint(envelope.validUntil, 32)
      .storeUint(envelope.seqno, 32)
      .storeMaybeRef(actionsCell)
      .endCell();

    const signature = sign(unsignedBody.hash(), AgentVault.normalizeSecretKey(secretOrSeedKey));

    return beginCell()
      .storeSlice(unsignedBody.beginParse())
      .storeBuffer(signature)
      .endCell();
  }

  static buildExternalMessage(vaultAddress: Address, signedBody: Cell): Cell {
    const message = external({
      to: vaultAddress,
      body: signedBody,
    });

    return beginCell().store(storeMessage(message)).endCell();
  }

  static normalizeSecretKey(privateOrSeedKey: Buffer): Buffer {
    if (privateOrSeedKey.length === 64) {
      return privateOrSeedKey;
    }

    if (privateOrSeedKey.length === 32) {
      return keyPairFromSeed(privateOrSeedKey).secretKey;
    }

    throw new Error('Invalid private key length. Use 32-byte seed or 64-byte secret key.');
  }
}
