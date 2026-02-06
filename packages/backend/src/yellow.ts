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

/* ───────────── main WebSocket flow ───────────── */
const ws = new WebSocket(WS_URL);

let channelId: string | undefined;
let resized = false;
let isAuthenticated = false;

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
    try { msg = JSON.parse(raw.toString()); }
    catch (e) { console.error('✗ Failed to parse WS message:', raw.toString()); return; }

    logResponse(msg);

    if (msg.error) { console.error('✗ RPC ERROR:', msg.error); return; }
    if (!msg.res) { console.warn('⚠️ Message without res field'); return; }

    const [, method, d] = msg.res;

    /* ───── auth ───── */
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

    /* ───── channels ───── */
    if (method === 'channels') {
        const open = d.channels?.find((c: any) => c.status === 'open');
        channelId = open?.channel_id;

        if (channelId && !resized) {
            resized = true;
            const resize = await createResizeChannelMessage(sessionSigner, {
                channel_id: channelId as `0x${string}`,
                allocate_amount: 20n,
                funds_destination: account.address,
            });
            logRequest('resize_channel', resize);
            ws.send(resize);
        }

        if (!channelId) {
            const create = await createCreateChannelMessage(sessionSigner, {
                chain_id: sepolia.id,
                token: TOKEN,
            });
            logRequest('create_channel', create);
            ws.send(create);
        }
    }

    /* ───── create_channel ───── */
    if (method === 'create_channel') {
        channelId = d.channel_id;

        console.log('✓ Channel prepared on server:', channelId);

        await nitro.createChannel({
            channel: d.channel,
            unsignedInitialState: mapState(d.state),
            serverSignature: d.server_signature,
        });

        if (!resized) {
            resized = true;
            const resize = await createResizeChannelMessage(sessionSigner, {
                channel_id: channelId,
                allocate_amount: 20n,
                funds_destination: account.address,
            });
            logRequest('resize_channel', resize);
            ws.send(resize);
        }
    }

    /* ───── resize_channel ───── */
    if (method === 'resize_channel') {
        const onChain = await nitro.getChannelData(d.channel_id as `0x${string}`);
        const proofStates = onChain.lastValidState ? [onChain.lastValidState] : [];

        console.log('✓ Resizing channel on-chain...');
        await nitro.resizeChannel({
            resizeState: {
                ...mapState(d.state),
                channelId: d.channel_id,
                serverSignature: d.server_signature,
            },
            proofStates,
        });

        const close = await createCloseChannelMessage(sessionSigner, d.channel_id, account.address);
        logRequest('close_channel', close);
        ws.send(close);
    }

    /* ───── close_channel ───── */
    if (method === 'close_channel') {
        console.log('✓ Closing channel on-chain...');
        await nitro.closeChannel({
            finalState: {
                ...mapState(d.state),
                channelId: d.channel_id,
                serverSignature: d.server_signature,
            },
            stateData: d.state.state_data ?? '0x',
        });

        const balances = (await publicClient.readContract({
            address: CUSTODY,
            abi: [{
                type: 'function',
                name: 'getAccountsBalances',
                inputs: [
                    { name: 'users', type: 'address[]' },
                    { name: 'tokens', type: 'address[]' },
                ],
                outputs: [{ type: 'uint256[]' }],
                stateMutability: 'view',
            }],
            functionName: 'getAccountsBalances',
            args: [[account.address], [TOKEN]],
        })) as bigint[];

        if (balances[0] > 0n) {
            console.log('✓ Withdrawing funds:', balances[0].toString());
            await nitro.withdrawal(TOKEN, balances[0]);
            console.log('✓ Funds withdrawn successfully');
        } else {
            console.log('⚠️ No funds to withdraw');
        }

        console.log('✓ Flow complete');
        process.exit(0);
    }

    if (![
        'auth_challenge',
        'auth_verify',
        'get_ledger_balances',
        'channels',
        'create_channel',
        'resize_channel',
        'close_channel',
    ].includes(method)) {
        console.warn('⚠️ Unhandled method:', method);
    }
});
