import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { Canvas, useFrame } from "@react-three/fiber/native";
import * as THREE from "three";
import { Asset } from "expo-asset";

// Same real designed artwork the lock screen's GhostRevealMark uses.
const GHOST_MARK_ASSET = Asset.fromModule(require("@/assets/images/ghostface-mark-gold.webp"));

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

function CoinMesh(
  { held }: { held: boolean },
  ref: React.Ref<GhostCoinHandle>,
) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const velocity = useRef(0);
  const heldRef = useRef(held);
  heldRef.current = held;

  useImperativeHandle(ref, () => ({
    flick: () => {
      velocity.current += IMPULSE;
    },
  }));

  // Manual texture loading instead of Suspense/useLoader — this app's
  // second WebGL crash attempt still crashed even with useLoader gated on
  // a confirmed-downloaded asset, so removing Suspense as a variable too
  // rather than assuming it was innocent. onError at least turns a texture
  // failure into a visible fallback instead of an unhandled state.
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    GHOST_MARK_ASSET.downloadAsync()
      .then(() => {
        if (cancelled) return;
        const uri = GHOST_MARK_ASSET.localUri ?? GHOST_MARK_ASSET.uri;
        new THREE.TextureLoader().load(
          uri,
          (tex) => {
            if (cancelled) return;
            tex.colorSpace = THREE.SRGBColorSpace;
            // Expo's GL texture upload is flipped relative to standard web
            // <img> sources — without this the mark renders mirrored.
            tex.flipY = false;
            setTexture(tex);
          },
          undefined,
          (err) => console.warn("[GhostCoin] texture load failed:", err),
        );
      })
      .catch((err) => console.warn("[GhostCoin] asset download failed:", err));
    return () => {
      cancelled = true;
    };
  }, []);

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

    const moving = Math.abs(velocity.current) > REST_THRESHOLD;
    if (moving) {
      mesh.rotation.z += velocity.current;
      // Multi-axis wobble on the two non-spin axes — a bit of parallax
      // depth rather than a perfectly flat, mechanical spin.
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

    // Glow intensity scales with spin speed.
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial;
      glowMat.opacity = Math.min(Math.abs(velocity.current) * 3, 0.5);
    }
  });

  if (!texture) return null;

  // React.createElement instead of JSX for the raw Three.js host elements
  // below: this project's tsconfig uses the classic "jsx": "react-native"
  // transform, and @react-three/fiber's JSX.IntrinsicElements augmentation
  // (targeting the newer automatic-runtime namespace) doesn't merge into
  // it, so TypeScript sees mesh/meshStandardMaterial/etc. as unknown tags.
  // createElement needs no such typing — it's a plain function call — so
  // this sidesteps the mismatch entirely without a fragile custom .d.ts.
  // Purely a compile-time workaround; identical at runtime to JSX.
  return React.createElement(
    "group",
    null,
    React.createElement(
      "mesh",
      { ref: meshRef, geometry },
      // Rim — glossy gold. meshStandardMaterial (not Physical): no
      // clearcoat/transmission, the two most GPU-demanding material
      // features and the ones this scene hasn't tested crash-free yet.
      React.createElement("meshStandardMaterial", {
        key: "rim",
        attach: "material-0",
        roughness: 0.15,
        metalness: 0.75,
        color: "#f4e2a1",
      }),
      // Front face — the real mark, textured.
      React.createElement("meshStandardMaterial", {
        key: "front",
        attach: "material-1",
        map: texture,
        transparent: true,
        roughness: 0.25,
        metalness: 0.4,
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
    ),
    // Glow shell — a slightly larger, additive, transparent sphere behind
    // the coin whose opacity is driven by spin speed each frame above.
    React.createElement(
      "mesh",
      { ref: glowRef, scale: 1.35 },
      React.createElement("sphereGeometry", { args: [1, 24, 24] }),
      React.createElement("meshBasicMaterial", {
        color: "#f4e2a1",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    ),
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
          {React.createElement("ambientLight", { intensity: 0.6 })}
          {React.createElement("directionalLight", { intensity: 1.1, position: [3, 4, 5] })}
          {React.createElement("directionalLight", {
            intensity: 0.4,
            position: [-3, -2, 2],
            color: "#f4e2a1",
          })}
          <CoinMeshWithRef ref={ref} held={held} />
        </Canvas>
      </View>
    );
  },
);
