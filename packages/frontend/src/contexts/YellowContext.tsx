import { createContext, useContext, useState, useEffect, type ReactNode, useRef } from 'react';
import { useWalletClient, usePublicClient, useAccount } from 'wagmi';
import { 
  NitroliteClient, 
  WalletStateSigner,
  createGetConfigMessage,
  createAuthRequestMessage,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageFromChallenge,
  createCreateChannelMessage,
  createECDSAMessageSigner,
  createResizeChannelMessage
} from '@erc7824/nitrolite';
import { sepolia } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Hardcoded addresses from Yellow Network Quickstart
const YELLOW_ADDRESSES = {
  custody: '0x019B65A265EB3363822f2752141b3dF16131b262' as `0x${string}`,
  adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2' as `0x${string}`,
};

const YELLOW_BROKER_URL = 'wss://clearnet-sandbox.yellow.com/ws';

interface YellowContextType {
  client: NitroliteClient | null;
  isConnected: boolean;
  initialize: () => Promise<void>;
  balance: string;
  refreshBalance: () => Promise<void>;
  
  // Broker / Session
  brokerConnected: boolean;
  supportedNetworks: any[];
  sessionAddress: string | null;
  activeChannel: any; // Add strong typing later
  setupSession: () => Promise<void>;
  openChannel: () => Promise<void>;
  fundChannel: (amount: string) => Promise<void>;
  requestFaucet: () => Promise<void>;
  listNetworks: () => Promise<void>;
}

const YellowContext = createContext<YellowContextType>({
  client: null,
  isConnected: false,
  initialize: async () => {},
  balance: '0',
  refreshBalance: async () => {},
  
  brokerConnected: false,
  supportedNetworks: [],
  sessionAddress: null,
  activeChannel: null,
  setupSession: async () => {},
  openChannel: async () => {},
  fundChannel: async () => {},
  requestFaucet: async () => {},
  listNetworks: async () => {},
});

export const useYellow = () => useContext(YellowContext);

export const YellowProvider = ({ children }: { children: ReactNode }) => {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { address, isConnected: isWalletConnected } = useAccount();
  const [client, setClient] = useState<NitroliteClient | null>(null);
  const [balance, setBalance] = useState('0');
  
  // -- Broker State --
  const ws = useRef<WebSocket | null>(null);
  const [brokerConnected, setBrokerConnected] = useState(false);
  const [supportedNetworks, setSupportedNetworks] = useState<any[]>([]);
  const [supportedAssets, setSupportedAssets] = useState<any[]>([]);
  
  // Use refs for values accessed in callbacks to avoid stale closures
  const sessionKeyRef = useRef<`0x${string}` | null>(null);
  const isAuthenticatedRef = useRef(false);
  const clientRef = useRef<NitroliteClient | null>(null);

  // Sync refs with state for UI if needed (keeping state for UI re-renders)
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  
  // State for active channel
  const [activeChannel, setActiveChannel] = useState<any>(null);

  useEffect(() => {
    if (!isWalletConnected || !walletClient) {
      setClient(null);
      clientRef.current = null;
      // Close WS on disconnect? 
      // ws.current?.close();
    }
  }, [isWalletConnected, walletClient]);

  // Establish WS connection once client is initialized or explicitly
  const connectBroker = () => {
    if (ws.current?.readyState === WebSocket.OPEN) return Promise.resolve();
    
    return new Promise<void>((resolve) => {
      console.log('Connecting to Yellow Broker:', YELLOW_BROKER_URL);
      const socket = new WebSocket(YELLOW_BROKER_URL);
      
      socket.onopen = () => {
        console.log('✓ Broker Connected');
        setBrokerConnected(true);
        resolve();
      };
      
      socket.onclose = () => {
        console.log('Broker Disconnected');
        setBrokerConnected(false);
      };

      socket.onerror = (err) => {
        console.error('Broker Error:', err);
      };

      socket.onmessage = handleBrokerMessage;
      
      ws.current = socket;

      // Heartbeat
      const pingInterval = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
              console.log('Ping Broker');
              socket.send(JSON.stringify({ type: 'ping' })); // Or any keep-alive msg
          }
      }, 30000); // 30s

      socket.onclose = () => {
         console.log('Broker Disconnected');
         setBrokerConnected(false);
         clearInterval(pingInterval);
      };
    });
  };

  const handleBrokerMessage = async (event: MessageEvent) => {
    try {
      const response = JSON.parse(event.data.toString());
      console.log('Broker Message:', response);

      if (response.res && response.res[1] === 'auth_challenge') {
        const challenge = response.res[2].challenge_message;
        
        // Need to sign this challenge using EIP-712 with main wallet
        if (!walletClient || !address) return;

        // Reconstruct authParams we sent (we need to store them or recreate)
        const currentSessionKey = sessionKeyRef.current;
        if (!currentSessionKey) {
            console.error('Session Key missing during auth challenge');
            return;
        }

        const sessionAccount = privateKeyToAccount(currentSessionKey); 
        
        const authParams = {
          session_key: sessionAccount.address,
          allowances: [{ asset: 'ytest.usd', amount: '1000000000' }],
          expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
          scope: 'test.app',
        };

        const signer = createEIP712AuthMessageSigner(
          walletClient as any, 
          authParams, 
          { name: 'Test app' }
        );

        const verifyMsg = await createAuthVerifyMessageFromChallenge(signer, challenge);
        ws.current?.send(verifyMsg);
      }

      // Debug logging for message structure
      if (response.res && Array.isArray(response.res) && response.res.length > 1) {
          console.log('Broker Message Type:', response.res[1]);
      }

      if (response.res && response.res[1] === 'auth_verify') {
        console.log('✓ Session Authenticated!');
        isAuthenticatedRef.current = true;
      }
      
      if (response.res && response.res[1] === 'create_channel') {
        const { channel_id, channel, state, server_signature } = response.res[2];
        console.log('Channel Created Proposal Received:', channel_id);
        console.log('State:', state);
        
        const client = clientRef.current;
        if (!client) {
            console.error('Client not initialized in callback, cannot create channel');
            return;
        }

        // Transform state object to match UnsignedState interface for the SDK
        const unsignedInitialState = {
            intent: state.intent,
            version: BigInt(state.version),
            data: state.state_data || state.data || '0x', 
            allocations: state.allocations.map((a: any) => ({
                destination: a.destination,
                token: a.token,
                amount: BigInt(a.amount),
            })),
        };

        console.log('Submitting channel creation to blockchain...');
        try {
            const createResult = await client.createChannel({
                channel,
                unsignedInitialState,
                serverSignature: server_signature,
            });
            
            console.log('Channel on-chain creation submitted:', createResult);
            
            // Calculate initial off-chain balance for user
            let userBalance = '0.00';
            if (state.allocations && address) {
                const userAlloc = state.allocations.find((a: any) => a.destination.toLowerCase() === address.toLowerCase());
                if (userAlloc) {
                    userBalance = (Number(userAlloc.amount) / 1e18).toFixed(4);
                }
            }

            // Store active channel details
            setActiveChannel({
                id: channel_id,
                status: 'Open', 
                balance: userBalance, 
                channel: channel,
                state: state
            });
            
        } catch (err) {
            console.error('Failed to create channel on-chain:', err);
        }
      }

      // Handle resize (Funding)
      if (response.res && response.res[1] === 'resize_channel') {
          console.log('Resize Proposal Received');
          const payload = response.res[2];
          console.log('Resize Payload:', payload);
          
          const channel_id = payload.channel_id || payload.id;
          const resize_state = payload.resize_state || payload.state; // Fallback to 'state'
          const proof_states = payload.proof_states || [];

          if (!resize_state) {
              console.error('Resize State missing in payload', payload);
              return;
          }
          
          const client = clientRef.current;
          if (!client) return;
          
          // Transform resize_state to match SignedState interface
          // SDK requires channelId and serverSignature in the state object for resizeChannel
          const signedResizeState = {
              channelId: channel_id,
              serverSignature: resize_state.server_signature || resize_state.signature || payload.server_signature || '0x', // Check payload too
              intent: resize_state.intent,
              version: BigInt(resize_state.version),
              data: resize_state.state_data || resize_state.data || '0x',
              allocations: resize_state.allocations.map((a: any) => ({
                  destination: a.destination,
                  token: a.token,
                  amount: BigInt(a.amount),
              })),
          };

          console.log('Submitting transformed resize to blockchain...', signedResizeState);
          try {
             // Docs says: client.resizeChannel({ resizeState, proofStates })
             await client.resizeChannel({
                 resizeState: signedResizeState,
                 proofStates: proof_states
             });
             console.log('Channel Resized/Funded Successfully!');
             
             // Optimistic update
             if (activeChannel) {
                 // Calculate new balance for user
                 let newBalance = activeChannel.balance;
                 const userAlloc = signedResizeState.allocations.find((a: any) => a.destination.toLowerCase() === address?.toLowerCase());
                 if (userAlloc) {
                     newBalance = (Number(userAlloc.amount) / 1e18).toFixed(4);
                 }
                 setActiveChannel({
                     ...activeChannel,
                     balance: newBalance,
                     state: {
                         ...activeChannel.state,
                         ...resize_state // Merge new state
                     }
                 });
             }
             
          } catch (err) {
              console.error('Failed to resize channel:', err);
          }
      }

      // Handle Errors
      if (response.res && response.res[1] === 'error') {
           console.error('BROKER ERROR DETAILS:', response.res[2]);
      }

      // Handle 'cu' (Channel Update?)
      if (response.res && response.res[1] === 'cu') {
           console.log('Channel Update (cu) Received:', response.res[2]);
           // This likely contains the new state after resize/update
           // We can verify if balance increased here
      }

      // Handle 'bu' (Balance Update?)
      if (response.res && response.res[1] === 'bu') {
           console.log('Unified Balance Update (bu) Received:', response.res[2]);
      }

      // Handle listing existing channels (Restoration)
      if (response.res && response.res[1] === 'channels') {
          const channelsData = response.res[2];
          console.log('Existing Channels Data:', channelsData);

          let channelsList: any[] = [];
          if (Array.isArray(channelsData)) {
              channelsList = channelsData;
          } else if (channelsData && Array.isArray(channelsData.channels)) {
              channelsList = channelsData.channels;
          }

          if (channelsList.length > 0) {
              // Find first open channel
              const openChan = channelsList.find((c: any) => c.status === 'open' || c.status === 'active'); 
              
              if (openChan) {
                  const chanId = openChan.channel_id || openChan.id;
                  console.log('Found ID of existing active channel:', chanId);
                  
                  let restoredBalance = 'Unknown';
                  
                  // Use 'amount' from summary if available (likely user balance or total capacity)
                  // The summary doesn't have full state/allocations.
                  if (openChan.amount) {
                      restoredBalance = (Number(openChan.amount) / 1e18).toFixed(4);
                  }
                  
                  // Check if state is present (it wasn't in the log, but keeping check)
                  if (openChan.state && openChan.state.allocations && address) {
                       const userAlloc = openChan.state.allocations.find((a: any) => a.destination.toLowerCase() === address.toLowerCase());
                       if (userAlloc) {
                           restoredBalance = (Number(userAlloc.amount) / 1e18).toFixed(4);
                       }
                  } else {
                      console.log('Fetching full details not supported yet for channel:', chanId);
                  }

                  setActiveChannel({
                      id: chanId,
                      status: openChan.status || 'Open',
                      balance: restoredBalance,
                      channel: openChan.channel,
                      state: openChan.state
                  });
              }
          }
      }

      // Handle full channel details response
      if (response.res && response.res[1] === 'channel') {
          const chanData = response.res[2];
          console.log('Full Channel Details:', chanData);
          
          if (chanData && chanData.id && chanData.state) {
               let restoredBalance = '0.00';
               const state = chanData.state;
               if (state.allocations && address) {
                   const userAlloc = state.allocations.find((a: any) => a.destination.toLowerCase() === address.toLowerCase());
                   if (userAlloc) {
                       restoredBalance = (Number(userAlloc.amount) / 1e18).toFixed(4);
                   }
               }
               
               // Update active channel with full details
               setActiveChannel({
                  id: chanData.id,
                  status: 'Open',
                  balance: restoredBalance,
                  channel: chanData.channel,
                  state: state
               });
               console.log('Updated Active Channel Balance:', restoredBalance);
          }
      }

    } catch (e) {
      console.error('Error handling broker message', e);
    }
  };

  const initialize = async () => {
    if (!walletClient || !publicClient || !address) return;

    try {
      console.log('Initializing Yellow Network...');
      
      const nitroliteClient = new NitroliteClient({
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        stateSigner: new WalletStateSigner(walletClient as any),
        addresses: YELLOW_ADDRESSES,
        chainId: sepolia.id,
        challengeDuration: 3600n,
      });
      
      setClient(nitroliteClient);
      clientRef.current = nitroliteClient;
      await connectBroker();
      await listNetworks(); // Fetch config immediately
      await refreshBalance();
      
    } catch (error) {
      console.error('Failed to initialize Yellow Network:', error);
    }
  };

  const listNetworks = async () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        await connectBroker();
    }
    
    console.log('Fetching Yellow Network Config...');
    const tmpKey = generatePrivateKey();
    const signer = createECDSAMessageSigner(tmpKey);
    
    const msg = await createGetConfigMessage(signer);
    
    const onMsg = (event: MessageEvent) => {
        try {
            const response = JSON.parse(event.data.toString());
            // Check if this is a config response (simple check for networks/assets in payload)
            if (response.res && response.res[2] && (response.res[2].networks || response.res[2].assets)) {
                 const data = response.res[2];
                 if (data.networks) {
                    console.log('Networks Config Loaded:', data.networks.length, 'networks');
                    setSupportedNetworks(data.networks);
                 }
                 if (data.assets) {
                     console.log('Assets Config Loaded:', data.assets);
                     setSupportedAssets(data.assets);
                 }
            }
        } catch (e) {
            console.error('Error parsing config response', e);
        }
    };
    ws.current?.addEventListener('message', onMsg);
    ws.current?.send(msg);
  };

  const setupSession = async () => {
    if (!ws.current || !walletClient || !address) return;
    
    // Generate Session Key
    const privKey = generatePrivateKey();
    
    // Update refs
    sessionKeyRef.current = privKey;
    
    const account = privateKeyToAccount(privKey);
    
    // Update state for UI
    setSessionAddress(account.address);
    
    console.log('Generated Session Key:', account.address);

    const authParams = {
      session_key: account.address,
      allowances: [{ asset: 'ytest.usd', amount: '1000000000' }],
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
      scope: 'test.app',
    };

    const authRequestMsg = await createAuthRequestMessage({
      address: address,
      application: 'Test app',
      ...authParams
    });

    ws.current.send(authRequestMsg);
  };

  const openChannel = async () => {
    if (!isAuthenticatedRef.current || !sessionKeyRef.current) {
        console.error('Must authenticate session first!');
        return;
    }
    
    // Find supported asset for current chain
    let token = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'; // Default Fallback
    
    // Attempt dynamic lookup
    if (supportedAssets.length > 0) {
        const asset = supportedAssets.find((a: any) => a.chain_id === 11155111);
        if (asset && asset.token) {
            console.log('Using dynamic token from config:', asset.token);
            token = asset.token;
        } else {
            console.warn('No asset found for Sepolia in config, using hardcoded fallback.');
        }
    } else {
        console.warn('Config assets not loaded yet, using hardcoded fallback.');
    }

    const sessionSigner = createECDSAMessageSigner(sessionKeyRef.current);
    
    const createChannelMsg = await createCreateChannelMessage(
        sessionSigner, 
        { 
            chain_id: 11155111, 
            token: token as `0x${string}`,
        }
    );
    
    console.log(`Sending create_channel request for token ${token}...`);
    ws.current?.send(createChannelMsg);
  };



  const fundChannel = async (amount: string) => {
      if (!sessionKeyRef.current || !activeChannel) return;
      console.log(`Funding Channel ${activeChannel.id} with ${amount}...`);
      
      const signer = createECDSAMessageSigner(sessionKeyRef.current);
      
      try {
          // Convert amount to BigInt elements (assuming 18 decimals input string)
          const amountBI = BigInt(Number(amount) * 1e18);
          
          const resizeMsg = await createResizeChannelMessage(
              signer,
              {
                  channel_id: activeChannel.id,
                  allocate_amount: amountBI,
                  funds_destination: address as `0x${string}`, // User's address
              }
          );
          ws.current?.send(resizeMsg);
      } catch (err) {
          console.error('Error creating resize message:', err);
      }
  };

  const requestFaucet = async () => {
      if (!address) return;
      console.log('Requesting Faucet Funds for:', address);
      try {
          const res = await fetch('https://clearnet-sandbox.yellow.com/faucet/requestTokens', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userAddress: address })
          });
          
          if (res.ok) {
              console.log('Faucet Request Successful');
              alert('Faucet Funds Requested! Wait a moment then try to allocate.');
          } else {
              console.error('Faucet Request Failed:', res.statusText);
          }
      } catch (err) {
          console.error('Faucet Error:', err);
      }
  };

  const refreshBalance = async () => {
    if (!walletClient || !address || !publicClient) return;
    try {
      // 1. Fetch Native ETH Balance
      const ethBalance = await publicClient.getBalance({ address });
      const ethFormatted = (Number(ethBalance) / 1e18).toFixed(4);
      
      // 2. Fetch Active Token Balance
      let tokenBalance = '0.00';
      let tokenAddr = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'; // Default
      const asset = supportedAssets.find((a: any) => a.chain_id === 11155111);
      if (asset && asset.token) {
          tokenAddr = asset.token;
      }

      try {
          console.log('Fetching token balance for:', tokenAddr);
          const erc20Balance = await publicClient.readContract({
            address: tokenAddr as `0x${string}`,
            abi: [{
                name: 'balanceOf',
                type: 'function',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ name: 'balance', type: 'uint256' }],
                stateMutability: 'view'
            }],
            functionName: 'balanceOf',
            args: [address]
          }) as bigint;
          
          console.log('Raw Token Balance:', erc20Balance);
          tokenBalance = (Number(erc20Balance) / 1e18).toFixed(2);
      } catch (err) {
          console.warn('Failed to fetch token balance:', err);
      }

      setBalance(`${ethFormatted} ETH | ${tokenBalance} TEST`);
      
    } catch (e) {
      console.error('Error fetching balance', e);
    }
  };

  return (
    <YellowContext.Provider value={{
      client,
      isConnected: !!client,
      initialize,
      balance,
      refreshBalance,
      
      brokerConnected,
      supportedNetworks,
      sessionAddress,
      activeChannel, // Added
      setupSession,
      openChannel,
      fundChannel,
      requestFaucet,
      listNetworks
    }}>
      {children}
    </YellowContext.Provider>
  );
};
