import { Address, toNano } from '@ton/core';
import { NetworkProvider, compile } from '@ton/blueprint';
import { AgentVault } from '../wrappers/AgentVault';

export async function run(provider: NetworkProvider) {
  const ownerPublicKeyHex = process.env.OWNER_PUBLIC_KEY_HEX;
  const adminAddressRaw = process.env.ADMIN_ADDRESS;

  if (!ownerPublicKeyHex || !adminAddressRaw) {
    throw new Error('Missing OWNER_PUBLIC_KEY_HEX or ADMIN_ADDRESS in environment');
  }

  const code = await compile('AgentVault');
  const ownerPublicKey = Buffer.from(ownerPublicKeyHex.replace(/^0x/, ''), 'hex');

  if (ownerPublicKey.length !== 32) {
    throw new Error('OWNER_PUBLIC_KEY_HEX must be 32 bytes hex');
  }

  const vault = provider.open(
    AgentVault.createFromConfig(
      {
        signatureAllowed: true,
        seqno: 0,
        walletId: Math.floor(Date.now() / 1000),
        ownerPublicKey,
        adminAddress: Address.parse(adminAddressRaw),
      },
      code,
    ),
  );

  await vault.sendDeploy(provider.sender(), toNano('0.1'));
  await provider.waitForDeploy(vault.address);

  // eslint-disable-next-line no-console
  console.log('AgentVault deployed at', vault.address.toString());
}
