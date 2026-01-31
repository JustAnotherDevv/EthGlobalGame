import { useState, useEffect } from "react"
import * as THREE from "three"

interface DebugUIProps {
  playerRef: React.RefObject<THREE.Group | null>
}

export function DebugUI({ playerRef }: DebugUIProps) {
  const [fps, setFps] = useState(0)
  const [pos, setPos] = useState({ x: 0, y: 0, z: 0 })

  useEffect(() => {
    let lastTime = performance.now()
    let frames = 0
    let rafId: number

    const update = () => {
      const now = performance.now()
      frames++

      if (now >= lastTime + 1000) {
        setFps(Math.round((frames * 1000) / (now - lastTime)))
        lastTime = now
        frames = 0
      }

      if (playerRef.current) {
        const p = playerRef.current.position
        setPos({
          x: Number(p.x.toFixed(2)),
          y: Number(p.y.toFixed(2)),
          z: Number(p.z.toFixed(2))
        })
      }

      rafId = requestAnimationFrame(update)
    }

    rafId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafId)
  }, [playerRef])

  return (
    <div className="absolute top-4 right-4 p-4 bg-background/80 backdrop-blur rounded-lg border shadow-sm pointer-events-none font-mono text-sm space-y-1 min-w-[150px]">
      <div className="flex justify-between border-b pb-1 mb-1">
        <span className="font-bold">Debug Info</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">FPS:</span>
        <span className={fps < 30 ? "text-red-500" : "text-green-500"}>{fps}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">X:</span>
        <span>{pos.x}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Y:</span>
        <span>{pos.y}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Z:</span>
        <span>{pos.z}</span>
      </div>
    </div>
  )
}
