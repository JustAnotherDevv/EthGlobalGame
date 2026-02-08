import WebSocket from 'ws';
import {
  NitroliteClient,
  WalletStateSigner,
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createCreateChannelMessage,
  createResizeChannelMessage,
  createECDSAMessageSigner,
  createEIP712AuthMessageSigner,
  createGetLedgerBalancesMessage,
  createTransferMessage,
  createPingMessage,
} from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { config } from '../config.js';
import { YELLOW_ASSET } from '../shared/constants.js';

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

export class YellowService {
  private ws!: WebSocket;
  private account;
  private sessionSigner;
  private sessionAddr: string;
  private nitro: NitroliteClient;
  private channelId: string | null = null;
  private authenticated = false;
  private channelReady = false;
  private pendingResolves: Array<() => void> = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  readonly address: string;

  constructor() {
    this.account = privateKeyToAccount(config.privateKey);
    this.address = this.account.address;

    const sessionPK = generatePrivateKey();
    this.sessionSigner = createECDSAMessageSigner(sessionPK);
    this.sessionAddr = privateKeyToAccount(sessionPK).address;

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(config.rpcUrl),
    });

    const walletClient = createWalletClient({
      chain: sepolia,
      transport: http(),
      account: this.account,
    });

    this.nitro = new NitroliteClient({
      publicClient,
      walletClient,
      stateSigner: new WalletStateSigner(walletClient),
      chainId: sepolia.id,
      challengeDuration: 3600n,
      addresses: {
        custody: config.yellowCustody,
        adjudicator: config.yellowAdjudicator,
      },
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(config.yellowWsUrl);

      const authParams = {
        session_key: this.sessionAddr as `0x${string}`,
        allowances: [{ asset: YELLOW_ASSET, amount: '1000000000' }],
        expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
        scope: 'app' as const,
      };

      this.ws.on('open', async () => {
        console.log('[Yellow] WS connected');
        const msg = await createAuthRequestMessage({
          address: this.account.address,
          application: 'app',
          ...authParams,
        });
        this.ws.send(msg);
      });

      this.ws.on('error', (e) => {
        console.error('[Yellow] WS error:', e.message);
        reject(e);
      });

      this.ws.on('close', () => {
        console.log('[Yellow] WS closed');
        this.authenticated = false;
        this.channelReady = false;
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
      });

      this.ws.on('message', async (raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); }
        catch { return; }

        if (msg.error) {
          console.error('[Yellow] RPC error:', msg.error);
          return;
        }
        if (!msg.res) return;

        const [, method, d] = msg.res;

        if (method === 'auth_challenge') {
          if (this.authenticated) return;
          const walletClient = createWalletClient({
            chain: sepolia,
            transport: http(),
            account: this.account,
          });
          const verify = await createAuthVerifyMessageFromChallenge(
            createEIP712AuthMessageSigner(walletClient, authParams, { name: 'app' }),
            d.challenge_message
          );
          this.ws.send(verify);
        }

        if (method === 'auth_verify') {
          this.authenticated = true;
          console.log('[Yellow] Authenticated');
          this.startPingLoop();
          const ledger = await createGetLedgerBalancesMessage(
            this.sessionSigner, this.account.address, Date.now()
          );
          this.ws.send(ledger);
        }

        if (method === 'channels') {
          const open = d.channels?.find((c: any) => c.status === 'open');
          if (open) {
            this.channelId = open.channel_id;
            this.channelReady = true;
            console.log('[Yellow] Existing channel:', this.channelId);
            this.flushResolves();
            resolve();
            return;
          }
          const create = await createCreateChannelMessage(this.sessionSigner, {
            chain_id: sepolia.id,
            token: config.yellowToken,
          });
          this.ws.send(create);
        }

        if (method === 'create_channel') {
          this.channelId = d.channel_id;
          console.log('[Yellow] Channel created:', this.channelId);
          await this.nitro.createChannel({
            channel: d.channel,
            unsignedInitialState: mapState(d.state),
            serverSignature: d.server_signature,
          });
        }

        if (method === 'cu') {
          if (d.channel_id === this.channelId && d.status === 'open') {
            if (!this.channelReady) {
              this.channelReady = true;
              console.log('[Yellow] Channel confirmed open');
              const resize = await createResizeChannelMessage(this.sessionSigner, {
                channel_id: this.channelId as `0x${string}`,
                allocate_amount: 100n,
                funds_destination: this.account.address,
              });
              this.ws.send(resize);
            }
          }
        }

        if (method === 'resize_channel') {
          console.log('[Yellow] Channel resized');
          this.flushResolves();
          resolve();
        }

        if (method === 'get_ledger_balances') {
          // Balance query handled via callback
        }
      });
    });
  }

  private startPingLoop() {
    if (this.pingInterval) return;
    this.pingInterval = setInterval(async () => {
      if (this.ws.readyState === WebSocket.OPEN) {
        const msg = await createPingMessage(this.sessionSigner);
        this.ws.send(msg);
      }
    }, 30_000);
  }

  private flushResolves() {
    for (const r of this.pendingResolves) r();
    this.pendingResolves = [];
  }

  async transferTo(destination: string, amount: number): Promise<void> {
    if (!this.channelReady) {
      throw new Error('Yellow channel not ready');
    }
    const msg = await createTransferMessage(this.sessionSigner, {
      destination: destination as `0x${string}`,
      allocations: [{ asset: YELLOW_ASSET, amount: amount.toString() }],
    });
    this.ws.send(msg);
  }

  async getBalance(): Promise<number> {
    return new Promise((resolve) => {
      const handler = (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.res && msg.res[1] === 'get_ledger_balances') {
            this.ws.off('message', handler);
            const balances = msg.res[2]?.balances ?? [];
            const usd = balances.find((b: any) => b.asset === YELLOW_ASSET);
            resolve(usd ? parseFloat(usd.amount) : 0);
          }
        } catch { /* skip */ }
      };
      this.ws.on('message', handler);

      createGetLedgerBalancesMessage(
        this.sessionSigner, this.account.address, Date.now()
      ).then(msg => this.ws.send(msg));
    });
  }

  isReady(): boolean {
    return this.authenticated && this.channelReady;
  }
}
