/**
 * SÓLIDOS 3D: mallas de alambre proyectadas a 2D. Matemática pura sin
 * dependencias (solo Point2D de drawing.ts).
 *
 * Todo se define centrado en el origen (coordenadas negativas incluidas) y
 * cada arista es un stroke de 2 puntos. Se recomienda combinarlo con
 * `fit: "contain"` en paint_draw, que escala y centra el modelo en el
 * lienzo. Los cuerpos disponibles: poliedros regulares y compuestos
 * (tetraedro, cubo, octaedro, dodecaedro, icosaedro, gran icosaedro,
 * estrella octángula), tesseract (4D→3D→2D), toro, nudo toroidal,
 * superficies de revolución y mallas wireframe genéricas.
 */

import type { Point2D } from "./drawing.js";

/** Punto en 3D (espacio del modelo, centrado en el origen). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** "ortho": proyección ortográfica (sin perspectiva). "perspective": cámara
 * a `distance` del origen, los puntos cercanos a la cámara se agrandan. */
export type ProjectionMode = "ortho" | "perspective";

/** Malla de alambre: vértices 3D + aristas como pares de índices. */
export interface SolidMesh {
  vertices: Vec3[];
  edges: [number, number][];
}

/** Sólidos disponibles en el kind "solid" del DSL. */
export type SolidName =
  | "tetrahedron"
  | "cube"
  | "octahedron"
  | "dodecahedron"
  | "icosahedron"
  | "greatIcosahedron"
  | "starOctangula"
  | "tesseract";

export function solidMesh(solid: SolidName): SolidMesh {
  switch (solid) {
    case "tetrahedron":
      return tetrahedron();
    case "cube":
      return cube();
    case "octahedron":
      return octahedron();
    case "icosahedron":
      return icosahedron();
    case "dodecahedron":
      return dodecahedron();
    case "greatIcosahedron":
      return greatIcosahedron();
    case "starOctangula":
      return starOctangula();
    case "tesseract":
      return tesseract();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotaciones y proyección
// ─────────────────────────────────────────────────────────────────────────────

function rotatePointX(p: Vec3, deg: number): Vec3 {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: p.x,
    y: p.y * cos - p.z * sin,
    z: p.y * sin + p.z * cos,
  };
}

function rotatePointY(p: Vec3, deg: number): Vec3 {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: p.x * cos + p.z * sin,
    y: p.y,
    z: -p.x * sin + p.z * cos,
  };
}

function rotatePointZ(p: Vec3, deg: number): Vec3 {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
    z: p.z,
  };
}

/** Rota los puntos en el orden X → Y → Z (grados). */
export function rotate3D(
  points: Vec3[],
  rotX: number,
  rotY: number,
  rotZ: number,
): Vec3[] {
  return points.map((p) =>
    rotatePointZ(rotatePointY(rotatePointX(p, rotX), rotY), rotZ),
  );
}

function projectPoint(
  p: Vec3,
  projection: ProjectionMode,
  distance: number,
  size: number,
): Point2D {
  const f = projection === "perspective"
    ? distance / Math.max(distance - p.z, 0.1)
    : 1;
  return {
    x: Math.round(p.x * f * size),
    y: Math.round(p.y * f * size),
  };
}

/** Proyecta la malla a strokes de 2 puntos (una arista por stroke). */
export function projectMesh(
  mesh: SolidMesh,
  rotX: number,
  rotY: number,
  rotZ: number,
  projection: ProjectionMode,
  distance: number,
  size: number,
): Point2D[][] {
  const rotated = rotate3D(mesh.vertices, rotX, rotY, rotZ);
  return mesh.edges.map(([a, b]) => [
    projectPoint(rotated[a], projection, distance, size),
    projectPoint(rotated[b], projection, distance, size),
  ]);
}

/** Proyecta una polilínea 3D cerrada (p. ej. un anillo del toro). */
export function projectClosedPolyline(
  points: Vec3[],
  rotX: number,
  rotY: number,
  rotZ: number,
  projection: ProjectionMode,
  distance: number,
  size: number,
): Point2D[] {
  const rotated = rotate3D(points, rotX, rotY, rotZ);
  const projected = rotated.map((p) =>
    projectPoint(p, projection, distance, size),
  );
  projected.push({ ...projected[0] });
  return projected;
}

/** Proyecta una polilínea 3D abierta (curvas paramétricas como el nudo). */
export function projectPolyline(
  points: Vec3[],
  rotX: number,
  rotY: number,
  rotZ: number,
  projection: ProjectionMode,
  distance: number,
  size: number,
): Point2D[] {
  return rotate3D(points, rotX, rotY, rotZ).map((p) =>
    projectPoint(p, projection, distance, size)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sólidos platónicos, compuestos y estrellados
// ─────────────────────────────────────────────────────────────────────────────

const PHI = (1 + Math.sqrt(5)) / 2;

function allPairs(count: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      pairs.push([i, j]);
    }
  }
  return pairs;
}

/** Aristas entre pares de vértices que distan exactamente `length`. */
function edgesAtDistance(
  vertices: Vec3[],
  length: number,
): [number, number][] {
  const edges: [number, number][] = [];
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      const d = Math.hypot(
        vertices[i].x - vertices[j].x,
        vertices[i].y - vertices[j].y,
        vertices[i].z - vertices[j].z,
      );
      if (Math.abs(d - length) < 1e-6) {
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

export function tetrahedron(): SolidMesh {
  return {
    vertices: [
      { x: 1, y: 1, z: 1 },
      { x: 1, y: -1, z: -1 },
      { x: -1, y: 1, z: -1 },
      { x: -1, y: -1, z: 1 },
    ],
    edges: allPairs(4),
  };
}

export function cube(): SolidMesh {
  const vertices: Vec3[] = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        vertices.push({ x, y, z });
      }
    }
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      const a = vertices[i];
      const b = vertices[j];
      const diffs =
        (a.x !== b.x ? 1 : 0) +
        (a.y !== b.y ? 1 : 0) +
        (a.z !== b.z ? 1 : 0);
      if (diffs === 1) {
        edges.push([i, j]);
      }
    }
  }
  return { vertices, edges };
}

export function octahedron(): SolidMesh {
  const vertices: Vec3[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  return {
    vertices,
    // Todas las parejas menos los opuestos (distancia 2).
    edges: edgesAtDistance(vertices, Math.sqrt(2)),
  };
}

export function icosahedron(): SolidMesh {
  const vertices: Vec3[] = [
    { x: 0, y: 1, z: PHI },
    { x: 0, y: -1, z: PHI },
    { x: 0, y: 1, z: -PHI },
    { x: 0, y: -1, z: -PHI },
    { x: 1, y: PHI, z: 0 },
    { x: -1, y: PHI, z: 0 },
    { x: 1, y: -PHI, z: 0 },
    { x: -1, y: -PHI, z: 0 },
    { x: PHI, y: 0, z: 1 },
    { x: PHI, y: 0, z: -1 },
    { x: -PHI, y: 0, z: 1 },
    { x: -PHI, y: 0, z: -1 },
  ];
  return { vertices, edges: edgesAtDistance(vertices, 2) };
}

export function dodecahedron(): SolidMesh {
  const invPhi = 1 / PHI;
  const vertices: Vec3[] = [
    ...allSigns().map(([x, y, z]) => ({ x, y, z })),
    ...goldenRectangles().map(([x, y, z]) => ({ x, y, z })),
  ];
  return { vertices, edges: edgesAtDistance(vertices, 2 * invPhi) };
}

function allSigns(): [number, number, number][] {
  const result: [number, number, number][] = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        result.push([x, y, z]);
      }
    }
  }
  return result;
}

function goldenRectangles(): [number, number, number][] {
  const invPhi = 1 / PHI;
  const result: [number, number, number][] = [];
  for (const s of [-1, 1]) {
    result.push([0, s * invPhi, s * PHI]);
    result.push([s * invPhi, s * PHI, 0]);
    result.push([s * PHI, 0, s * invPhi]);
    result.push([0, s * invPhi, -s * PHI]);
    result.push([-s * invPhi, s * PHI, 0]);
    result.push([-s * PHI, 0, s * invPhi]);
  }
  return result;
}

/**
 * Gran icosaedro (Kepler-Poinsot): comparte los 12 vértices y las 30
 * aristas del icosaedro; sus 20 caras son pentagramas que se cruzan.
 */
export function greatIcosahedron(): SolidMesh {
  return icosahedron();
}

/**
 * Caras pentagrama del gran icosaedro: para cada cara triangular (a, b, c)
 * del icosaedro, el pentagrama usa los 3 vértices de la cara más los 2
 * terceros vértices de las caras vecinas (axb, byc, cza), enlazados en el
 * ciclo a → x → b → y → c (5 aristas del icosaedro). Es una aproximación
 * visual de las caras que se cruzan; el esqueleto de 30 aristas sí es el
 * gran icosaedro exacto. Devuelve las 20 caras como polilíneas cerradas.
 */
export function greatIcosahedronFaces(): Vec3[][] {
  const base = icosahedron();
  const { vertices } = base;
  const edgeSet = new Set(base.edges.map(([a, b]) => `${a}-${b}`));

  const faces: number[][] = [];
  for (let a = 0; a < vertices.length; a += 1) {
    for (let b = a + 1; b < vertices.length; b += 1) {
      for (let c = b + 1; c < vertices.length; c += 1) {
        if (
          !edgeSet.has(`${a}-${b}`) ||
          !edgeSet.has(`${a}-${c}`) ||
          !edgeSet.has(`${b}-${c}`)
        ) {
          continue;
        }
        faces.push([a, b, c]);
      }
    }
  }

  const result: Vec3[][] = [];
  for (const face of faces) {
    const [a, b, c] = face;
    const x = thirdOf(a, b, face, faces);
    const y = thirdOf(b, c, face, faces);
    const z = thirdOf(c, a, face, faces);
    if (x < 0 || y < 0 || z < 0) {
      continue;
    }
    const pentagram = [a, x, b, y, c, a];
    result.push(pentagram.map((index) => vertices[index]));
  }
  return result;
}

/** Tercer vértice de la cara que comparte la arista (u, v) y que no está en `except`. */
function thirdOf(
  u: number,
  v: number,
  except: number[],
  faces: number[][],
): number {
  for (const face of faces) {
    if (!face.includes(u) || !face.includes(v)) {
      continue;
    }
    const third = face.find((index) => index !== u && index !== v);
    if (third !== undefined && !except.includes(third)) {
      return third;
    }
  }
  return -1;
}

/**
 * Estrella octángula: el único compuesto poliédrico regular — dos
 * tetraedros (los dos sets alternos de vértices del cubo) cruzados.
 */
export function starOctangula(): SolidMesh {
  const first = [
    { x: 1, y: 1, z: 1 },
    { x: 1, y: -1, z: -1 },
    { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 },
  ];
  const second = [
    { x: -1, y: -1, z: -1 },
    { x: -1, y: 1, z: 1 },
    { x: 1, y: -1, z: 1 },
    { x: 1, y: 1, z: -1 },
  ];
  return {
    vertices: [...first, ...second],
    edges: [
      ...allPairs(4),
      ...allPairs(4).map(([a, b]) => [a + 4, b + 4] as [number, number]),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tesseract (4D → 3D → 2D)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tesseract: los 16 vértices de un hipercubo (±1)^4 proyectados a 3D con
 * perspectiva en la cuarta dimensión (cámara a 2.5 en el eje w) y sus 32
 * aristas (parejas que difieren en exactamente una coordenada).
 */
export function tesseract(): SolidMesh {
  interface Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
  }

  const coords = [-1, 1];
  const hyperVertices: Vec4[] = [];
  for (const x of coords) {
    for (const y of coords) {
      for (const z of coords) {
        for (const w of coords) {
          hyperVertices.push({ x, y, z, w });
        }
      }
    }
  }

  const vertices: Vec3[] = hyperVertices.map(({ x, y, z, w }) => {
    const f = 2.5 / (2.5 - w);
    return { x: x * f, y: y * f, z: z * f };
  });

  const edges: [number, number][] = [];
  for (let i = 0; i < hyperVertices.length; i += 1) {
    for (let j = i + 1; j < hyperVertices.length; j += 1) {
      const di = hyperVertices[i];
      const dj = hyperVertices[j];
      const diffs =
        (di.x !== dj.x ? 1 : 0) +
        (di.y !== dj.y ? 1 : 0) +
        (di.z !== dj.z ? 1 : 0) +
        (di.w !== dj.w ? 1 : 0);
      if (diffs === 1) {
        edges.push([i, j]);
      }
    }
  }

  return { vertices, edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Toro, nudo toroidal y superficies de revolución
// ─────────────────────────────────────────────────────────────────────────────

export interface TorusOptions {
  /** Radio mayor (del agujero al centro del tubo). */
  majorRadius: number;
  /** Radio del tubo. */
  tubeRadius: number;
  /** Número de segmentos alrededor del agujero (anillos por meridiano). */
  segments: number;
  /** Número de anillos alrededor del tubo (latitudes). */
  rings: number;
}

/**
 * Toro paramétrico. Devuelve [anillos de latitud, meridianos]: cada uno es
 * una polilínea cerrada (un stroke por anillo/meridiano, sin aristas sueltas).
 */
export function torusPolygons(options: TorusOptions): Vec3[][] {
  const { majorRadius, tubeRadius, segments, rings } = options;
  const latitudeRings: Vec3[][] = [];
  const meridians: Vec3[][] = [];

  for (let ring = 0; ring < rings; ring += 1) {
    const v = (ring / rings) * Math.PI * 2;
    const ringPoints: Vec3[] = [];
    for (let seg = 0; seg < segments; seg += 1) {
      const u = (seg / segments) * Math.PI * 2;
      const r = majorRadius + tubeRadius * Math.cos(v);
      ringPoints.push({
        x: r * Math.cos(u),
        y: tubeRadius * Math.sin(v),
        z: r * Math.sin(u),
      });
    }
    latitudeRings.push(ringPoints);
  }

  for (let seg = 0; seg < segments; seg += 1) {
    const u = (seg / segments) * Math.PI * 2;
    const meridian: Vec3[] = [];
    for (let ring = 0; ring < rings; ring += 1) {
      const v = (ring / rings) * Math.PI * 2;
      const r = majorRadius + tubeRadius * Math.cos(v);
      meridian.push({
        x: r * Math.cos(u),
        y: tubeRadius * Math.sin(v),
        z: r * Math.sin(u),
      });
    }
    meridians.push(meridian);
  }

  return [...latitudeRings, ...meridians];
}

export interface TorusKnotOptions {
  /** Vuelta p (alrededor del agujero). */
  p: number;
  /** Vuelta q (alrededor del tubo). */
  q: number;
  /** Radio mayor. */
  radius: number;
  /** Radio del tubo. */
  tubeRadius: number;
  /** Número de puntos de la curva (resolución). */
  steps: number;
}

/**
 * Nudo toroidal (p, q): curva cerrada enlazada sobre la superficie de un
 * toro. Devuelve una única polilínea 3D (un stroke al proyectarla).
 */
export function torusKnotPoints(options: TorusKnotOptions): Vec3[] {
  const { p, q, radius, tubeRadius, steps } = options;
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const r = radius + tubeRadius * Math.cos(q * t);
    points.push({
      x: r * Math.cos(p * t),
      y: r * Math.sin(p * t),
      z: tubeRadius * Math.sin(q * t),
    });
  }
  return points;
}

export interface RevolutionOptions {
  /** Perfil en el plano {x = distancia al eje, y = altura}. */
  profile: Point2D[];
  /** Número de segmentos alrededor del eje. */
  segments: number;
}

/**
 * Superficie de revolución facetada: rota un perfil polilínea alrededor
 * del eje Y. Devuelve [anillos por cada punto del perfil, meridianos]:
 * cada uno es una polilínea cerrada (un stroke por anillo/meridiano).
 */
export function revolutionPolygons(options: RevolutionOptions): Vec3[][] {
  const { profile, segments } = options;
  const rings: Vec3[][] = [];
  const meridians: Vec3[][] = [];

  for (const point of profile) {
    const ring: Vec3[] = [];
    for (let seg = 0; seg < segments; seg += 1) {
      const u = (seg / segments) * Math.PI * 2;
      ring.push({
        x: point.x * Math.cos(u),
        y: point.y,
        z: point.x * Math.sin(u),
      });
    }
    rings.push(ring);
  }

  for (let seg = 0; seg < segments; seg += 1) {
    const u = (seg / segments) * Math.PI * 2;
    meridians.push(
      profile.map((point) => ({
        x: point.x * Math.cos(u),
        y: point.y,
        z: point.x * Math.sin(u),
      })),
    );
  }

  return [...rings, ...meridians];
}

// ─────────────────────────────────────────────────────────────────────────────
// Malla genérica (wireframe)
// ─────────────────────────────────────────────────────────────────────────────

export interface WireframeOptions {
  /** Vértices en 3D (centrados donde convenga). */
  vertices: Vec3[];
  /** Aristas como pares de índices de `vertices`. */
  edges: [number, number][];
}

/** Convierte una malla explícita (vértices + aristas) en strokes de 2 puntos. */
export function wireframeStrokes(
  options: WireframeOptions,
  rotX: number,
  rotY: number,
  rotZ: number,
  projection: ProjectionMode,
  distance: number,
  size: number,
): Point2D[][] {
  return projectMesh(
    { vertices: options.vertices, edges: options.edges },
    rotX,
    rotY,
    rotZ,
    projection,
    distance,
    size,
  );
}
