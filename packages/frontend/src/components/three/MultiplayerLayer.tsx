import * as THREE from 'three';
import { useGame } from '@/contexts/GameContext';
import { RoomPhase } from '@/types/game';
import type { Vec3 } from '@/types/game';
import { OtherPlayers } from './OtherPlayers';
import { GameResources } from './GameResources';

const DIG_RADIUS = 1.5;
const tempObject = new THREE.Object3D();

const holeGeometry = new THREE.CircleGeometry(DIG_RADIUS, 16);
holeGeometry.rotateX(-Math.PI / 2);

const holeMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#3d2b1f'),
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
});

function DigSpots({ spots }: { spots: Vec3[] }) {
  const setInstances = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    for (let i = 0; i < spots.length; i++) {
      tempObject.position.set(spots[i].x, -0.48, spots[i].z);
      tempObject.rotation.set(0, 0, 0);
      tempObject.scale.set(1, 1, 1);
      tempObject.updateMatrix();
      mesh.setMatrixAt(i, tempObject.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  if (spots.length === 0) return null;

  return (
    <instancedMesh key={spots.length} ref={setInstances} args={[holeGeometry, holeMaterial, spots.length]} />
  );
}

export function MultiplayerLayer({ playerRef }: { playerRef: React.RefObject<THREE.Group | null> }) {
  const { phase, players, playerId, resources, startHarvest, digSpots } = useGame();

  if (phase !== RoomPhase.Playing) return null;

  return (
    <>
      <OtherPlayers players={players} localPlayerId={playerId} />
      <GameResources
        resources={resources}
        playerPosition={playerRef.current?.position ?? null}
        onHarvest={startHarvest}
      />
      <DigSpots spots={digSpots} />
    </>
  );
}
