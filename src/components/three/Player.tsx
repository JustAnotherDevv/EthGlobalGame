import { useRef, useImperativeHandle, forwardRef } from "react"
import { useFrame } from "@react-three/fiber"
import { useKeyboardControls } from "@react-three/drei"
import { RapierRigidBody, RigidBody, CapsuleCollider } from "@react-three/rapier"
import * as THREE from "three"

const SPEED = 5
const direction = new THREE.Vector3()
const frontVector = new THREE.Vector3()
const sideVector = new THREE.Vector3()
const targetVelocity = new THREE.Vector3()
const cameraOffset = new THREE.Vector3()
const idealOffset = new THREE.Vector3(0, 2, 5)

export const Player = forwardRef<THREE.Group>((_, ref) => {
  const rb = useRef<RapierRigidBody>(null)
  const groupRef = useRef<THREE.Group>(null)
  const [, getKeys] = useKeyboardControls()

  // Expose the internal group/position to the parent via ref
  useImperativeHandle(ref, () => groupRef.current!)

  useFrame((state, delta) => {
    if (!rb.current || !groupRef.current) return

    const { forward, backward, left, right, jump } = getKeys()

    // Sync group position with physics for external ref access
    const translation = rb.current.translation()
    groupRef.current.position.set(translation.x, translation.y, translation.z)

    // Get camera orientation
    const camera = state.camera
    
    // Calculate direction based on camera orientation
    frontVector.set(0, 0, Number(backward) - Number(forward))
    sideVector.set(Number(left) - Number(right), 0, 0)
    
    direction
      .subVectors(frontVector, sideVector)
      .normalize()
      .applyQuaternion(camera.quaternion)

    // Remove vertical component for horizontal movement
    direction.y = 0
    if (direction.length() > 0) {
      direction.normalize()
    }
    
    targetVelocity.copy(direction).multiplyScalar(SPEED)
    
    const rbVelocity = rb.current.linvel()

    // Use lerp for smoother velocity transitions
    const lerpFactor = 1 - Math.pow(0.001, delta)
    const vx = THREE.MathUtils.lerp(rbVelocity.x, targetVelocity.x, lerpFactor)
    const vz = THREE.MathUtils.lerp(rbVelocity.z, targetVelocity.z, lerpFactor)

    // Apply velocity
    rb.current.setLinvel({ x: vx, y: rbVelocity.y, z: vz }, true)

    // Jump
    if (jump && Math.abs(rbVelocity.y) < 0.05) {
      rb.current.setLinvel({ x: vx, y: 5, z: vz }, true)
    }

    // Camera follow (GTA-style third person)
    // Use the character's position and smoothly follow it
    
    // Only use the horizontal rotation (yaw) for the camera offset to avoid top-down flipping
    const cameraEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cameraEuler.y)
    
    cameraOffset.copy(idealOffset).applyQuaternion(yawQuaternion)
    
    // To reduce jitter, we can lerp the camera position too
    const targetX = translation.x + cameraOffset.x
    const targetY = translation.y + cameraOffset.y
    const targetZ = translation.z + cameraOffset.z

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.1)
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.1)
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.1)
    
    // Smoothly interpolate the lookAt point as well
    const lookAtX = translation.x
    const lookAtY = translation.y + 1
    const lookAtZ = translation.z
    
    // We can use a helper vector to lerp the lookAt target if needed, 
    // but camera.lookAt every frame is usually fine if position is smooth.
    camera.lookAt(lookAtX, lookAtY, lookAtZ)
  })

  return (
    <RigidBody
      ref={rb}
      colliders={false}
      enabledRotations={[false, false, false]}
      position={[0, 1, 0]}
    >
      <group ref={groupRef} />
      <CapsuleCollider args={[0.5, 0.5]} />
      <mesh castShadow>
        <capsuleGeometry args={[0.5, 1]} />
        <meshStandardMaterial color="hotpink" />
      </mesh>
    </RigidBody>
  )
})
