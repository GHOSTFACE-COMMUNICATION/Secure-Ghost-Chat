import React, { Suspense, forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { View } from "react-native";
import { Canvas, useFrame, useLoader } from "@react-three/fiber/native";
import * as THREE from "three";
import { Asset } from "expo-asset";

// Same real designed artwork the lock screen's GhostRevealMark uses.
const GHOST_MARK_URI = Asset.fromModule(
  require("@/assets/images/ghostface-mark-gold.webp"),
).uri;

const IMPULSE = 0.16;
const FRICTION = 0.96;
const REST_THRESHOLD = 0.0008;
// Hold-to-stop damps much harder than natural friction, so it reads as an
// intentional "grab and stop" rather than just a faster coast-down.
const HOLD_DAMPING = 0.72;

export interface GhostCoinHandle {
  /** Impart a spin impulse — call on tap. */
  flick: () => void;
}

function CoinMesh({ held }: { held: boolean }, ref: React.Ref<GhostCoinHandle>) {
  const meshRef = useRef<THREE.Mesh>(null);
  const velocity = useRef(0);
  const heldRef = useRef(held);
  heldRef.current = held;

  useImperativeHandle(ref, () => ({
    flick: () => {
      velocity.current += IMPULSE;
    },
  }));

  const texture = useLoader(THREE.TextureLoader, GHOST_MARK_URI);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Expo's GL texture upload is flipped relative to standard web <img>
  // sources — without this the mark renders mirrored vertically.
  texture.flipY = false;

  // Cylinder's default axis is Y (caps face up/down) — baked 90° so the
  // caps face the camera (+Z/-Z) instead of showing the coin edge-on,
  // which is what the raw geometry would do at the default camera
  // position. Baking it into the geometry (once) rather than the mesh's
  // own rotation keeps the spin math below simple: after this bake, the
  // coin's face-normal is Z, so an in-plane "wheel" spin is rotation.z,
  // not rotation.y.
  const geometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(1, 1, 0.22, 64);
    geo.rotateX(Math.PI / 2);
    return geo;
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (heldRef.current) {
      velocity.current *= HOLD_DAMPING;
    }

    if (Math.abs(velocity.current) > REST_THRESHOLD) {
      mesh.rotation.z += velocity.current;
      // Slight wobble on the two non-spin axes — a bit of "liquid glass"
      // parallax rather than a perfectly flat, mechanical spin.
      mesh.rotation.x = Math.sin(velocity.current * 20) * 0.12;
      mesh.rotation.y = Math.cos(velocity.current * 15) * 0.08;
      velocity.current *= FRICTION;
    } else {
      // Magnetic lock: settle upright and dead still rather than drifting
      // to an arbitrary rest angle.
      velocity.current = 0;
      mesh.rotation.z = Math.round(mesh.rotation.z / (Math.PI * 2)) * (Math.PI * 2);
      mesh.rotation.x = 0;
      mesh.rotation.y = 0;
    }
  });

  // React.createElement instead of JSX for the raw Three.js host elements
  // below: this project's tsconfig uses the classic "jsx": "react-native"
  // transform, and @react-three/fiber's JSX.IntrinsicElements augmentation
  // (targeting the newer automatic-runtime namespace) doesn't merge into
  // it, so TypeScript sees mesh/meshPhysicalMaterial/etc. as unknown tags.
  // createElement needs no such typing — it's a plain function call — so
  // this sidesteps the mismatch entirely without a fragile custom .d.ts.
  // Purely a compile-time workaround; identical at runtime to JSX.
  return React.createElement(
    "mesh",
    { ref: meshRef, geometry },
    // Rim — liquid-glass hyper-gloss.
    React.createElement("meshPhysicalMaterial", {
      key: "rim",
      attach: "material-0",
      transmission: 1,
      thickness: 0.4,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0,
      reflectivity: 1,
      ior: 1.5,
      color: "#f4e2a1",
    }),
    // Front face — the real mark, textured.
    React.createElement("meshPhysicalMaterial", {
      key: "front",
      attach: "material-1",
      map: texture,
      transparent: true,
      roughness: 0.2,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      reflectivity: 0.6,
      color: "#ffffff",
    }),
    // Back face — plain gold.
    React.createElement("meshStandardMaterial", {
      key: "back",
      attach: "material-2",
      color: "#5c4713",
      metalness: 0.7,
      roughness: 0.35,
    }),
  );
}

const CoinMeshWithRef = forwardRef(CoinMesh);

export const GhostCoin = forwardRef<GhostCoinHandle, { size?: number; held?: boolean; active?: boolean }>(
  function GhostCoin({ size = 184, held = false, active = true }, ref) {
    return (
      <View style={{ width: size, height: size }}>
        <Canvas
          style={{ width: size, height: size }}
          frameloop={active ? "always" : "never"}
          camera={{ position: [0, 0, 3.1], fov: 40 }}
        >
          {/* React.createElement here too, same reason as CoinMesh's
              materials — see comment there. */}
          {React.createElement("ambientLight", { intensity: 0.55 })}
          {React.createElement("directionalLight", { intensity: 1.1, position: [3, 4, 5] })}
          {React.createElement("directionalLight", {
            intensity: 0.4,
            position: [-3, -2, 2],
            color: "#f4e2a1",
          })}
          <Suspense fallback={null}>
            <CoinMeshWithRef ref={ref} held={held} />
          </Suspense>
        </Canvas>
      </View>
    );
  },
);
