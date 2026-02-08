import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import { Scene } from "@/components/three/Scene"
import { MainMenu } from "@/components/MainMenu"
import { YellowDebugUI } from "@/components/YellowDebugUI"
import { GameHUD } from "@/components/GameHUD"
import { useGame } from "@/contexts/GameContext"
import { RoomPhase } from "@/types/game"
import * as THREE from 'three'

type GameState = 'menu' | 'lobby' | 'playing' | 'ended'

function App() {
  const [gameState, setGameState] = useState<GameState>('menu')
  const [seed, setSeed] = useState(0)
  const playerRef = useRef<THREE.Group>(null)
  const game = useGame()
  const gameRef = useRef(game)
  gameRef.current = game
  const actionThrottleRef = useRef(0)

  useEffect(() => {
    if (game.phase === RoomPhase.Playing && game.seed !== null) {
      setSeed(game.seed)
      setGameState('playing')
    } else if (game.phase === RoomPhase.Ended) {
      setGameState('ended')
    } else if (game.phase === RoomPhase.Lobby || game.phase === 'connecting' || game.phase === 'wager_pending') {
      setGameState('lobby')
    } else if (game.phase === 'disconnected') {
      if (gameState === 'lobby' || gameState === 'ended') {
        setGameState('menu')
      }
    }
  }, [game.phase, game.seed])

  // Position sync: read playerRef on interval, outside R3F render loop
  useEffect(() => {
    if (gameState !== 'playing') return
    const interval = setInterval(() => {
      if (playerRef.current) {
        const p = playerRef.current.position
        gameRef.current.sendPosition(p.x, p.y, p.z)
      }
    }, 50)
    return () => clearInterval(interval)
  }, [gameState])

  const handleAction = useCallback((x: number, y: number, z: number) => {
    const now = Date.now()
    if (now - actionThrottleRef.current < 500) return
    actionThrottleRef.current = now

    const g = gameRef.current
    if (g.phase !== RoomPhase.Playing) return

    const INTERACT_DIST = 3
    let nearestId: string | null = null
    let nearestDist = INTERACT_DIST
    for (const r of g.resources) {
      if (r.harvested) continue
      const d = Math.sqrt((r.position.x - x) ** 2 + (r.position.z - z) ** 2)
      if (d < nearestDist) {
        nearestDist = d
        nearestId = r.id
      }
    }

    if (nearestId) {
      g.startHarvest(nearestId)
    } else {
      g.startDig(x, y, z)
    }
  }, [])

  const handleFindGame = () => {
    game.joinGame()
  }

  const handleBackToMenu = () => {
    game.leaveGame()
    setGameState('menu')
  }

  if (gameState === 'menu') {
    return <MainMenu onFindGame={handleFindGame} />
  }

  if (gameState === 'lobby') {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-slate-900">
        <div className="bg-background p-6 rounded-2xl border shadow-2xl text-center max-w-sm">
          <h2 className="text-2xl font-bold mb-2">
            {game.phase === 'connecting' && 'Connecting...'}
            {game.phase === 'wager_pending' && 'Processing wager...'}
            {game.phase === RoomPhase.Lobby && 'Waiting for players'}
          </h2>
          {game.countdown > 0 && (
            <p className="text-4xl font-bold text-primary my-4">{game.countdown}</p>
          )}
          <p className="text-sm text-muted-foreground mb-4">
            {game.players.length} player{game.players.length !== 1 ? 's' : ''} in room
          </p>
          {game.error && (
            <p className="text-sm text-destructive mb-2">{game.error}</p>
          )}
          <button
            className="text-sm text-muted-foreground underline"
            onClick={handleBackToMenu}
          >
            Cancel
          </button>
        </div>
        <YellowDebugUI />
      </div>
    )
  }

  return (
    <div className="w-screen h-screen relative bg-black">
      <Scene
        seed={seed}
        playerRef={playerRef}
        gameState="playing"
        onAction={handleAction}
      />

      <GameHUD />
      <YellowDebugUI playerRef={playerRef} />

      <div className="absolute top-4 left-4 p-4 bg-background/80 backdrop-blur rounded-lg border shadow-sm pointer-events-none">
        <h1 className="text-xl font-bold mb-2">Island Treasure Hunt</h1>
        <p className="text-sm text-muted-foreground">
          Use <kbd className="px-1 border rounded bg-muted">WASD</kbd> to move<br />
          Use <kbd className="px-1 border rounded bg-muted">Shift</kbd> to run<br />
          Use <kbd className="px-1 border rounded bg-muted">Space</kbd> to jump<br />
          Use <kbd className="px-1 border rounded bg-muted">E</kbd> to harvest / dig<br />
          Click to look around
        </p>
      </div>

      {gameState === 'ended' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
          <div className="bg-background p-8 rounded-2xl border shadow-2xl text-center max-w-sm">
            <h2 className="text-3xl font-bold mb-2">Game Over</h2>
            {game.winner && (
              <p className="text-lg mb-1">
                {game.winner === game.playerId ? 'You won!' : `Winner: ${game.winner.slice(0, 8)}...`}
              </p>
            )}
            {game.winReason && (
              <p className="text-sm text-muted-foreground mb-2">
                {game.winReason === 'chest_found' ? 'Treasure found' : game.winReason === 'timeout' ? 'Time ran out' : 'Game abandoned'}
              </p>
            )}
            {game.payoutAmount != null && (
              <p className="text-green-500 font-bold mb-4">Payout: {game.payoutAmount}</p>
            )}
            <button
              className="bg-primary text-primary-foreground px-6 py-2 rounded-full font-bold"
              onClick={handleBackToMenu}
            >
              Back to Menu
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
