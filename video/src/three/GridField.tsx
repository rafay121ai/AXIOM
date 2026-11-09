import { useMemo } from 'react'
import * as THREE from 'three'
import { useCurrentFrame } from 'remotion'

// DESIGN.md's construction grid, in 3D: thin gold lines and a point at every fourth crossing,
// laid on a floor plane that drifts slowly toward the camera.
const SIZE = 40
const STEP = 1

export const GridField = ({ opacity = 1 }: { opacity?: number }) => {
  const frame = useCurrentFrame()
  const { lines, points } = useMemo(() => {
    const l: number[] = []
    for (let i = -SIZE; i <= SIZE; i += STEP) {
      l.push(-SIZE, 0, i, SIZE, 0, i, i, 0, -SIZE, i, 0, SIZE)
    }
    const p: number[] = []
    for (let x = -SIZE; x <= SIZE; x += STEP * 4) for (let z = -SIZE; z <= SIZE; z += STEP * 4) p.push(x, 0, z)
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(l, 3))
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    return { lines: lg, points: pg }
  }, [])
  const drift = ((frame / 30) * 0.25) % (STEP * 4)
  return (
    <group position={[0, -2.2, drift]} rotation={[0, 0, 0]}>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#cdb27e" transparent opacity={0.07 * opacity} />
      </lineSegments>
      <points geometry={points}>
        <pointsMaterial color="#cdb27e" size={0.06} transparent opacity={0.45 * opacity} />
      </points>
    </group>
  )
}
