import { useRef, useImperativeHandle, forwardRef, useEffect, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { useKeyboardControls, useGLTF, useAnimations } from "@react-three/drei"
import { RapierRigidBody, RigidBody, CapsuleCollider } from "@react-three/rapier"
import * as THREE from "three"

const SPEED = 3
const RUN_SPEED = 6

const direction = new THREE.Vector3()
const frontVector = new THREE.Vector3()
const sideVector = new THREE.Vector3()
const targetVelocity = new THREE.Vector3()
const cameraOffset = new THREE.Vector3()
const idealOffset = new THREE.Vector3(0, 5, 7)
const smoothedHorizontalRotation = { current: 0 }

export const Player = forwardRef<THREE.Group, { gameState: 'preview' | 'playing' }>(({ gameState }, ref) => {
  const smoothedY = useRef(0)
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
    
    // Smooth Y movement for camera to prevent "head bobbing"
    // We use a much slower lerp for Y when on ground, but faster when jumping/falling
    // EVEN SLOWER lerp when grounded (0.01) to filter out terrain micro-variations
    const yLerpFactor = isGrounded ? 0.01 : 0.15
    // SMOOTHING OVERRIDE: If movement is minimal and grounded, lock Y
    const isMoving = Math.hypot(rbVelocity.x, rbVelocity.z) > 0.1
    if (isGrounded && !isMoving) {
        smoothedY.current = THREE.MathUtils.lerp(smoothedY.current || translation.y, translation.y, 0.002)
    } else {
        smoothedY.current = THREE.MathUtils.lerp(smoothedY.current || translation.y, translation.y, yLerpFactor)
    }

    // Update group position - use smoothed Y when grounded to avoid micro-bounces
    // but keep X and Z reactive to physics
    groupRef.current.position.set(
      translation.x, 
      isGrounded ? (smoothedY.current || translation.y) : translation.y, 
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

    // Camera follow - Fixed third person behind player
    // Smooth the horizontal rotation to eliminate jitter during fast mouse movements

    // Extract horizontal (yaw) rotation from PointerLockControls
    const cameraEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    const targetHorizontalRotation = cameraEuler.y

    // Initialize smoothed rotation on first frame
    if (smoothedHorizontalRotation.current === 0 && gameState === 'playing') {
      smoothedHorizontalRotation.current = targetHorizontalRotation
    }

    // Smooth the rotation with proper angle wrapping
    let angleDiff = targetHorizontalRotation - smoothedHorizontalRotation.current
    // Normalize angle difference to [-PI, PI] for shortest path
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2

    // Apply smoothing - higher value = more responsive, lower = smoother
    const rotationSmoothFactor = 0.15
    smoothedHorizontalRotation.current += angleDiff * rotationSmoothFactor

    // Apply smoothed yaw to camera offset
    const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      smoothedHorizontalRotation.current
    )
    cameraOffset.copy(idealOffset).applyQuaternion(yawQuaternion)

    // Calculate and apply smoothed camera position
    const targetX = translation.x + cameraOffset.x
    const targetY = (isGrounded ? (smoothedY.current || translation.y) : translation.y) + cameraOffset.y
    const targetZ = translation.z + cameraOffset.z

    const positionLerpFactor = 0.15
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, positionLerpFactor)
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, positionLerpFactor)

    const verticalLerpFactor = isGrounded ? 0.05 : 0.15
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, verticalLerpFactor)

    // Make camera look at player using smoothed position
    const lookAtTarget = new THREE.Vector3(
      translation.x,
      (isGrounded ? (smoothedY.current || translation.y) : translation.y) + 1.5,
      translation.z
    )
    camera.lookAt(lookAtTarget)
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
