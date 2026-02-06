import 'dotenv/config';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { privateKeyToAccount } from 'viem/accounts';

const seedPhrase = process.env.SEED;
if (!seedPhrase) throw new Error('SEED env var required');

const seed = mnemonicToSeedSync(seedPhrase);
const masterKey = HDKey.fromMasterSeed(seed);

for (let i = 0; i < 10; i++) {
    const derived = masterKey.derive(`m/44'/60'/0'/0/${i}`);
    if (!derived.privateKey) continue;

    const privateKey = `0x${Buffer.from(derived.privateKey).toString('hex')}`;
    const account = privateKeyToAccount(privateKey);

    console.log(`\nAccount ${i}:`);
    console.log('Private:', privateKey);
    console.log('Public:', account.publicKey || 'N/A');
    console.log('Address:', account.address);
}