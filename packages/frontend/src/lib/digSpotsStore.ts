import * as THREE from 'three';

const MAX_DIG_SPOTS = 64;
export const digSpotsArray: THREE.Vector2[] = Array.from({ length: MAX_DIG_SPOTS }, () => new THREE.Vector2(0, 0));
export let digSpotsCount = 0;

export function pushDigSpot(x: number, z: number) {
  if (digSpotsCount >= MAX_DIG_SPOTS) return;
  digSpotsArray[digSpotsCount].set(x, z);
  digSpotsCount++;
}

export function resetDigSpots() {
  digSpotsCount = 0;
}
