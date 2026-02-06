import 'dotenv/config';
import WebSocket from 'ws';
import {
    NitroliteClient,
    WalletStateSigner,
    createAuthRequestMessage,
    createAuthVerifyMessageFromChallenge,
    createCreateChannelMessage,
    createResizeChannelMessage,
    createCloseChannelMessage,
    createECDSAMessageSigner,
    createEIP712AuthMessageSigner,
    createGetLedgerBalancesMessage,
} from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

/* ───────────── crash visibility ───────────── */
process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

console.log('Starting Yellow + Nitrolite integration…');

/* ───────────── config ───────────── */
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
if (!PRIVATE_KEY) throw new Error('Missing PRIVATE_KEY');

const WS_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const TOKEN = '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb';
const PARTNER = '0xC7E6827ad9DA2c89188fAEd836F9285E6bFdCCCC';
const CUSTODY = '0x019B65A265EB3363822f2752141b3dF16131b262';
const ADJUDICATOR = '0x7c7ccbc98469190849BCC6c926307794fDfB11F2';

/* ───────────── clients ───────────── */
const account = privateKeyToAccount(PRIVATE_KEY);
console.log('✓ Wallet:', account.address);

const publicClient = createPublicClient({
    chain: sepolia,
    transport: http('https://1rpc.io/sepolia'),
});

const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(),
    account,
});

const nitro = new NitroliteClient({
    publicClient,
    walletClient,
    stateSigner: new WalletStateSigner(walletClient),
    chainId: sepolia.id,
    challengeDuration: 3600n,
    addresses: { custody: CUSTODY, adjudicator: ADJUDICATOR },
});

console.log('✓ Nitrolite client initialized');

/* ───────────── session key ───────────── */
const sessionPK = generatePrivateKey();
const sessionSigner = createECDSAMessageSigner(sessionPK);
const sessionAddr = privateKeyToAccount(sessionPK).address;
console.log('✓ Session key:', sessionAddr);

const authParams = {
    session_key: sessionAddr,
    allowances: [{ asset: 'ytest.usd', amount: '1000000000' }],
    expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
    scope: 'app',
};

/* ───────────── helpers ───────────── */
const mapState = (s: any) => ({
    intent: s.intent,
    version: BigInt(s.version),
    data: s.state_data ?? s.data ?? '0x',
    allocations: s.allocations.map((a: any) => ({
        destination: a.destination,
        token: a.token,
        amount: BigInt(a.amount),
    })),
});

const logRequest = (msgName: string, msg: any) => {
    console.log(`\n→ Sending ${msgName}:`);
    console.log(JSON.stringify(msg, null, 2));
};

const logResponse = (msg: any) => {
    console.log('\n← Received WS message:');
    console.log(JSON.stringify(msg, null, 2));
};

/* ───────────── WebSocket & State ───────────── */
const ws = new WebSocket(WS_URL);
let channelId: string | undefined;
let isAuthenticated = false;
let channelConfirmedOpen = false;
let hasResized = false;

/* ───────────── Off-chain Payment ───────────── */
async function sendOffchainPayment(amount: bigint) {
    if (!channelId || !channelConfirmedOpen) {
        console.warn('⚠️ Channel not ready for off-chain payment');
        return;
    }

    const paymentMessage = {
        type: 'payment',
        amount: amount.toString(),
        recipient: PARTNER,
        token: TOKEN,
        channel_id: channelId,
        timestamp: Date.now(),
    };

    const signature = await sessionSigner(JSON.stringify(paymentMessage));
    const signedPayment = {
        ...paymentMessage,
        sender: sessionAddr,
        signature,
    };

    ws.send(JSON.stringify(signedPayment));
    console.log(`💸 Sent off-chain payment of ${amount} in channel ${channelId}`);
}

/* ───────────── WS Event Handlers ───────────── */
ws.on('open', async () => {
    console.log('✓ WebSocket connected');
    const msg = await createAuthRequestMessage({
        address: account.address,
        application: 'app',
        ...authParams,
    });
    logRequest('auth_request', msg);
    ws.send(msg);
});

ws.on('close', (c, r) => console.log('✗ WebSocket closed:', c, r.toString()));
ws.on('error', (e) => console.error('✗ WebSocket error:', e));

ws.on('message', async (raw) => {
    let msg: any;
    try {
        msg = JSON.parse(raw.toString());
    } catch {
        console.error('✗ Failed to parse WS message:', raw.toString());
        return;
    }

    logResponse(msg);

    if (msg.error) {
        console.error('✗ RPC ERROR:', msg.error);
        return;
    }

    if (!msg.res) {
        console.warn('⚠️ Message without res field');
        return;
    }

    const [, method, d] = msg.res;

    /* ───── Auth Flow ───── */
    if (method === 'auth_challenge') {
        if (isAuthenticated) return;
        const verify = await createAuthVerifyMessageFromChallenge(
            createEIP712AuthMessageSigner(walletClient, authParams, { name: 'app' }),
            d.challenge_message
        );
        logRequest('auth_verify', verify);
        ws.send(verify);
    }

    if (method === 'auth_verify') {
        isAuthenticated = true;
        console.log('✓ Authenticated successfully');

        const ledger = await createGetLedgerBalancesMessage(sessionSigner, account.address, Date.now());
        logRequest('get_ledger_balances', ledger);
        ws.send(ledger);
    }

    /* ───── Channel Flow ───── */
    if (method === 'channels') {
        // Check for existing open channel
        const open = d.channels?.find((c: any) => c.status === 'open');
        if (open) {
            channelId = open.channel_id;
            console.log('✓ Found existing open channel:', channelId);
            return;
        }

        // Create new channel
        const create = await createCreateChannelMessage(sessionSigner, {
            chain_id: sepolia.id,
            token: TOKEN,
        });
        logRequest('create_channel', create);
        ws.send(create);
    }

    if (method === 'create_channel') {
        channelId = d.channel_id;
        console.log('✓ Channel created on server:', channelId);

        await nitro.createChannel({
            channel: d.channel,
            unsignedInitialState: mapState(d.state),
            serverSignature: d.server_signature,
        });
    }

    if (method === 'cu') {
        if (d.channel_id !== channelId) return;

        channelConfirmedOpen = d.status === 'open';
        console.log('✓ Channel confirmed open:', channelId);

        // Resize/fund the channel once confirmed open
        if (!hasResized) {
            hasResized = true;
            const resize = await createResizeChannelMessage(sessionSigner, {
                channel_id: channelId,
                allocate_amount: 20n,
                funds_destination: account.address,
            });
            logRequest('resize_channel', resize);
            ws.send(resize);
        }
    }

    if (method === 'resize_channel') {
        console.log('✓ Resize request acknowledged:', d.channel_id);
        // After resize, funds should be available → send off-chain payment
        await sendOffchainPayment(5n);
    }

    if (method === 'bu') {
        console.log('💰 Balance update:', d.balance_updates);
    }

    if (method === 'close_channel') {
        console.log('✓ Channel closed:', d.channel_id);
        process.exit(0);
    }

    // Handle other unhandled methods
    const handledMethods = ['auth_challenge', 'auth_verify', 'get_ledger_balances', 'channels', 'create_channel', 'resize_channel', 'cu', 'bu', 'close_channel'];
    if (!handledMethods.includes(method)) {
        console.warn('⚠️ Unhandled method:', method);
    }
});
