import { useState, useRef } from 'react'
import './App.css'
import { Scene } from "@/components/three/Scene"
import { MainMenu } from "@/components/MainMenu"
import { DebugUI } from "@/components/DebugUI"
import * as THREE from 'three'

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [seed, setSeed] = useState(0)
  const playerRef = useRef<THREE.Group>(null)

  const handleStart = () => {
    setSeed(Math.random())
    setIsPlaying(true)
  }

  if (!isPlaying) {
    return <MainMenu onStart={handleStart} />
  }

  return (
    <div className="w-screen h-screen relative bg-black">
      <Scene seed={seed} playerRef={playerRef} />
      <DebugUI playerRef={playerRef} />
      <div className="absolute top-4 left-4 p-4 bg-background/80 backdrop-blur rounded-lg border shadow-sm pointer-events-none">
        <h1 className="text-xl font-bold mb-2">3D Third Person Controller</h1>
        <p className="text-sm text-muted-foreground">
          Use <kbd className="px-1 border rounded bg-muted">WASD</kbd> to move<br />
          Use <kbd className="px-1 border rounded bg-muted">Space</kbd> to jump<br />
          Click to look around
        </p>
      </div>
    </div>
  )
}

export default App
