import { useMemo, useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { KeyboardControls, Sky, Stars, ContactShadows, PointerLockControls, Environment } from "@react-three/drei"
import { Physics, RigidBody } from "@react-three/rapier"
import * as THREE from "three"
import { Player } from "./Player"
import { DebugUI } from "../DebugUI"

// Simple pseudo-random generator based on seed
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
]

const GRASS_COUNT = 150000
const GRASS_RANGE = 100

function Grass({ seed, playerRef }: { seed: number, playerRef: React.RefObject<THREE.Group | null> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  const grassData = useMemo(() => {
    const random = mulberry32(seed * 12345);
    const data = []
    for (let i = 0; i < GRASS_COUNT; i++) {
      const x = random() * GRASS_RANGE - GRASS_RANGE / 2
      const z = random() * GRASS_RANGE - GRASS_RANGE / 2
      
      // Use a more natural distribution for scale
      const scaleY = 0.3 + random() * 0.5
      const scaleXZ = 0.15 + random() * 0.2
      const rotation = random() * Math.PI
      
      // Color variation (more natural greens)
      const h = 80 + random() * 60
      const s = 40 + random() * 40
      const l = 25 + random() * 25
      const color = new THREE.Color(`hsl(${h}, ${s}%, ${l}%)`)
      
      // Random lean direction
      const lean = random() * 0.5
      const leanDirection = random() * Math.PI * 2
      
      data.push({ x, z, scaleY, scaleXZ, rotation, color, lean, leanDirection })
    }
    return data
  }, [seed])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    // @ts-ignore - assigning to ref
    meshRef.current = mesh
    grassData.forEach((data, i) => {
      dummy.position.set(data.x, -0.5, data.z)
      dummy.rotation.set(0, data.rotation, 0)
      
      // Apply initial lean via rotation
      dummy.rotateX(data.lean)
      dummy.rotateY(data.leanDirection)
      
      dummy.scale.set(data.scaleXZ, data.scaleY, data.scaleXZ)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, data.color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  // Custom shader for wind, displacement and color
  const grassShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3() },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vInstanceColor;
      varying vec3 vWorldPosition;
      uniform float uTime;
      uniform vec3 uPlayerPos;
      
      // Simple 2D Noise
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        vUv = uv;
        vInstanceColor = instanceColor;
        
        // Calculate world position
        vec4 worldPos = instanceMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        
        vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        
        // --- WIND CALCULATION ---
        // Large scale noise waves
        float windScale = 0.2;
        float windSpeed = 1.5;
        float wave = noise(instancePosition.xz * windScale + uTime * windSpeed);
        float windStrength = wave * 0.4;
        
        // Small high-frequency jitter
        float jitter = sin(uTime * 10.0 + instancePosition.x * 20.0) * 0.02;
        
        // --- PLAYER DISPLACEMENT ---
        float dist = distance(instancePosition.xyz, uPlayerPos);
        float radius = 1.5;
        float displacement = 0.0;
        vec3 dir = normalize(instancePosition.xyz - uPlayerPos);
        if(dist < radius) {
          displacement = pow(1.0 - dist/radius, 2.0) * 1.5;
        }

        vec3 pos = position;
        float strength = pow(uv.y, 1.5); // Apply more to tips
        
        pos.x += (windStrength + jitter) * strength;
        pos.z += (windStrength * 0.5) * strength;
        
        // Apply player displacement
        pos.x += dir.x * displacement * strength;
        pos.z += dir.z * displacement * strength;
        
        // Curve the blade slightly for a more organic look
        pos.x += pow(uv.y, 2.0) * 0.1;

        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vInstanceColor;
      varying vec3 vWorldPosition;
      
      void main() {
        // AAA Color palette: Darker base, vibrant translucent tip
        vec3 baseColor = vInstanceColor * 0.3;
        vec3 tipColor = mix(vInstanceColor, vec3(0.8, 1.0, 0.3), 0.3); // Slight yellow-green tint at tips
        
        vec3 finalColor = mix(baseColor, tipColor, vUv.y);
        
        // Fake Translucency / Sub-surface scattering
        // Light coming from "behind" or "above" makes the grass glow
        float translucency = pow(vUv.y, 2.0) * 0.3;
        finalColor += vec3(0.4, 0.5, 0.1) * translucency;
        
        // Fake depth/shading
        float shading = mix(0.6, 1.0, vUv.x);
        finalColor *= shading;
        
        // Subtle vertical highlight
        float highlight = smoothstep(0.4, 0.5, vUv.x) * smoothstep(0.6, 0.5, vUv.x) * 0.1;
        finalColor += highlight * vUv.y;
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `
  }), [])

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
      if (playerRef.current) {
        // Get player position from RigidBody/mesh
        materialRef.current.uniforms.uPlayerPos.value.copy(playerRef.current.position)
      }
    }
  })

        // Create a better geometry for the grass blade
        // A thin, tapered plane
        const geometry = useMemo(() => {
          const geo = new THREE.PlaneGeometry(0.5, 1, 1, 8) // Thicker base
          geo.translate(0, 0.5, 0) // Move origin to bottom
          
          // Taper the tip and add some initial natural curve
          const position = geo.attributes.position
          for (let i = 0; i < position.count; i++) {
            const y = position.getY(i)
            const x = position.getX(i)
            const z = position.getZ(i)
            
            // Taper x as y increases
            const taper = 1.0 - Math.pow(y, 1.5)
            position.setX(i, x * taper)
            
            // Add a slight natural curve to the geometry itself
            position.setZ(i, z + Math.pow(y, 2.0) * 0.2)
          }
          return geo
        }, [])

  return (
    <instancedMesh ref={setInstances} args={[geometry, undefined, GRASS_COUNT]} castShadow receiveShadow>
      <shaderMaterial
        ref={materialRef}
        args={[grassShader]}
        vertexColors
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  )
}

function Flowers({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const FLOWER_COUNT = 500

  const flowerData = useMemo(() => {
    const random = mulberry32(seed * 98765);
    const data = []
    const colors = ['#ff69b4', '#ffffff', '#ffff00', '#add8e6', '#dda0dd']
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const x = random() * GRASS_RANGE - GRASS_RANGE / 2
      const z = random() * GRASS_RANGE - GRASS_RANGE / 2
      const color = new THREE.Color(colors[Math.floor(random() * colors.length)])
      data.push({ x, z, color })
    }
    return data
  }, [seed])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    const random = mulberry32(seed * 54321);
    flowerData.forEach((data, i) => {
      dummy.position.set(data.x, -0.4, data.z)
      dummy.scale.set(0.2, 0.2, 0.2)
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, data.color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  return (
    <instancedMesh ref={setInstances} args={[undefined, undefined, FLOWER_COUNT]} castShadow>
      <sphereGeometry args={[0.5, 8, 8]} />
      <meshStandardMaterial vertexColors />
    </instancedMesh>
  )
}

export function Scene({ seed, playerRef }: { seed: number, playerRef: React.RefObject<THREE.Group | null> }) {
  return (
    <KeyboardControls map={keyboardMap}>
      <Canvas shadows camera={{ position: [0, 2, 5], fov: 75 }}>
        <fog attach="fog" args={["#87ceeb", 10, 80]} />
        <PointerLockControls pointerSpeed={4} />
        <Sky sunPosition={[100, 20, 100]} turbidity={0.1} rayleigh={0.5} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        <Environment preset="park" />
        
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[50, 50, 50]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
        />
        
        <Physics gravity={[0, -9.81, 0]} interpolate={false}>
          <Player ref={playerRef} />
          
          <RigidBody type="fixed">
            <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
              <planeGeometry args={[GRASS_RANGE, GRASS_RANGE]} />
              <meshStandardMaterial color="#2d5a27" roughness={0.8} />
            </mesh>
          </RigidBody>

          <Grass seed={seed} playerRef={playerRef} />
          <Flowers seed={seed} />
        </Physics>

        <ContactShadows
          opacity={0.4}
          scale={GRASS_RANGE}
          blur={1.5}
          far={10}
          resolution={512}
          color="#1a3317"
        />
      </Canvas>
    </KeyboardControls>
  )
}
