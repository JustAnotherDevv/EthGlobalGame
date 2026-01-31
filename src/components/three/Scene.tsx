import { useMemo, useRef, useState } from "react"
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

// 2D Noise for island shape and wind
function hash2D(p: number[]) {
  const x = Math.sin(p[0] * 127.1 + p[1] * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function lerp(a: number, b: number, t: number) {
  return a + t * (b - a);
}

function noise2D(x: number, y: number) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3.0 - 2.0 * fx);
  const sy = fy * fy * (3.0 - 2.0 * fy);

  const n00 = hash2D([i, j]);
  const n10 = hash2D([i + 1, j]);
  const n01 = hash2D([i, j + 1]);
  const n11 = hash2D([i + 1, j + 1]);

  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function fbm(x: number, y: number, seed: number) {
  let value = 0.0;
  let amplitude = 0.5;
  let frequency = 1.0;
  for (let i = 0; i < 5; i++) {
    value += amplitude * noise2D(x * frequency + seed, y * frequency + seed);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

function getIslandShape(x: number, z: number, seed: number, isVegetation = false) {
  const maxR = GRASS_RANGE / 2;
  
  // Normalize coordinates
  let nx = x / maxR;
  let nz = z / maxR;
  
  // Domain warping for more interesting shapes
  const warpScale = 0.8;
  const qx = fbm(nx * warpScale, nz * warpScale, seed + 12.3);
  const qz = fbm(nx * warpScale + 5.2, nz * warpScale + 1.3, seed + 45.6);
  
  nx += qx * 0.4;
  nz += qz * 0.4;
  
  // Fractal noise with warped coordinates
  const islandScale = 1.5;
  const n = fbm(nx * 1.8, nz * 1.8, seed) * islandScale;
  
  // Distance from center falloff
  const d = Math.sqrt(nx * nx + nz * nz);
  
  // Multiplicative radial mask - even more aggressive to prevent edge clipping
  const radialMask = Math.max(0, 1.0 - Math.pow(d, 2.0));
  
  // Central bias to ensure a solid core
  const centralBias = Math.max(0, 0.4 * (1.0 - d * 2.0));
  
  // Final shape calculation - stronger falloff at the edges
  const islandValue = (n * radialMask) - (Math.pow(d, 5.0) * 0.8) + centralBias;
  
  const edgeThreshold = 0.12;
  const objectThreshold = 0.25;
  return islandValue > (isVegetation ? objectThreshold : edgeThreshold) ? 1 : 0;
}

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
]

const NEAR_GRASS_COUNT = 60000
const MID_GRASS_COUNT = 60000
const FAR_GRASS_COUNT = 50000
const GRASS_RANGE = 200
const ROCK_COUNT = 30

function Rocks({ seed, onRockData }: { seed: number, onRockData: (rocks: { x: number, z: number, radius: number }[]) => void }) {
  const rocks = useMemo(() => {
    const random = mulberry32(seed * 67890);
    const data = []
    let i = 0
    let attempts = 0
    while (i < ROCK_COUNT && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      // Check if inside island
      if (getIslandShape(x, z, seed, true) === 0) continue;

      const scaleX = 2 + random() * 4
      const scaleY = 1 + random() * 3
      const scaleZ = 2 + random() * 4
      
      const rotationY = random() * Math.PI * 2
      const rotationX = (random() - 0.5) * 0.4
      const rotationZ = (random() - 0.5) * 0.4
      
      const gray = 0.3 + random() * 0.2
      const color = new THREE.Color(gray, gray, gray)
      
      // Approximate radius for exclusion (using max horizontal scale)
      const exclusionRadius = Math.max(scaleX, scaleZ) * 0.8
      
      data.push({ x, z, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, color, radius: exclusionRadius })
      i++
    }
    onRockData(data.map(d => ({ x: d.x, z: d.z, radius: d.radius })))
    return data
  }, [seed, onRockData])

  return (
    <group>
      {rocks.map((rock, i) => (
        <RigidBody key={i} type="fixed" colliders="hull" position={[rock.x, rock.scaleY / 2 - 0.6, rock.z]} rotation={[rock.rotationX, rock.rotationY, rock.rotationZ]}>
          <mesh castShadow receiveShadow>
            <dodecahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color={rock.color} roughness={0.9} />
          </mesh>
          <mesh scale={[rock.scaleX, rock.scaleY, rock.scaleZ]}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={rock.color} roughness={0.9} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  )
}

function Grass({ seed, playerRef, rockData, gameState }: { seed: number, playerRef: React.RefObject<THREE.Group | null>, rockData: { x: number, z: number, radius: number }[], gameState: 'preview' | 'playing' }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const nearMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const midMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const farMaterialRef = useRef<THREE.ShaderMaterial>(null)

  const grassData = useMemo(() => {
    const random = mulberry32(seed * 12345);
    const near = []
    const mid = []
    const far = []
    
    // Total count is now 170,000 (increased for fullness, but with 3-tier LOD and stochastic culling)
    let i = 0;
    let attempts = 0;
    const totalDesired = NEAR_GRASS_COUNT + MID_GRASS_COUNT + FAR_GRASS_COUNT;
    while (i < totalDesired && attempts < totalDesired * 4) {
      attempts++;
      // Use square root for uniform distribution in a circle
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      // Check if inside island - use a slightly more conservative check for grass
      if (getIslandShape(x, z, seed, true) === 0) continue;

      // Check for rock collision
      let tooClose = false;
      for (const rock of rockData) {
        const dx = x - rock.x;
        const dz = z - rock.z;
        if (dx*dx + dz*dz < rock.radius * rock.radius) {
          tooClose = true;
          break;
        }
      }
      
      if (tooClose) continue;

      const scaleY = 0.5 + random() * 0.7
      const scaleXZ = 0.45 + random() * 0.55
      const rotation = random() * Math.PI
      
      const h = 80 + random() * 60
      const s = 40 + random() * 40
      const l = 25 + random() * 25
      const color = new THREE.Color(`hsl(${h}, ${s}%, ${l}%)`)
      
      const lean = random() * 0.7
      const leanDirection = random() * Math.PI * 2
      
      const item = { x, z, scaleY, scaleXZ, rotation, color, lean, leanDirection }
      
      if (i < NEAR_GRASS_COUNT) {
        near.push(item)
      } else if (i < NEAR_GRASS_COUNT + MID_GRASS_COUNT) {
        mid.push(item)
      } else {
        far.push(item)
      }
      i++;
    }
    return { near, mid, far }
  }, [seed, rockData])

  const { nearGeometry, midGeometry, farGeometry, grassShader } = useMemo(() => {
    // Helper to create tapered plane geometry
    const createTaperedGeo = (segments: number) => {
      const geo = new THREE.PlaneGeometry(0.8, 1, 1, segments)
      geo.translate(0, 0.5, 0)
      const pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i)
        const taper = 1.0 - Math.pow(y, 1.2)
        pos.setX(i, pos.getX(i) * taper)
        pos.setZ(i, pos.getZ(i) + Math.pow(y, 1.5) * 0.3)
      }
      return geo
    }

    const nearGeo = createTaperedGeo(3)
    const midGeo = createTaperedGeo(2)
    const farGeo = createTaperedGeo(1)

    const shader = {
      uniforms: {
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector3() },
        uCameraPos: { value: new THREE.Vector3() },
        uProjectionMatrix: { value: new THREE.Matrix4() },
        uViewMatrix: { value: new THREE.Matrix4() },
        uIsPreview: { value: gameState === 'preview' ? 1.0 : 0.0 },
        ...THREE.UniformsLib.fog,
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vInstanceColor;
        // varying vec3 vWorldPosition;
        uniform float uTime;
        uniform vec3 uPlayerPos;
        uniform vec3 uCameraPos;
        uniform mat4 uProjectionMatrix;
        uniform mat4 uViewMatrix;
        uniform float uIsPreview;
        // #include <fog_pars_vertex>
        
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
          float margin = 200.0;
          if (abs(clipPos.x) > clipPos.w + margin || abs(clipPos.y) > clipPos.w + margin) {
             gl_Position = vec4(0.0);
             return;
          }

          float distToCamera = distance(worldInstancePos, uCameraPos);
          float maxDist = uIsPreview > 0.5 ? 400.0 : 100.0;
          float extremeDist = uIsPreview > 0.5 ? 500.0 : 180.0;
          
          // Optimization: Progressive density reduction for far grass
          // We use a pseudo-random value based on instance position to decide if we cull
          float h = hash(worldInstancePos.xz);
          
          // Smoothly reduce density from 40% of maxDist up to extremeDist
          // Near/Mid distance: full density
          // Far distance (maxDist): significantly reduced density
          // Extreme distance: very low density (background layer)
          float densityThreshold = smoothstep(extremeDist, maxDist * 0.3, distToCamera);
          
          if (distToCamera > extremeDist) {
            gl_Position = vec4(0.0);
            return;
          }

          // Reduce density in preview mode or when far away in playing mode
          if (uIsPreview > 0.5) {
            gl_Position = vec4(0.0);
            return;
          }
          
          float threshold = densityThreshold + 0.15;
          if (h > threshold) {
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

          // Smoothly fade out to transparent/ground color at extreme distances
          float fadeOut = 1.0 - smoothstep(extremeDist * 0.7, extremeDist, distToCamera);
          // pos *= fadeOut; // Temporarily disable scale-based fading to ensure visibility

          vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
          // vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
          
          // Force apply fadeOut to gl_Position if needed, or just let fog handle it
          // gl_Position.xyz *= fadeOut; 
          
          // #include <fog_vertex>
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vInstanceColor;
        // varying vec3 vWorldPosition;
        uniform float uIsPreview;
        // #include <fog_pars_fragment>
        
        void main() {
          // Simplified lighting/shading
          vec3 baseColor = vInstanceColor * 0.2;
          vec3 tipColor = mix(vInstanceColor, vec3(0.9, 1.0, 0.4), 0.4);
          vec3 finalColor = mix(baseColor, tipColor, vUv.y);
          
          // Sub-surface scattering approximation
          float translucency = vUv.y * vUv.y * 0.4;
          finalColor += vec3(0.4, 0.5, 0.1) * translucency;
          
          // Side shading for volume
          finalColor *= (0.5 + vUv.x * 0.5);
          
          // Tip highlight
          float highlight = smoothstep(0.4, 0.5, vUv.x) * smoothstep(0.6, 0.5, vUv.x);
          finalColor += highlight * vUv.y * 0.1;
          
          gl_FragColor = vec4(finalColor, 1.0);
          // #include <fog_fragment>
        }
      `,
      fog: false,
    }
    return { nearGeometry: nearGeo, midGeometry: midGeo, farGeometry: farGeo, grassShader: shader }
  }, [seed, gameState])

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

    const projMatrix = state.camera.projectionMatrix
    const viewMatrix = state.camera.matrixWorldInverse

    if (nearMaterialRef.current) {
      nearMaterialRef.current.uniforms.uTime.value = time
      nearMaterialRef.current.uniforms.uCameraPos.value.copy(cameraPos)
      nearMaterialRef.current.uniforms.uPlayerPos.value.copy(playerPos)
      nearMaterialRef.current.uniforms.uProjectionMatrix.value.copy(projMatrix)
      nearMaterialRef.current.uniforms.uViewMatrix.value.copy(viewMatrix)
      nearMaterialRef.current.uniforms.uIsPreview.value = gameState === 'preview' ? 1.0 : 0.0
    }
    if (midMaterialRef.current) {
      midMaterialRef.current.uniforms.uTime.value = time
      midMaterialRef.current.uniforms.uCameraPos.value.copy(cameraPos)
      midMaterialRef.current.uniforms.uPlayerPos.value.copy(playerPos)
      midMaterialRef.current.uniforms.uProjectionMatrix.value.copy(projMatrix)
      midMaterialRef.current.uniforms.uViewMatrix.value.copy(viewMatrix)
      midMaterialRef.current.uniforms.uIsPreview.value = gameState === 'preview' ? 1.0 : 0.0
    }
    if (farMaterialRef.current) {
      farMaterialRef.current.uniforms.uTime.value = time
      farMaterialRef.current.uniforms.uCameraPos.value.copy(cameraPos)
      farMaterialRef.current.uniforms.uPlayerPos.value.copy(playerPos)
      farMaterialRef.current.uniforms.uProjectionMatrix.value.copy(projMatrix)
      farMaterialRef.current.uniforms.uViewMatrix.value.copy(viewMatrix)
      farMaterialRef.current.uniforms.uIsPreview.value = gameState === 'preview' ? 1.0 : 0.0
    }
  })

  return (
    <group>
      <instancedMesh ref={setNearInstances} args={[nearGeometry, undefined, NEAR_GRASS_COUNT]} castShadow receiveShadow frustumCulled={false}>
        <shaderMaterial
          ref={nearMaterialRef}
          attach="material"
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
          fog={true}
        />
      </instancedMesh>
      <instancedMesh ref={setMidInstances} args={[midGeometry, undefined, MID_GRASS_COUNT]} castShadow receiveShadow frustumCulled={false}>
        <shaderMaterial
          ref={midMaterialRef}
          attach="material"
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
          fog={true}
        />
      </instancedMesh>
      <instancedMesh ref={setFarInstances} args={[farGeometry, undefined, FAR_GRASS_COUNT]} castShadow receiveShadow frustumCulled={false}>
        <shaderMaterial
          ref={farMaterialRef}
          attach="material"
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
          fog={true}
        />
      </instancedMesh>
    </group>
  )
}

function Flowers({ seed, rockData, gameState }: { seed: number, rockData: { x: number, z: number, radius: number }[], gameState: 'preview' | 'playing' }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const FLOWER_COUNT = 400

  const flowerData = useMemo(() => {
    const random = mulberry32(seed * 98765);
    const data = []
    const colors = ['#ff69b4', '#ffffff', '#ffff00', '#add8e6', '#dda0dd']
    let i = 0;
    let attempts = 0;
    while (i < FLOWER_COUNT && attempts < 1000) {
      attempts++;
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)

      // Check if inside island - use a slightly more conservative check for flowers
      if (getIslandShape(x, z, seed, true) === 0 || gameState === 'preview') continue;

      // Check for rock collision
      let tooClose = false;
      for (const rock of rockData) {
        const dx = x - rock.x;
        const dz = z - rock.z;
        if (dx*dx + dz*dz < rock.radius * rock.radius) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const color = new THREE.Color(colors[Math.floor(random() * colors.length)])
      data.push({ x, z, color })
      i++;
    }
    return data
  }, [seed, rockData])

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
        if (distToCamera > 140.0) {
          gl_Position = vec4(0.0);
          return;
        }
        
        // Gentle sway
        vec3 pos = position;
        pos.x += sin(uTime + worldInstancePos.x) * 0.1 * uv.y;
        
        // Fade out flowers
        float flowerFade = 1.0 - smoothstep(100.0, 140.0, distToCamera);
        pos *= flowerFade;
        
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(pos, 1.0);
        // #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        // #include <fog_fragment>
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
      <shaderMaterial ref={materialRef} attach="material" args={[flowerShader]} vertexColors />
    </instancedMesh>
  )
}

function IslandGround({ seed, gameState }: { seed: number, gameState: 'preview' | 'playing' }) {
  const shader = useMemo(() => ({
    uniforms: {
      uSeed: { value: seed },
      uRange: { value: GRASS_RANGE },
      uIsPreview: { value: gameState === 'preview' ? 1.0 : 0.0 },
      ...THREE.UniformsLib.fog,
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      // #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        // #include <fog_vertex>
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      uniform float uSeed;
      uniform float uRange;
      uniform float uIsPreview;
      // #include <fog_pars_fragment>

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

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p * frequency + uSeed);
          frequency *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        float x = vWorldPos.x;
        float z = vWorldPos.z;
        float maxR = uRange / 2.0;
        
        // Normalize coordinates for FBM
        vec2 np = vWorldPos.xz / maxR;
        
        // Domain warping for more interesting shapes (Matching TS logic)
        float warpScale = 0.8;
        float qx = fbm(np * warpScale + 12.3);
        float qz = fbm(np * warpScale + vec2(5.2, 1.3) + 45.6);
        
        vec2 warpedNp = np + vec2(qx, qz) * 0.4;
        
        float islandScale = 1.5;
        float n = fbm(warpedNp * 1.8) * islandScale;
        
        // Distance from center falloff using warped coordinates
        float d = length(warpedNp);
        float radialMask = max(0.0, 1.0 - pow(d, 2.0));
        float centralBias = max(0.0, 0.4 * (1.0 - d * 2.0));
        float islandValue = (n * radialMask) - (pow(d, 5.0) * 0.8) + centralBias;
        
        // Ground color with some subtle variation
        float detail = noise(vWorldPos.xz * 0.2);
        vec3 grassColor = mix(vec3(0.17, 0.35, 0.15), vec3(0.2, 0.4, 0.18), detail);
        vec3 sandColor = mix(vec3(0.76, 0.7, 0.5), vec3(0.8, 0.75, 0.55), detail);
        vec3 oceanColor = vec3(0.0, 0.44, 0.62);

        // Define zones: Island center -> Grass -> Sand -> Ocean
        float edgeThreshold = 0.12;
        float beachWidth = 0.12;
        
        // Smooth transitions between zones
        float sandMask = smoothstep(edgeThreshold - 0.05, edgeThreshold + 0.05, islandValue);
        float grassMask = smoothstep(edgeThreshold + beachWidth - 0.05, edgeThreshold + beachWidth + 0.05, islandValue);
        
        vec3 finalGroundColor = mix(sandColor, grassColor, grassMask);
        vec3 color = mix(oceanColor, finalGroundColor, sandMask);
        
        // Discard or alpha-blend edges of the 200x200 plane to reveal the infinite ocean below
        float alpha = smoothstep(0.9, 0.8, d); // d is distance from center in normalized units
        if (alpha < 0.01) discard;
      
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    fog: false,
  }), [seed, gameState])

  return (
    <RigidBody type="fixed">
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[GRASS_RANGE, GRASS_RANGE]} />
        <shaderMaterial attach="material" args={[shader]} fog={false} />
      </mesh>
    </RigidBody>
  )
}

function Ocean() {
  const shader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;

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
        vec2 uv = vUv * 1000.0;
        float n = noise(uv + uTime * 0.2);
        vec3 baseColor = vec3(0.0, 0.44, 0.62);
        vec3 shallowColor = vec3(0.0, 0.55, 0.7);
        vec3 color = mix(baseColor, shallowColor, n * 0.2);
        gl_FragColor = vec4(color, 1.0);
      }
    `
  }), [])

  useFrame((state) => {
    if (shader.uniforms.uTime) {
      shader.uniforms.uTime.value = state.clock.elapsedTime
    }
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]}>
      <circleGeometry args={[2000, 32]} />
      <shaderMaterial attach="material" args={[shader]} />
    </mesh>
  )
}

export function Scene({ seed, playerRef, gameState }: { seed: number, playerRef: React.RefObject<THREE.Group | null>, gameState: 'preview' | 'playing' }) {
  const [rockData, setRockData] = useState<{ x: number, z: number, radius: number }[]>([])
  
  return (
    <KeyboardControls map={keyboardMap}>
      <Canvas shadows camera={{ position: [0, 150, 150], fov: 60 }} gl={{ antialias: true }}>
        <color attach="background" args={["#87ceeb"]} />
        {/* {gameState === 'playing' ? (
          <fog attach="fog" args={["#87ceeb", 20, 160]} />
        ) : (
          <fog attach="fog" args={["#87ceeb", 300, 500]} />
        )} */}
        {gameState === 'playing' && <PointerLockControls pointerSpeed={4} />}
        <Sky sunPosition={[100, 20, 100]} turbidity={0.1} rayleigh={0.5} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        <Environment preset="park" />
        
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[50, 50, 50]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
        />
        
        <Physics gravity={[0, -9.81, 0]} interpolate={false}>
          <Player ref={playerRef} gameState={gameState} />
          
          <IslandGround seed={seed} gameState={gameState} />
          <Ocean />

          <Rocks seed={seed} onRockData={setRockData} />
          <Grass seed={seed} playerRef={playerRef} rockData={rockData} gameState={gameState} />
          <Flowers seed={seed} rockData={rockData} gameState={gameState} />
        </Physics>

        <ContactShadows
          opacity={0.4}
          scale={GRASS_RANGE}
          blur={1.5}
          far={10}
          resolution={256}
          color="#1a3317"
        />
      </Canvas>
    </KeyboardControls>
  )
}
