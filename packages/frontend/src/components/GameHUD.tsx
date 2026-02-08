import { useGame } from '@/contexts/GameContext';
import { RoomPhase } from '@/types/game';

export function GameHUD() {
  const { phase, inventory, countdown, winner, winReason, payoutAmount, players, mapHint } = useGame();

  if (phase !== RoomPhase.Playing && phase !== RoomPhase.Ended) return null;

  return (
    <div className="absolute top-4 right-4 flex flex-col gap-2 pointer-events-none z-10">
      {/* Inventory */}
      <div className="bg-black/70 backdrop-blur text-white p-3 rounded-lg text-sm min-w-[160px]">
        <div className="font-bold mb-1 text-xs uppercase tracking-wide opacity-70">Inventory</div>
        <div className="flex flex-col gap-0.5">
          <div className="flex justify-between"><span>Wood</span><span>{inventory.wood}</span></div>
          <div className="flex justify-between"><span>Stone</span><span>{inventory.stone}</span></div>
          <div className="flex justify-between"><span>Berry</span><span>{inventory.berry}</span></div>
        </div>
      </div>

      {/* Players */}
      <div className="bg-black/70 backdrop-blur text-white p-3 rounded-lg text-sm">
        <div className="font-bold mb-1 text-xs uppercase tracking-wide opacity-70">Players</div>
        <div>{players.filter(p => p.connected).length} connected</div>
      </div>

      {/* Map hint */}
      {mapHint && (
        <div className="bg-yellow-900/80 backdrop-blur text-yellow-200 p-3 rounded-lg text-sm">
          <div className="font-bold text-xs">Map revealed</div>
          <div>Chest is near ({Math.round(mapHint.center.x)}, {Math.round(mapHint.center.z)})</div>
          <div>Radius: ~{Math.round(mapHint.radius)}</div>
        </div>
      )}

      {/* Countdown */}
      {countdown > 0 && (
        <div className="bg-blue-900/80 backdrop-blur text-blue-200 p-3 rounded-lg text-sm text-center">
          <div className="text-2xl font-bold">{countdown}</div>
          <div className="text-xs">Game starting...</div>
        </div>
      )}

      {/* Game ended */}
      {phase === RoomPhase.Ended && (
        <div className="bg-black/80 backdrop-blur text-white p-4 rounded-lg text-center">
          <div className="text-lg font-bold mb-1">Game Over</div>
          {winner && <div>Winner: {winner.slice(0, 8)}...</div>}
          {winReason && <div className="text-xs opacity-70">Reason: {winReason.replace('_', ' ')}</div>}
          {payoutAmount != null && <div className="text-green-400 mt-1">Payout: {payoutAmount}</div>}
        </div>
      )}
    </div>
  );
}
