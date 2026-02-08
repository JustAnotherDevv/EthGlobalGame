import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { useYellow } from '@/contexts/YellowContext'

interface MainMenuProps {
  onFindGame: () => void
}

export function MainMenu({ onFindGame }: MainMenuProps) {
  const { address, isConnected } = useAccount()
  const yellow = useYellow()

  const canPlay = isConnected && yellow.isReady

  return (
    <div className="flex items-center justify-center w-screen h-screen bg-slate-900 overflow-hidden">
      <Card className="w-[400px] shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Island Treasure Hunt</CardTitle>
          <CardDescription>Wager, explore, and find the treasure</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Step 1: Wallet */}
          <div className="flex flex-col items-center gap-2 p-4 bg-muted/50 rounded-lg border">
            <ConnectButton />
            {isConnected && address && (
              <p className="text-xs text-muted-foreground font-mono">
                Connected: {address.slice(0, 6)}...{address.slice(-4)}
              </p>
            )}
          </div>

          {/* Step 2: Yellow channel */}
          {isConnected && !yellow.isReady && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => yellow.connect()}
              disabled={yellow.isConnecting}
            >
              {yellow.isConnecting ? 'Connecting Yellow...' : 'Connect Yellow Channel'}
            </Button>
          )}

          {isConnected && yellow.isReady && (
            <div className="text-center text-sm text-green-600 font-medium">
              Yellow channel ready (balance: {yellow.balance.toFixed(2)})
            </div>
          )}

          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Controls:</h3>
            <ul className="text-sm text-muted-foreground list-disc list-inside">
              <li>WASD to move</li>
              <li>Space to jump</li>
              <li>E to harvest / dig</li>
              <li>Click to look around</li>
            </ul>
          </div>

          <Button
            size="lg"
            className="w-full mt-4"
            onClick={onFindGame}
            disabled={!canPlay}
          >
            {!isConnected ? 'Connect Wallet First' : !yellow.isReady ? 'Connect Yellow First' : 'Find Game'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
