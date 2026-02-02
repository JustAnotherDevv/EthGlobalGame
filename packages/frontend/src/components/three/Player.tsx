import { useRef, useImperativeHandle, forwardRef, useEffect, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { useKeyboardControls, useGLTF, useAnimations } from "@react-three/drei"
import { RapierRigidBody, RigidBody, CapsuleCollider } from "@react-three/rapier"
import * as THREE from "three"

const SPEED = 4
const RUN_SPEED = 6

const direction = new THREE.Vector3()
const frontVector = new THREE.Vector3()
const sideVector = new THREE.Vector3()
const targetVelocity = new THREE.Vector3()
const cameraOffset = new THREE.Vector3()
const idealOffset = new THREE.Vector3(0, 5, 7)
const smoothedHorizontalRotation = { current: 0 }
const smoothedLookAtY = { current: 0 }
const smoothedLookAtPosition = new THREE.Vector3() // Smooth lookAt target to prevent tilting

export const Player = forwardRef<THREE.Group, { gameState: 'preview' | 'playing' }>(({ gameState }, ref) => {
  const smoothedY = useRef(0)
  const smoothedCameraY = useRef(0)
  const stableGroundY = useRef(0) // Track stable ground height when grounded
  const rb = useRef<RapierRigidBody>(null)
  const groupRef = useRef<THREE.Group>(null)
  const characterModelRef = useRef<THREE.Group>(null)
  const isJumpPressed = useRef(false)
  const [, getKeys] = useKeyboardControls()

  // Load character model
  const { scene, animations } = useGLTF("/pirate.gltf")
  const { actions } = useAnimations(animations, characterModelRef)
  const [animation, setAnimation] = useState("Idle")

  useEffect(() => {
    // Play the current animation
    const action = actions[animation]
    if (action) {
      // Faster crossfade for most animations (0.2s)
      // but longer crossfade when transitioning to Jump_Idle for smoothness
      const fadeDuration = (animation === "Jump_Idle") ? 0.4 : 0.2
      
      action.reset().fadeIn(fadeDuration).play()
      
      // If it's a Jump animation, we want it to be slower and freeze on the last frame
      if (animation === "Jump") {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
          action.timeScale = 0.5 // Slow down the jump launch animation
      } else if (animation === "Sword" || animation === "Jump_Land") {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
          action.timeScale = 1.0
      } else {
          action.setLoop(THREE.LoopRepeat, Infinity)
          action.timeScale = 1.0
      }

      return () => {
        action.fadeOut(fadeDuration)
      }
    }
  }, [animation, actions])

  // Expose the internal group/position to the parent via ref
  useImperativeHandle(ref, () => groupRef.current!)

  useFrame((state, delta) => {
    // Handle preview camera even if rb/groupRef are not ready or if it's not playing
    if (gameState === 'preview') {
      state.camera.position.lerp(new THREE.Vector3(0, 150, 150), 0.05)
      state.camera.lookAt(0, 0, 0)
      return
    }

    if (!rb.current || !groupRef.current) return

    const { forward, backward, left, right, jump, run, action } = getKeys()

    // Sync group position with physics for external ref access
    const translation = rb.current.translation()
    const rbVelocity = rb.current.linvel()
    
    // Check if we are grounded to decide on smoothing
    // Increased threshold slightly to better handle small physics bounces
    const isGrounded = Math.abs(rbVelocity.y) < 0.2
    
    // Smooth Y movement for visual display
    const isMoving = Math.hypot(rbVelocity.x, rbVelocity.z) > 0.1

    // Initialize smoothedY on first frame
    if (smoothedY.current === 0) {
      smoothedY.current = translation.y
    }

    if (isGrounded) {
        // When grounded, use medium smoothing for player visual position
        smoothedY.current = THREE.MathUtils.lerp(smoothedY.current, translation.y, 0.1)
    } else {
        // When airborne, track actual position more closely
        smoothedY.current = THREE.MathUtils.lerp(smoothedY.current, translation.y, 0.2)
    }

    // Update group position with smoothed Y
    groupRef.current.position.set(
      translation.x,
      smoothedY.current,
      translation.z
    )

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
    
    const currentSpeed = run ? RUN_SPEED : SPEED
    targetVelocity.copy(direction).multiplyScalar(currentSpeed)
    
    // Character rotation
    if (direction.length() > 0 && characterModelRef.current) {
        const targetRotation = Math.atan2(direction.x, direction.z)
        
        // Manual lerpAngle implementation
        let diff = targetRotation - characterModelRef.current.rotation.y
        while (diff < -Math.PI) diff += Math.PI * 2
        while (diff > Math.PI) diff -= Math.PI * 2
        characterModelRef.current.rotation.y += diff * 0.15
    }

    // Animation state
    let nextAnimation = animation
    if (!isGrounded) {
        // Only trigger "Jump" when we just left the ground and have upward velocity
        const isActuallyJumping = rbVelocity.y > 1.0;
        
        if (isActuallyJumping && animation !== "Jump" && animation !== "Jump_Idle") {
            nextAnimation = "Jump"
        } else if (animation === "Jump") {
            // Smoothly transition from Jump to Jump_Idle near the apex or when falling
            // Using a slightly positive threshold (0.5) to start the blend earlier for smoothness
            if (rbVelocity.y < 0.5) {
                nextAnimation = "Jump_Idle"
            }
        } else if (animation !== "Jump" && animation !== "Jump_Idle") {
            // Fallback for falling without a jump (e.g. walking off a ledge)
            nextAnimation = "Jump_Idle"
        }
    } else if (action) {
        nextAnimation = "Sword"
    } else if (isMoving) {
        nextAnimation = run ? "Run" : "Walk"
    } else {
        // Check if we just landed
        if (animation === "Jump_Idle" || animation === "Jump") {
            nextAnimation = "Jump_Land"
        } else if (animation === "Jump_Land") {
            // Keep playing Jump_Land until it's almost done
            const landAction = actions["Jump_Land"]
            if (landAction && landAction.isRunning() && landAction.time < landAction.getClip().duration * 0.8) {
                nextAnimation = "Jump_Land"
            } else {
                nextAnimation = "Idle"
            }
        } else if (animation === "Sword") {
             const swordAction = actions["Sword"]
             if (swordAction && swordAction.isRunning() && swordAction.time < swordAction.getClip().duration * 0.8) {
                 nextAnimation = "Sword"
             } else {
                 nextAnimation = "Idle"
             }
        } else {
            nextAnimation = "Idle"
        }
    }

    if (nextAnimation !== animation) {
        setAnimation(nextAnimation)
    }
    
    // rbVelocity already declared above
    // const rbVelocity = rb.current.linvel()

    const lookAtY = (isGrounded ? (smoothedY.current || translation.y) : translation.y) + 1.5

    // Use lerp for smoother velocity transitions
    const lerpFactor = 1 - Math.pow(0.001, delta)
    const vx = THREE.MathUtils.lerp(rbVelocity.x, targetVelocity.x, lerpFactor)
    const vz = THREE.MathUtils.lerp(rbVelocity.z, targetVelocity.z, lerpFactor)

    // Apply velocity
    rb.current.setLinvel({ x: vx, y: rbVelocity.y, z: vz }, true)

    // Jump
    if (jump) {
      if (isGrounded && !isJumpPressed.current && Math.abs(rbVelocity.y) < 0.1) {
        rb.current.setLinvel({ x: vx, y: 7, z: vz }, true)
      }
      isJumpPressed.current = true
    } else {
      isJumpPressed.current = false
    }

    // BULLETPROOF FIX: Freeze camera Y completely when running
    // Root cause: terrain physics causes translation.y to fluctuate
    // Solution: Use frozen Y for camera position, override PointerLockControls rotation

    if (isGrounded && isMoving) {
      // Initialize and freeze stable Y
      if (stableGroundY.current === 0) {
        stableGroundY.current = translation.y
      }
      // COMPLETELY FROZEN - no updates while running
    } else if (!isGrounded) {
      // Airborne - sync to actual position
      stableGroundY.current = translation.y
    } else {
      // Standing still - smoothly sync
      stableGroundY.current = THREE.MathUtils.lerp(stableGroundY.current, translation.y, 0.2)
    }

    // Use frozen Y when running to eliminate jitter
    const effectiveY = (isGrounded && isMoving) ? stableGroundY.current : translation.y

    // Camera follow - Fixed third person behind player
    // Extract horizontal (yaw) rotation from PointerLockControls
    const cameraEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    const targetHorizontalRotation = cameraEuler.y

    // Initialize smoothed rotation on first frame
    if (smoothedHorizontalRotation.current === 0 && gameState === 'playing') {
      smoothedHorizontalRotation.current = targetHorizontalRotation
    }

    // Smooth the rotation with proper angle wrapping
    let angleDiff = targetHorizontalRotation - smoothedHorizontalRotation.current
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
    smoothedHorizontalRotation.current += angleDiff * 0.15

    // Apply smoothed yaw to camera offset
    const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      smoothedHorizontalRotation.current
    )
    cameraOffset.copy(idealOffset).applyQuaternion(yawQuaternion)

    // Calculate target camera position using FROZEN Y
    const targetX = translation.x + cameraOffset.x
    const targetZ = translation.z + cameraOffset.z
    const targetY = effectiveY + 5 // Use frozen Y to eliminate jitter

    // Apply camera position
    const positionLerpFactor = 0.15
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, positionLerpFactor)
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, positionLerpFactor)

    // BULLETPROOF: Directly set Y when running - no interpolation = no jitter
    if (isGrounded && isMoving) {
      camera.position.y = targetY
    } else {
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, positionLerpFactor)
    }

    // LookAt target position with frozen Y to prevent vertical jitter
    const lookAtTargetPosition = new THREE.Vector3(
      translation.x,
      effectiveY + 1.5, // Use frozen Y
      translation.z
    )

    // Initialize smoothed lookAt position on first frame
    if (smoothedLookAtPosition.lengthSq() === 0 && gameState === 'playing') {
      smoothedLookAtPosition.copy(lookAtTargetPosition)
    }

    // BULLETPROOF FIX: Always smooth lookAt to prevent tilting, but only Y is frozen
    // Smooth X and Z to follow player, but freeze Y to prevent vertical jitter
    if (isGrounded && isMoving) {
      // Smooth X and Z to follow player without tilting
      smoothedLookAtPosition.x = THREE.MathUtils.lerp(smoothedLookAtPosition.x, lookAtTargetPosition.x, 0.15)
      smoothedLookAtPosition.z = THREE.MathUtils.lerp(smoothedLookAtPosition.z, lookAtTargetPosition.z, 0.15)
      // Directly set Y - no smoothing = no vertical jitter
      smoothedLookAtPosition.y = lookAtTargetPosition.y
    } else {
      // Smooth all components for jumps/landings
      smoothedLookAtPosition.lerp(lookAtTargetPosition, 0.15)
    }

    // Make camera look at the smoothed target position
    camera.lookAt(smoothedLookAtPosition)
  })

  return (
    <>
      <RigidBody
        ref={rb}
        colliders={false}
        enabledRotations={[false, false, false]}
        position={[0, 1, 0]}
      >
        <CapsuleCollider args={[0.5, 0.5]} />
      </RigidBody>
      <group ref={groupRef}>
        <group ref={characterModelRef} position={[0, -1, 0]}>
            <primitive object={scene} />
        </group>
      </group>
    </>
  )
})
