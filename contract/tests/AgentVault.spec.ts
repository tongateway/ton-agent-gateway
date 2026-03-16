import { compile } from '@ton/blueprint';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { KeyPair, keyPairFromSeed, getSecureRandomBytes } from '@ton/crypto';
import { Cell, toNano, external, beginCell, SendMode } from '@ton/core';
import { AgentVault } from '../wrappers/AgentVault';
import '@ton/test-utils';

const WALLET_ID = 777;

async function randomKeyPair(): Promise<KeyPair> {
  return keyPairFromSeed(await getSecureRandomBytes(32));
}

describe('AgentVault', () => {
  let blockchain: Blockchain;
  let admin: SandboxContract<TreasuryContract>;
  let ownerKp: KeyPair;
  let vault: SandboxContract<AgentVault>;
  let code: Cell;

  beforeAll(async () => {
    code = await compile('AgentVault');
  });

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    admin = await blockchain.treasury('admin');
    ownerKp = await randomKeyPair();

    vault = blockchain.openContract(
      AgentVault.createFromConfig(
        {
          signatureAllowed: true,
          seqno: 0,
          walletId: WALLET_ID,
          ownerPublicKey: ownerKp.publicKey,
          adminAddress: admin.address,
        },
        code,
      ),
    );

    const deployResult = await admin.send({
      to: vault.address,
      value: toNano('1'),
      init: vault.init,
    });

    expect(deployResult.transactions).toHaveTransaction({
      on: vault.address,
      deploy: true,
      aborted: false,
    });
  });

  function envelope(seqno: number, validUntil?: number) {
    return {
      walletId: WALLET_ID,
      seqno,
      validUntil: validUntil ?? Math.floor(Date.now() / 1000) + 600,
    };
  }

  async function sendExternal(signedBody: Cell) {
    const ext = external({ to: vault.address, body: signedBody });
    return blockchain.sendMessage(ext);
  }

  // ===== Deploy =====

  it('deploys and returns seqno', async () => {
    expect(await vault.getSeqno()).toBe(0);
  });

  it('accepts plain TON transfers', async () => {
    const result = await admin.send({ to: vault.address, value: toNano('0.5') });
    expect(result.transactions).toHaveTransaction({
      on: vault.address,
      aborted: false,
    });
  });

  // ===== Admin: set agent =====

  it('admin can set agent key', async () => {
    const agentKp = await randomKeyPair();
    const validUntil = Math.floor(Date.now() / 1000) + 3600;

    const result = await vault.sendAdminSetAgent(admin.getSender(), {
      value: toNano('0.05'),
      agentPublicKey: agentKp.publicKey,
      validUntil,
    });

    expect(result.transactions).toHaveTransaction({
      on: vault.address,
      aborted: false,
    });
  });

  it('non-admin cannot set agent key', async () => {
    const stranger = await blockchain.treasury('stranger');
    const agentKp = await randomKeyPair();

    const result = await vault.sendAdminSetAgent(stranger.getSender(), {
      value: toNano('0.05'),
      agentPublicKey: agentKp.publicKey,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(result.transactions).toHaveTransaction({
      on: vault.address,
      aborted: true,
      exitCode: 412, // unauthorized
    });
  });

  // ===== Admin: revoke agent =====

  it('admin can revoke agent key', async () => {
    const agentKp = await randomKeyPair();
    await vault.sendAdminSetAgent(admin.getSender(), {
      value: toNano('0.05'),
      agentPublicKey: agentKp.publicKey,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = await vault.sendAdminRevokeAgent(admin.getSender(), {
      value: toNano('0.05'),
    });

    expect(result.transactions).toHaveTransaction({
      on: vault.address,
      aborted: false,
    });
  });

  // ===== Admin: set owner key =====

  it('admin can set owner key', async () => {
    const newOwnerKp = await randomKeyPair();

    const result = await vault.sendAdminSetOwnerKey(admin.getSender(), {
      value: toNano('0.05'),
      ownerPublicKey: newOwnerKp.publicKey,
    });

    expect(result.transactions).toHaveTransaction({
      on: vault.address,
      aborted: false,
    });
  });

  // ===== External: owner executes actions =====

  it('owner can send transfer via external message', async () => {
    const recipient = await blockchain.treasury('recipient');
    const transferAmount = toNano('0.1');

    const signedBody = AgentVault.buildSignedBody(
      envelope(0),
      [{
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        message: AgentVault.buildTransferMessage(recipient.address, transferAmount),
      }],
      ownerKp.secretKey,
    );

    const result = await sendExternal(signedBody);

    expect(result.transactions).toHaveTransaction({
      on: vault.address,
      aborted: false,
    });
    expect(result.transactions).toHaveTransaction({
      from: vault.address,
      to: recipient.address,
      value: transferAmount,
    });
    expect(await vault.getSeqno()).toBe(1);
  });

  it('owner can send multiple transfers in one external', async () => {
    const r1 = await blockchain.treasury('r1');
    const r2 = await blockchain.treasury('r2');
    const mode = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;

    const signedBody = AgentVault.buildSignedBody(
      envelope(0),
      [
        { sendMode: mode, message: AgentVault.buildTransferMessage(r1.address, toNano('0.05')) },
        { sendMode: mode, message: AgentVault.buildTransferMessage(r2.address, toNano('0.07')) },
      ],
      ownerKp.secretKey,
    );

    const result = await sendExternal(signedBody);

    expect(result.transactions).toHaveTransaction({ from: vault.address, to: r1.address, value: toNano('0.05') });
    expect(result.transactions).toHaveTransaction({ from: vault.address, to: r2.address, value: toNano('0.07') });
    expect(await vault.getSeqno()).toBe(1);
  });

  it('owner can send empty actions (seqno bump)', async () => {
    const signedBody = AgentVault.buildSignedBody(envelope(0), [], ownerKp.secretKey);
    const result = await sendExternal(signedBody);

    expect(result.transactions).toHaveTransaction({ on: vault.address, aborted: false });
    expect(await vault.getSeqno()).toBe(1);
  });

  // ===== External: agent executes actions =====

  it('agent can send transfer via external message', async () => {
    const agentKp = await randomKeyPair();
    const recipient = await blockchain.treasury('recipient');

    await vault.sendAdminSetAgent(admin.getSender(), {
      value: toNano('0.05'),
      agentPublicKey: agentKp.publicKey,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
    });

    const signedBody = AgentVault.buildSignedBody(
      envelope(0),
      [{
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        message: AgentVault.buildTransferMessage(recipient.address, toNano('0.1')),
      }],
      agentKp.secretKey,
    );

    const result = await sendExternal(signedBody);

    expect(result.transactions).toHaveTransaction({ on: vault.address, aborted: false });
    expect(result.transactions).toHaveTransaction({ from: vault.address, to: recipient.address, value: toNano('0.1') });
    expect(await vault.getSeqno()).toBe(1);
  });

  // ===== External: agent restrictions =====

  it('revoked agent cannot send external', async () => {
    const agentKp = await randomKeyPair();

    await vault.sendAdminSetAgent(admin.getSender(), {
      value: toNano('0.05'),
      agentPublicKey: agentKp.publicKey,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
    });
    await vault.sendAdminRevokeAgent(admin.getSender(), { value: toNano('0.05') });

    const signedBody = AgentVault.buildSignedBody(envelope(0), [], agentKp.secretKey);

    await expect(sendExternal(signedBody)).rejects.toThrow();
    expect(await vault.getSeqno()).toBe(0);
  });

  it('expired agent cannot send external', async () => {
    const agentKp = await randomKeyPair();
    const pastTime = Math.floor(Date.now() / 1000) - 100;

    await vault.sendAdminSetAgent(admin.getSender(), {
      value: toNano('0.05'),
      agentPublicKey: agentKp.publicKey,
      validUntil: pastTime,
    });

    const signedBody = AgentVault.buildSignedBody(
      envelope(0, Math.floor(Date.now() / 1000) + 600),
      [],
      agentKp.secretKey,
    );

    await expect(sendExternal(signedBody)).rejects.toThrow();
    expect(await vault.getSeqno()).toBe(0);
  });

  // ===== External: signature validation =====

  it('rejects external with wrong key', async () => {
    const wrongKp = await randomKeyPair();

    const signedBody = AgentVault.buildSignedBody(envelope(0), [], wrongKp.secretKey);

    await expect(sendExternal(signedBody)).rejects.toThrow();
    expect(await vault.getSeqno()).toBe(0);
  });

  it('rejects external with wrong seqno', async () => {
    const signedBody = AgentVault.buildSignedBody(envelope(999), [], ownerKp.secretKey);

    await expect(sendExternal(signedBody)).rejects.toThrow();
    expect(await vault.getSeqno()).toBe(0);
  });

  it('rejects external with wrong wallet_id', async () => {
    const signedBody = AgentVault.buildSignedBody(
      { walletId: 12345, seqno: 0, validUntil: Math.floor(Date.now() / 1000) + 600 },
      [],
      ownerKp.secretKey,
    );

    await expect(sendExternal(signedBody)).rejects.toThrow();
    expect(await vault.getSeqno()).toBe(0);
  });

  it('rejects expired external message', async () => {
    const signedBody = AgentVault.buildSignedBody(
      envelope(0, Math.floor(Date.now() / 1000) - 100),
      [],
      ownerKp.secretKey,
    );

    await expect(sendExternal(signedBody)).rejects.toThrow();
    expect(await vault.getSeqno()).toBe(0);
  });

  // ===== Replay protection =====

  it('increments seqno and rejects replay', async () => {
    const signedBody = AgentVault.buildSignedBody(envelope(0), [], ownerKp.secretKey);
    await sendExternal(signedBody);
    expect(await vault.getSeqno()).toBe(1);

    // same message (seqno=0) should fail
    await expect(sendExternal(signedBody)).rejects.toThrow();
    expect(await vault.getSeqno()).toBe(1);
  });

  it('sequential external messages with incrementing seqno', async () => {
    for (let i = 0; i < 3; i++) {
      const signedBody = AgentVault.buildSignedBody(envelope(i), [], ownerKp.secretKey);
      await sendExternal(signedBody);
      expect(await vault.getSeqno()).toBe(i + 1);
    }
  });

  // ===== Owner key rotation via admin =====

  it('rotated owner key works, old key rejected', async () => {
    const newOwnerKp = await randomKeyPair();

    await vault.sendAdminSetOwnerKey(admin.getSender(), {
      value: toNano('0.05'),
      ownerPublicKey: newOwnerKp.publicKey,
    });

    // old key should fail
    const oldBody = AgentVault.buildSignedBody(envelope(0), [], ownerKp.secretKey);
    await expect(sendExternal(oldBody)).rejects.toThrow();

    // new key should work
    const newBody = AgentVault.buildSignedBody(envelope(0), [], newOwnerKp.secretKey);
    const result = await sendExternal(newBody);
    expect(result.transactions).toHaveTransaction({ on: vault.address, aborted: false });
    expect(await vault.getSeqno()).toBe(1);
  });

  // ===== Transfer with payload =====

  it('sends transfer with body payload', async () => {
    const recipient = await blockchain.treasury('recipient');
    const comment = beginCell().storeUint(0, 32).storeStringTail('hello').endCell();

    const signedBody = AgentVault.buildSignedBody(
      envelope(0),
      [{
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        message: AgentVault.buildTransferMessage(recipient.address, toNano('0.1'), comment),
      }],
      ownerKp.secretKey,
    );

    const result = await sendExternal(signedBody);
    expect(result.transactions).toHaveTransaction({ from: vault.address, to: recipient.address });
  });

  // ===== Bounced messages ignored =====

  it('ignores bounced messages', async () => {
    const result = await admin.send({
      to: vault.address,
      value: toNano('0.05'),
      bounce: true,
      body: beginCell().storeUint(0xFFFFFFFF, 32).endCell(),
    });

    // should not abort — unknown ops are silently ignored
    expect(result.transactions).toHaveTransaction({
      on: vault.address,
      aborted: false,
    });
  });
});
