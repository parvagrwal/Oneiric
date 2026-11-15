// 3D Moon view: navigation and presentation only. It reads sites, grades, and the engine's Sun and Earth
// directions; it never changes a verdict, a metric, or a grade. Loaded on demand, after the first paint.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js';
import * as THREE from 'three';
import type { Grade, Vec3 } from '../../engine/index.ts';
import {
  NEAR_SIDE_POSE,
  buildMoonSphere,
  latLonToScene,
  moonToScene,
  poseToScene,
  type CameraPose,
} from './globe-math.ts';
import { gradeColor } from './grade-style.ts';
import { moonTextureCandidates, type SurfaceState } from './moon-texture.ts';
import type { SiteDefinition } from './scenario.ts';

const MIN_DISTANCE = 1.22;
const MAX_DISTANCE = 6;
const SUN_COLOR = '#f7c948';
const EARTH_COLOR = '#5fd4e6';
const TEXTURE_TIMEOUT_MS = 20_000;

export interface PoseRequest {
  pose: CameraPose;
  nonce: number;
}

export interface ZoomRequest {
  factor: number;
  nonce: number;
}

export interface MoonGlobeProps {
  sites: SiteDefinition[];
  grades: Map<string, Grade>;
  activeSiteId: string;
  comparedSiteIds: Set<string>;
  /** Unit vectors from the Moon's centre in MOON_ME, from the engine's ephemeris at the selected time. */
  sunDir: Vec3 | null;
  earthDir: Vec3 | null;
  poseRequest: PoseRequest;
  zoomRequest: ZoomRequest;
  autoRotate: boolean;
  wheelZoom: boolean;
  /** false pauses the render loop (hero off screen or tab hidden). */
  running: boolean;
  onPickSite: (siteId: string) => void;
  onHoverSite: (siteId: string | null) => void;
  onUserInteract: () => void;
  onSurface: (state: SurfaceState) => void;
  onReady: () => void;
  onContextLost: () => void;
}

function CameraRig({
  poseRequest,
  zoomRequest,
  autoRotate,
  wheelZoom,
  onUserInteract,
}: Pick<MoonGlobeProps, 'poseRequest' | 'zoomRequest' | 'autoRotate' | 'wheelZoom' | 'onUserInteract'>) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);
  const flight = useRef<THREE.Spherical | null>(null);
  const scratch = useRef(new THREE.Spherical());

  useEffect(() => {
    const [x, y, z] = poseToScene(poseRequest.pose);
    flight.current = new THREE.Spherical().setFromVector3(new THREE.Vector3(x, y, z));
  }, [poseRequest]);

  useEffect(() => {
    if (zoomRequest.nonce === 0) return;
    const base = flight.current ?? new THREE.Spherical().setFromVector3(camera.position);
    const radius = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, base.radius * zoomRequest.factor));
    flight.current = new THREE.Spherical(radius, base.phi, base.theta);
  }, [camera, zoomRequest]);

  useFrame((_, delta) => {
    const target = flight.current;
    if (controls.current) controls.current.autoRotate = autoRotate && !target;
    if (!target) return;
    const current = scratch.current.setFromVector3(camera.position);
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 3.4);
    const dTheta = Math.atan2(Math.sin(target.theta - current.theta), Math.cos(target.theta - current.theta));
    const dPhi = target.phi - current.phi;
    const dRadius = target.radius - current.radius;
    current.set(current.radius + dRadius * k, current.phi + dPhi * k, current.theta + dTheta * k);
    camera.position.setFromSpherical(current);
    camera.lookAt(0, 0, 0);
    if (Math.abs(dRadius) < 0.003 && Math.abs(dPhi) < 0.003 && Math.abs(dTheta) < 0.003) flight.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.09}
      rotateSpeed={0.5}
      zoomSpeed={0.7}
      enableZoom={wheelZoom}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={0.1}
      maxPolarAngle={Math.PI - 0.1}
      autoRotateSpeed={0.4}
      onStart={() => {
        flight.current = null;
        onUserInteract();
      }}
    />
  );
}

function MoonSurface({ onSurface }: { onSurface: (state: SurfaceState) => void }) {
  const gl = useThree((state) => state.gl);
  const [map, setMap] = useState<THREE.Texture | null>(null);

  const geometry = useMemo(() => {
    const mesh = buildMoonSphere(128, 64);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const candidates = moonTextureCandidates();
    onSurface('loading');
    // If the picture is slow, say so and keep the plain sphere; a late arrival is still used.
    const slow = window.setTimeout(() => {
      if (!cancelled && !loaded) onSurface('plain');
    }, TEXTURE_TIMEOUT_MS);
    const attempt = (index: number) => {
      if (cancelled) return;
      if (index >= candidates.length) {
        window.clearTimeout(slow);
        onSurface('plain');
        return;
      }
      loader.load(
        candidates[index],
        (texture) => {
          if (cancelled) {
            texture.dispose();
            return;
          }
          window.clearTimeout(slow);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
          loaded = texture;
          setMap(texture);
          onSurface('ready');
        },
        undefined,
        () => attempt(index + 1),
      );
    };
    attempt(0);
    return () => {
      cancelled = true;
      window.clearTimeout(slow);
      loaded?.dispose();
    };
  }, [gl, onSurface]);

  return (
    <mesh
      geometry={geometry}
      // The Moon blocks the pointer, so markers on the far side cannot be hovered or clicked through it.
      onClick={(event) => event.stopPropagation()}
      onPointerOver={(event) => event.stopPropagation()}
    >
      <meshStandardMaterial
        key={map ? 'textured' : 'plain'}
        map={map}
        color={map ? '#ffffff' : '#8f949b'}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

/** Thin latitude and longitude lines every 30 degrees, drawn just above the surface. */
function Graticule() {
  const line = useMemo(() => {
    const points: number[] = [];
    const radius = 1.0015;
    const push = (lat0: number, lon0: number, lat1: number, lon1: number) => {
      points.push(...latLonToScene(lat0, lon0, radius), ...latLonToScene(lat1, lon1, radius));
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = 0; lon < 360; lon += 4) push(lat, lon, lat, lon + 4);
    }
    // The 80° S circle marks the edge of the 20 m polar elevation product.
    for (let lon = 0; lon < 360; lon += 4) push(-80, lon, -80, lon + 4);
    for (let lon = 0; lon < 360; lon += 30) {
      for (let lat = -88; lat < 88; lat += 4) push(lat, lon, lat + 4, lon);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: '#9fd8e6', transparent: true, opacity: 0.13, depthWrite: false });
    return new THREE.LineSegments(geometry, material);
  }, []);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

function labelTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const height = 64;
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  const font = `600 30px 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace`;
  let width = 256;
  if (probe) {
    probe.font = font;
    width = Math.min(1024, Math.ceil(probe.measureText(text).width) + 36);
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(5, 7, 11, 0.82)';
    context.fillRect(0, 6, width, height - 12);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.strokeRect(1, 7, width - 2, height - 14);
    context.font = font;
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    context.fillStyle = color;
    context.fillText(text, width / 2, height / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

/** Keeps its children the same size on screen whatever the camera distance. */
function ScreenScaled({ position, size, children }: { position: Vec3; size: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    g.scale.setScalar(camera.position.distanceTo(g.position) * size);
  });
  return (
    <group ref={group} position={position}>
      {children}
    </group>
  );
}

function Label({ text, color, lift = 1.6 }: { text: string; color: string; lift?: number }) {
  const { texture, aspect } = useMemo(() => labelTexture(text, color), [color, text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite scale={[aspect * 3.4, 3.4, 1]} center={[0.5, -lift * 0.5]} renderOrder={5}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

function DirectionPointer({ direction, color, label }: { direction: Vec3; color: string; label: string }) {
  const scene = moonToScene(direction);
  const tip: Vec3 = [scene[0] * 1.3, scene[1] * 1.3, scene[2] * 1.3];
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    return new THREE.Line(geometry, material);
  }, [color]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );
  useEffect(() => {
    const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.setXYZ(0, scene[0] * 1.012, scene[1] * 1.012, scene[2] * 1.012);
    attribute.setXYZ(1, tip[0], tip[1], tip[2]);
    attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  });
  return (
    <>
      <primitive object={line} />
      <ScreenScaled position={tip} size={0.0075}>
        <mesh>
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <Label text={label} color={color} />
      </ScreenScaled>
    </>
  );
}

function SiteMarker({
  site,
  grade,
  active,
  compared,
  onPick,
  onHover,
}: {
  site: SiteDefinition;
  grade: Grade | undefined;
  active: boolean;
  compared: boolean;
  onPick: (siteId: string) => void;
  onHover: (siteId: string | null) => void;
}) {
  const position = useMemo(() => latLonToScene(site.lat, site.eLon, 1.004), [site.eLon, site.lat]);
  const ring = useRef<THREE.Mesh>(null);
  const outward = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...position).normalize()),
    [position],
  );
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + 0.18 * Math.sin(clock.elapsedTime * 3));
  });
  const color = gradeColor(grade);
  const size = active ? 0.0085 : compared ? 0.0072 : 0.0058;
  return (
    <ScreenScaled position={position} size={size}>
      <mesh
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          // A drag that happens to end on a marker is a rotation, not a pick.
          if (event.delta <= 6) onPick(site.id);
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover(site.id);
        }}
        onPointerOut={() => onHover(null)}
      >
        <sphereGeometry args={[2.6, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1, 18, 14]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {(active || compared) && (
        <mesh ref={active ? ring : undefined} quaternion={outward}>
          <ringGeometry args={[1.7, 2.15, 40]} />
          <meshBasicMaterial color={active ? '#ffffff' : color} side={THREE.DoubleSide} transparent opacity={active ? 0.95 : 0.7} />
        </mesh>
      )}
      {active && <Label text={site.name} color="#ffffff" lift={2.4} />}
    </ScreenScaled>
  );
}

export function MoonScene(props: MoonGlobeProps) {
  const sunScene = props.sunDir ? moonToScene(props.sunDir) : null;
  // Until the ephemeris arrives the Moon is lit from the viewer's side, so it is never a black disc.
  const light: Vec3 = sunScene ?? [0.5, 0.35, 1];
  return (
    <>
      <ambientLight intensity={0.22} />
      <directionalLight position={[light[0] * 10, light[1] * 10, light[2] * 10]} intensity={3.1} color="#fff5e4" />
      <MoonSurface onSurface={props.onSurface} />
      <Graticule />
      {props.sunDir && <DirectionPointer direction={props.sunDir} color={SUN_COLOR} label="SUN" />}
      {props.earthDir && <DirectionPointer direction={props.earthDir} color={EARTH_COLOR} label="EARTH" />}
      {props.sites.map((site) => (
        <SiteMarker
          key={site.id}
          site={site}
          grade={site.isCustom ? 'D' : props.grades.get(site.id)}
          active={site.id === props.activeSiteId}
          compared={props.comparedSiteIds.has(site.id)}
          onPick={props.onPickSite}
          onHover={props.onHoverSite}
        />
      ))}
      <CameraRig
        poseRequest={props.poseRequest}
        zoomRequest={props.zoomRequest}
        autoRotate={props.autoRotate}
        wheelZoom={props.wheelZoom}
        onUserInteract={props.onUserInteract}
      />
    </>
  );
}

export default function MoonGlobe(props: MoonGlobeProps) {
  const { onReady, onContextLost } = props;
  return (
    <Canvas
      flat
      dpr={[1, 1.75]}
      frameloop={props.running ? 'always' : 'never'}
      camera={{ position: poseToScene(NEAR_SIDE_POSE), fov: 38, near: 0.05, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onContextLost();
        });
        onReady();
      }}
      aria-label="3D Moon with the site library, the Sun direction, and the Earth direction. The site list below offers the same choices."
      role="img"
    >
      <MoonScene {...props} />
    </Canvas>
  );
}
