import { createContext, useContext, useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { useWalletClient, usePublicClient, useAccount } from 'wagmi';
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
import { sepolia } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const YELLOW_ASSET = 'ytest.usd';
const BROKER_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const ADDRESSES = {
  custody: '0x019B65A265EB3363822f2752141b3dF16131b262' as `0x${string}`,
  adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2' as `0x${string}`,
  token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb' as `0x${string}`,
};

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

interface YellowContextType {
  connect: () => Promise<void>;
  transferTo: (destination: string, amount: number) => Promise<void>;
  isReady: boolean;
  isConnecting: boolean;
  balance: number;
  refreshBalance: () => Promise<void>;
  requestFaucet: () => Promise<void>;
}

const YellowContext = createContext<YellowContextType>({
  connect: async () => {},
  transferTo: async () => {},
  isReady: false,
  isConnecting: false,
  balance: 0,
  refreshBalance: async () => {},
  requestFaucet: async () => {},
});

export const useYellow = () => useContext(YellowContext);

export const YellowProvider = ({ children }: { children: ReactNode }) => {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { address } = useAccount();

  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [balance, setBalance] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionSignerRef = useRef<ReturnType<typeof createECDSAMessageSigner> | null>(null);
  const nitroRef = useRef<NitroliteClient | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const connect = async () => {
    if (!walletClient || !publicClient || !address) return;
    if (readyRef.current || isConnecting) return;

    setIsConnecting(true);

    const sessionPK = generatePrivateKey();
    const sessionSigner = createECDSAMessageSigner(sessionPK);
    const sessionAddr = privateKeyToAccount(sessionPK).address;
    sessionSignerRef.current = sessionSigner;

    const nitro = new NitroliteClient({
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      stateSigner: new WalletStateSigner(walletClient as any),
      chainId: sepolia.id,
      challengeDuration: 3600n,
      addresses: {
        custody: ADDRESSES.custody,
        adjudicator: ADDRESSES.adjudicator,
      },
    });
    nitroRef.current = nitro;

    const authParams = {
      session_key: sessionAddr as `0x${string}`,
      allowances: [{ asset: YELLOW_ASSET, amount: '1000000000' }],
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
      scope: 'app' as const,
    };

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(BROKER_URL);
      wsRef.current = ws;
      let authenticated = false;
      let channelReady = false;

      ws.onopen = async () => {
        const msg = await createAuthRequestMessage({
          address,
          application: 'app',
          ...authParams,
        });
        ws.send(msg);
      };

      ws.onerror = () => {
        setIsConnecting(false);
        reject(new Error('WebSocket connection failed'));
      };

      ws.onmessage = async (event) => {
        let msg: any;
        try { msg = JSON.parse(event.data); }
        catch { return; }

        if (msg.error || !msg.res) return;
        const [, method, d] = msg.res;

        if (method === 'auth_challenge' && !authenticated) {
          const signer = createEIP712AuthMessageSigner(
            walletClient as any,
            authParams,
            { name: 'app' }
          );
          const verify = await createAuthVerifyMessageFromChallenge(signer, d.challenge_message);
          ws.send(verify);
        }

        if (method === 'auth_verify') {
          authenticated = true;
          const ledger = await createGetLedgerBalancesMessage(
            sessionSigner, address, Date.now()
          );
          ws.send(ledger);
        }

        if (method === 'channels') {
          const open = d.channels?.find((c: any) => c.status === 'open');
          if (open) {
            channelReady = true;
            readyRef.current = true;
            setIsReady(true);
            setIsConnecting(false);
            resolve();
            return;
          }
          const create = await createCreateChannelMessage(sessionSigner, {
            chain_id: sepolia.id,
            token: ADDRESSES.token,
          });
          ws.send(create);
        }

        if (method === 'create_channel') {
          await nitro.createChannel({
            channel: d.channel,
            unsignedInitialState: mapState(d.state),
            serverSignature: d.server_signature,
          });
        }

        if (method === 'cu' && d.status === 'open') {
          if (!channelReady) {
            channelReady = true;
            const resize = await createResizeChannelMessage(sessionSigner, {
              channel_id: d.channel_id,
              allocate_amount: 50n,
              funds_destination: address,
            });
            ws.send(resize);
          }
        }

        if (method === 'resize_channel') {
          readyRef.current = true;
          setIsReady(true);
          setIsConnecting(false);
          resolve();
        }

        if (method === 'ledger_balances' || method === 'get_ledger_balances' || method === 'bu') {
          const list = d.balances ?? d.balance_updates ?? (Array.isArray(d) ? d : []);
          const usd = list.find((b: any) => b.asset === YELLOW_ASSET);
          if (usd) setBalance(Number(usd.amount) / 1e8);
        }
      };
    });
  };

  const transferTo = async (destination: string, amount: number) => {
    if (!sessionSignerRef.current || !wsRef.current) {
      throw new Error('Yellow channel not ready');
    }
    const msg = await createTransferMessage(sessionSignerRef.current, {
      destination: destination as `0x${string}`,
      allocations: [{ asset: YELLOW_ASSET, amount: amount.toString() }],
    });
    wsRef.current.send(msg);
  };

  const refreshBalance = async () => {
    if (!sessionSignerRef.current || !wsRef.current || !address) return;
    const msg = await createGetLedgerBalancesMessage(
      sessionSignerRef.current, address, Date.now()
    );
    wsRef.current.send(msg);
  };

  const requestFaucet = async () => {
    if (!address) return;
    const res = await fetch('https://clearnet-sandbox.yellow.com/faucet/requestTokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress: address }),
    });
    if (!res.ok) throw new Error('Faucet request failed');
    setTimeout(() => refreshBalance(), 2000);
  };

  const value = useMemo(() => ({
    connect,
    transferTo,
    isReady,
    isConnecting,
    balance,
    refreshBalance,
    requestFaucet,
  }), [connect, transferTo, isReady, isConnecting, balance, refreshBalance, requestFaucet]);

  return (
    <YellowContext.Provider value={value}>
      {children}
    </YellowContext.Provider>
  );
};
