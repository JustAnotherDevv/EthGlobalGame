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
  createResizeChannelMessage,
  createGetLedgerBalancesMessage,
  createGetChannelsMessage,
  createCloseChannelMessage
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
  unifiedBalance: string;
  refreshBalance: () => Promise<void>;

  // Broker / Session
  brokerConnected: boolean;
  supportedNetworks: any[];
  sessionAddress: string | null;
  activeChannel: any; // Add strong typing later
  allChannels: any[]; // All open channels
  setupSession: () => Promise<void>;
  openChannel: () => Promise<void>;
  fundChannel: (amount: string, channelId?: string) => Promise<void>;
  closeChannel: (channelId: string) => Promise<void>;
  withdrawFromUnified: (amount: string) => Promise<void>;
  requestFaucet: () => Promise<void>;
  listNetworks: () => Promise<void>;
  fetchAllChannels: () => Promise<void>;
}

const YellowContext = createContext<YellowContextType>({
  client: null,
  isConnected: false,
  initialize: async () => {},
  balance: '0',
  unifiedBalance: '0',
  refreshBalance: async () => {},

  brokerConnected: false,
  supportedNetworks: [],
  sessionAddress: null,
  activeChannel: null,
  allChannels: [],
  setupSession: async () => {},
  openChannel: async () => {},
  fundChannel: async () => {},
  closeChannel: async () => {},
  withdrawFromUnified: async () => {},
  requestFaucet: async () => {},
  listNetworks: async () => {},
  fetchAllChannels: async () => {},
});

export const useYellow = () => useContext(YellowContext);

export const YellowProvider = ({ children }: { children: ReactNode }) => {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { address, isConnected: isWalletConnected } = useAccount();
  const [client, setClient] = useState<NitroliteClient | null>(null);
  const [balance, setBalance] = useState('0');
  const [unifiedBalance, setUnifiedBalance] = useState('0');

  // -- Broker State --
  const ws = useRef<WebSocket | null>(null);
  const [brokerConnected, setBrokerConnected] = useState(false);
  const [supportedNetworks, setSupportedNetworks] = useState<any[]>([]);
  const [supportedAssets, setSupportedAssets] = useState<any[]>([]);
  
  // Use refs for values accessed in callbacks to avoid stale closures
  const sessionKeyRef = useRef<`0x${string}` | null>(null);
  const authParamsRef = useRef<any>(null); // Store auth params for challenge verification
  const isAuthenticatedRef = useRef(false);
  const clientRef = useRef<NitroliteClient | null>(null);

  // Sync refs with state for UI if needed (keeping state for UI re-renders)
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);

  // State for active channel
  const [activeChannel, setActiveChannel] = useState<any>(null);
  const activeChannelRef = useRef<any>(null); // Ref to avoid stale closure in callbacks

  // State for all channels
  const [allChannels, setAllChannels] = useState<any[]>([]);
  const allChannelsRef = useRef<any[]>([]); // Ref to avoid stale closure

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

      // Note: Yellow Network broker doesn't require ping/keepalive messages
      // The WebSocket connection stays alive automatically
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

        // Use the stored authParams that we sent in auth_request
        const authParams = authParamsRef.current;
        if (!authParams) {
            console.error('Auth params missing during auth challenge');
            return;
        }

        console.log('Signing challenge with authParams:', authParams);

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
        // Request initial unified balance and all channels after auth
        setTimeout(() => {
          requestUnifiedBalance();
          fetchAllChannels();
        }, 500);
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
            console.log('Initial State from createResult:', createResult.initialState);

            // Calculate initial off-chain balance for user
            let userBalance = '0.00';
            if (state.allocations && address) {
                const userAlloc = state.allocations.find((a: any) => a.destination.toLowerCase() === address.toLowerCase());
                if (userAlloc) {
                    // Yellow uses 8 decimals for ytest.usd allocations in state
                    userBalance = (Number(userAlloc.amount) / 1e8).toFixed(8);
                }
            }

            // The createChannel result includes the signed initial state
            // We should use that instead of the unsigned state from the broker
            const signedInitialState = createResult.initialState;

            // Store active channel details IMMEDIATELY so cu handler can find it
            const newChannel = {
                id: channel_id,
                status: 'Confirming', // Channel tx submitted, waiting for confirmation
                balance: userBalance,
                channel: channel,
                state: {
                    ...state,
                    server_signature: server_signature, // Store server signature for later use in proofs
                    // Include the signatures from the signed initial state returned by SDK
                    sigs: signedInitialState?.sigs || []
                },
                isReady: false, // Not ready for operations yet
                txConfirmed: false // Will be set to true after confirmation
            };
            setActiveChannel(newChannel);
            activeChannelRef.current = newChannel;

            // Add to allChannels array immediately
            const updatedAllChannels = [...allChannelsRef.current, newChannel];
            setAllChannels(updatedAllChannels);
            allChannelsRef.current = updatedAllChannels;

            console.log('⏳ Channel created. Waiting for transaction confirmation...');

            // Wait for transaction to be confirmed in background
            if (createResult.txHash && publicClient) {
                publicClient.waitForTransactionReceipt({
                    hash: createResult.txHash as `0x${string}`,
                    confirmations: 1
                }).then((receipt) => {
                    console.log('✅ Channel creation transaction confirmed!', receipt);
                    // Update channel to mark tx as confirmed
                    const current = activeChannelRef.current;
                    if (current && current.id === channel_id) {
                        // Re-evaluate isReady now that tx is confirmed
                        const isReady = current.status === 'open' && true;
                        const updated = {
                            ...current,
                            txConfirmed: true,
                            isReady: isReady
                        };
                        setActiveChannel(updated);
                        activeChannelRef.current = updated;

                        if (isReady) {
                            console.log('✅ Channel is now OPEN and ready for operations!');
                        } else {
                            console.log('⏳ Transaction confirmed. Waiting for broker to confirm status...');
                        }
                    }
                }).catch((err) => {
                    console.warn('Could not wait for transaction receipt:', err);
                });
            }

            // Poll channel status until it's confirmed (open)
            const pollChannelStatus = setInterval(async () => {
                if (!ws.current || !sessionKeyRef.current) {
                    clearInterval(pollChannelStatus);
                    return;
                }

                // Request channel list using proper signed message
                try {
                    const signer = createECDSAMessageSigner(sessionKeyRef.current);
                    const channelsMsg = await createGetChannelsMessage(signer);
                    ws.current.send(channelsMsg);
                } catch (err) {
                    console.error('Failed to poll channel status:', err);
                }
            }, 3000); // Poll every 3 seconds

            // Stop polling after 30 seconds
            setTimeout(() => {
                clearInterval(pollChannelStatus);
            }, 30000);

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
          let proof_states = payload.proof_states || [];

          if (!resize_state) {
              console.error('Resize State missing in payload', payload);
              return;
          }

          const client = clientRef.current;
          if (!client) return;

          // Build proof states array - we need the current on-chain state as proof
          const transformedProofStates: any[] = [];

          // Use ref to get current channel state (avoid stale closure)
          const currentChannel = activeChannelRef.current;

          // If we have the current channel state, add it as proof
          if (currentChannel && currentChannel.state) {
              console.log('Using current channel state as proof:', currentChannel.state);

              // Important: For the initial state (version 0), we don't need client signatures
              // The initial state was created by createChannel and only has server signature
              // For version 0, we should provide an empty sigs array or just server sig
              // Actually looking at the SDK, for proof states we shouldn't include sigs at all for version 0

              // Check if this is the initial state (version 0)
              const isInitialState = (currentChannel.state.version || 0) === 0;

              const proofState: any = {
                  intent: currentChannel.state.intent || 1,
                  version: BigInt(currentChannel.state.version || 0),
                  data: currentChannel.state.state_data || currentChannel.state.data || '0x',
                  allocations: (currentChannel.state.allocations || []).map((a: any) => ({
                      destination: a.destination,
                      token: a.token,
                      amount: BigInt(a.amount),
                  }))
              };

              // Use the sigs array from the SDK if available
              if (currentChannel.state.sigs && currentChannel.state.sigs.length > 0) {
                  proofState.sigs = currentChannel.state.sigs;
                  console.log('Using sigs from state:', currentChannel.state.sigs);
              } else {
                  console.warn('No sigs array found in state, this may cause issues');
              }

              console.log('Transformed proof state:', proofState);
              transformedProofStates.push(proofState);
          } else {
              console.error('❌ No active channel state available for proof!');
              console.log('Current channel:', currentChannel);
              console.warn('⚠️ Cannot complete resize without channel state. This likely means:');
              console.warn('1. Page was reloaded and channel state was lost');
              console.warn('2. An automatic resize was triggered by the broker');
              console.warn('Solution: Refresh the page to reset the channel state, or wait for the ongoing resize to timeout.');
              // Don't proceed with resize if we don't have the proof
              return;
          }

          // Also transform any proof_states from the broker
          if (proof_states && proof_states.length > 0) {
              console.log('Broker provided proof_states:', proof_states);
              proof_states.forEach((ps: any) => {
                  transformedProofStates.push({
                      channelId: channel_id,
                      serverSignature: ps.server_signature || ps.signature || '0x',
                      intent: ps.intent,
                      version: BigInt(ps.version),
                      data: ps.state_data || ps.data || '0x',
                      allocations: ps.allocations.map((a: any) => ({
                          destination: a.destination,
                          token: a.token,
                          amount: BigInt(a.amount),
                      })),
                  });
              });
          }

          // Transform resize_state to match SignedState interface
          const signedResizeState = {
              channelId: channel_id,
              serverSignature: resize_state.server_signature || resize_state.signature || payload.server_signature || '0x',
              intent: resize_state.intent,
              version: BigInt(resize_state.version),
              data: resize_state.state_data || resize_state.data || '0x',
              allocations: resize_state.allocations.map((a: any) => ({
                  destination: a.destination,
                  token: a.token,
                  amount: BigInt(a.amount),
              })),
          };

          console.log('Submitting resize to blockchain...');
          console.log('- Resize State:', signedResizeState);
          console.log('- Proof States:', transformedProofStates);

          try {
             await client.resizeChannel({
                 resizeState: signedResizeState,
                 proofStates: transformedProofStates
             });
             console.log('✅ Channel Resized/Funded Successfully!');

             // Update channel with new state and balance in both activeChannel and allChannels
             const current = activeChannelRef.current;
             if (current && current.id === channel_id) {
                 // Calculate new balance for user from the resize state
                 let newBalance = current.balance;
                 const userAlloc = signedResizeState.allocations.find((a: any) =>
                     a.destination.toLowerCase() === address?.toLowerCase()
                 );
                 if (userAlloc) {
                     // Yellow uses 8 decimals for ytest.usd
                     newBalance = (Number(userAlloc.amount) / 1e8).toFixed(8);
                 }

                 console.log('💰 Updated channel balance:', newBalance, 'TEST');

                 // Channel is ready after successful resize (transaction completed on-chain)
                 const updated = {
                     ...current,
                     balance: newBalance,
                     status: 'open',
                     txConfirmed: true,
                     isReady: true,
                     state: {
                         ...resize_state,
                         server_signature: resize_state.server_signature || payload.server_signature,
                         sigs: resize_state.sigs || []
                     }
                 };
                 setActiveChannel(updated);
                 activeChannelRef.current = updated;

                 // Also update in allChannels array
                 const updatedAllChannels = allChannelsRef.current.map((c: any) =>
                     c.id === channel_id ? updated : c
                 );
                 setAllChannels(updatedAllChannels);
                 allChannelsRef.current = updatedAllChannels;

                 // Request updated unified balance with delay to allow broker to process
                 // Try multiple times with increasing delays
                 setTimeout(() => requestUnifiedBalance(), 2000);
                 setTimeout(() => requestUnifiedBalance(), 4000);
             }
             
          } catch (err) {
              console.error('Failed to resize channel:', err);
          }
      }

      // Handle close_channel response
      if (response.res && response.res[1] === 'close_channel') {
          const closeData = response.res[2];
          console.log('✅ Channel close initiated:', closeData);

          // Refresh unified balance after a brief delay
          setTimeout(() => {
              requestUnifiedBalance();
              fetchAllChannels();
          }, 1000);
      }

      // Handle Errors
      if (response.res && response.res[1] === 'error') {
           console.error('BROKER ERROR DETAILS:', response.res[2]);
           const errorMsg = response.res[2];
           if (errorMsg && errorMsg.error) {
               if (errorMsg.error.includes('channel') && errorMsg.error.includes('not found')) {
                   console.warn('⚠️ Channel not synced yet with broker. Wait a few seconds and try again.');
               } else if (errorMsg.error.includes('resize already ongoing')) {
                   console.error('⚠️ Resize operation already in progress. The previous resize needs to be completed on-chain first.');
                   alert('A resize operation is already in progress for this channel. Please wait for it to complete or refresh the page to reset.');
               }
           }
      }

      // Handle 'cu' (Channel Update?)
      if (response.res && response.res[1] === 'cu') {
           console.log('Channel Update (cu) Received:', response.res[2]);
           const cuData = response.res[2];

           // Use ref to get current channel state
           const currentChannel = activeChannelRef.current;

           // Update active channel if this is our channel
           if (cuData && currentChannel && cuData.channel_id === currentChannel.id) {
               console.log('Updating active channel from cu message');

               // If state is provided, extract balance
               let updatedBalance = currentChannel.balance;
               if (cuData.state && cuData.state.allocations && address) {
                   const userAlloc = cuData.state.allocations.find((a: any) =>
                       a.destination.toLowerCase() === address.toLowerCase()
                   );
                   if (userAlloc) {
                       // Yellow uses 8 decimals for ytest.usd
                       updatedBalance = (Number(userAlloc.amount) / 1e8).toFixed(8);
                   }
               }

               const newStatus = cuData.status || currentChannel.status;
               // Channel is ready ONLY when tx is confirmed AND broker status is 'open'
               const isReady = newStatus === 'open' && currentChannel.txConfirmed;

               const updatedChannel = {
                   ...currentChannel,
                   status: newStatus,
                   balance: updatedBalance,
                   state: cuData.state || currentChannel.state,
                   isReady: isReady
               };

               setActiveChannel(updatedChannel);
               activeChannelRef.current = updatedChannel;

               // Also update in allChannels array
               const updatedAllChannels = allChannelsRef.current.map((c: any) =>
                   c.id === cuData.channel_id ? updatedChannel : c
               );
               setAllChannels(updatedAllChannels);
               allChannelsRef.current = updatedAllChannels;

               if (isReady && !currentChannel.isReady) {
                   console.log('✅ Channel is now OPEN and ready for operations!');
               }
           } else if (cuData && !currentChannel) {
               console.log('⚠️ Received cu for channel but no active channel tracked yet');
           }
      }

      // Handle 'bu' (Balance Update?), 'balances' (Balance Response), or 'ledger_balances'
      if (response.res && (response.res[1] === 'bu' || response.res[1] === 'balances' || response.res[1] === 'ledger_balances')) {
           console.log('Unified Balance Update Received:', response.res[1], response.res[2]);
           const balanceData = response.res[2];

           // Handle balance_updates format (from 'bu' messages)
           if (balanceData && balanceData.balance_updates) {
               console.log('Processing balance_updates:', balanceData.balance_updates);
               const testBalance = balanceData.balance_updates.find((b: any) => b.asset === 'ytest.usd');
               if (testBalance) {
                   console.log('Found ytest.usd balance:', testBalance);
                   // Yellow uses 8 decimals for ytest.usd (not 18)
                   const formattedBalance = (Number(testBalance.amount) / 1e8).toFixed(8);
                   console.log('🔄 Unified Balance Change:', unifiedBalance, '→', formattedBalance);
                   setUnifiedBalance(formattedBalance);
                   console.log('Unified Balance Updated:', formattedBalance);
               } else {
                   console.log('No ytest.usd balance found in balance_updates');
               }
           } else if (balanceData && balanceData.balances) {
               console.log('Processing balances:', balanceData.balances);
               // Find ytest.usd balance
               const testBalance = balanceData.balances.find((b: any) => b.asset === 'ytest.usd');
               if (testBalance) {
                   const formattedBalance = (Number(testBalance.amount) / 1e8).toFixed(8);
                   setUnifiedBalance(formattedBalance);
                   console.log('Unified Balance Updated:', formattedBalance);
               }
           } else if (Array.isArray(balanceData)) {
               console.log('Processing array balanceData:', balanceData);
               // Handle array format
               const testBalance = balanceData.find((b: any) => b.asset === 'ytest.usd');
               if (testBalance) {
                   const formattedBalance = (Number(testBalance.amount) / 1e8).toFixed(8);
                   setUnifiedBalance(formattedBalance);
                   console.log('Unified Balance Updated:', formattedBalance);
               }
           }
      }

      // Handle listing existing channels (Restoration)
      if (response.res && response.res[1] === 'channels') {
          const channelsData = response.res[2];
          console.log('Existing Channels Data:', channelsData);
          console.log('📊 Channel count in response:', Array.isArray(channelsData) ? channelsData.length : channelsData?.channels?.length || 0);

          let channelsList: any[] = [];
          if (Array.isArray(channelsData)) {
              channelsList = channelsData;
          } else if (channelsData && Array.isArray(channelsData.channels)) {
              channelsList = channelsData.channels;
          }

          if (channelsList.length > 0) {
              // Process all channels and calculate balances
              const processedChannels = channelsList
                  .filter((chan: any) => {
                      const chanStatus = chan.status || 'unknown';
                      // Filter out channels that are closing, resizing, or in transition states
                      return chanStatus === 'open' || chanStatus === 'active';
                  })
                  .map((chan: any) => {
                      const chanId = chan.channel_id || chan.id;
                      const chanStatus = chan.status || 'unknown';

                      let channelBalance = 'Unknown';

                      // Use 'amount' from summary if available
                      if (chan.amount) {
                          // Yellow uses 8 decimals for ytest.usd
                          channelBalance = (Number(chan.amount) / 1e8).toFixed(8);
                      }

                      // Check if state is present with allocations
                      if (chan.state && chan.state.allocations && address) {
                           const userAlloc = chan.state.allocations.find((a: any) =>
                               a.destination.toLowerCase() === address.toLowerCase()
                           );
                           if (userAlloc) {
                               // Yellow uses 8 decimals for ytest.usd
                               channelBalance = (Number(userAlloc.amount) / 1e8).toFixed(8);
                           }
                      }

                      const isReady = chanStatus === 'open';

                      return {
                          id: chanId,
                          status: chanStatus,
                          balance: channelBalance,
                          channel: chan.channel,
                          state: chan.state,
                          isReady: isReady
                      };
                  });

              // Update all channels state
              setAllChannels(processedChannels);
              allChannelsRef.current = processedChannels;

              console.log(`✅ Found ${processedChannels.length} channel(s)`);

              // Find first open channel and set as active
              const openChan = processedChannels.find((c: any) => c.status === 'open' || c.status === 'active');
              if (openChan) {
                  setActiveChannel(openChan);
                  activeChannelRef.current = openChan;
                  console.log('✅ Active channel set:', openChan.id);
              }
          } else {
              // No channels found
              setAllChannels([]);
              allChannelsRef.current = [];
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
                       // Yellow uses 8 decimals for ytest.usd
                       restoredBalance = (Number(userAlloc.amount) / 1e8).toFixed(8);
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

    // Store authParams for later use in challenge verification
    authParamsRef.current = authParams;
    console.log('Stored authParams:', authParams);

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



  const fundChannel = async (amount: string, channelId?: string) => {
      const targetChannelId = channelId || activeChannel?.id;

      if (!sessionKeyRef.current || !targetChannelId) {
          console.error('Cannot fund: session or channel missing');
          return;
      }

      // Find the channel in allChannels
      const targetChannel = allChannelsRef.current.find((c: any) => c.id === targetChannelId);

      if (!targetChannel) {
          console.error('Channel not found:', targetChannelId);
          return;
      }

      if (!targetChannel.isReady) {
          console.error('❌ Cannot allocate: Channel is not ready yet (status: ' + targetChannel.status + ')');
          alert('Channel is not ready yet. Please wait for on-chain confirmation.');
          return;
      }

      // If channel state is missing, fetch it from on-chain
      if (!targetChannel.state && clientRef.current) {
          console.log('⚠️ Channel state missing, fetching from on-chain...');
          try {
              const channelData = await clientRef.current.getChannelData(targetChannelId as `0x${string}`);
              console.log('📥 Fetched channel data from chain:', channelData);

              // Update the channel in allChannels with the state
              const updatedChannels = allChannelsRef.current.map((c: any) => {
                  if (c.id === targetChannelId) {
                      return {
                          ...c,
                          state: channelData.lastValidState,
                          channel: channelData.channel
                      };
                  }
                  return c;
              });

              setAllChannels(updatedChannels);
              allChannelsRef.current = updatedChannels;

              // Update activeChannel if it's the same
              if (activeChannel?.id === targetChannelId) {
                  const updated = updatedChannels.find((c: any) => c.id === targetChannelId);
                  setActiveChannel(updated);
                  activeChannelRef.current = updated;
              }

              // Now retry the funding with updated state
              console.log('🔄 Retrying allocation with fetched state...');
              // Give a brief moment for state to update
              setTimeout(() => fundChannel(amount, channelId), 500);
              return;
          } catch (err) {
              console.error('Failed to fetch channel data:', err);
              alert('Failed to fetch channel state. Please refresh the page.');
              return;
          }
      }

      console.log(`Funding Channel ${targetChannelId} with ${amount}...`);

      const signer = createECDSAMessageSigner(sessionKeyRef.current);

      try {
          // Convert amount to BigInt elements (Yellow uses 8 decimals for ytest.usd)
          const amountBI = BigInt(Math.floor(Number(amount) * 1e8));

          const resizeMsg = await createResizeChannelMessage(
              signer,
              {
                  channel_id: targetChannelId,
                  allocate_amount: amountBI, // This pulls from unified balance
                  funds_destination: address as `0x${string}`, // User's address
              }
          );
          ws.current?.send(resizeMsg);
          console.log('📤 Allocation request sent to broker');
      } catch (err) {
          console.error('Error creating resize message:', err);
      }
  };

  const closeChannel = async (channelId: string) => {
      if (!sessionKeyRef.current || !address) {
          console.error('Cannot close: session or address missing');
          return;
      }

      console.log(`🔒 Closing Channel ${channelId}...`);

      const signer = createECDSAMessageSigner(sessionKeyRef.current);

      try {
          const closeMsg = await createCloseChannelMessage(
              signer,
              channelId,
              address
          );
          ws.current?.send(closeMsg);
          console.log('📤 Close channel request sent to broker');
      } catch (err) {
          console.error('Error creating close message:', err);
      }
  };

  const withdrawFromUnified = async (amount: string) => {
      if (!clientRef.current || !address) {
          console.error('Cannot withdraw: client or address missing');
          return;
      }

      console.log(`💸 Withdrawing ${amount} TEST from unified balance to Sepolia...`);

      try {
          // Find the token address from supported assets
          let tokenAddr = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'; // Default fallback
          const asset = supportedAssets.find((a: any) => a.chain_id === 11155111);
          if (asset && asset.token) {
              tokenAddr = asset.token;
              console.log('Using token address from config:', tokenAddr);
          } else {
              console.warn('Using fallback token address');
          }

          // Convert amount to proper format (8 decimals for ytest.usd)
          const amountBI = BigInt(Math.floor(Number(amount) * 1e8));

          console.log('Initiating withdrawal transaction...');
          const withdrawalTx = await clientRef.current.withdrawal(
              tokenAddr as `0x${string}`,
              amountBI
          );

          console.log('✅ Withdrawal transaction submitted:', withdrawalTx);
          alert(`Withdrawal initiated! Transaction hash: ${withdrawalTx}`);

          // Wait for transaction confirmation
          if (publicClient && withdrawalTx) {
              console.log('Waiting for transaction confirmation...');
              const receipt = await publicClient.waitForTransactionReceipt({
                  hash: withdrawalTx as `0x${string}`,
                  confirmations: 1
              });
              console.log('✅ Withdrawal confirmed!', receipt);

              // Refresh balances after confirmation
              setTimeout(() => {
                  refreshBalance();
                  requestUnifiedBalance();
              }, 2000);
          }
      } catch (err) {
          console.error('Failed to withdraw:', err);
          alert(`Withdrawal failed: ${err}`);
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
              alert('Faucet Funds Requested! Wait a moment then refresh balance.');
              // Request updated unified balance after brief delay
              setTimeout(() => requestUnifiedBalance(), 2000);
          } else {
              console.error('Faucet Request Failed:', res.statusText);
          }
      } catch (err) {
          console.error('Faucet Error:', err);
      }
  };

  const fetchAllChannels = async () => {
      if (!sessionKeyRef.current || !ws.current) {
          console.error('Cannot fetch channels: session or websocket missing');
          return;
      }

      console.log('📡 Fetching all channels...');

      try {
          const signer = createECDSAMessageSigner(sessionKeyRef.current);

          // Note: Yellow Network broker may limit channel responses (typically to 10)
          // We can only request channels for a specific participant (user)
          // The SDK doesn't expose pagination parameters, so we get what the broker returns
          const channelsMsg = await createGetChannelsMessage(
              signer,
              address as `0x${string}`, // Filter by participant address to get user's channels
              undefined, // status filter (undefined = all statuses)
          );
          ws.current.send(channelsMsg);
      } catch (err) {
          console.error('Failed to fetch channels:', err);
      }
  };

  const requestUnifiedBalance = async () => {
      if (!sessionKeyRef.current || !ws.current || !address) return;
      console.log('Requesting Unified Balance...');

      try {
          const signer = createECDSAMessageSigner(sessionKeyRef.current);
          const ledgerMsg = await createGetLedgerBalancesMessage(
              signer,
              address,
              Date.now()
          );
          ws.current.send(ledgerMsg);
      } catch (err) {
          console.error('Failed to create ledger balance message:', err);
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

      // 3. Request Unified Balance from Broker
      requestUnifiedBalance();

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
      unifiedBalance,
      refreshBalance,

      brokerConnected,
      supportedNetworks,
      sessionAddress,
      activeChannel, // Added
      allChannels, // Added
      setupSession,
      openChannel,
      fundChannel,
      closeChannel,
      withdrawFromUnified,
      requestFaucet,
      listNetworks,
      fetchAllChannels
    }}>
      {children}
    </YellowContext.Provider>
  );
};
