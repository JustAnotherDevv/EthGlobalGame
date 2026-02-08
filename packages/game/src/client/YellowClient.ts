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
} from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
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

export interface YellowClientConfig {
  privateKey: `0x${string}`;
  wsUrl?: string;
  token?: `0x${string}`;
  custody?: `0x${string}`;
  adjudicator?: `0x${string}`;
  rpcUrl?: string;
}

export class YellowClient {
  private ws!: WebSocket;
  private account;
  private sessionSigner;
  private sessionAddr: string;
  private nitro: NitroliteClient;
  private channelReady = false;
  private authenticated = false;
  private config: Required<YellowClientConfig>;
  readonly address: string;

  constructor(cfg: YellowClientConfig) {
    this.config = {
      privateKey: cfg.privateKey,
      wsUrl: cfg.wsUrl ?? 'wss://clearnet-sandbox.yellow.com/ws',
      token: cfg.token ?? '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
      custody: cfg.custody ?? '0x019B65A265EB3363822f2752141b3dF16131b262',
      adjudicator: cfg.adjudicator ?? '0x7c7ccbc98469190849BCC6c926307794fDfB11F2',
      rpcUrl: cfg.rpcUrl ?? 'https://1rpc.io/sepolia',
    };

    this.account = privateKeyToAccount(this.config.privateKey);
    this.address = this.account.address;

    const sessionPK = generatePrivateKey();
    this.sessionSigner = createECDSAMessageSigner(sessionPK);
    this.sessionAddr = privateKeyToAccount(sessionPK).address;

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(this.config.rpcUrl),
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
        custody: this.config.custody,
        adjudicator: this.config.adjudicator,
      },
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.wsUrl);

      const authParams = {
        session_key: this.sessionAddr as `0x${string}`,
        allowances: [{ asset: YELLOW_ASSET, amount: '1000000000' }],
        expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
        scope: 'app' as const,
      };

      this.ws.on('open', async () => {
        const msg = await createAuthRequestMessage({
          address: this.account.address,
          application: 'app',
          ...authParams,
        });
        this.ws.send(msg);
      });

      this.ws.on('error', (e) => reject(e));

      this.ws.on('message', async (raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); }
        catch { return; }

        if (msg.error || !msg.res) return;
        const [, method, d] = msg.res;

        if (method === 'auth_challenge' && !this.authenticated) {
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
          const ledger = await createGetLedgerBalancesMessage(
            this.sessionSigner, this.account.address, Date.now()
          );
          this.ws.send(ledger);
        }

        if (method === 'channels') {
          const open = d.channels?.find((c: any) => c.status === 'open');
          if (open) {
            this.channelReady = true;
            resolve();
            return;
          }
          const create = await createCreateChannelMessage(this.sessionSigner, {
            chain_id: sepolia.id,
            token: this.config.token,
          });
          this.ws.send(create);
        }

        if (method === 'create_channel') {
          await this.nitro.createChannel({
            channel: d.channel,
            unsignedInitialState: mapState(d.state),
            serverSignature: d.server_signature,
          });
        }

        if (method === 'cu' && d.status === 'open') {
          if (!this.channelReady) {
            this.channelReady = true;
            const resize = await createResizeChannelMessage(this.sessionSigner, {
              channel_id: d.channel_id,
              allocate_amount: 50n,
              funds_destination: this.account.address,
            });
            this.ws.send(resize);
          }
        }

        if (method === 'resize_channel') {
          resolve();
        }
      });
    });
  }

  async transferTo(destination: string, amount: number): Promise<void> {
    const msg = await createTransferMessage(this.sessionSigner, {
      destination: destination as `0x${string}`,
      allocations: [{ asset: YELLOW_ASSET, amount: amount.toString() }],
    });
    this.ws.send(msg);
  }

  isReady() { return this.authenticated && this.channelReady; }
}
