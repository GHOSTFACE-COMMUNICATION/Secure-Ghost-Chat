import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Image, StyleSheet, Text, View } from "react-native";
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

// Independent motion constants for the layers added on top of the base
// coin — kept separate from IMPULSE/FRICTION/HOLD_DAMPING above since these
// layers spin/pulse continuously rather than decaying from a flick impulse.
const HOLO_ROTATION_SPEED = 0.7; // rad/s — hologram layer's own idle spin
const SHELL_ROTATION_SPEED = 0.15; // rad/s — slow drift on the glass shell
const PULSE_SPEED = 2.2; // rad/s — golden idle-glow breathing rate
const TRAIL_LAG = 0.85; // trail ring rotates slightly behind the coin
const HOLO_ASPECT = 952 / 1232; // ghostface-mark-gold.webp's native aspect ratio
const CORE_SPIN_SPEED = 0.2; // rad/s — wireframe globe's self-rotation
const CORE_ORBIT_SPEED = 0.5; // rad/s — globe's revolution around the coin center
// Flattened so the orbit path reads as a 3D ellipse seen at an angle rather
// than a flat circle face-on to the camera. Radius kept under the coin's own
// ~1.0 radius so the globe stays within the coin face as it travels.
const CORE_ORBIT_RADIUS_X = 0.6;
const CORE_ORBIT_RADIUS_Y = 0.25;

// outer_shell "liquid glass" fresnel rim, standing in for real
// transmission/refraction: MeshPhysicalMaterial's transmission pass
// unconditionally asks the renderer for a multisampled render-target copy
// of the scene (renderbufferStorageMultisample), which expo-gl's WebGL2
// implementation doesn't have — confirmed on-device, it throws every
// single frame and hangs the render loop instead of drawing anything. This
// shader needs none of that: it's a plain vertex/fragment pair (no
// render-to-texture, no MSAA), just a view-angle-based rim brightening on
// the shell's own surface — cheap "glass edge" glow instead of true
// see-through refraction.
const SHELL_VERTEX_SHADER = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SHELL_FRAGMENT_SHADER = `
  varying vec3 vNormal;
  uniform vec3 glowColor;
  uniform float intensity;
  void main() {
    float fresnel = pow(1.0 - clamp(abs(vNormal.z), 0.0, 1.0), 2.5);
    gl_FragColor = vec4(glowColor, fresnel * intensity);
  }
`;

function CoinMesh(
  { held }: { held: boolean },
  ref: React.Ref<GhostCoinHandle>,
) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const holoRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const shellMatRef = useRef<THREE.ShaderMaterial>(null);
  const trailRef = useRef<THREE.Points>(null);
  const pulsePhase = useRef(0);
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
  //
  // This does NOT go through THREE.TextureLoader/ImageLoader — those call
  // `document.createElementNS(...)` internally (three's utils.js), and
  // `document` doesn't exist under Hermes/RN, which is exactly what was
  // crashing texture loads here. Instead this builds the THREE.Texture by
  // hand and points `.image` at `{ localUri }`: expo-gl's native
  // texImage2D implementation (EXGLImageUtils.cpp) special-cases that
  // exact shape — a `file://` localUri string — and decodes the image
  // natively (stb_image) without ever touching a DOM Image/document. Same
  // mechanism expo-three's TextureLoader uses internally.
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    GHOST_MARK_ASSET.downloadAsync()
      .then(() => {
        if (cancelled) return;
        const uri = GHOST_MARK_ASSET.localUri;
        if (!uri) {
          console.warn("[GhostCoin] asset has no localUri after download");
          return;
        }
        const tex = new THREE.Texture();
        tex.image = { localUri: uri, width: GHOST_MARK_ASSET.width ?? 0, height: GHOST_MARK_ASSET.height ?? 0 };
        tex.colorSpace = THREE.SRGBColorSpace;
        // Expo's GL texture upload is flipped relative to standard web
        // <img> sources — without this the mark renders mirrored.
        tex.flipY = false;
        // The artwork isn't guaranteed power-of-two sized; mipmapping a
        // NPOT texture is what would actually throw/warn here, not the
        // manual image object above.
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        setTexture(tex);
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

  // Smoke-trail ring: a fixed scatter of points around the rim, rotated
  // slightly behind the coin's own spin each frame (see TRAIL_LAG below) so
  // it reads as particles being flung off rather than a static halo.
  const trailGeometry = useMemo(() => {
    const count = 40;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 1.05 + Math.random() * 0.25;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Hologram, glass shell, and pulse all run on their own continuous
    // clocks rather than off the flick-decay `velocity`, so they stay
    // "alive" even while the coin is at rest.
    pulsePhase.current += delta * PULSE_SPEED;
    const goldenPulse = Math.sin(pulsePhase.current) * 0.5 + 0.5;

    if (holoRef.current) {
      holoRef.current.rotation.y += delta * HOLO_ROTATION_SPEED;
    }
    if (shellRef.current) {
      shellRef.current.rotation.y += delta * SHELL_ROTATION_SPEED;
    }
    if (shellMatRef.current) {
      shellMatRef.current.uniforms.intensity.value = 0.5 + goldenPulse * 0.4;
    }
    if (coreRef.current) {
      // Globe both spins on its own axis AND revolves around the coin
      // center on a flattened elliptical path (CORE_ORBIT_RADIUS_X/Y) —
      // true orbit, not just self-rotation. z stays 0 so it never pokes
      // past the avatar_hologram plane at z=0.55 regardless of orbit phase.
      const t = state.clock.getElapsedTime();
      coreRef.current.rotation.y = t * CORE_SPIN_SPEED;
      coreRef.current.position.x = Math.cos(t * CORE_ORBIT_SPEED) * CORE_ORBIT_RADIUS_X;
      coreRef.current.position.y = Math.sin(t * CORE_ORBIT_SPEED) * CORE_ORBIT_RADIUS_Y;
    }

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

    // Glow intensity scales with spin speed, plus a slow golden idle pulse
    // so the coin still breathes gently when stopped.
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial;
      glowMat.opacity = Math.min(Math.abs(velocity.current) * 3, 0.5) + goldenPulse * 0.15;
    }

    // Smoke trail: only visible while actually spinning, lagging slightly
    // behind the coin's rotation so it reads as particles being shed.
    if (trailRef.current) {
      trailRef.current.rotation.z = mesh.rotation.z * TRAIL_LAG;
      const trailMat = trailRef.current.material as THREE.PointsMaterial;
      trailMat.opacity = Math.min(Math.abs(velocity.current) * 4, 0.45);
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
      // Rim — glossy gold. Kept on meshStandardMaterial (not Physical) so
      // the base coin itself stays on the cheap/stable material path even
      // though the outer_shell layer below now opts into transmission —
      // if that shell ever needs to be pulled for stability, the coin
      // underneath still renders correctly on its own.
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
    // the coin whose opacity is driven by spin speed (plus golden_pulse)
    // each frame above.
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
    // inner_core — wireframe gold globe, spinning in place (CORE_SPIN_SPEED
    // in the frame loop above) as a decorative "energy core" read through
    // the glass shell. Deliberately small/dim/sparse (0.32 radius, 16
    // segments, low opacity) — at the original 0.5/32-segment/opacity-0.8
    // spec it visually dominated the coin and the actual GHOSTFACE mark
    // (avatar_hologram) underneath became unreadable. This should sit
    // behind the mark as a subtle accent, not compete with it.
    React.createElement(
      "mesh",
      { ref: coreRef },
      React.createElement("sphereGeometry", { args: [0.32, 16, 16] }),
      React.createElement("meshStandardMaterial", {
        emissive: "#FFD700",
        emissiveIntensity: 1,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
      }),
    ),
    // avatar_hologram — the same ghost-mark artwork (the actual trademark),
    // reused as a second floating layer in front of the coin face rather
    // than refetched, with its own independent rotation
    // (HOLO_ROTATION_SPEED) so it reads as a projection. z pushed to 0.55,
    // clear of inner_core's 0.5 radius — it was previously at 0.35, which
    // the wireframe globe's own geometry pokes past, so the globe was
    // rendering in front of and blocking the real mark instead of behind
    // it. No color tint (was "#fff6dc") and higher opacity than the
    // original hologram spec — this needs to read as the actual artwork,
    // not a faint colored ghost of it.
    React.createElement(
      "mesh",
      { ref: holoRef, position: [0, 0, 0.55] },
      React.createElement("planeGeometry", { args: [1.6 * HOLO_ASPECT, 1.6] }),
      React.createElement("meshBasicMaterial", {
        map: texture,
        transparent: true,
        opacity: 0.95,
        color: "#ffffff",
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
    // smoke_trails — a ring of points around the rim, faded in with spin
    // speed and lagging the coin's own rotation (see TRAIL_LAG above).
    React.createElement(
      "points",
      { ref: trailRef, geometry: trailGeometry },
      React.createElement("pointsMaterial", {
        color: "#f4e2a1",
        size: 0.05,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    ),
    // outer_shell — "liquid glass" as a fresnel rim glow, encasing the
    // whole coin. Started as real MeshPhysicalMaterial transmission, which
    // is what the pseudo spec literally asked for — confirmed on-device to
    // hang the render loop (see SHELL_VERTEX_SHADER's comment above for
    // why), so this is the fresnel-shader fallback instead. Isolated to
    // this one mesh; can be dropped without touching the coin, core,
    // hologram, or trail layers above.
    React.createElement(
      "mesh",
      { ref: shellRef, scale: 1.5 },
      React.createElement("sphereGeometry", { args: [1, 32, 32] }),
      React.createElement("shaderMaterial", {
        ref: shellMatRef,
        vertexShader: SHELL_VERTEX_SHADER,
        fragmentShader: SHELL_FRAGMENT_SHADER,
        uniforms: {
          glowColor: { value: new THREE.Color("#f4e2a1") },
          intensity: { value: 0.5 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
}

const CoinMeshWithRef = forwardRef(CoinMesh);

export const GhostCoin = forwardRef<GhostCoinHandle, { size?: number; held?: boolean; active?: boolean }>(
  function GhostCoin({ size = 184, held = false, active = true }, ref) {
    return (
      <View style={{ width: size, height: size }}>
        {/* Static fallback, same artwork as the 3D coin's texture — visible
            underneath until (or unless) the WebGL texture/mesh finishes
            loading, so a texture-load failure leaves something on screen
            instead of a blank Canvas (see CoinMesh's `if (!texture) return
            null`, and its own comment on this scene's WebGL fragility). */}
        <Image
          source={require("@/assets/images/ghostface-mark-gold.webp")}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
        {/* Wrapping with a plain native View (rather than passing
            pointerEvents to Canvas as a prop) excludes the WHOLE subtree —
            GLView included — from hit-testing, regardless of whether R3F's
            CanvasImpl internally forwards pointerEvents to every native
            view it renders. Passing it as a Canvas prop only reached one
            internal sibling view, not GLView itself, and produced a worse
            regression (see git history) — this is the same pattern already
            used for the glow overlay below, applied one level higher. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Canvas
            style={{ width: size, height: size }}
            frameloop={active ? "always" : "never"}
            camera={{ position: [0, 0, 3.1], fov: 40 }}
            events={() => ({ enabled: false, priority: 0 })}
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
        {/* GHOSTFACE is a registered mark — ® shown on the coin face itself. */}
        <Text style={[styles.registeredMark, { fontSize: Math.max(10, size * 0.09) }]} pointerEvents="none">
          ®
        </Text>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  registeredMark: {
    position: "absolute",
    alignSelf: "center",
    bottom: "18%",
    color: "#f4e2a1",
    fontWeight: "700",
  },
});
