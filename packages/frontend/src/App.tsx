import { useState, useRef } from 'react'
import './App.css'
import { Scene } from "@/components/three/Scene"
import { MainMenu } from "@/components/MainMenu"
import { DebugUI } from "@/components/DebugUI"
import { YellowDebugUI } from "@/components/YellowDebugUI"
import * as THREE from 'three'

type GameState = 'menu' | 'preview' | 'playing'

function App() {
  const [gameState, setGameState] = useState<GameState>('menu')
  const [seed, setSeed] = useState(0)
  const playerRef = useRef<THREE.Group>(null)

  const handleStart = () => {
    setSeed(Math.random())
    setGameState('preview')
  }

  const handleEnter = () => {
    setGameState('playing')
  }

  if (gameState === 'menu') {
    return <MainMenu onStart={handleStart} />
  }

  return (
    <div className="w-screen h-screen relative bg-black">
      <Scene seed={seed} playerRef={playerRef} gameState={gameState} />
      
      {gameState === 'playing' && <DebugUI playerRef={playerRef} />}
      <YellowDebugUI />
      
      {gameState === 'playing' && (
        <div className="absolute top-4 left-4 p-4 bg-background/80 backdrop-blur rounded-lg border shadow-sm pointer-events-none">
          <h1 className="text-xl font-bold mb-2">3D Third Person Controller</h1>
          <p className="text-sm text-muted-foreground">
            Use <kbd className="px-1 border rounded bg-muted">WASD</kbd> to move<br />
            Use <kbd className="px-1 border rounded bg-muted">Shift</kbd> to run<br />
            Use <kbd className="px-1 border rounded bg-muted">Space</kbd> to jump<br />
            Use <kbd className="px-1 border rounded bg-muted">E</kbd> or <kbd className="px-1 border rounded bg-muted">F</kbd> for action<br />
            Click to look around
          </p>
        </div>
      )}

      {gameState === 'preview' && (
        <div 
          className="absolute inset-0 flex flex-col items-center pt-4 pointer-events-none"
        >
          <div 
            className="bg-background/80 p-6 rounded-2xl border shadow-2xl text-center animate-in fade-in zoom-in duration-500 pointer-events-auto cursor-pointer hover:scale-105 transition-transform"
            onClick={handleEnter}
          >
            <h2 className="text-2xl font-bold mb-2">Map Preview</h2>
            <p className="text-sm text-muted-foreground mb-4">Take a look at your procedurally generated island</p>
            <button 
              className="bg-primary text-primary-foreground px-6 py-2 rounded-full font-bold text-base shadow-lg"
            >
              Enter Game
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
