import { useYellow } from "@/contexts/YellowContext";
import { useGame } from "@/contexts/GameContext";
import { useAccount } from "wagmi";
import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import * as THREE from "three";

const BASE_SPEED = 4;
const BASE_RUN_SPEED = 6;
const BASE_DIG_MS = 3000;

interface Props {
  playerRef?: React.RefObject<THREE.Group | null>;
}

export function YellowDebugUI({ playerRef }: Props) {
  const { connect, isReady, isConnecting, balance, refreshBalance, requestFaucet } = useYellow();
  const { isConnected: isWalletConnected } = useAccount();
  const { upgrades, phase } = useGame();
  const [loading, setLoading] = useState(false);
  const [fps, setFps] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0, z: 0 });
  const fpsFrames = useRef(0);
  const fpsLastTime = useRef(performance.now());

  useEffect(() => {
    if (!playerRef) return;
    let rafId: number;
    const update = () => {
      const now = performance.now();
      fpsFrames.current++;
      if (now >= fpsLastTime.current + 1000) {
        setFps(Math.round((fpsFrames.current * 1000) / (now - fpsLastTime.current)));
        fpsLastTime.current = now;
        fpsFrames.current = 0;
      }
      if (playerRef.current) {
        const p = playerRef.current.position;
        setPos({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) });
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [playerRef]);

  const handleConnect = async () => {
    setLoading(true);
    try { await connect(); } catch (e) { console.error('Yellow connect failed:', e); }
    setLoading(false);
  };

  if (!isWalletConnected) {
    return (
      <Card className="fixed bottom-4 right-4 w-72">
        <CardHeader><CardTitle>Yellow Network</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-yellow-600">Connect wallet first</p>
        </CardContent>
      </Card>
    );
  }

  const walkSpeed = (BASE_SPEED * upgrades.speedMultiplier).toFixed(1);
  const runSpeed = (BASE_RUN_SPEED * upgrades.speedMultiplier).toFixed(1);
  const digSpeed = (BASE_DIG_MS * upgrades.digMultiplier / 1000).toFixed(1);
  const isPlaying = phase === 'playing' || phase === 'ended';

  return (
    <Card className="fixed bottom-4 right-4 w-72 bg-background/90 backdrop-blur z-50">
      <CardHeader className="pb-2">
        <CardTitle className="flex justify-between items-center text-sm">
          <span>Debug</span>
          <span className={`h-2 w-2 rounded-full ${isReady ? 'bg-green-500' : isConnecting ? 'bg-yellow-500' : 'bg-red-500'}`} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs font-mono">
        {isPlaying && playerRef && (
          <div className="space-y-1 border-b pb-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">FPS:</span>
              <span className={fps < 30 ? "text-red-500" : "text-green-500"}>{fps}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pos:</span>
              <span>{pos.x}, {pos.y}, {pos.z}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Walk/Run:</span>
              <span>{walkSpeed} / {runSpeed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dig time:</span>
              <span>{digSpeed}s</span>
            </div>
          </div>
        )}

        {!isReady ? (
          <Button onClick={handleConnect} disabled={loading || isConnecting} className="w-full text-white">
            {isConnecting ? 'Connecting...' : 'Connect Yellow'}
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status:</span>
              <span className="text-green-500 font-semibold">Ready</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Balance:</span>
              <span>{balance.toFixed(8)} TEST</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refreshBalance} className="flex-1 h-7 text-white text-xs">
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={requestFaucet} className="flex-1 h-7 text-white text-xs">
                Faucet
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
