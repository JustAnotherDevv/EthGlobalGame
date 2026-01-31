import { useMemo, useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { KeyboardControls, Sky, Stars, ContactShadows, PointerLockControls, Environment } from "@react-three/drei"
import { Physics, RigidBody } from "@react-three/rapier"
import * as THREE from "three"
import { Player } from "./Player"

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

const NEAR_GRASS_COUNT = 60000
const MID_GRASS_COUNT = 70000
const FAR_GRASS_COUNT = 40000
const GRASS_RANGE = 100

function Grass({ seed, playerRef }: { seed: number, playerRef: React.RefObject<THREE.Group | null> }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const nearMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const midMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const farMaterialRef = useRef<THREE.ShaderMaterial>(null)

  const grassData = useMemo(() => {
    const random = mulberry32(seed * 12345);
    const near = []
    const mid = []
    const far = []
    
    // Total count is now 170,000 (reduced from 200,000)
    for (let i = 0; i < NEAR_GRASS_COUNT + MID_GRASS_COUNT + FAR_GRASS_COUNT; i++) {
      // Use square root for uniform distribution in a circle
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      const scaleY = 0.3 + random() * 0.5
      const scaleXZ = 0.25 + random() * 0.35
      const rotation = random() * Math.PI
      
      const h = 80 + random() * 60
      const s = 40 + random() * 40
      const l = 25 + random() * 25
      const color = new THREE.Color(`hsl(${h}, ${s}%, ${l}%)`)
      
      const lean = random() * 0.5
      const leanDirection = random() * Math.PI * 2
      
      const item = { x, z, scaleY, scaleXZ, rotation, color, lean, leanDirection }
      
      if (i < NEAR_GRASS_COUNT) {
        near.push(item)
      } else if (i < NEAR_GRASS_COUNT + MID_GRASS_COUNT) {
        mid.push(item)
      } else {
        far.push(item)
      }
    }
    return { near, mid, far }
  }, [seed])

  const { nearGeometry, midGeometry, farGeometry, grassShader } = useMemo(() => {
    // Helper to create tapered plane geometry
    const createTaperedGeo = (segments: number) => {
      const geo = new THREE.PlaneGeometry(0.6, 1, 1, segments)
      geo.translate(0, 0.5, 0)
      const pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i)
        const taper = 1.0 - Math.pow(y, 1.5)
        pos.setX(i, pos.getX(i) * taper)
        pos.setZ(i, pos.getZ(i) + Math.pow(y, 2.0) * 0.2)
      }
      return geo
    }

    const nearGeo = createTaperedGeo(4)
    const midGeo = createTaperedGeo(2)
    const farGeo = createTaperedGeo(1)

    const shader = {
      uniforms: {
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector3() },
        uCameraPos: { value: new THREE.Vector3() },
        uProjectionMatrix: { value: new THREE.Matrix4() },
        uViewMatrix: { value: new THREE.Matrix4() },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vInstanceColor;
        varying vec3 vWorldPosition;
        uniform float uTime;
        uniform vec3 uPlayerPos;
        uniform vec3 uCameraPos;
        uniform mat4 uProjectionMatrix;
        uniform mat4 uViewMatrix;
        
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
          
          vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 worldInstancePos = (modelMatrix * instancePosition).xyz;
          
          // 1. Frustum Culling (GPU Side)
          // Project the world instance position to clip space
          vec4 clipPos = uProjectionMatrix * uViewMatrix * vec4(worldInstancePos, 1.0);
          // Add a larger margin to prevent popping at edges during fast rotation
          float margin = 30.0;
          if (abs(clipPos.x) > clipPos.w + margin || abs(clipPos.y) > clipPos.w + margin || clipPos.z < -clipPos.w - margin || clipPos.z > clipPos.w + margin) {
             gl_Position = vec4(0.0);
             return;
          }

          float distToCamera = distance(worldInstancePos, uCameraPos);
          float maxDist = 70.0;
          
          // Optimization: Progressive density reduction for far grass
          // We use a pseudo-random value based on instance position to decide if we cull
          float h = hash(worldInstancePos.xz);
          float densityThreshold = smoothstep(maxDist, maxDist * 0.4, distToCamera);
          
          if (distToCamera > maxDist || h > densityThreshold + 0.15) {
            gl_Position = vec4(0.0);
            return;
          }

          // WIND - Simplified noise call
          float windScale = 0.2;
          float windSpeed = 1.5;
          float wave = noise(worldInstancePos.xz * windScale + uTime * windSpeed);
          float windStrength = wave * 0.4;
          float jitter = sin(uTime * 10.0 + worldInstancePos.x * 20.0) * 0.02;
          
          // PLAYER DISPLACEMENT
          float distToPlayer = distance(worldInstancePos, uPlayerPos);
          float radius = 1.5;
          
          vec3 pos = position;
          float strength = pow(uv.y, 1.5);
          
          pos.x += (windStrength + jitter) * strength;
          pos.z += (windStrength * 0.5) * strength;
          
          if(distToPlayer < radius) {
            vec3 dir = normalize(worldInstancePos - uPlayerPos);
            float displacement = pow(1.0 - distToPlayer/radius, 2.0) * 1.5;
            pos.x += dir.x * displacement * strength;
            pos.z += dir.z * displacement * strength;
          }
          
          pos.x += pow(uv.y, 2.0) * 0.1;

          float fadeOut = 1.0 - smoothstep(maxDist * 0.8, maxDist, distToCamera);
          pos *= fadeOut;

          vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vInstanceColor;
        varying vec3 vWorldPosition;
        
        void main() {
          // Simplified lighting/shading
          vec3 baseColor = vInstanceColor * 0.3;
          vec3 tipColor = mix(vInstanceColor, vec3(0.8, 1.0, 0.3), 0.3);
          vec3 finalColor = mix(baseColor, tipColor, vUv.y);
          
          // Sub-surface scattering approximation
          float translucency = vUv.y * vUv.y * 0.3;
          finalColor += vec3(0.4, 0.5, 0.1) * translucency;
          
          // Side shading for volume
          finalColor *= (0.6 + vUv.x * 0.4);
          
          // Tip highlight
          float highlight = smoothstep(0.4, 0.5, vUv.x) * smoothstep(0.6, 0.5, vUv.x);
          finalColor += highlight * vUv.y * 0.1;
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    }
    return { nearGeometry: nearGeo, midGeometry: midGeo, farGeometry: farGeo, grassShader: shader }
  }, [seed])

  const setNearInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    grassData.near.forEach((data, i) => {
      dummy.position.set(data.x, -0.5, data.z)
      dummy.rotation.set(0, data.rotation, 0)
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

  const setMidInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    grassData.mid.forEach((data, i) => {
      dummy.position.set(data.x, -0.5, data.z)
      dummy.rotation.set(0, data.rotation, 0)
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

  const setFarInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    grassData.far.forEach((data, i) => {
      dummy.position.set(data.x, -0.5, data.z)
      dummy.rotation.set(0, data.rotation, 0)
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

  useFrame((state) => {
    const time = state.clock.elapsedTime
    const cameraPos = state.camera.position
    const playerPos = playerRef.current ? playerRef.current.position : new THREE.Vector3()

    if (nearMaterialRef.current) {
      nearMaterialRef.current.uniforms.uTime.value = time
      nearMaterialRef.current.uniforms.uCameraPos.value.copy(cameraPos)
      nearMaterialRef.current.uniforms.uPlayerPos.value.copy(playerPos)
      nearMaterialRef.current.uniforms.uProjectionMatrix.value.copy(state.camera.projectionMatrix)
      nearMaterialRef.current.uniforms.uViewMatrix.value.copy(state.camera.matrixWorldInverse)
    }
    if (midMaterialRef.current) {
      midMaterialRef.current.uniforms.uTime.value = time
      midMaterialRef.current.uniforms.uCameraPos.value.copy(cameraPos)
      midMaterialRef.current.uniforms.uPlayerPos.value.copy(playerPos)
      midMaterialRef.current.uniforms.uProjectionMatrix.value.copy(state.camera.projectionMatrix)
      midMaterialRef.current.uniforms.uViewMatrix.value.copy(state.camera.matrixWorldInverse)
    }
    if (farMaterialRef.current) {
      farMaterialRef.current.uniforms.uTime.value = time
      farMaterialRef.current.uniforms.uCameraPos.value.copy(cameraPos)
      farMaterialRef.current.uniforms.uPlayerPos.value.copy(playerPos)
      farMaterialRef.current.uniforms.uProjectionMatrix.value.copy(state.camera.projectionMatrix)
      farMaterialRef.current.uniforms.uViewMatrix.value.copy(state.camera.matrixWorldInverse)
    }
  })

  return (
    <group>
      <instancedMesh ref={setNearInstances} args={[nearGeometry, undefined, NEAR_GRASS_COUNT]} castShadow receiveShadow frustumCulled={false}>
        <shaderMaterial
          ref={nearMaterialRef}
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={setMidInstances} args={[midGeometry, undefined, MID_GRASS_COUNT]} castShadow receiveShadow frustumCulled={false}>
        <shaderMaterial
          ref={midMaterialRef}
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={setFarInstances} args={[farGeometry, undefined, FAR_GRASS_COUNT]} castShadow receiveShadow frustumCulled={false}>
        <shaderMaterial
          ref={farMaterialRef}
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  )
}

function Flowers({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const FLOWER_COUNT = 400

  const flowerData = useMemo(() => {
    const random = mulberry32(seed * 98765);
    const data = []
    const colors = ['#ff69b4', '#ffffff', '#ffff00', '#add8e6', '#dda0dd']
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      const color = new THREE.Color(colors[Math.floor(random() * colors.length)])
      data.push({ x, z, color })
    }
    return data
  }, [seed])

  const flowerShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new THREE.Vector3() },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      uniform float uTime;
      uniform vec3 uCameraPos;
      
      void main() {
        vUv = uv;
        vColor = instanceColor;
        vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 worldInstancePos = (modelMatrix * instancePosition).xyz;
        
        float distToCamera = distance(worldInstancePos, uCameraPos);
        if (distToCamera > 60.0) {
          gl_Position = vec4(0.0);
          return;
        }
        
        // Gentle sway
        vec3 pos = position;
        pos.x += sin(uTime + worldInstancePos.x) * 0.1 * uv.y;
        
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `
  }), [])

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

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
      materialRef.current.uniforms.uCameraPos.value.copy(state.camera.position)
    }
  })

  return (
    <instancedMesh ref={setInstances} args={[undefined, undefined, FLOWER_COUNT]} castShadow frustumCulled={false}>
      <sphereGeometry args={[0.5, 6, 6]} />
      <shaderMaterial ref={materialRef} args={[flowerShader]} vertexColors />
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
              <circleGeometry args={[GRASS_RANGE / 2, 32]} />
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
