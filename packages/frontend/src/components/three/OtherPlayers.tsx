import { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PlayerState } from '@/types/game';

function RemotePlayer({ player }: { player: PlayerState }) {
  const groupRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));
  const smoothedSpeed = useRef(0);
  const lastFramePos = useRef(new THREE.Vector3(player.position.x, player.position.y, player.position.z));

  const { scene, animations } = useGLTF('/pirate.gltf');
  const clonedScene = useMemo(() => skeletonClone(scene), [scene]);
  const { actions } = useAnimations(animations, modelRef);
  const [animation, setAnimation] = useState('Idle');

  useEffect(() => {
    targetPos.current.set(player.position.x, player.position.y, player.position.z);
  }, [player.position.x, player.position.y, player.position.z]);

  useEffect(() => {
    const action = actions[animation];
    if (action) {
      action.reset().fadeIn(0.2).play();
      if (animation === 'Sword') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      return () => { action.fadeOut(0.2); };
    }
  }, [animation, actions]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const pos = groupRef.current.position;
    pos.lerp(targetPos.current, 0.15);

    // Compute speed from actual interpolated movement
    const dx = pos.x - lastFramePos.current.x;
    const dz = pos.z - lastFramePos.current.z;
    const frameSpeed = delta > 0 ? Math.sqrt(dx * dx + dz * dz) / delta : 0;
    smoothedSpeed.current += (frameSpeed - smoothedSpeed.current) * 0.1;
    lastFramePos.current.copy(pos);

    if (smoothedSpeed.current > 0.3 && modelRef.current) {
      const angle = Math.atan2(dx, dz);
      let diff = angle - modelRef.current.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      modelRef.current.rotation.y += diff * 0.15;
    }

    const speed = smoothedSpeed.current;
    const nextAnim = player.currentAction === 'harvesting' ? 'Sword'
      : player.currentAction === 'digging' ? 'Sword'
      : speed > 3 ? 'Run'
      : speed > 0.5 ? 'Walk'
      : 'Idle';

    if (nextAnim !== animation) setAnimation(nextAnim);
  });

  return (
    <group ref={groupRef} position={[player.position.x, player.position.y, player.position.z]}>
      <group ref={modelRef} position={[0, -1, 0]}>
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

export function OtherPlayers({ players, localPlayerId }: { players: PlayerState[]; localPlayerId: string | null }) {
  const remotePlayers = players.filter(p => p.id !== localPlayerId && p.connected);

  return (
    <>
      {remotePlayers.map(player => (
        <RemotePlayer key={player.id} player={player} />
      ))}
    </>
  );
}
