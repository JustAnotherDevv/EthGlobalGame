import { GRID_SIZE, RESOURCE_COUNT } from './constants.js';
import type { Vec3, Resource } from './types.js';
import { ResourceType } from './types.js';

const GRASS_RANGE = GRID_SIZE;

function mulberry32(a: number) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

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

export function getIslandShape(x: number, z: number, seed: number, isVegetation = false, returnRawValue = false) {
  const maxR = GRASS_RANGE / 2;
  let nx = x / maxR;
  let nz = z / maxR;

  const warpScale = 0.8;
  const qx = fbm(nx * warpScale, nz * warpScale, seed + 12.3);
  const qz = fbm(nx * warpScale + 5.2, nz * warpScale + 1.3, seed + 45.6);

  nx += qx * 0.4;
  nz += qz * 0.4;

  const islandScale = 1.5;
  const n = fbm(nx * 1.8, nz * 1.8, seed) * islandScale;

  const d = Math.sqrt(nx * nx + nz * nz);
  const radialMask = Math.max(0, 1.0 - Math.pow(d, 2.0));
  const centralBias = Math.max(0, 0.4 * (1.0 - d * 2.0));
  const islandValue = (n * radialMask) - (Math.pow(d, 5.0) * 0.8) + centralBias;

  if (returnRawValue) return islandValue;

  const edgeThreshold = 0.12;
  const objectThreshold = 0.25;
  return islandValue > (isVegetation ? objectThreshold : edgeThreshold) ? 1 : 0;
}

export function getHeightAt(x: number, z: number, seed: number): number {
  const raw = getIslandShape(x, z, seed, false, true) as number;
  return Math.max(0, raw * 15);
}

export function isOnIsland(x: number, z: number, seed: number): boolean {
  return getIslandShape(x, z, seed) === 1;
}

export function generateChestPosition(seed: number): Vec3 {
  const rng = mulberry32(seed * 99991);
  const maxR = GRASS_RANGE / 2.5;
  for (let attempt = 0; attempt < 200; attempt++) {
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * maxR;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (isOnIsland(x, z, seed)) {
      return { x, y: getHeightAt(x, z, seed), z };
    }
  }
  return { x: 0, y: getHeightAt(0, 0, seed), z: 0 };
}

export function generateResources(seed: number, count: number = RESOURCE_COUNT): Resource[] {
  const rng = mulberry32(seed * 77777);
  const resources: Resource[] = [];
  const types = [ResourceType.Wood, ResourceType.Stone, ResourceType.Berry];
  const maxR = GRASS_RANGE / 2.2;
  const minSpacing = 5;

  for (let attempt = 0; attempt < count * 20 && resources.length < count; attempt++) {
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * maxR;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    if (!isOnIsland(x, z, seed)) continue;

    const tooClose = resources.some(res => {
      const dx = res.position.x - x;
      const dz = res.position.z - z;
      return Math.sqrt(dx * dx + dz * dz) < minSpacing;
    });
    if (tooClose) continue;

    resources.push({
      id: `res_${resources.length}`,
      type: types[Math.floor(rng() * types.length)],
      position: { x, y: getHeightAt(x, z, seed), z },
      harvested: false,
    });
  }

  return resources;
}
