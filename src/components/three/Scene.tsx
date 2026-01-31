import { useMemo, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { KeyboardControls, Sky, Stars, ContactShadows, PointerLockControls, Environment } from "@react-three/drei"
import { Physics, RigidBody } from "@react-three/rapier"
import * as THREE from "three"
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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

function getIslandShape(x: number, z: number, seed: number, isVegetation = false, returnRawValue = false) {
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
  
  if (returnRawValue) return islandValue;
  
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
  { name: "run", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "action", keys: ["KeyE", "KeyF"] },
]

const NEAR_GRASS_COUNT = 30000
const MID_GRASS_COUNT = 40000
const FAR_GRASS_COUNT = 40000
const GRASS_RANGE = 200
const ROCK_COUNT = 30
const PALM_COUNT = 30
const BUSH_COUNT = 40
const FERN_COUNT = 50
const BAMBOO_COUNT = 15
const DRIFTWOOD_COUNT = 15
const STARFISH_COUNT = 30
const SHELL_COUNT = 40
const CRAB_COUNT = 20
const BUOY_COUNT = 8
const TOTEM_COUNT = 5
const TORCH_COUNT = 6

function Bushes({ seed, rockData, palmData }: { seed: number, rockData: { x: number, z: number, radius: number }[], palmData: { x: number, z: number, radius: number }[] }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const materialRef = useRef<THREE.ShaderMaterial>(null)

  // Create a clustered bush geometry
  const bushGeometry = useMemo(() => {
    const geometries = []
    const random = mulberry32(12345) // Fixed seed for geometry structure
    
    // Center main clump
    const center = new THREE.IcosahedronGeometry(1, 1)
    geometries.push(center)
    
    // Add 3-5 smaller clumps around
    const clumpCount = 3 + Math.floor(random() * 3)
    for (let i = 0; i < clumpCount; i++) {
      const angle = (i / clumpCount) * Math.PI * 2 + random() * 0.5
      const dist = 0.5 + random() * 0.3
      const scale = 0.5 + random() * 0.4
      
      const clump = new THREE.IcosahedronGeometry(scale, 1)
      clump.translate(
        Math.cos(angle) * dist,
        (random() - 0.5) * 0.3,
        Math.sin(angle) * dist
      )
      geometries.push(clump)
    }
    
    const merged = BufferGeometryUtils.mergeGeometries(geometries)
    // Add some random vertex jitter for more organic look
    const pos = merged.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      
      // Use vertex position as seed for deterministic jitter
      const jitter = 0.05
      pos.setXYZ(i, 
        x + (Math.sin(x * 10.0 + y * 5.0) * jitter),
        y + (Math.cos(y * 10.0 + z * 5.0) * jitter),
        z + (Math.sin(z * 10.0 + x * 5.0) * jitter)
      )
    }
    merged.computeVertexNormals()
    return merged
  }, [])

  const bushes = useMemo(() => {
    const random = mulberry32(seed * 44444);
    const data: { x: number, z: number, scale: number, rotationY: number }[] = []
    let i = 0
    let attempts = 0
    while (i < BUSH_COUNT && attempts < 2000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)

      if (getIslandShape(x, z, seed, true) === 0) continue;

      const scale = 0.8 + random() * 1.2
      const radius = scale * 1.2;

      let tooClose = false;
      for (const rock of rockData) {
        if (Math.hypot(x - rock.x, z - rock.z) < rock.radius + radius) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      for (const palm of palmData) {
        if (Math.hypot(x - palm.x, z - palm.z) < palm.radius + radius) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      for (const bush of data) {
        if (Math.hypot(x - bush.x, z - bush.z) < radius * 2) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const rotationY = random() * Math.PI * 2
      
      data.push({ x, z, scale, rotationY })
      i++
    }
    return data
  }, [seed, rockData, palmData])

  const shader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vInstanceColor;
      varying float vY;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      uniform float uTime;
      
      void main() {
        vUv = uv;
        vInstanceColor = instanceColor;
        vY = position.y;
        vNormal = normalize(normalMatrix * (instanceMatrix * vec4(normal, 0.0)).xyz);
        
        vec3 pos = position;
        
        // Dynamic sway - stronger at the top
        vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float swayTime = uTime * 1.5 + instancePosition.x * 0.1 + instancePosition.z * 0.1;
        float heightFactor = max(0.0, pos.y + 0.8);
        float sway = sin(swayTime) * 0.12 * heightFactor;
        pos.x += sway;
        pos.z += sin(swayTime * 0.7) * 0.08 * heightFactor;
        
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vInstanceColor;
      varying float vY;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      void main() {
        // Simple alpha discard for toon leaf shape based on UV
        float leafShape = sin(vUv.x * 30.0) * sin(vUv.y * 30.0);
        if (leafShape < -0.5) discard;

        // Main color with vertical gradient
        vec3 baseColor = mix(vInstanceColor * 0.5, vInstanceColor * 1.1, vY + 0.6);
        
        // Procedural leafy pattern (stepping for toon look)
        float noise = sin(vUv.x * 30.0 + vY * 10.0) * sin(vUv.y * 30.0);
        float leafStep = smoothstep(-0.2, 0.2, noise);

        vec3 color = mix(baseColor * 0.9, baseColor, leafStep);
        
        // Simple toon shading / rim light
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float rim = 1.0 - max(0.0, dot(normal, viewDir));
        rim = pow(rim, 3.0);
        color += rim * 0.3 * vInstanceColor;

        // Subtle top highlight
        float topHighlight = smoothstep(0.3, 1.0, vY);
        color = mix(color, color * 1.2, topHighlight * 0.2);
        
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }), [])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    const random = mulberry32(seed * 33333);
    bushes.forEach((bush, i) => {
      dummy.position.set(bush.x, bush.scale * 0.5, bush.z)
      dummy.rotation.set(0, bush.rotationY, 0)
      dummy.scale.set(bush.scale, bush.scale, bush.scale)
      
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      
      // Slightly more varied tropical greens
      const bushColor = new THREE.Color().setHSL(0.2 + random() * 0.12, 0.6, 0.25 + random() * 0.2);
      mesh.setColorAt(i, bushColor)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
    }
  })

  return (
    <instancedMesh ref={setInstances} args={[bushGeometry, undefined, bushes.length]} castShadow receiveShadow>
      <shaderMaterial 
        ref={materialRef} 
        args={[shader]} 
        vertexColors 
        alphaTest={0.5}
        transparent={false}
        depthWrite={true}
        depthTest={true}
      />
    </instancedMesh>
  )
}

function Coconuts({ seed, palmData }: { seed: number, palmData: { x: number, z: number, height: number }[] }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#4e342e", roughness: 0.8 }), [])
  const geometry = useMemo(() => new THREE.SphereGeometry(0.25, 8, 8), [])

  const coconuts = useMemo(() => {
    if (palmData.length === 0) return []
    const random = mulberry32(seed * 777)
    const data: { x: number, z: number, scale: number }[] = []
    
    palmData.forEach(palm => {
      const count = 1 + Math.floor(random() * 3)
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2
        const dist = 0.5 + random() * 1.5
        data.push({
          x: palm.x + Math.cos(angle) * dist,
          z: palm.z + Math.sin(angle) * dist,
          scale: 0.8 + random() * 0.4
        })
      }
    })
    return data
  }, [seed, palmData])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    coconuts.forEach((coco, i) => {
      dummy.position.set(coco.x, -0.3, coco.z)
      dummy.scale.set(coco.scale, coco.scale, coco.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  if (coconuts.length === 0) return null

  return (
    <instancedMesh ref={setInstances} args={[geometry, material, coconuts.length]} castShadow receiveShadow />
  )
}

function Ferns({ seed, rockData, palmData }: { seed: number, rockData: { x: number, z: number, radius: number }[], palmData: { x: number, z: number, radius: number }[] }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const fernGeometry = useMemo(() => {
    const geometries = []
    const leafCount = 8
    for (let i = 0; i < leafCount; i++) {
      const geo = new THREE.PlaneGeometry(0.5, 1.5, 1, 4)
      geo.translate(0, 0.75, 0)
      const angle = (i / leafCount) * Math.PI * 2
      geo.rotateX(Math.PI * 0.3)
      geo.rotateY(angle)
      geometries.push(geo)
    }
    const merged = BufferGeometryUtils.mergeGeometries(geometries)
    merged.computeVertexNormals()
    return merged
  }, [])

  const ferns = useMemo(() => {
    const random = mulberry32(seed * 888)
    const data: { x: number, z: number, rotationY: number, scale: number }[] = []
    let i = 0
    let attempts = 0
    while (i < FERN_COUNT && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      if (getIslandShape(x, z, seed, true) === 0) continue

      const scale = 0.6 + random() * 0.6
      const radius = scale * 1.5

      let tooClose = false
      for (const rock of rockData) {
        if (Math.hypot(x - rock.x, z - rock.z) < rock.radius + radius) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      for (const palm of palmData) {
        if (Math.hypot(x - palm.x, z - palm.z) < palm.radius + radius) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      for (const fern of data) {
        if (Math.hypot(x - fern.x, z - fern.z) < radius * 2) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      data.push({ x, z, rotationY: random() * Math.PI * 2, scale })
      i++
    }
    return data
  }, [seed, rockData, palmData])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    ferns.forEach((fern, i) => {
      dummy.position.set(fern.x, -0.45, fern.z)
      dummy.rotation.set(0, fern.rotationY, 0)
      dummy.scale.set(fern.scale, fern.scale, fern.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <instancedMesh ref={setInstances} args={[fernGeometry, undefined, ferns.length]} castShadow>
      <meshStandardMaterial 
        color="#2d5a27" 
        side={THREE.DoubleSide} 
        roughness={0.8} 
        alphaTest={0.5} 
        transparent={false}
        depthWrite={true}
        depthTest={true}
      />
    </instancedMesh>
  )
}

function Bamboo({ seed, rockData, palmData }: { seed: number, rockData: { x: number, z: number, radius: number }[], palmData: { x: number, z: number, radius: number }[] }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const bambooGeometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.1, 0.1, 5, 6, 5)
    geo.translate(0, 2.5, 0)
    return geo
  }, [])

  const thickets = useMemo(() => {
    const random = mulberry32(seed * 999)
    const data: { x: number, z: number, height: number, rotationY: number, lean: number }[] = []
    let i = 0
    let attempts = 0
    while (i < BAMBOO_COUNT && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.5)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      if (getIslandShape(x, z, seed, true) === 0) continue

      let tooClose = false
      for (const rock of rockData) {
        if (Math.hypot(x - rock.x, z - rock.z) < rock.radius + 2) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      for (const palm of palmData) {
        if (Math.hypot(x - palm.x, z - palm.z) < palm.radius + 2) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      const clusterSize = 5 + Math.floor(random() * 8)
      for (let j = 0; j < clusterSize; j++) {
        const ox = (random() - 0.5) * 2
        const oz = (random() - 0.5) * 2
        data.push({
          x: x + ox,
          z: z + oz,
          height: 0.8 + random() * 0.4,
          rotationY: random() * Math.PI,
          lean: (random() - 0.5) * 0.1
        })
      }
      i++
    }
    return data
  }, [seed, rockData, palmData])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    thickets.forEach((b, i) => {
      dummy.position.set(b.x, -0.5, b.z)
      dummy.rotation.set(b.lean, b.rotationY, 0)
      dummy.scale.set(1, b.height, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <instancedMesh ref={setInstances} args={[bambooGeometry, undefined, thickets.length]} castShadow>
      <meshStandardMaterial color="#4f7942" roughness={0.6} />
    </instancedMesh>
  )
}

function SandMounds({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const geometry = useMemo(() => new THREE.SphereGeometry(2, 16, 8), [])
  
  const mounds = useMemo(() => {
    const random = mulberry32(seed * 111)
    const data = []
    let i = 0
    let attempts = 0
    while (i < 30 && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.1)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      // Only place on sand (low island value)
      const islandVal = getIslandShape(x, z, seed, false, true) as number
      if (islandVal > 0.15 || islandVal < 0.05) continue

      data.push({ x, z, scaleX: 1 + random() * 2, scaleY: 0.2 + random() * 0.3, scaleZ: 1 + random() * 2 })
      i++
    }
    return data
  }, [seed])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    mounds.forEach((m, i) => {
      dummy.position.set(m.x, -0.6, m.z)
      dummy.scale.set(m.scaleX, m.scaleY, m.scaleZ)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <instancedMesh ref={setInstances} args={[geometry, undefined, mounds.length]} receiveShadow>
      <meshStandardMaterial color="#d2b48c" roughness={1} />
    </instancedMesh>
  )
}

function Driftwood({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const geometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.2, 0.2, 2, 6, 4)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      pos.setX(i, pos.getX(i) + Math.sin(y * 2) * 0.3)
    }
    geo.rotateZ(Math.PI / 2)
    return geo
  }, [])
  
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a89080", roughness: 0.9 }), [])

  const wood = useMemo(() => {
    const random = mulberry32(seed * 222)
    const data = []
    let i = 0
    let attempts = 0
    while (i < DRIFTWOOD_COUNT && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.1)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      const islandVal = getIslandShape(x, z, seed, false, true) as number
      if (islandVal > 0.12 || islandVal < 0.05) continue

      data.push({ x, z, rotationY: random() * Math.PI * 2, scale: 0.8 + random() * 0.5 })
      i++
    }
    return data
  }, [seed])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    wood.forEach((w, i) => {
      dummy.position.set(w.x, -0.45, w.z)
      dummy.rotation.set(0, w.rotationY, 0)
      dummy.scale.set(w.scale, w.scale, w.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <instancedMesh ref={setInstances} args={[geometry, material, wood.length]} castShadow receiveShadow />
  )
}

function BeachDecor({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const starfishGeo = useMemo(() => new THREE.SphereGeometry(0.15, 5, 2), [])
  const shellGeo = useMemo(() => new THREE.IcosahedronGeometry(0.1, 0), [])
  
  const decor = useMemo(() => {
    const random = mulberry32(seed * 333)
    const starfish = []
    const shells = []
    
    let i = 0
    let attempts = 0
    while (i < STARFISH_COUNT && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.1)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      const islandVal = getIslandShape(x, z, seed, false, true) as number
      if (islandVal > 0.1 || islandVal < 0.02) continue
      starfish.push({ x, z, color: ["#ff6347", "#ffa500", "#ff69b4"][Math.floor(random() * 3)], rot: random() * Math.PI })
      i++
    }
    
    i = 0
    attempts = 0
    while (i < SHELL_COUNT && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.1)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      const islandVal = getIslandShape(x, z, seed, false, true) as number
      if (islandVal > 0.12 || islandVal < 0.02) continue
      shells.push({ x, z, rotX: random() * Math.PI, rotY: random() * Math.PI })
      i++
    }
    return { starfish, shells }
  }, [seed])

  const setStarfish = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    decor.starfish.forEach((s, i) => {
      dummy.position.set(s.x, -0.55, s.z)
      dummy.rotation.set(0, s.rot, 0)
      dummy.scale.set(1, 0.2, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, new THREE.Color(s.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  const setShells = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    decor.shells.forEach((s, i) => {
      dummy.position.set(s.x, -0.58, s.z)
      dummy.rotation.set(s.rotX, s.rotY, 0)
      dummy.scale.set(1, 0.6, 1.2)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <group>
      <instancedMesh ref={setStarfish} args={[starfishGeo, undefined, decor.starfish.length]}>
        <meshStandardMaterial roughness={0.5} vertexColors />
      </instancedMesh>
      <instancedMesh ref={setShells} args={[shellGeo, undefined, decor.shells.length]}>
        <meshStandardMaterial color="#fff5ee" roughness={0.4} />
      </instancedMesh>
    </group>
  )
}


function WaterObjects({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const buoyGeo = useMemo(() => {
    const geometries = []
    const top = new THREE.ConeGeometry(0.3, 0.6, 8)
    top.translate(0, 0.3, 0)
    geometries.push(top)
    const bottom = new THREE.SphereGeometry(0.3, 8, 4)
    bottom.translate(0, -0.1, 0)
    geometries.push(bottom)
    return BufferGeometryUtils.mergeGeometries(geometries)
  }, [])
  
  const crateGeo = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), [])

  const objects = useMemo(() => {
    const random = mulberry32(seed * 555)
    const buoys = []
    const crates = []
    
    for (let i = 0; i < BUOY_COUNT; i++) {
      const angle = random() * Math.PI * 2
      const dist = 50 + random() * 50
      buoys.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, phase: random() * Math.PI * 2 })
    }
    
    for (let i = 0; i < 15; i++) {
      const angle = random() * Math.PI * 2
      const dist = 40 + random() * 20
      crates.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, phase: random() * Math.PI * 2, rot: random() * Math.PI })
    }
    return { buoys, crates }
  }, [seed])

  const buoyRef = useRef<THREE.InstancedMesh>(null)
  const crateRef = useRef<THREE.InstancedMesh>(null)

  useFrame((state) => {
    const time = state.clock.elapsedTime
    if (buoyRef.current) {
      objects.buoys.forEach((b, i) => {
        dummy.position.set(b.x, -0.7 + Math.sin(time + b.phase) * 0.1, b.z)
        dummy.rotation.set(Math.sin(time + b.phase) * 0.2, 0, Math.cos(time + b.phase) * 0.2)
        dummy.updateMatrix()
        buoyRef.current!.setMatrixAt(i, dummy.matrix)
      })
      buoyRef.current.instanceMatrix.needsUpdate = true
    }
    if (crateRef.current) {
      objects.crates.forEach((c, i) => {
        dummy.position.set(c.x, -0.8 + Math.sin(time * 0.8 + c.phase) * 0.05, c.z)
        dummy.rotation.set(Math.sin(time * 0.5 + c.phase) * 0.1, c.rot + time * 0.1, 0)
        dummy.updateMatrix()
        crateRef.current!.setMatrixAt(i, dummy.matrix)
      })
      crateRef.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <instancedMesh ref={buoyRef} args={[buoyGeo, undefined, objects.buoys.length]} castShadow>
        <meshStandardMaterial color="#ff4500" roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={crateRef} args={[crateGeo, undefined, objects.crates.length]} castShadow>
        <meshStandardMaterial color="#8b4513" roughness={0.8} />
      </instancedMesh>
    </group>
  )
}

function Crabs({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.3, 0.1, 0.2)
    return geo
  }, [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff4500", roughness: 0.5 }), [])

  const crabs = useMemo(() => {
    const random = mulberry32(seed * 666)
    const data = []
    let i = 0
    let attempts = 0
    while (i < CRAB_COUNT && attempts < 1000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.1)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      const islandVal = getIslandShape(x, z, seed, false, true) as number
      if (islandVal > 0.08 || islandVal < 0.02) continue
      data.push({ x, z, rot: random() * Math.PI * 2, phase: random() * Math.PI * 2 })
      i++
    }
    return data
  }, [seed])

  const meshRef = useRef<THREE.InstancedMesh>(null)

  useFrame((state) => {
    const time = state.clock.elapsedTime
    if (meshRef.current) {
      crabs.forEach((c, i) => {
        const move = Math.sin(time * 2 + c.phase) * 0.2
        dummy.position.set(c.x + Math.cos(c.rot) * move, -0.6, c.z + Math.sin(c.rot) * move)
        dummy.rotation.set(0, c.rot, 0)
        dummy.updateMatrix()
        meshRef.current!.setMatrixAt(i, dummy.matrix)
      })
      meshRef.current.instanceMatrix.needsUpdate = true
    }
  })

  return <instancedMesh ref={meshRef} args={[geometry, material, crabs.length]} castShadow />
}

function AncientTotems({ seed }: { seed: number }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const geometry = useMemo(() => {
    const geometries = []
    const base = new THREE.BoxGeometry(1, 2, 0.8)
    base.translate(0, 1, 0)
    geometries.push(base)
    const nose = new THREE.BoxGeometry(0.2, 0.5, 0.2)
    nose.translate(0, 1.2, 0.5)
    geometries.push(nose)
    return BufferGeometryUtils.mergeGeometries(geometries)
  }, [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#696969", roughness: 0.9 }), [])

  const totems = useMemo(() => {
    const random = mulberry32(seed * 7777)
    const data = []
    let i = 0
    let attempts = 0
    while (i < TOTEM_COUNT && attempts < 1000) {
      attempts++
      const r = 10 + random() * 30
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      if (getIslandShape(x, z, seed, true) === 0) continue
      data.push({ x, z, rot: random() * Math.PI * 2 })
      i++
    }
    return data
  }, [seed])

  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    totems.forEach((t, i) => {
      dummy.position.set(t.x, -0.5, t.z)
      dummy.rotation.set(0, t.rot, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  return <instancedMesh ref={setInstances} args={[geometry, material, totems.length]} castShadow />
}

function Structures({ seed }: { seed: number }) {
  const random = useMemo(() => mulberry32(seed * 8888), [seed])
  const pos = useMemo(() => {
    let attempts = 0
    while (attempts < 100) {
      const x = (random() - 0.5) * 20
      const z = (random() - 0.5) * 20
      if (getIslandShape(x, z, seed, true) === 1) return { x, z }
      attempts++
    }
    return { x: 5, z: 5 }
  }, [seed, random])

  const fireRef = useRef<THREE.PointLight>(null)
  useFrame((state) => {
    if (fireRef.current) {
      fireRef.current.intensity = 1.5 + Math.sin(state.clock.elapsedTime * 10) * 0.5
    }
  })

  return (
    <group position={[pos.x, -0.5, pos.z]}>
      {/* Campfire */}
      <group>
        {[0, 1, 2, 3, 4].map(i => (
          <mesh key={i} position={[Math.cos(i * 1.2) * 0.5, 0.1, Math.sin(i * 1.2) * 0.5]} rotation={[0, i, 0]}>
            <boxGeometry args={[0.2, 0.1, 0.6]} />
            <meshStandardMaterial color="#4e342e" />
          </mesh>
        ))}
        <mesh position={[0, 0.3, 0]}>
          <coneGeometry args={[0.3, 0.6, 6]} />
          <meshStandardMaterial color="#ff4500" emissive="#ff4500" emissiveIntensity={2} transparent opacity={0.8} />
        </mesh>
        <pointLight ref={fireRef} color="#ff8c00" distance={10} decay={2} castShadow />
      </group>
      
      {/* Small Tent/Lean-to */}
      <mesh position={[2, 0.5, 0]} rotation={[0, -Math.PI / 4, 0]}>
        <coneGeometry args={[1.5, 2, 4]} />
        <meshStandardMaterial color="#a0522d" />
      </mesh>
    </group>
  )
}

function Torches({ seed }: { seed: number }) {
  const torches = useMemo(() => {
    const random = mulberry32(seed * 9999)
    const data = []
    for (let i = 0; i < TORCH_COUNT; i++) {
      const angle = (i / TORCH_COUNT) * Math.PI * 2
      const x = Math.cos(angle) * 15 + (random() - 0.5) * 5
      const z = Math.sin(angle) * 15 + (random() - 0.5) * 5
      data.push({ x, z })
    }
    return data
  }, [seed])

  return (
    <group>
      {torches.map((t, i) => (
        <group key={i} position={[t.x, -0.5, t.z]}>
          <mesh position={[0, 1, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 2]} />
            <meshStandardMaterial color="#4e342e" />
          </mesh>
          <mesh position={[0, 2.1, 0]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshStandardMaterial color="#ff4500" emissive="#ff4500" emissiveIntensity={2} />
          </mesh>
          <pointLight color="#ff8c00" intensity={0.5} distance={5} position={[0, 2.1, 0]} />
        </group>
      ))}
    </group>
  )
}

function AtmosphericEffects({ seed, gameState }: { seed: number, gameState: 'preview' | 'playing' }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const leafGeo = useMemo(() => new THREE.PlaneGeometry(0.1, 0.1), [])
  const leafMat = useMemo(() => new THREE.MeshStandardMaterial({ 
    color: "#2d5a27", 
    side: THREE.DoubleSide, 
    alphaTest: 0.5,
    transparent: false,
    depthWrite: true,
    depthTest: true
  }), [])
  
  const particleCount = gameState === 'preview' ? 400 : 800
  const particles = useMemo(() => {
    const random = mulberry32(seed * 123)
    const data: { x: number, y: number, z: number, speed: number, rotSpeed: number, phase: number }[] = []
    for (let i = 0; i < particleCount; i++) {
      data.push({
        x: (random() - 0.5) * GRASS_RANGE,
        y: 5 + random() * 10,
        z: (random() - 0.5) * GRASS_RANGE,
        speed: 0.5 + random() * 1,
        rotSpeed: random() * 2,
        phase: random() * Math.PI * 2
      })
    }
    return data
  }, [seed, particleCount])

  const leafRef = useRef<THREE.InstancedMesh>(null)
  const fireflyRef = useRef<THREE.Points>(null)

  const firefliesData = useMemo(() => {
    const count = gameState === 'preview' ? 100 : 250
    const positions = new Float32Array(count * 3)
    const random = mulberry32(seed * 456)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * GRASS_RANGE
      positions[i * 3 + 1] = random() * 3
      positions[i * 3 + 2] = (random() - 0.5) * GRASS_RANGE
    }
    return positions
  }, [seed, gameState])

  useFrame((state) => {
    const time = state.clock.elapsedTime
    if (leafRef.current) {
      particles.forEach((p, i) => {
        let y = p.y - (time * p.speed) % 15
        if (y < -0.5) y += 15
        const x = p.x + Math.sin(time + p.phase) * 2
        const z = p.z + Math.cos(time * 0.5 + p.phase) * 2
        dummy.position.set(x, y, z)
        dummy.rotation.set(time * p.rotSpeed, time * p.rotSpeed * 0.5, 0)
        dummy.updateMatrix()
        leafRef.current!.setMatrixAt(i, dummy.matrix)
      })
      leafRef.current.instanceMatrix.needsUpdate = true
    }
    
    if (fireflyRef.current) {
      const pos = fireflyRef.current.geometry.attributes.position.array as Float32Array
      const count = pos.length / 3
      for (let i = 0; i < count; i++) {
        pos[i * 3 + 1] += Math.sin(time + i) * 0.005
      }
      fireflyRef.current.geometry.attributes.position.needsUpdate = true
    }
  })

  return (
    <group>
      <instancedMesh ref={leafRef} args={[leafGeo, leafMat, particleCount]} />
      <points ref={fireflyRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={firefliesData.length / 3}
            array={firefliesData}
            itemSize={3}
            args={[firefliesData, 3]}
          />
        </bufferGeometry>
        <pointsMaterial size={0.15} color="#ffff00" transparent opacity={0.6} />
      </points>
    </group>
  )
}

function Palms({ seed, rockData, leafGeometry, onPalmData }: { seed: number, rockData: { x: number, z: number, radius: number }[], leafGeometry: THREE.BufferGeometry, onPalmData: (data: { x: number, z: number, height: number, radius: number }[]) => void }) {
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const trunkMaterialRef = useRef<THREE.ShaderMaterial>(null)
  const leafMaterialRef = useRef<THREE.ShaderMaterial>(null)
  
  const palms = useMemo(() => {
    const random = mulberry32(seed * 55555);
    const data = []
    let i = 0
    let attempts = 0
    while (i < PALM_COUNT && attempts < 2000) {
      attempts++
      const r = Math.sqrt(random()) * (GRASS_RANGE / 2.2)
      const theta = random() * 2 * Math.PI
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      
      if (getIslandShape(x, z, seed, true) === 0) continue;

      let tooClose = false;
      for (const rock of rockData) {
        const dx = x - rock.x;
        const dz = z - rock.z;
        if (dx*dx + dz*dz < (rock.radius + 2) * (rock.radius + 2)) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      for (const palm of data) {
        const dx = x - palm.x;
        const dz = z - palm.z;
        if (dx*dx + dz*dz < 49) { // 7 units apart
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const height = 4 + random() * 3
      const rotationY = random() * Math.PI * 2
      const leafCount = 12 + Math.floor(random() * 4)
      const trunkLean = (random() - 0.5) * 0.15
      const trunkLeanDir = random() * Math.PI * 2
      const radius = 2.5; // Radius for other objects to avoid
      
      data.push({ x, z, height, rotationY, trunkLean, trunkLeanDir, leafCount, radius })
      i++
    }
    // Report palm positions for coconuts and others
    onPalmData(data.map(p => ({ x: p.x, z: p.z, height: p.height, radius: p.radius })))
    return data
  }, [seed, rockData, onPalmData])

  const trunkShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float uTime;
      
      void main() {
        vUv = uv;
        
        vec3 pos = position;
        
        // Bend the trunk
        // We use pos.y as the height factor since cylinder is height 1 translated to start at 0
        float h = pos.y;
        float bend = pow(h, 2.0) * 1.2;
        pos.x += bend;
        
        // Slight sway
        vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float swayTime = uTime * 0.5 + instancePosition.x * 0.05 + instancePosition.z * 0.05;
        pos.x += sin(swayTime) * 0.1 * h;
        pos.z += cos(swayTime) * 0.1 * h;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        // Vertical gradient and ring detail
        vec3 color1 = vec3(0.36, 0.25, 0.22); // #5d4037
        vec3 color2 = vec3(0.31, 0.2, 0.18);  // #4e342e
        
        float ring = step(0.5, fract(vUv.y * 10.0));
        vec3 color = mix(color1, color2, ring);
        
        // Add some noise/texture based on UV
        color *= (0.9 + 0.2 * sin(vUv.x * 20.0));
        
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }), [])

  const leafShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vInstanceColor;
      uniform float uTime;
      
      void main() {
        vUv = uv;
        vInstanceColor = instanceColor;
        
        vec3 pos = position;
        
        // Taper the leaf geometry toward the tip
        // Now geo is translated by (0, 0.5, 0), so pos.y goes from 0 to 1
        float distAlong = pos.y; 
        float taper = 1.0 - distAlong * 0.8;
        pos.x *= taper;
        
        // Bend the leaf downward (quadratic)
        float bend = pow(distAlong, 1.5) * 5.0; 
        pos.z += bend;
        
        // Dynamic sway
        vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float swayTime = uTime * 1.5 + instancePosition.x * 0.1 + instancePosition.z * 0.1;
        float sway = sin(swayTime) * 0.15;
        float rustle = sin(uTime * 5.0 + instancePosition.y) * 0.02;
        
        pos.x += (sway + rustle) * distAlong;
        pos.z += (sway * 0.5) * distAlong;
        
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vInstanceColor;
      void main() {
        // Simple leaf shape discard
        float centerDist = abs(vUv.x - 0.5) * 2.0; // Normalized 0 to 1 from center
        float leafShape = smoothstep(1.0, 0.9, centerDist);
        if (vUv.y > 0.95 || leafShape < 0.1) discard;

        // Vertical gradient
        vec3 baseColor = vInstanceColor * 0.7;
        vec3 tipColor = vInstanceColor * 1.3;
        vec3 color = mix(baseColor, tipColor, vUv.y);
        
        // Mid-rib detail
        float midRib = 1.0 - smoothstep(0.0, 0.1, abs(vUv.x - 0.5));
        color *= (1.0 + midRib * 0.2);

        // Subtle fringe detail
        float fringe = sin(vUv.x * 60.0) * 0.05 * vUv.y;
        color += fringe;

        // Fake depth shading
        color *= (0.8 + 0.4 * centerDist);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }), [])

  const setTrunkInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    palms.forEach((palm, i) => {
      dummy.position.set(palm.x, -0.5, palm.z)
      dummy.rotation.set(palm.trunkLean, palm.trunkLeanDir, 0)
      dummy.scale.set(0.6, palm.height, 0.6) // Thicker: 0.6 instead of 0.4-0.2
      
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  const setLeafInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    const random = mulberry32(seed * 77777);
    let totalIdx = 0
    palms.forEach((palm) => {
      // In trunk shader: 
      // h = pos.y (0 to 1)
      // bend = pow(h, 2.0) * 1.2
      // pos.x += bend
      // Cylinder is scaled by (0.6, palm.height, 0.6)
      
      const localTop = new THREE.Vector3(1.2 * 0.6, 1.0 * palm.height, 0); // Correct local-scaled position
      const worldTop = new THREE.Vector3();
      
      // Apply rotation and translation to the local-scaled position
      worldTop.copy(localTop)
        .applyEuler(new THREE.Euler(palm.trunkLean, palm.trunkLeanDir, 0))
        .add(new THREE.Vector3(palm.x, -0.5, palm.z));

      for (let j = 0; j < palm.leafCount; j++) {
        const angle = (j * Math.PI * 2) / palm.leafCount + palm.rotationY;
        const leafLen = 7.0 + random() * 4.0; 
        const leafWidth = 1.0 + random() * 0.5;
        
        dummy.position.copy(worldTop)
        // Rotate leaf to point outwards and tilt down significantly
        const downwardTilt = 0.6 + random() * 0.4;
        dummy.rotation.set(0, angle, 0, 'YXZ') // Rotate around Y first
        dummy.rotateX(downwardTilt) // Then tilt down locally
        dummy.scale.set(leafWidth, leafLen, 1)
        
        dummy.updateMatrix()
        mesh.setMatrixAt(totalIdx, dummy.matrix)
        
        // Better tropical green colors
        const leafColor = new THREE.Color().setHSL(0.25 + random() * 0.1, 0.6, 0.4 + random() * 0.2);
        mesh.setColorAt(totalIdx, leafColor)
        totalIdx++
      }
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  useFrame((state) => {
    if (leafMaterialRef.current) {
      leafMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime
    }
    if (trunkMaterialRef.current) {
      trunkMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime
    }
  })

  const totalLeafSegments = useMemo(() => palms.reduce((acc, p) => acc + p.leafCount, 0), [palms])

  const trunkGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.4, 0.5, 1, 10, 10)
    geo.translate(0, 0.5, 0) // Center at bottom
    return geo
  }, [])

  if (palms.length === 0) return null

  return (
    <group>
      {palms.map((palm, i) => (
        <RigidBody key={i} type="fixed" colliders="cuboid" position={[palm.x, -0.5 + palm.height / 2, palm.z]} rotation={[palm.trunkLean, palm.trunkLeanDir, 0]}>
          <mesh visible={false}>
            <boxGeometry args={[0.8, palm.height, 0.8]} />
          </mesh>
        </RigidBody>
      ))}

      <instancedMesh ref={setTrunkInstances} args={[trunkGeo, undefined, palms.length]} castShadow receiveShadow>
        <shaderMaterial 
          ref={trunkMaterialRef} 
          args={[trunkShader]} 
          side={THREE.DoubleSide} 
        />
      </instancedMesh>

      <instancedMesh ref={setLeafInstances} args={[leafGeometry, undefined, totalLeafSegments]} castShadow receiveShadow>
        <shaderMaterial 
          ref={leafMaterialRef} 
          args={[leafShader]} 
          vertexColors 
          side={THREE.DoubleSide} 
          alphaTest={0.5}
          transparent={false}
          depthWrite={true}
          depthTest={true}
        />
      </instancedMesh>
    </group>
  )
}

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
      
      // Check if inside island - STRICT check to ensure grass NEVER appears on sand/beach
      // Get raw island value to check if well inside the grass zone
      const islandValue = getIslandShape(x, z, seed, false, true)
      // Threshold must be higher than beach edge (edgeThreshold + beachWidth = 0.24)
      // Using 0.45 for a moderate safety margin - grass stays off beach but closer to it
      const grassThreshold = 0.2
      if (islandValue < grassThreshold) continue;

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
      geo.computeVertexNormals() // Added to ensure normals are correct after modification
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
      alphaTest: 0.5,
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
          // Standard frustum check with a margin
          // Clip space coords are between -w and w
          float margin = 100.0; // Margin in clip space units relative to w
          if (abs(clipPos.x) > clipPos.w + margin || abs(clipPos.y) > clipPos.w + margin || clipPos.z < -clipPos.w - margin || clipPos.z > clipPos.w + margin) {
             gl_Position = vec4(0.0);
             return;
          }

          float distToCamera = distance(worldInstancePos, uCameraPos);
          float distToPlayer = distance(worldInstancePos, uPlayerPos);
          
          float maxDist = uIsPreview > 0.5 ? 400.0 : 100.0;
          float extremeDist = uIsPreview > 0.5 ? 500.0 : 180.0;
          
          // Optimization: Progressive density reduction for far grass
          // We use a pseudo-random value based on instance position to decide if we cull
          float h = hash(worldInstancePos.xz);
          
          // Smoothly reduce density from 40% of maxDist up to extremeDist
          // Near/Mid distance: full density
          // Far distance (maxDist): significantly reduced density
          // Extreme distance: very low density (background layer)
          float densityThreshold = smoothstep(extremeDist, maxDist * 0.4, distToCamera);
          
          // CUSTOM PERFORMANCE IMPROVEMENT: 
          // Keep high density around player even if camera is far
          float playerSafetyRadius = 25.0; // Increased radius slightly
          float playerSafetyFactor = smoothstep(playerSafetyRadius, playerSafetyRadius + 15.0, distToPlayer);
          
          // Apply safety factor: when close to player, densityThreshold should be 1.0 (no culling)
          densityThreshold = mix(1.0, densityThreshold, playerSafetyFactor);

          if (distToCamera > extremeDist && distToPlayer > playerSafetyRadius + 15.0) {
            gl_Position = vec4(0.0);
            return;
          }

          // Reduce density in preview mode or when far away in playing mode
          float threshold = densityThreshold + 0.05;
          if (uIsPreview > 0.5) {
            threshold = 0.25; // Balanced preview density
          }
          
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
          // float distToPlayer = distance(worldInstancePos, uPlayerPos); // Duplicate declaration removed
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
          // Simple discard for tapered plane
          if (vUv.y > 0.95) discard;
          if (abs(vUv.x - 0.5) > 0.45) discard;

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
      <instancedMesh ref={setNearInstances} args={[nearGeometry, undefined, NEAR_GRASS_COUNT]} castShadow receiveShadow>
        <shaderMaterial
          ref={nearMaterialRef}
          attach="material"
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
          fog={true}
          transparent={false}
          depthWrite={true}
          depthTest={true}
          alphaTest={0.5}
        />
      </instancedMesh>
      <instancedMesh ref={setMidInstances} args={[midGeometry, undefined, MID_GRASS_COUNT]} castShadow receiveShadow>
        <shaderMaterial
          ref={midMaterialRef}
          attach="material"
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
          fog={true}
          transparent={false}
          depthWrite={true}
          depthTest={true}
          alphaTest={0.5}
        />
      </instancedMesh>
      <instancedMesh ref={setFarInstances} args={[farGeometry, undefined, FAR_GRASS_COUNT]} castShadow receiveShadow>
        <shaderMaterial
          ref={farMaterialRef}
          attach="material"
          args={[grassShader]}
          vertexColors
          side={THREE.DoubleSide}
          fog={true}
          transparent={false}
          depthWrite={true}
          depthTest={true}
          alphaTest={0.5}
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
    <instancedMesh ref={setInstances} args={[undefined, undefined, FLOWER_COUNT]} castShadow>
      <sphereGeometry args={[0.5, 6, 6]} />
      <shaderMaterial ref={materialRef} attach="material" args={[flowerShader]} vertexColors alphaTest={0.5} />
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
        
        // Simple foam at shore simulation (very basic based on noise/uv)
        float shore = smoothstep(0.4, 0.5, n);
        color = mix(color, vec3(1.0), shore * 0.1);
        
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
  const [palmData, setPalmData] = useState<{ x: number, z: number, radius: number }[]>([])
  
  const leafGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 8) // 8 vertical segments for smooth bending
    geo.translate(0, 0.5, 0) // Base at origin
    return geo
  }, [])
  
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
          position={[50, 100, 50]}
          intensity={2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
        />
        
        <Physics gravity={[0, -9.81, 0]} interpolate={true}>
          <Player ref={playerRef} gameState={gameState} />
          
          <IslandGround seed={seed} gameState={gameState} />
          <Ocean />
          
          <Bushes seed={seed} rockData={rockData} palmData={palmData} />
          <Rocks seed={seed} onRockData={setRockData} />
          <Palms seed={seed} rockData={rockData} leafGeometry={leafGeometry} onPalmData={setPalmData} />
          <Coconuts seed={seed} palmData={palmData as any} />
          <Ferns seed={seed} rockData={rockData} palmData={palmData} />
          <Bamboo seed={seed} rockData={rockData} palmData={palmData} />
          <SandMounds seed={seed} />
          <Driftwood seed={seed} />
          <BeachDecor seed={seed} />
          <WaterObjects seed={seed} />
          <Crabs seed={seed} />
          <AncientTotems seed={seed} />
          <Structures seed={seed} />
          <Torches seed={seed} />
          <AtmosphericEffects seed={seed} gameState={gameState} />
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
