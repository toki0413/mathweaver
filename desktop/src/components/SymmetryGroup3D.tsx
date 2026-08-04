import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GroupType = 'S4' | 'A5'

interface Permutation {
  /** Cycle notation, e.g. "(1 2 3)" */
  notation: string
  /** Mapping: vertex i -> permutation[i] */
  perm: number[]
  /** Human-readable description */
  description: string
}

// ---------------------------------------------------------------------------
// Polyhedron geometry data
// ---------------------------------------------------------------------------

/**
 * Tetrahedron vertices (for S₄).
 * The 4 vertices of a regular tetrahedron centered at origin.
 */
const TETRA_VERTICES: [number, number, number][] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
]

/**
 * Icosahedron vertices (for A₅ rotational symmetry).
 * 12 vertices of a regular icosahedron.
 */
const ICO_VERTICES: [number, number, number][] = (() => {
  const phi = (1 + Math.sqrt(5)) / 2
  const verts: [number, number, number][] = []
  const normalize = (v: [number, number, number]): [number, number, number] => {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    return [v[0] / len, v[1] / len, v[2] / len]
  }
  // Rectangular coordinates
  for (const sign1 of [-1, 1]) {
    for (const sign2 of [-1, 1]) {
      verts.push(normalize([0, sign1, sign2 * phi]))
      verts.push(normalize([sign1, sign2 * phi, 0]))
      verts.push(normalize([sign2 * phi, 0, sign1]))
    }
  }
  return verts
})()

// ---------------------------------------------------------------------------
// Predefined permutations
// ---------------------------------------------------------------------------

const S4_PERMUTATIONS: Permutation[] = [
  { notation: '()', perm: [0, 1, 2, 3], description: '恒等变换' },
  {
    notation: '(0 1)',
    perm: [1, 0, 2, 3],
    description: '交换顶点 0 和 1（绕过 2-3 边中点的轴旋转 180°）',
  },
  {
    notation: '(0 1 2)',
    perm: [1, 2, 0, 3],
    description: '三循环：0→1→2→0（绕顶点 3 的轴旋转 120°）',
  },
  { notation: '(0 1 2 3)', perm: [1, 2, 3, 0], description: '四循环：0→1→2→3→0' },
  {
    notation: '(0 2)',
    perm: [2, 1, 0, 3],
    description: '交换顶点 0 和 2（绕过 1-3 边中点的轴旋转 180°）',
  },
  {
    notation: '(0 2 1)',
    perm: [2, 0, 1, 3],
    description: '三循环：0→2→1→0（绕顶点 3 的轴逆向旋转 120°）',
  },
]

const A5_PERMUTATIONS: Permutation[] = [
  { notation: '()', perm: [0, 1, 2, 3, 4], description: '恒等变换' },
  {
    notation: '(0 1 2)',
    perm: [1, 2, 0, 3, 4],
    description: '三循环（绕一对对顶点的轴旋转 120°）',
  },
  {
    notation: '(0 1)(2 3)',
    perm: [1, 0, 3, 2, 4],
    description: '双对换（绕对棱中点的轴旋转 180°）',
  },
  { notation: '(0 1 2 3 4)', perm: [1, 2, 3, 4, 0], description: '五循环（绕对顶点的轴旋转 72°）' },
  { notation: '(0 2 4 1 3)', perm: [2, 4, 1, 3, 0], description: '五循环（逆向旋转 72°）' },
]

// ---------------------------------------------------------------------------
// Rotation computation: find the rotation matrix that maps vertex i to perm[i]
// ---------------------------------------------------------------------------

function computeRotationForPermutation(
  perm: number[],
  vertices: [number, number, number][],
): THREE.Matrix4 {
  const n = perm.length

  if (perm.every((v, i) => v === i)) {
    return new THREE.Matrix4()
  }

  // Find the best-fit rotation using Kabsch algorithm
  // Source points: vertices[0..n-1]
  // Target points: vertices[perm[0..n-1]]
  const source: THREE.Vector3[] = []
  const target: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    source.push(new THREE.Vector3(...vertices[i]))
    target.push(new THREE.Vector3(...vertices[perm[i]]))
  }

  // Compute centroids
  const sourceCentroid = new THREE.Vector3()
  const targetCentroid = new THREE.Vector3()
  source.forEach(s => sourceCentroid.add(s))
  target.forEach(t => targetCentroid.add(t))
  sourceCentroid.multiplyScalar(1 / n)
  targetCentroid.multiplyScalar(1 / n)

  // Since we're on a sphere centered at origin, centroids should be ~0
  // Center the points
  const centeredSource = source.map(s => s.clone().sub(sourceCentroid))
  const centeredTarget = target.map(t => t.clone().sub(targetCentroid))

  // Compute covariance matrix H = sum(source_i * target_i^T)
  const H = new THREE.Matrix3()
  for (let i = 0; i < n; i++) {
    const s = centeredSource[i]
    const t = centeredTarget[i]
    H.elements[0] += s.x * t.x
    H.elements[1] += s.x * t.y
    H.elements[2] += s.x * t.z
    H.elements[3] += s.y * t.x
    H.elements[4] += s.y * t.y
    H.elements[5] += s.y * t.z
    H.elements[6] += s.z * t.x
    H.elements[7] += s.z * t.y
    H.elements[8] += s.z * t.z
  }

  // SVD of H (using three.js Matrix3 — but Matrix3 doesn't have SVD)
  // Instead, we use a simpler approach: for regular polyhedra with known
  // symmetry axes, the rotation is well-defined. We compute it directly.

  // Fallback: compute rotation that maps the average of cross products
  // For a single pair (i, perm[i]), the rotation axis is source × target
  const axis = new THREE.Vector3()
  let totalAngle = 0
  let count = 0

  for (let i = 0; i < n; i++) {
    if (perm[i] === i) continue
    const s = new THREE.Vector3(...vertices[i]).normalize()
    const t = new THREE.Vector3(...vertices[perm[i]]).normalize()
    const cross = new THREE.Vector3().crossVectors(s, t)
    const dot = s.dot(t)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (cross.lengthSq() > 1e-10) {
      cross.normalize()
      axis.add(cross.multiplyScalar(angle))
      totalAngle += angle
      count++
    }
  }

  if (count === 0) {
    return new THREE.Matrix4()
  }

  axis.multiplyScalar(1 / count)
  const angle = totalAngle / count

  if (axis.lengthSq() < 1e-10) {
    return new THREE.Matrix4()
  }

  axis.normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(q)
  return matrix
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  groupType?: GroupType
  className?: string
}

export const SymmetryGroup3D: React.FC<Props> = ({ groupType = 'S4', className }) => {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const polyhedronRef = useRef<THREE.Group | null>(null)
  const labelsRef = useRef<THREE.Sprite[]>([])
  const animFrameRef = useRef<number>(0)
  const currentQuatRef = useRef<THREE.Quaternion>(new THREE.Quaternion())
  const targetQuatRef = useRef<THREE.Quaternion>(new THREE.Quaternion())
  const isAnimatingRef = useRef<boolean>(false)

  const [selectedPerm, setSelectedPerm] = useState(0)
  const [autoRotate, setAutoRotate] = useState(true)
  const [webglFailed, setWebglFailed] = useState(false)

  const permutations = useMemo<Permutation[]>(
    () => (groupType === 'S4' ? S4_PERMUTATIONS : A5_PERMUTATIONS),
    [groupType],
  )

  const vertices = useMemo<[number, number, number][]>(
    () => (groupType === 'S4' ? TETRA_VERTICES : ICO_VERTICES),
    [groupType],
  )

  // Number of elements being permuted (4 for S₄, 5 for A₅)
  const permSize = groupType === 'S4' ? 4 : 5

  // -- Create text sprite for vertex labels --
  const createLabel = useCallback((text: string, color = '#ffffff'): THREE.Sprite => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    ctx.font = 'bold 64px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(0.4, 0.4, 0.4)
    return sprite
  }, [])

  // -- Initialize Three.js scene --
  useEffect(() => {
    if (!mountRef.current) return

    const mount = mountRef.current
    const width = mount.clientWidth || 400
    const height = mount.clientHeight || 400

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    camera.position.set(3, 2, 4)
    camera.lookAt(0, 0, 0)

    // Renderer — gracefully handle WebGL unavailability
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglFailed(true)
      return
    }
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 1.5)
    scene.add(ambient)

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight.position.set(5, 5, 5)
    scene.add(dirLight)

    const dirLight2 = new THREE.DirectionalLight(0x8899ff, 0.5)
    dirLight2.position.set(-5, -3, -5)
    scene.add(dirLight2)

    // Create polyhedron group
    const group = new THREE.Group()
    polyhedronRef.current = group
    scene.add(group)

    // -- Build polyhedron --
    if (groupType === 'S4') {
      buildTetrahedron(group)
    } else {
      buildIcosahedron(group)
    }

    // -- Vertex labels --
    labelsRef.current = []
    for (let i = 0; i < permSize; i++) {
      const v = vertices[i]
      const pos = new THREE.Vector3(v[0], v[1], v[2]).normalize().multiplyScalar(1.5)
      const label = createLabel(String(i), '#ffdd44')
      label.position.copy(pos)
      group.add(label)
      labelsRef.current.push(label)
    }

    // Initial gentle rotation
    currentQuatRef.current = new THREE.Quaternion()
    targetQuatRef.current = new THREE.Quaternion()

    // -- Animation loop --
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate)

      if (autoRotate && !isAnimatingRef.current) {
        group.rotation.y += 0.005
      } else if (isAnimatingRef.current) {
        // Lerp current quaternion toward target
        currentQuatRef.current.slerp(targetQuatRef.current, 0.08)
        group.quaternion.copy(currentQuatRef.current)

        if (currentQuatRef.current.angleTo(targetQuatRef.current) < 0.01) {
          currentQuatRef.current.copy(targetQuatRef.current)
          isAnimatingRef.current = false
        }
      }

      // Keep labels facing camera
      camera.updateMatrixWorld()
      labelsRef.current.forEach(label => {
        label.lookAt(camera.position)
      })

      renderer.render(scene, camera)
    }
    animate()

    // -- Resize handler --
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current) return
      const w = mount.clientWidth || 400
      const h = mount.clientHeight || 400
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [groupType, vertices, permSize, createLabel, autoRotate, buildIcosahedron])

  // -- Handle permutation selection --
  const handleSelectPermutation = useCallback(
    (idx: number) => {
      if (!polyhedronRef.current || idx === selectedPerm) return

      const perm = permutations[idx].perm
      const rotMatrix = computeRotationForPermutation(perm, vertices)

      // Set target quaternion
      const targetQ = new THREE.Quaternion().setFromRotationMatrix(rotMatrix)

      // We want to rotate FROM the identity (current reset state) TO target
      // Reset to identity first, then animate to target
      currentQuatRef.current = new THREE.Quaternion()
      polyhedronRef.current.quaternion.copy(currentQuatRef.current)
      targetQuatRef.current = targetQ
      isAnimatingRef.current = true
      setAutoRotate(false)

      setSelectedPerm(idx)
    },
    [permutations, vertices, selectedPerm],
  )

  // -- Step through: apply permutation one element at a time --
  const [stepIndex, setStepIndex] = useState(-1)
  const handleStepThrough = useCallback(() => {
    if (!polyhedronRef.current) return
    const perm = permutations[selectedPerm].perm
    const nextStep = stepIndex + 1

    if (nextStep >= perm.length) {
      // Reset to start
      setStepIndex(-1)
      handleSelectPermutation(selectedPerm)
      return
    }

    // Find the next non-identity mapping
    if (perm[nextStep] === nextStep) {
      setStepIndex(nextStep)
      return
    }

    // Build a partial permutation: only apply the mapping for elements up to nextStep
    const partialPerm = perm.map((v, i) => (i <= nextStep ? v : i))

    const rotMatrix = computeRotationForPermutation(partialPerm, vertices)
    const targetQ = new THREE.Quaternion().setFromRotationMatrix(rotMatrix)

    currentQuatRef.current = polyhedronRef.current.quaternion.clone()
    targetQuatRef.current = targetQ
    isAnimatingRef.current = true
    setAutoRotate(false)
    setStepIndex(nextStep)
  }, [permutations, selectedPerm, stepIndex, vertices, handleSelectPermutation])

  // -- Reset view --
  const handleReset = useCallback(() => {
    if (!polyhedronRef.current) return
    currentQuatRef.current = new THREE.Quaternion()
    targetQuatRef.current = new THREE.Quaternion()
    isAnimatingRef.current = false
    polyhedronRef.current.quaternion.copy(currentQuatRef.current)
    setSelectedPerm(0)
    setAutoRotate(true)
  }, [])

  // -- Build tetrahedron --
  function buildTetrahedron(group: THREE.Group) {
    const scale = 1.3

    // Solid faces (semi-transparent)
    const faceGeom = new THREE.BufferGeometry()
    const verts = new Float32Array(TETRA_VERTICES.flatMap(v => v.map(c => c * scale)))
    // Faces: (0,1,2), (0,1,3), (0,2,3), (1,2,3)
    const indices = new Uint16Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3])
    faceGeom.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    faceGeom.setIndex(new THREE.BufferAttribute(indices, 1))
    faceGeom.computeVertexNormals()

    const faceMat = new THREE.MeshPhongMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      shininess: 80,
    })
    const faceMesh = new THREE.Mesh(faceGeom, faceMat)
    group.add(faceMesh)

    // Edges
    const edgeGeom = new THREE.EdgesGeometry(faceGeom)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x88bbff, linewidth: 2 })
    const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat)
    group.add(edgeLines)

    // Vertex spheres
    TETRA_VERTICES.forEach((v, i) => {
      const sphereGeom = new THREE.SphereGeometry(0.12, 16, 16)
      const sphereMat = new THREE.MeshPhongMaterial({
        color: i === 0 ? 0xff6644 : 0xffdd44,
        emissive: 0x442200,
      })
      const sphere = new THREE.Mesh(sphereGeom, sphereMat)
      sphere.position.set(v[0] * scale, v[1] * scale, v[2] * scale)
      group.add(sphere)
    })
  }

  // -- Build icosahedron --
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function buildIcosahedron(group: THREE.Group) {
    const scale = 1.5

    // Build icosahedron geometry from vertices
    const positions: number[] = []
    const icoIndices: number[] = []

    // Normalize vertices and scale
    const scaledVerts = ICO_VERTICES.map(v => {
      const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
      return [(v[0] / len) * scale, (v[1] / len) * scale, (v[2] / len) * scale]
    })

    scaledVerts.forEach(v => positions.push(...v))

    // Find faces: 20 equilateral triangles
    // For each triplet of vertices, check if all pairwise distances are equal
    // Simpler: just find all triplets where all edges are the same length
    const edgeLen = new THREE.Vector3(...scaledVerts[0]).distanceTo(
      new THREE.Vector3(...scaledVerts[1]),
    )

    for (let i = 0; i < scaledVerts.length; i++) {
      for (let j = i + 1; j < scaledVerts.length; j++) {
        const dij = new THREE.Vector3(...scaledVerts[i]).distanceTo(
          new THREE.Vector3(...scaledVerts[j]),
        )
        if (Math.abs(dij - edgeLen) > 0.01) continue
        for (let k = j + 1; k < scaledVerts.length; k++) {
          const dik = new THREE.Vector3(...scaledVerts[i]).distanceTo(
            new THREE.Vector3(...scaledVerts[k]),
          )
          const djk = new THREE.Vector3(...scaledVerts[j]).distanceTo(
            new THREE.Vector3(...scaledVerts[k]),
          )
          if (Math.abs(dik - edgeLen) < 0.01 && Math.abs(djk - edgeLen) < 0.01) {
            icoIndices.push(i, j, k)
          }
        }
      }
    }

    const faceGeom = new THREE.BufferGeometry()
    faceGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    faceGeom.setIndex(icoIndices)
    faceGeom.computeVertexNormals()

    const faceMat = new THREE.MeshPhongMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      shininess: 100,
    })
    const faceMesh = new THREE.Mesh(faceGeom, faceMat)
    group.add(faceMesh)

    // Edges
    const edgeGeom = new THREE.EdgesGeometry(faceGeom)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x66ffaa, linewidth: 1.5 })
    const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat)
    group.add(edgeLines)

    // Vertex spheres — only color the first permSize vertices
    scaledVerts.forEach((v, i) => {
      const sphereGeom = new THREE.SphereGeometry(0.08, 12, 12)
      const isLabeled = i < permSize
      const sphereMat = new THREE.MeshPhongMaterial({
        color: isLabeled ? (i === 0 ? 0xff6644 : 0xffdd44) : 0x4488cc,
        emissive: isLabeled ? 0x442200 : 0x001122,
      })
      const sphere = new THREE.Mesh(sphereGeom, sphereMat)
      sphere.position.set(v[0], v[1], v[2])
      group.add(sphere)
    })
  }

  // -- Render UI --
  if (webglFailed) {
    // SVG-based 2D fallback when WebGL is unavailable
    const project2D = (v: number[]): { x: number; y: number } => ({
      x: 200 + v[0] * 60 - v[2] * 30,
      y: 200 + v[1] * 60 - v[2] * 20,
    })

    const projected = vertices.map(project2D)
    const edges: [number, number][] =
      groupType === 'S4'
        ? [
            [0, 1],
            [0, 2],
            [0, 3],
            [1, 2],
            [1, 3],
            [2, 3],
          ]
        : [
            [0, 1],
            [0, 5],
            [0, 6],
            [0, 7],
            [0, 8],
            [1, 2],
            [1, 3],
            [1, 4],
            [2, 5],
            [2, 6],
            [2, 11],
            [3, 5],
            [3, 7],
            [3, 11],
            [4, 6],
            [4, 7],
            [4, 8],
            [5, 9],
            [5, 10],
            [6, 9],
            [6, 10],
            [7, 9],
            [7, 10],
            [8, 9],
            [8, 10],
            [9, 11],
            [10, 11],
          ]

    return (
      <div className={`symmetry-3d ${className || ''}`}>
        <div className="symmetry-3d-header">
          <div className="symmetry-3d-title">
            {groupType === 'S4' ? 'S₄ · 正四面体旋转对称群' : 'A₅ · 正二十面体旋转对称群'}
          </div>
          <div className="symmetry-3d-info">
            {groupType === 'S4'
              ? '4 个顶点对应 4 个被置换元素，每个旋转 = S₄ 中的一个置换'
              : '5 个内接立方体对应 5 个被置换元素，每个旋转 = A₅ 中的一个偶置换'}
          </div>
        </div>

        <div className="symmetry-3d-fallback">
          <svg width="400" height="400" viewBox="0 0 400 400">
            <rect width="400" height="400" fill="#1a1a2e" rx="8" />
            {/* Edges */}
            {edges.map(([a, b], i) => (
              <line
                key={`e-${i}`}
                x1={projected[a].x}
                y1={projected[a].y}
                x2={projected[b].x}
                y2={projected[b].y}
                stroke="#88bbff"
                strokeWidth="1.5"
                opacity="0.6"
              />
            ))}
            {/* Vertices */}
            {projected.map((p, i) => (
              <g key={`v-${i}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={i < permSize ? 10 : 6}
                  fill={i < permSize ? (i === 0 ? '#ff6644' : '#ffdd44') : '#4488cc'}
                  opacity={i < permSize ? 1 : 0.6}
                />
                {i < permSize && (
                  <text
                    x={p.x}
                    y={p.y + 4}
                    textAnchor="middle"
                    fill="#1a1a2e"
                    fontSize="12"
                    fontWeight="bold"
                  >
                    {i}
                  </text>
                )}
              </g>
            ))}
            <text x="200" y="380" textAnchor="middle" fill="#6688aa" fontSize="11">
              WebGL 不可用 — 显示 2D 静态投影
            </text>
          </svg>
        </div>

        <div className="symmetry-3d-controls">
          <div className="perm-list">
            <span className="perm-label">选择群元:</span>
            {permutations.map((p, i) => (
              <button
                key={i}
                className={`perm-btn${selectedPerm === i ? ' perm-btn-selected' : ''}`}
                onClick={() => setSelectedPerm(i)}
              >
                {p.notation}
              </button>
            ))}
          </div>
          <div className="perm-detail">
            <span className="perm-notation">{permutations[selectedPerm].notation}</span>
            <span className="perm-desc">{permutations[selectedPerm].description}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`symmetry-3d ${className || ''}`}>
      <div className="symmetry-3d-header">
        <div className="symmetry-3d-title">
          {groupType === 'S4' ? 'S₄ · 正四面体旋转对称群' : 'A₅ · 正二十面体旋转对称群'}
        </div>
        <div className="symmetry-3d-info">
          {groupType === 'S4'
            ? '4 个顶点对应 4 个被置换元素，每个旋转 = S₄ 中的一个置换'
            : '5 个内接立方体对应 5 个被置换元素，每个旋转 = A₅ 中的一个偶置换'}
        </div>
      </div>

      <div
        ref={mountRef}
        className="symmetry-3d-canvas"
        style={{ width: '100%', height: '400px', borderRadius: '8px', overflow: 'hidden' }}
      />

      <div className="symmetry-3d-controls">
        <div className="perm-list">
          <span className="perm-label">选择群元:</span>
          {permutations.map((p, i) => (
            <button
              key={i}
              className={`perm-btn${selectedPerm === i ? ' perm-btn-selected' : ''}`}
              onClick={() => handleSelectPermutation(i)}
              title={p.description}
            >
              {p.notation}
            </button>
          ))}
        </div>

        {/* Permutation mapping visualization */}
        <div
          className="perm-mapping"
          style={{
            margin: '8px 0',
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.15)',
            borderRadius: '6px',
            fontSize: '13px',
            fontFamily: 'var(--mono, monospace)',
            color: '#c8c8d0',
          }}
        >
          <span style={{ color: '#88bbff', marginRight: '8px' }}>映射:</span>
          {permutations[selectedPerm].perm.map((target, src) => (
            <span
              key={src}
              style={{
                display: 'inline-block',
                marginRight: '8px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: target !== src ? 'rgba(229,192,123,0.2)' : 'transparent',
                color: target !== src ? '#e5c07b' : '#666',
              }}
            >
              {src}→{target}
              {stepIndex >= 0 && src <= stepIndex && target !== src && (
                <span style={{ color: '#98c379', marginLeft: '2px' }}> ✓</span>
              )}
            </span>
          ))}
        </div>

        <div className="perm-detail">
          <span className="perm-notation">{permutations[selectedPerm].notation}</span>
          <span className="perm-desc">{permutations[selectedPerm].description}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            className="perm-btn"
            onClick={handleStepThrough}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              background: stepIndex >= 0 ? 'rgba(152,195,121,0.2)' : 'rgba(0,0,0,0.15)',
              color: stepIndex >= 0 ? '#98c379' : '#c8c8d0',
              border: '1px solid',
              borderColor: stepIndex >= 0 ? '#98c379' : '#3a3a4a',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {stepIndex >= 0
              ? `▶ 步骤 ${stepIndex + 1}/${permutations[selectedPerm].perm.length}`
              : '▶ 逐步演示'}
          </button>
          <button
            className="perm-btn"
            onClick={() => {
              setAutoRotate(!autoRotate)
              setStepIndex(-1)
            }}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              background: autoRotate ? 'rgba(136,187,255,0.2)' : 'rgba(0,0,0,0.15)',
              color: autoRotate ? '#88bbff' : '#c8c8d0',
              border: '1px solid',
              borderColor: autoRotate ? '#88bbff' : '#3a3a4a',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {autoRotate ? '⏸ 暂停旋转' : '▶ 自动旋转'}
          </button>
          <button className="perm-reset" onClick={handleReset}>
            重置视角
          </button>
        </div>
      </div>
    </div>
  )
}

export default SymmetryGroup3D
