import './App.css'
import { Scene } from "@/components/three/Scene"

function App() {
  return (
    <div className="w-screen h-screen relative bg-red-600">
      <Scene />
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
