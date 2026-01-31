import { Canvas } from "@react-three/fiber"
import { KeyboardControls, Sky, Stars, ContactShadows, PointerLockControls } from "@react-three/drei"
import { Physics, RigidBody } from "@react-three/rapier"
import { Player } from "./Player"

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
]

export function Scene() {
  return (
    <KeyboardControls map={keyboardMap}>
      <Canvas shadows camera={{ position: [0, 2, 5], fov: 75 }}>
        <PointerLockControls pointerSpeed={4} />
        <Sky sunPosition={[100, 20, 100]} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        <ambientLight intensity={1.5} />
        <directionalLight
          position={[10, 10, 10]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        
        <Physics gravity={[0, -9.81, 0]} interpolate={false}>
          <Player />
          
          <RigidBody type="fixed">
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
              <planeGeometry args={[100, 100]} />
              <meshStandardMaterial color="#303030" />
            </mesh>
          </RigidBody>

          {/* Some obstacles */}
          {[...Array(20)].map((_, i) => (
            <RigidBody key={i} position={[Math.random() * 20 - 10, 1, Math.random() * 20 - 10]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="orange" />
              </mesh>
            </RigidBody>
          ))}
        </Physics>

        <ContactShadows
          opacity={0.4}
          scale={100}
          blur={1}
          far={10}
          resolution={256}
          color="#000000"
        />
      </Canvas>
    </KeyboardControls>
  )
}
