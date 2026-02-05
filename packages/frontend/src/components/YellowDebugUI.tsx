import { useYellow } from "@/contexts/YellowContext";
import { useAccount } from "wagmi";
import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

export function YellowDebugUI() {
  const {
    isConnected: isYellowConnected,
    initialize,
    balance,
    unifiedBalance,
    refreshBalance,
    client,
    brokerConnected,
    supportedNetworks,
    sessionAddress,
    setupSession,
    openChannel,
    fundChannel,
    closeChannel,
    requestFaucet,
    listNetworks,
    activeChannel,
    allChannels,
    fetchAllChannels
  } = useYellow();
  
  const { isConnected: isWalletConnected } = useAccount();
  const [loading, setLoading] = useState(false);

  const handleInit = async () => {
    setLoading(true);
    await initialize();
    setLoading(false);
  };

  if (!isWalletConnected) {
    return (
      <Card className="fixed bottom-4 right-4 w-80">
        <CardHeader>
          <CardTitle>Yellow Network</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-yellow-600">Please connect wallet first</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="fixed bottom-4 right-4 w-96 max-h-[80vh] overflow-y-auto bg-background/90 backdrop-blur z-50">
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <span>Yellow Network</span>
          <div className="flex gap-2">
             <span title="Broker" className={`h-2 w-2 rounded-full ${brokerConnected ? 'bg-blue-500' : 'bg-gray-500'}`} />
             <span title="Client" className={`h-2 w-2 rounded-full ${isYellowConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isYellowConnected ? (
          <Button onClick={handleInit} disabled={loading} className="w-full text-white">
            {loading ? 'Initializing...' : 'Initialize Yellow SDK'}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 border-b pb-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Chain ID:</span>
                <span className="font-mono">{client?.chainId}</span>
              </div>
              <div className="flex justify-between text-xs">
                 <span className="text-muted-foreground">Wallet:</span>
                 <span className="font-mono text-[10px]">{balance}</span>
              </div>
              <div className="flex justify-between text-xs">
                 <span className="text-muted-foreground">Unified:</span>
                 <span className="font-mono font-semibold text-yellow-500">{unifiedBalance} TEST</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => refreshBalance()} className="w-full h-8 text-white">
                Refresh Balance
              </Button>
            </div>

            {/* Broker Actions */}
            <div className="space-y-2">
                <h4 className="text-sm font-semibold">Broker Actions</h4>
                
                <Button variant="secondary" size="sm" onClick={listNetworks} className="w-full h-8 text-white">
                    List Networks (Console)
                </Button>

                <Button variant="outline" size="sm" onClick={requestFaucet} disabled={!isWalletConnected} className="w-full h-8 text-white">
                    Request Faucet Funds
                </Button>
                {supportedNetworks.length > 0 && (
                    <div className="text-xs max-h-20 overflow-auto bg-muted p-2 rounded">
                        {supportedNetworks.map((n: any) => (
                            <div key={n.chain_id}>ID: {n.chain_id} - {n.name}</div>
                        ))}
                    </div>
                )}

                <Button variant="secondary" size="sm" onClick={setupSession} disabled={!!sessionAddress} className="w-full h-8 text-white">
                    {sessionAddress ? 'Session Active' : 'Setup Session'}
                </Button>
                {sessionAddress && (
                     <div className="text-xs truncate text-muted-foreground">
                        Session: {sessionAddress}
                     </div>
                )}

                <Button variant="default" size="sm" onClick={openChannel} disabled={!sessionAddress} className="w-full h-8 text-white">
                    Open New Channel
                </Button>

                {sessionAddress && (
                    <Button variant="outline" size="sm" onClick={fetchAllChannels} className="w-full h-8 text-white">
                        Refresh Channels
                    </Button>
                )}

                {/* Display All Channels */}
                {allChannels.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-yellow-400 mt-2">
                            Open Channels ({allChannels.length})
                        </h4>
                        <div className="max-h-60 overflow-y-auto space-y-2">
                            {allChannels.map((channel) => (
                                <div key={channel.id} className="text-xs bg-muted p-2 rounded space-y-1 border border-gray-700">
                                    <div className={`font-semibold ${channel.isReady ? 'text-green-500' : 'text-yellow-500'}`}>
                                        {channel.isReady ? '✅ Ready' : '⏳ Pending'}
                                    </div>
                                    <div className="truncate text-[10px]" title={channel.id}>ID: {channel.id}</div>
                                    <div>Status: <span className="font-semibold">{channel.status}</span></div>
                                    <div className="font-semibold text-green-400">Balance: {channel.balance} TEST</div>
                                    {!channel.isReady && (
                                        <div className="text-[9px] text-yellow-600 italic mt-1">
                                            ⏳ Waiting for on-chain confirmation...
                                        </div>
                                    )}

                                    <div className="flex gap-1">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => fundChannel('0.1')}
                                            disabled={!channel.isReady}
                                            className="flex-1 h-6 mt-2 text-[10px] text-white"
                                        >
                                            {channel.isReady ? 'Alloc 0.1 TEST' : 'Waiting...'}
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => closeChannel(channel.id)}
                                            disabled={!channel.isReady}
                                            className="flex-1 h-6 mt-2 text-[10px] text-white"
                                        >
                                            Close Channel
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {allChannels.length === 0 && sessionAddress && (
                    <div className="text-xs text-muted-foreground italic mt-2">
                        No channels found. Open a new channel to get started.
                    </div>
                )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
