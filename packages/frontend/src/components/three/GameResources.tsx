import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Resource } from '@/types/game';
import { ResourceType } from '@/types/game';

const INTERACTION_DISTANCE = 3;

const WOOD_COLOR = new THREE.Color('#8B4513');
const STONE_COLOR = new THREE.Color('#808080');
const BERRY_COLOR = new THREE.Color('#FF6B6B');

const tempObject = new THREE.Object3D();

const BEAM_HEIGHT = 8;
const beamGeometry = new THREE.CylinderGeometry(0.08, 0.08, BEAM_HEIGHT, 6, 1, true);
beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);

const beamVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const beamFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float fade = 1.0 - vUv.y;
    fade = fade * fade;
    float shimmer = 0.7 + 0.3 * sin(uTime * 4.0 + vUv.y * 10.0);
    gl_FragColor = vec4(uColor, fade * shimmer * 0.6);
  }
`;

const ringGeometry = new THREE.RingGeometry(0.6, 1.0, 24);
ringGeometry.rotateX(-Math.PI / 2);

function ResourceInstances({ resources, type }: { resources: Resource[]; type: ResourceType }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const beamRef = useRef<THREE.InstancedMesh>(null);
  const active = useMemo(() => resources.filter(r => !r.harvested), [resources]);

  const geometry = useMemo(() => {
    switch (type) {
      case ResourceType.Wood: return new THREE.CylinderGeometry(0.15, 0.2, 0.8, 6);
      case ResourceType.Stone: return new THREE.DodecahedronGeometry(0.4, 0);
      case ResourceType.Berry: return new THREE.SphereGeometry(0.3, 8, 8);
    }
  }, [type]);

  const material = useMemo(() => {
    const color = type === ResourceType.Wood ? WOOD_COLOR
      : type === ResourceType.Stone ? STONE_COLOR : BERRY_COLOR;
    return new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  }, [type]);

  const beamColor = type === ResourceType.Wood ? new THREE.Color('#ffaa00')
    : type === ResourceType.Stone ? new THREE.Color('#aaccff')
    : new THREE.Color('#ff4466');

  const beamMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: beamVertexShader,
      fragmentShader: beamFragmentShader,
      uniforms: {
        uColor: { value: beamColor },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [type]);

  const ringMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: beamColor,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }, [type]);

  useFrame((state) => {
    const mesh = meshRef.current;
    const ring = ringRef.current;
    const beam = beamRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    const pulse = 0.5 + Math.sin(t * 3) * 0.3;

    beamMaterial.uniforms.uTime.value = t;

    for (let i = 0; i < active.length; i++) {
      const r = active[i];
      const y = -0.5 + Math.sin(t * 2 + r.position.x) * 0.1 + 0.5;

      tempObject.position.set(r.position.x, y, r.position.z);
      tempObject.rotation.set(0, t * 0.5 + i, 0);
      tempObject.scale.set(1, 1, 1);
      tempObject.updateMatrix();
      mesh.setMatrixAt(i, tempObject.matrix);

      if (ring) {
        const s = 1 + Math.sin(t * 3 + i) * 0.15;
        tempObject.position.set(r.position.x, -0.3, r.position.z);
        tempObject.rotation.set(0, 0, 0);
        tempObject.scale.set(s, s, s);
        tempObject.updateMatrix();
        ring.setMatrixAt(i, tempObject.matrix);
      }

      if (beam) {
        tempObject.position.set(r.position.x, -0.5, r.position.z);
        tempObject.rotation.set(0, 0, 0);
        tempObject.scale.set(1, 1, 1);
        tempObject.updateMatrix();
        beam.setMatrixAt(i, tempObject.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (ring) {
      ring.instanceMatrix.needsUpdate = true;
      ringMaterial.opacity = pulse;
    }
    if (beam) {
      beam.instanceMatrix.needsUpdate = true;
    }
  });

  if (active.length === 0) return null;

  return (
    <>
      <instancedMesh ref={meshRef} args={[geometry, material, active.length]} />
      <instancedMesh ref={ringRef} args={[ringGeometry, ringMaterial, active.length]} />
      <instancedMesh ref={beamRef} args={[beamGeometry, beamMaterial, active.length]} />
    </>
  );
}

export function GameResources({
  resources,
  playerPosition,
  onHarvest,
}: {
  resources: Resource[];
  playerPosition: THREE.Vector3 | null;
  onHarvest: (resourceId: string) => void;
}) {
  const grouped = useMemo(() => ({
    [ResourceType.Wood]: resources.filter(r => r.type === ResourceType.Wood),
    [ResourceType.Stone]: resources.filter(r => r.type === ResourceType.Stone),
    [ResourceType.Berry]: resources.filter(r => r.type === ResourceType.Berry),
  }), [resources]);

  return (
    <>
      <ResourceInstances resources={grouped[ResourceType.Wood]} type={ResourceType.Wood} />
      <ResourceInstances resources={grouped[ResourceType.Stone]} type={ResourceType.Stone} />
      <ResourceInstances resources={grouped[ResourceType.Berry]} type={ResourceType.Berry} />
    </>
  );
}

export function useNearestResource(
  resources: Resource[],
  playerPosition: THREE.Vector3 | null
): Resource | null {
  if (!playerPosition) return null;
  let nearest: Resource | null = null;
  let minDist = INTERACTION_DISTANCE;
  for (const r of resources) {
    if (r.harvested) continue;
    const d = Math.sqrt(
      (r.position.x - playerPosition.x) ** 2 +
      (r.position.z - playerPosition.z) ** 2
    );
    if (d < minDist) {
      minDist = d;
      nearest = r;
    }
  }
  return nearest;
}
