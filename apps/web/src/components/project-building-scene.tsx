"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { cn } from "@DashboardV2/ui/lib/utils";

type BuildingVariant = "house" | "skyscraper" | "mansion";

const VARIANTS: BuildingVariant[] = ["house", "skyscraper", "mansion"];

const BASE_ROTATION = -0.12;
const POINTER_SWING = 0.16;
/** Each silhouette gets its own editorial crop and isometric camera at 120px tall. */
const FRAMING: Record<
  BuildingVariant,
  {
    scale: number;
    narrowScale: number;
    offsetX: number;
    bottomInset: number;
    camera: [number, number, number];
  }
> = {
  house: {
    scale: 1.14,
    narrowScale: 1.08,
    offsetX: -0.1,
    bottomInset: 0.035,
    camera: [2.5, 1.8, 2.9],
  },
  mansion: {
    scale: 1.16,
    narrowScale: 1.1,
    offsetX: -0.085,
    bottomInset: 0.03,
    camera: [2.45, 1.75, 2.85],
  },
  skyscraper: {
    scale: 1.12,
    narrowScale: 1.08,
    offsetX: -0.09,
    bottomInset: 0.02,
    camera: [2.55, 2.05, 2.95],
  },
};

/** Bounds only the architecture; landscaping may crop, but the building never becomes a tiny island. */
const FOCUS_VOLUME: Record<
  BuildingVariant,
  { center: [number, number, number]; size: [number, number, number] }
> = {
  house: { center: [0, 1.58, -0.22], size: [5.25, 3.2, 3.2] },
  mansion: { center: [0, 1.72, -0.2], size: [6.55, 3.5, 3.35] },
  skyscraper: { center: [-0.18, 4.75, -0.12], size: [4.45, 9.55, 3.45] },
};

export default function ProjectBuildingScene({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const variant = buildingVariant(seed);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const container: HTMLDivElement = containerRef.current;
    const canvas: HTMLCanvasElement = canvasRef.current;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    scene.environment = environment;
    scene.environmentIntensity = 0.42;

    const disposables: Array<{ dispose: () => void }> = [];
    const materials = createMaterials();
    for (const material of Object.values(materials)) disposables.push(material);

    const builder: Builder = {
      materials,
      geometryCache: new Map(),
      track(resource) {
        disposables.push(resource);
        return resource;
      },
    };

    const building = new THREE.Group();
    if (variant === "skyscraper") buildSkyscraper(builder, building);
    else if (variant === "mansion") buildMansion(builder, building);
    else buildHouse(builder, building);
    building.rotation.y = BASE_ROTATION;
    scene.add(building);

    const bounds = new THREE.Box3().setFromObject(building);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;

    scene.add(new THREE.HemisphereLight(0xfdfbff, 0xd6c8b4, 0.75));

    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.6);
    keyLight.position.set(
      center.x - radius * 0.9,
      center.y + radius * 1.5,
      center.z + radius * 1.1,
    );
    keyLight.target.position.copy(center);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.radius = 2.5;
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 0.02;
    const shadowExtent = radius * 1.25;
    keyLight.shadow.camera.left = -shadowExtent;
    keyLight.shadow.camera.right = shadowExtent;
    keyLight.shadow.camera.top = shadowExtent;
    keyLight.shadow.camera.bottom = -shadowExtent;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = radius * 6;
    keyLight.shadow.camera.updateProjectionMatrix();
    scene.add(keyLight, keyLight.target);

    const fillLight = new THREE.DirectionalLight(0xd5ecf6, 0.55);
    fillLight.position.set(radius * 1.6, radius * 0.8, -radius * 1.2);
    scene.add(fillLight);

    const groundGeometry = new THREE.PlaneGeometry(radius * 8, radius * 8);
    const groundMaterial = new THREE.ShadowMaterial({ color: 0x4d453e, opacity: 0.16 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    disposables.push(groundGeometry, groundMaterial);

    // Baked ambient-occlusion halo: keeps the diorama grounded once the frame
    // crops into the site, where the shadow map alone reads as a hard edge.
    const haloTexture = createRadialShadowTexture();
    if (haloTexture) {
      const size = bounds.getSize(new THREE.Vector3());
      const haloGeometry = new THREE.PlaneGeometry(1, 1);
      const haloMaterial = new THREE.MeshBasicMaterial({
        map: haloTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(center.x + size.x * 0.06, 0.004, center.z - size.z * 0.04);
      halo.scale.set(size.x * 1.6, size.z * 1.6, 1);
      halo.renderOrder = -1;
      scene.add(halo);
      disposables.push(haloGeometry, haloMaterial, haloTexture);
    }

    const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, radius * 12);
    const framing = FRAMING[variant];
    const focus = FOCUS_VOLUME[variant];
    const focusCenter = new THREE.Vector3(...focus.center);
    camera.position.set(
      focusCenter.x + radius * framing.camera[0],
      focusCenter.y + radius * framing.camera[1],
      focusCenter.z + radius * framing.camera[2],
    );
    camera.lookAt(focusCenter);
    camera.updateMatrixWorld();

    const frame = fitVolume(focus, camera, [
      BASE_ROTATION - POINTER_SWING,
      BASE_ROTATION,
      BASE_ROTATION + POINTER_SWING,
    ]);
    building.rotation.y = BASE_ROTATION;

    let lastWidth = 0;
    let lastHeight = 0;

    function render() {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      const aspect = width / height;

      if (width !== lastWidth || height !== lastHeight) {
        renderer.setSize(width, height, false);
        lastWidth = width;
        lastHeight = height;
      }

      let viewHeight = frame.height;
      if (viewHeight * aspect < frame.width) viewHeight = frame.width / aspect;
      viewHeight *= aspect < 1.75 ? framing.narrowScale : framing.scale;
      const viewWidth = viewHeight * aspect;

      // The model behaves like a bottom-right architectural illustration.
      const offsetX = frame.centerX + viewWidth * framing.offsetX;
      const bottom = frame.centerY - frame.height / 2 - frame.height * framing.bottomInset;
      camera.left = offsetX - viewWidth / 2;
      camera.right = offsetX + viewWidth / 2;
      camera.top = bottom + viewHeight;
      camera.bottom = bottom;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }

    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(canvas);
    render();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clock = new THREE.Clock();
    let pointerTarget = 0;
    let pointerCurrent = 0;
    let animationFrame = 0;

    function animate() {
      animationFrame = 0;
      const delta = Math.min(clock.getDelta(), 0.1);
      // Frame-rate independent easing towards the pointer-driven angle.
      pointerCurrent += (pointerTarget - pointerCurrent) * (1 - Math.exp(-delta * 3.5));
      building.rotation.y = BASE_ROTATION + pointerCurrent;
      render();
      if (Math.abs(pointerTarget - pointerCurrent) > 0.001) startAnimation();
    }

    function startAnimation() {
      if (animationFrame || reducedMotion.matches) return;
      animationFrame = requestAnimationFrame(animate);
    }

    function stopAnimation() {
      if (!animationFrame) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    function handlePointerMove(event: PointerEvent) {
      if (reducedMotion.matches) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = (event.clientX - rect.left) / rect.width - 0.5;
      pointerTarget = THREE.MathUtils.clamp(ratio * 2, -1, 1) * POINTER_SWING;
      startAnimation();
    }

    function handlePointerLeave() {
      pointerTarget = 0;
      startAnimation();
    }

    function handleVisibility() {
      if (document.hidden) stopAnimation();
      else if (Math.abs(pointerTarget - pointerCurrent) > 0.001) startAnimation();
    }

    function handleMotionPreference() {
      if (!reducedMotion.matches) return;
      stopAnimation();
      pointerTarget = 0;
      pointerCurrent = 0;
      building.rotation.y = BASE_ROTATION;
      render();
    }

    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerleave", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      stopAnimation();
      resizeObserver.disconnect();
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotion.removeEventListener("change", handleMotionPreference);
      for (const resource of disposables) resource.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, [variant]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative isolate overflow-hidden",
        className,
      )}
      data-building-variant={variant}
      aria-hidden="true"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-linear-to-r from-[color-mix(in_oklab,var(--card),#f2ebff_42%)] to-transparent sm:w-24" />
      <div className="pointer-events-none absolute inset-0 z-[5] bg-[linear-gradient(115deg,#f0e9ff12,#dff5f51c)]" />
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}

function buildingVariant(seed: string): BuildingVariant {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return VARIANTS[(hash >>> 0) % VARIANTS.length] ?? "house";
}

/** Fits the orthographic frustum to the architectural focus volume across pointer rotation. */
function fitVolume(
  volume: { center: [number, number, number]; size: [number, number, number] },
  camera: THREE.Camera,
  rotations: number[],
  padding = 1.07,
) {
  const corner = new THREE.Vector3();
  const half = new THREE.Vector3(...volume.size).multiplyScalar(0.5);
  const localCenter = new THREE.Vector3(...volume.center);
  const up = new THREE.Vector3(0, 1, 0);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const rotation of rotations) {
    for (let index = 0; index < 8; index += 1) {
      corner.set(
        localCenter.x + (index & 1 ? half.x : -half.x),
        localCenter.y + (index & 2 ? half.y : -half.y),
        localCenter.z + (index & 4 ? half.z : -half.z),
      );
      corner.applyAxisAngle(up, rotation);
      corner.applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
  }

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: (maxX - minX) * padding,
    height: (maxY - minY) * padding,
  };
}

/** Soft elliptical falloff drawn to a canvas — cheaper and softer than a shadow map. */
function createRadialShadowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(58, 50, 42, 0.42)");
  gradient.addColorStop(0.5, "rgba(58, 50, 42, 0.18)");
  gradient.addColorStop(1, "rgba(58, 50, 42, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type Vec3 = [number, number, number];
type Materials = ReturnType<typeof createMaterials>;

type Builder = {
  materials: Materials;
  geometryCache: Map<string, THREE.BufferGeometry>;
  track: <T extends { dispose: () => void }>(resource: T) => T;
};

type Placement = {
  radius?: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  shadow?: boolean;
};

function createMaterials() {
  const surface = (color: number, roughness: number, metalness = 0.02) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.6 });

  return {
    plaster: surface(0xf6f2ea, 0.85),
    warmWhite: surface(0xfffdf7, 0.8),
    deck: surface(0xeae5db, 0.82),
    stone: surface(0xd5cbbb, 0.94),
    sand: surface(0xe6dccb, 0.92),
    wood: surface(0xc98a4d, 0.62),
    woodDark: surface(0x9a6234, 0.7),
    charcoal: surface(0x2f353b, 0.44, 0.28),
    steel: new THREE.MeshStandardMaterial({
      color: 0xa3abb1,
      roughness: 0.32,
      metalness: 0.65,
      envMapIntensity: 1.1,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x7fadbd,
      roughness: 0.05,
      metalness: 0.12,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      ior: 1.45,
      specularIntensity: 1,
      envMapIntensity: 1.8,
    }),
    // Interior-lit panes: a touch of emissive keeps windows readable at card size.
    glassLight: new THREE.MeshPhysicalMaterial({
      color: 0xd3e4e7,
      roughness: 0.09,
      metalness: 0.06,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      ior: 1.45,
      emissive: new THREE.Color(0xffe3b8),
      emissiveIntensity: 0.22,
      envMapIntensity: 1.4,
    }),
    glassRail: new THREE.MeshPhysicalMaterial({
      color: 0xcfe3e8,
      roughness: 0.05,
      metalness: 0.04,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      envMapIntensity: 1.5,
    }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x5cc2cd,
      roughness: 0.04,
      metalness: 0.02,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      clearcoat: 1,
      envMapIntensity: 1.6,
    }),
    foliage: new THREE.MeshStandardMaterial({
      color: 0x7ba367,
      roughness: 0.95,
      flatShading: true,
      envMapIntensity: 0.5,
    }),
    foliageDark: new THREE.MeshStandardMaterial({
      color: 0x5d8455,
      roughness: 0.95,
      flatShading: true,
      envMapIntensity: 0.5,
    }),
    grass: surface(0x8fae74, 0.98),
  };
}

function box(
  builder: Builder,
  parent: THREE.Object3D,
  size: Vec3,
  position: Vec3,
  material: THREE.Material,
  placement: Placement = {},
) {
  const [width, height, depth] = size;
  const smallest = Math.min(width, height, depth);
  const radius = Math.min(placement.radius ?? 0.035, smallest / 2 - 0.001);
  const geometry = boxGeometry(builder, size, smallest > 0.07 && radius > 0.005 ? radius : 0);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(placement.rotX ?? 0, placement.rotY ?? 0, placement.rotZ ?? 0);
  mesh.castShadow = placement.shadow ?? true;
  mesh.receiveShadow = placement.shadow ?? true;
  parent.add(mesh);
  return mesh;
}

function boxGeometry(builder: Builder, size: Vec3, radius: number) {
  const key = `${size.join(":")}:${radius}`;
  const cached = builder.geometryCache.get(key);
  if (cached) return cached;

  const geometry =
    radius > 0
      ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, radius)
      : new THREE.BoxGeometry(...size);
  builder.geometryCache.set(key, geometry);
  return builder.track(geometry);
}

/** One draw call for repeated architectural modules such as mullions and floor bands. */
function boxInstances(
  builder: Builder,
  parent: THREE.Object3D,
  size: Vec3,
  positions: Vec3[],
  material: THREE.Material,
  placement: Placement = {},
) {
  if (positions.length === 0) return null;
  const smallest = Math.min(...size);
  const radius = Math.min(placement.radius ?? 0.035, smallest / 2 - 0.001);
  const geometry = boxGeometry(builder, size, smallest > 0.07 && radius > 0.005 ? radius : 0);
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(placement.rotX ?? 0, placement.rotY ?? 0, placement.rotZ ?? 0),
  );
  const scale = new THREE.Vector3(1, 1, 1);

  positions.forEach((position, index) => {
    matrix.compose(new THREE.Vector3(...position), quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = placement.shadow ?? true;
  mesh.receiveShadow = placement.shadow ?? true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

function cylinder(
  builder: Builder,
  parent: THREE.Object3D,
  radius: number,
  height: number,
  position: Vec3,
  material: THREE.Material,
  placement: Placement & { segments?: number } = {},
) {
  const geometry = builder.track(
    new THREE.CylinderGeometry(radius, radius, height, placement.segments ?? 16),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(placement.rotX ?? 0, placement.rotY ?? 0, placement.rotZ ?? 0);
  mesh.castShadow = placement.shadow ?? true;
  mesh.receiveShadow = placement.shadow ?? true;
  parent.add(mesh);
  return mesh;
}

/** A glazed opening: tinted pane, slim frame and evenly spaced mullions. */
function glazing(
  builder: Builder,
  parent: THREE.Object3D,
  options: {
    width: number;
    height: number;
    position: Vec3;
    facing: "x" | "z";
    material?: THREE.Material;
    mullions?: number;
    frame?: boolean;
  },
) {
  const { width, height, position, facing, mullions = 0, frame = true } = options;
  const material = options.material ?? builder.materials.glass;
  const thickness = 0.07;
  const along = (offset: number): Vec3 =>
    facing === "z"
      ? [position[0] + offset, position[1], position[2]]
      : [position[0], position[1], position[2] + offset];
  const plate = (long: number, tall: number): Vec3 =>
    facing === "z" ? [long, tall, thickness] : [thickness, tall, long];

  box(builder, parent, plate(width, height), position, material, {
    radius: 0,
    shadow: false,
  });

  if (frame) {
    const rail = plate(width + 0.05, 0.05);
    const barSize: Vec3 =
      facing === "z" ? [rail[0], rail[1], thickness + 0.03] : [thickness + 0.03, rail[1], rail[2]];
    box(
      builder,
      parent,
      barSize,
      [position[0], position[1] + height / 2, position[2]],
      builder.materials.warmWhite,
      { radius: 0, shadow: false },
    );
    box(
      builder,
      parent,
      barSize,
      [position[0], position[1] - height / 2, position[2]],
      builder.materials.warmWhite,
      { radius: 0, shadow: false },
    );
  }

  const mullionSize: Vec3 =
    facing === "z" ? [0.05, height, thickness + 0.03] : [thickness + 0.03, height, 0.05];
  const mullionPositions = Array.from({ length: mullions }, (_, index) => {
    const offset = -width / 2 + (width * (index + 1)) / (mullions + 1);
    return along(offset);
  });
  boxInstances(builder, parent, mullionSize, mullionPositions, builder.materials.charcoal, {
    radius: 0,
    shadow: false,
  });
}

/** Frameless glass balustrade with a slim metal cap rail. */
function railing(
  builder: Builder,
  parent: THREE.Object3D,
  options: { length: number; position: Vec3; facing: "x" | "z"; height?: number },
) {
  const { length, position, facing } = options;
  const height = options.height ?? 0.42;
  const [x, y, z] = position;
  const panel: Vec3 = facing === "z" ? [length, height, 0.035] : [0.035, height, length];
  const cap: Vec3 = facing === "z" ? [length + 0.04, 0.04, 0.07] : [0.07, 0.04, length + 0.04];

  box(builder, parent, panel, [x, y + height / 2, z], builder.materials.glassRail, {
    radius: 0,
    shadow: false,
  });
  box(builder, parent, cap, [x, y + height, z], builder.materials.steel, { radius: 0.015 });
}

/** Timber slat screen — used for garage doors, sun screens and privacy walls. */
function slatScreen(
  builder: Builder,
  parent: THREE.Object3D,
  options: {
    width: number;
    height: number;
    position: Vec3;
    facing: "x" | "z";
    count?: number;
  },
) {
  const { width, height, position, facing } = options;
  const count = options.count ?? Math.max(4, Math.round(height / 0.18));
  const [x, y, z] = position;
  const backing: Vec3 = facing === "z" ? [width, height, 0.06] : [0.06, height, width];
  box(builder, parent, backing, position, builder.materials.charcoal, { radius: 0 });

  const gap = height / count;
  const slatPositions = Array.from({ length: count }, (_, index): Vec3 => {
    const slatY = y - height / 2 + gap * (index + 0.5);
    return facing === "z" ? [x, slatY, z + 0.04] : [x + 0.04, slatY, z];
  });
  const slatSize: Vec3 =
    facing === "z" ? [width, gap * 0.68, 0.07] : [0.07, gap * 0.68, width];
  boxInstances(builder, parent, slatSize, slatPositions, builder.materials.wood, {
    radius: 0.012,
  });
}

function tree(
  builder: Builder,
  parent: THREE.Object3D,
  position: Vec3,
  scale = 1,
  dark = false,
) {
  const [x, y, z] = position;
  const foliage = dark ? builder.materials.foliageDark : builder.materials.foliage;
  cylinder(builder, parent, 0.055 * scale, 0.75 * scale, [x, y + 0.37 * scale, z], builder.materials.woodDark, {
    segments: 8,
  });

  const crown = builder.track(new THREE.IcosahedronGeometry(0.42 * scale, 0));
  const lower = new THREE.Mesh(crown, foliage);
  lower.position.set(x, y + 0.92 * scale, z);
  lower.scale.set(1, 0.9, 1);
  lower.rotation.y = 0.6;
  lower.castShadow = true;
  parent.add(lower);

  const upper = new THREE.Mesh(crown, dark ? builder.materials.foliage : builder.materials.foliageDark);
  upper.position.set(x + 0.06 * scale, y + 1.28 * scale, z - 0.04 * scale);
  upper.scale.setScalar(0.66);
  upper.rotation.y = -0.4;
  upper.castShadow = true;
  parent.add(upper);
}

function shrub(builder: Builder, parent: THREE.Object3D, position: Vec3, scale = 1) {
  const geometry = builder.track(new THREE.IcosahedronGeometry(0.24 * scale, 0));
  const mesh = new THREE.Mesh(geometry, builder.materials.foliage);
  mesh.position.set(position[0], position[1] + 0.18 * scale, position[2]);
  mesh.scale.set(1, 0.85, 1);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function hedge(
  builder: Builder,
  parent: THREE.Object3D,
  options: { length: number; position: Vec3; facing: "x" | "z" },
) {
  const { length, position, facing } = options;
  const size: Vec3 = facing === "z" ? [length, 0.34, 0.32] : [0.32, 0.34, length];
  box(builder, parent, size, [position[0], position[1] + 0.17, position[2]], builder.materials.foliageDark, {
    radius: 0.1,
  });
}

function planter(
  builder: Builder,
  parent: THREE.Object3D,
  position: Vec3,
  size: [number, number] = [0.5, 0.5],
) {
  const [x, y, z] = position;
  box(builder, parent, [size[0], 0.28, size[1]], [x, y + 0.14, z], builder.materials.stone, {
    radius: 0.04,
  });
  shrub(builder, parent, [x, y + 0.28, z], Math.min(size[0], size[1]) * 1.7);
}

function pool(
  builder: Builder,
  parent: THREE.Object3D,
  options: { width: number; depth: number; position: Vec3 },
) {
  const { width, depth, position } = options;
  const [x, y, z] = position;
  box(builder, parent, [width + 0.34, 0.13, depth + 0.34], [x, y + 0.065, z], builder.materials.deck, {
    radius: 0.03,
  });
  box(builder, parent, [width, 0.1, depth], [x, y + 0.09, z], builder.materials.water, {
    radius: 0.02,
    shadow: false,
  });
}

function pergola(
  builder: Builder,
  parent: THREE.Object3D,
  options: { width: number; depth: number; height: number; position: Vec3 },
) {
  const { width, depth, height, position } = options;
  const [x, y, z] = position;
  const postPositions = ([
    [-width / 2 + 0.06, -depth / 2 + 0.06],
    [width / 2 - 0.06, -depth / 2 + 0.06],
    [-width / 2 + 0.06, depth / 2 - 0.06],
    [width / 2 - 0.06, depth / 2 - 0.06],
  ] as const).map(([dx, dz]): Vec3 => [x + dx, y + height / 2, z + dz]);
  boxInstances(builder, parent, [0.09, height, 0.09], postPositions, builder.materials.woodDark, {
    radius: 0.015,
  });
  const slats = Math.max(4, Math.round(width / 0.28));
  const slatPositions = Array.from({ length: slats }, (_, index): Vec3 => {
    const offset = -width / 2 + (width * (index + 0.5)) / slats;
    return [x + offset, y + height, z];
  });
  boxInstances(builder, parent, [0.07, 0.07, depth], slatPositions, builder.materials.wood, {
    radius: 0.015,
  });
}

function steps(
  builder: Builder,
  parent: THREE.Object3D,
  options: { width: number; count: number; rise: number; run: number; position: Vec3 },
) {
  const { width, count, rise, run, position } = options;
  const [x, y, z] = position;
  for (let index = 0; index < count; index += 1) {
    const depth = run * (count - index);
    box(
      builder,
      parent,
      [width, rise, depth],
      [x, y + rise * (index + 0.5), z + depth / 2],
      builder.materials.deck,
      { radius: 0.012 },
    );
  }
}

function buildHouse(builder: Builder, group: THREE.Group) {
  const m = builder.materials;
  const pad = 0.16;

  // A compact L-shaped villa: broad glazing and the cantilever carry at thumbnail size.
  box(builder, group, [6.6, pad, 4.5], [0, pad / 2, 0], m.deck, { radius: 0.05 });
  box(builder, group, [1.8, 0.06, 0.85], [2.15, pad + 0.03, 1.72], m.grass, { radius: 0.03 });
  box(builder, group, [3.9, 1.35, 2.45], [-0.45, pad + 0.675, -0.3], m.plaster, { radius: 0.045 });
  box(builder, group, [1.7, 1.18, 2.1], [2.05, pad + 0.59, 0.25], m.stone, { radius: 0.04 });
  box(builder, group, [3.3, 1.25, 2.2], [-0.12, 2.13, -0.46], m.warmWhite, { radius: 0.045 });
  box(builder, group, [3.7, 0.16, 2.58], [-0.12, 2.84, -0.43], m.warmWhite, { radius: 0.03 });

  glazing(builder, group, {
    width: 2.55,
    height: 1.03,
    position: [-0.95, 0.86, 0.94],
    facing: "z",
    material: m.glassLight,
    mullions: 3,
  });
  glazing(builder, group, {
    width: 1.65,
    height: 0.85,
    position: [-0.7, 2.14, 0.66],
    facing: "z",
    mullions: 1,
  });
  glazing(builder, group, {
    width: 1.5,
    height: 0.86,
    position: [-1.78, 2.14, -0.46],
    facing: "x",
  });
  box(builder, group, [0.72, 1.18, 0.08], [0.72, 0.78, 0.94], m.charcoal, { radius: 0.015 });
  box(builder, group, [1.45, 0.1, 0.72], [0.72, 1.48, 1.22], m.warmWhite, { radius: 0.02 });
  slatScreen(builder, group, {
    width: 1.35,
    height: 0.92,
    position: [2.05, 0.78, 1.32],
    facing: "z",
    count: 6,
  });

  // Open roof court, inspired by the pale aqua roof pool in the reference.
  box(builder, group, [1.5, 0.07, 0.72], [0.55, 2.97, -0.55], m.water, {
    radius: 0.025,
    shadow: false,
  });
  boxInstances(
    builder,
    group,
    [0.1, 0.3, 2.35],
    [[-1.92, 3.02, -0.43], [1.68, 3.02, -0.43]],
    m.warmWhite,
    { radius: 0.015 },
  );
  box(builder, group, [3.7, 0.3, 0.1], [-0.12, 3.02, -1.67], m.warmWhite, { radius: 0.015 });

  pool(builder, group, { width: 2.15, depth: 1.0, position: [-1.75, pad, 1.58] });
  steps(builder, group, { width: 1.15, count: 3, rise: 0.055, run: 0.2, position: [0.72, pad, 1.03] });
  tree(builder, group, [-2.85, pad, -1.65], 0.9);
  tree(builder, group, [2.75, pad, 1.7], 0.72, true);
  hedge(builder, group, { length: 2.5, position: [0.45, pad, 2.02], facing: "z" });
}

function buildMansion(builder: Builder, group: THREE.Group) {
  const m = builder.materials;
  const pad = 0.18;

  // Strong symmetry separates the mansion from the asymmetric house at a glance.
  box(builder, group, [7.8, pad, 5.25], [0, pad / 2, 0], m.stone, { radius: 0.05 });
  box(builder, group, [2.75, 2.35, 2.55], [0, pad + 1.175, -0.38], m.warmWhite, { radius: 0.045 });
  box(builder, group, [3.15, 1.05, 2.1], [0, 2.72, -0.48], m.plaster, { radius: 0.04 });
  box(builder, group, [3.45, 0.16, 2.4], [0, 3.32, -0.48], m.warmWhite, { radius: 0.03 });

  for (const side of [-1, 1] as const) {
    const x = side * 2.45;
    box(builder, group, [2.15, 1.72, 2.45], [x, pad + 0.86, -0.05], m.plaster, { radius: 0.04 });
    box(builder, group, [2.42, 0.15, 2.75], [x, 2.0, -0.05], m.deck, { radius: 0.03 });
    glazing(builder, group, {
      width: 1.45,
      height: 1.08,
      position: [x, 0.92, 1.2],
      facing: "z",
      material: side < 0 ? m.glass : m.glassLight,
      mullions: 1,
    });
    glazing(builder, group, {
      width: 1.55,
      height: 1.02,
      position: [x + side * 1.09, 0.92, -0.05],
      facing: "x",
    });
    railing(builder, group, { length: 2.35, position: [x, 2.08, 1.24], facing: "z" });
  }

  // Portico, entry axis and upper balcony.
  box(builder, group, [0.92, 1.25, 0.08], [0, 0.82, 0.9], m.woodDark, { radius: 0.015 });
  box(builder, group, [3.15, 0.14, 1.25], [0, 1.62, 1.45], m.warmWhite, { radius: 0.025 });
  const columnXs = [-1.25, -0.42, 0.42, 1.25];
  for (const x of columnXs) {
    cylinder(builder, group, 0.09, 1.38, [x, pad + 0.69, 1.93], m.warmWhite, { segments: 12 });
  }
  glazing(builder, group, {
    width: 2.15,
    height: 0.78,
    position: [0, 2.73, 0.59],
    facing: "z",
    material: m.glassLight,
    mullions: 2,
  });
  railing(builder, group, { length: 3.0, position: [0, 1.7, 2.02], facing: "z" });
  steps(builder, group, { width: 1.75, count: 3, rise: 0.06, run: 0.16, position: [0, pad, 2.05] });

  pergola(builder, group, { width: 1.7, depth: 1.45, height: 0.82, position: [2.45, 2.08, -0.05] });
  planter(builder, group, [-2.9, 2.08, -0.7], [0.5, 0.5]);
  pool(builder, group, { width: 2.8, depth: 1.1, position: [-2.2, pad, 1.92] });
  tree(builder, group, [-3.35, pad, -1.85], 1.0);
  tree(builder, group, [3.3, pad, -1.75], 0.92, true);
  tree(builder, group, [3.3, pad, 1.75], 0.72);
  hedge(builder, group, { length: 3.0, position: [1.6, pad, 2.28], facing: "z" });
}

function buildSkyscraper(builder: Builder, group: THREE.Group) {
  const m = builder.materials;
  const pad = 0.18;
  const towerX = -0.18;
  const towerZ = -0.18;

  // A clear podium, tall shaft and stepped crown read better than miniature roof furniture.
  box(builder, group, [6.0, pad, 4.7], [0, pad / 2, 0], m.stone, { radius: 0.05 });
  box(builder, group, [4.0, 1.0, 3.1], [0, pad + 0.5, 0], m.warmWhite, { radius: 0.04 });
  glazing(builder, group, {
    width: 3.45,
    height: 0.76,
    position: [0, 0.68, 1.57],
    facing: "z",
    material: m.glassLight,
    mullions: 5,
  });
  glazing(builder, group, {
    width: 2.55,
    height: 0.76,
    position: [2.02, 0.68, 0],
    facing: "x",
    mullions: 4,
  });
  box(builder, group, [4.35, 0.16, 3.45], [0, 1.25, 0], m.deck, { radius: 0.03 });

  // Lower curtain-wall shaft.
  box(builder, group, [2.7, 4.65, 2.12], [towerX, 3.63, towerZ], m.charcoal, { radius: 0.035 });
  const lowerFloors = Array.from({ length: 10 }, (_, floor) => 1.48 + floor * 0.45);
  boxInstances(
    builder,
    group,
    [2.84, 0.09, 2.26],
    lowerFloors.map((y): Vec3 => [towerX, y, towerZ]),
    m.warmWhite,
    { radius: 0.018 },
  );
  boxInstances(
    builder,
    group,
    [2.42, 0.3, 0.06],
    lowerFloors.map((y): Vec3 => [towerX, y + 0.21, towerZ + 1.09]),
    m.glass,
    { radius: 0, shadow: false },
  );
  boxInstances(
    builder,
    group,
    [0.06, 0.3, 1.82],
    lowerFloors.map((y): Vec3 => [towerX + 1.38, y + 0.21, towerZ]),
    m.glassLight,
    { radius: 0, shadow: false },
  );

  // Setback upper tower and crown.
  box(builder, group, [2.2, 2.35, 1.72], [towerX - 0.12, 7.08, towerZ - 0.05], m.charcoal, {
    radius: 0.035,
  });
  const upperFloors = Array.from({ length: 5 }, (_, floor) => 6.08 + floor * 0.43);
  boxInstances(
    builder,
    group,
    [2.32, 0.09, 1.84],
    upperFloors.map((y): Vec3 => [towerX - 0.12, y, towerZ - 0.05]),
    m.warmWhite,
    { radius: 0.018 },
  );
  boxInstances(
    builder,
    group,
    [1.92, 0.28, 0.06],
    upperFloors.map((y): Vec3 => [towerX - 0.12, y + 0.2, towerZ + 0.84]),
    m.glassLight,
    { radius: 0, shadow: false },
  );
  box(builder, group, [1.7, 0.48, 1.25], [towerX - 0.18, 8.54, towerZ - 0.08], m.warmWhite, {
    radius: 0.035,
  });
  cylinder(builder, group, 0.045, 1.1, [towerX + 0.28, 9.3, towerZ - 0.08], m.steel, {
    segments: 8,
  });

  boxInstances(
    builder,
    group,
    [0.08, 6.85, 0.15],
    [towerX - 1.29, towerX, towerX + 1.29].map((x): Vec3 => [x, 4.8, towerZ + 1.13]),
    m.steel,
    { radius: 0.012 },
  );
  box(builder, group, [3.15, 0.14, 2.55], [towerX, 5.88, towerZ], m.deck, { radius: 0.025 });
  railing(builder, group, { length: 3.05, position: [towerX, 5.96, towerZ + 1.22], facing: "z" });
  planter(builder, group, [towerX + 1.1, 5.96, towerZ + 0.92], [0.5, 0.5]);

  pool(builder, group, { width: 1.8, depth: 0.66, position: [-0.5, pad, 1.92] });
  tree(builder, group, [-2.45, pad, 1.75], 0.78);
  tree(builder, group, [2.35, pad, 1.72], 0.7, true);
  hedge(builder, group, { length: 1.8, position: [1.7, pad, -1.95], facing: "z" });
}
