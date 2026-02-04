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
    refreshBalance, 
    client,
    brokerConnected,
    supportedNetworks,
    sessionAddress,
    setupSession,
    openChannel,
    fundChannel,
    requestFaucet,
    listNetworks,
    activeChannel
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
          <Button onClick={handleInit} disabled={loading} className="w-full">
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
                 <span className="text-muted-foreground">Balance:</span>
                 <span>{balance}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => refreshBalance()} className="w-full h-8">
                Refresh Balance
              </Button>
            </div>

            {/* Broker Actions */}
            <div className="space-y-2">
                <h4 className="text-sm font-semibold">Broker Actions</h4>
                
                <Button variant="secondary" size="sm" onClick={listNetworks} className="w-full h-8">
                    List Networks (Console)
                </Button>
                
                <Button variant="outline" size="sm" onClick={requestFaucet} disabled={!isWalletConnected} className="w-full h-8">
                    Request Faucet Funds
                </Button>
                {supportedNetworks.length > 0 && (
                    <div className="text-xs max-h-20 overflow-auto bg-muted p-2 rounded">
                        {supportedNetworks.map((n: any) => (
                            <div key={n.chain_id}>ID: {n.chain_id} - {n.name}</div>
                        ))}
                    </div>
                )}

                <Button variant="secondary" size="sm" onClick={setupSession} disabled={!!sessionAddress} className="w-full h-8">
                    {sessionAddress ? 'Session Active' : 'Setup Session'}
                </Button>
                {sessionAddress && (
                     <div className="text-xs truncate text-muted-foreground">
                        Session: {sessionAddress}
                     </div>
                )}

                <Button variant="default" size="sm" onClick={openChannel} disabled={!sessionAddress || !!activeChannel} className="w-full h-8">
                    {activeChannel ? 'Channel Open' : 'Open Channel'}
                </Button>
                
                {activeChannel && (
                    <div className="text-xs bg-muted p-2 rounded space-y-1">
                        <div className="font-semibold text-green-500">✓ Active Channel</div>
                        <div className="truncate text-[10px]" title={activeChannel.id}>ID: {activeChannel.id}</div>
                        <div>Status: {activeChannel.status}</div>
                        <div>Balance: {activeChannel.balance}</div>
                        
                        <Button 
                            variant="secondary" 
                            size="sm" 
                            onClick={() => fundChannel('0.00001')} 
                            className="w-full h-6 mt-2 text-[10px]"
                        >
                            Alloc 0.00001 TEST From Faucet
                        </Button>
                    </div>
                )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
