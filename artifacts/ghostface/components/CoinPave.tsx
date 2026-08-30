import { useMemo } from "react";
import { Image, View } from "react-native";
import { BlurMask, Canvas, Circle, Group, Path, Skia } from "@shopify/react-native-skia";

const GHOST_MARK = require("@/assets/images/ghostface-mark-gold.webp");

/**
 * A pavé-set coin face: the disc packed with cut stones, with the GHOSTFACE
 * mark sitting on top.
 *
 * Why Skia and not Views. A dense field is thousands of stones. That is not a
 * View tree — the home screen already drives the coin from rAF, and thousands
 * of nodes would cost frames on every layout pass. Skia draws the field on the
 * GPU.
 *
 * Why buckets. Per-stone colour is the whole point (a pavé in one flat colour
 * is just a grey disc), but one Path per stone would be thousands of draw
 * calls. Stones are sorted into SHADE_STEPS brightness buckets and each bucket
 * is one Path, so the field costs ~2x SHADE_STEPS draws however dense it gets.
 *
 * What makes it read as jewellery rather than glitter, in the order each
 * mattered:
 *
 *  1. Stone size. Below ~3pt across, no individual stone is legible on a 2x
 *     display and the field collapses into sandpaper.
 *  2. Broken packing. Perfect concentric rings produce radial spokes and
 *     moiré — the one thing real pavé never shows. Each stone is jittered off
 *     its lattice point.
 *  3. A table. A real brilliant cut is a bright top facet inside a darker
 *     girdle. A flat filled diamond reads as a sequin; two nested diamonds at
 *     different brightness read as a stone.
 *  4. Metal between the stones. The gaps have to be dark oxidised setting, not
 *     whatever happens to sit behind the canvas.
 */

// Light from upper-left — the convention the rest of the coin's inset
// highlights already assume.
const LIGHT_X = -0.62;
const LIGHT_Y = -0.78;
const SHADE_STEPS = 14;

/** Deterministic 0..1 from an index. Stable across renders so the field does
 *  not shimmer when React re-runs; Math.random() would. */
function hash(i: number, salt = 0): number {
  const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export function CoinPave({
  size,
  /** Stone half-width in points. ~1.6 gives a 3.2pt stone, the smallest that
   *  still reads as a cut stone rather than grit. */
  stone = 1.6,
  /** Mark height as a fraction of the coin. */
  markScale = 0.62,
}: {
  size: number;
  stone?: number;
  markScale?: number;
}) {
  const { girdles, tables, sparkle } = useMemo(() => {
    const R = size / 2;
    // Leave a sliver bare so the pavé sits inside the rim rather than fighting
    // the milled edge on it.
    const inner = R - stone * 2.2;
    const pitch = stone * 1.85;
    const girdlePaths = Array.from({ length: SHADE_STEPS }, () => Skia.Path.Make());
    const tablePaths = Array.from({ length: SHADE_STEPS }, () => Skia.Path.Make());
    const sparklePath = Skia.Path.Make();

    let idx = 0;
    for (let r = pitch; r < inner; r += pitch) {
      const count = Math.max(6, Math.round((2 * Math.PI * r) / pitch));
      for (let k = 0; k < count; k++) {
        const j0 = hash(idx, 1);
        const j1 = hash(idx, 2);
        const j2 = hash(idx, 3);
        // Jitter off the lattice. Without this the rings line up into spokes.
        const theta = (2 * Math.PI * k) / count + (j0 - 0.5) * (pitch / r) * 1.1;
        const rr = r + (j1 - 0.5) * pitch * 0.55;
        const x = R + Math.cos(theta) * rr;
        const y = R + Math.sin(theta) * rr;
        if (Math.hypot(x - R, y - R) > inner) continue;

        // Dome shading across the face, then a per-stone tilt so neighbours
        // differ. The tilt is what sparkles; an evenly lit field of stones
        // reads as textured metal.
        const nx = (x - R) / R;
        const ny = (y - R) / R;
        const facing = (nx * LIGHT_X + ny * LIGHT_Y) * 0.5 + 0.5; // 0..1
        const shade = Math.max(0, Math.min(1, facing * (0.35 + 1.15 * j2)));
        idx += 1;

        const b = Math.min(SHADE_STEPS - 1, Math.floor(shade * SHADE_STEPS));
        const s = stone * (0.82 + 0.36 * j0); // stones are not all one size
        const g = girdlePaths[b];
        g.moveTo(x, y - s);
        g.lineTo(x + s, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s, y);
        g.close();

        // The table: a smaller diamond, brighter, nudged toward the light so
        // the stone reads as tilted rather than flat-on.
        const t = s * 0.46;
        const tx = x - s * 0.1;
        const ty = y - s * 0.1;
        const tb = Math.min(SHADE_STEPS - 1, b + 4);
        const tp = tablePaths[tb];
        tp.moveTo(tx, ty - t);
        tp.lineTo(tx + t, ty);
        tp.lineTo(tx, ty + t);
        tp.lineTo(tx - t, ty);
        tp.close();

        // A handful of stones catch the light dead-on. These get a bloom, and
        // they are what the eye reads as "diamond" — rare and fierce beats
        // uniformly bright.
        if (shade > 0.86 && j1 > 0.82) {
          const f = s * 1.5;
          sparklePath.moveTo(x, y - f);
          sparklePath.lineTo(x + f, y);
          sparklePath.lineTo(x, y + f);
          sparklePath.lineTo(x - f, y);
          sparklePath.close();
        }
      }
    }
    return { girdles: girdlePaths, tables: tablePaths, sparkle: sparklePath };
  }, [size, stone]);

  const R = size / 2;
  const markH = size * markScale;
  // 952 x 1232 source, so the mark is taller than it is wide.
  const markW = markH * (952 / 1232);

  const clip = useMemo(() => {
    const c = Skia.Path.Make();
    c.addCircle(R, R, R - 0.5);
    return c;
  }, [R]);

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }}>
        <Group clip={clip}>
          {/* Oxidised setting behind the stones, so the gaps read as metal
              rather than as holes onto whatever is behind the canvas. */}
          <Circle cx={R} cy={R} r={R} color="#0a0b10" />
          {girdles.map((p, i) => {
            const t = i / (SHADE_STEPS - 1);
            // Near-black through cool steel to a warm blown highlight. The warm
            // top end matches COIN_GLOW_WARM_WHITE, so the stones look lit by
            // the same source as the halo behind the coin.
            return (
              <Path
                key={`g${i}`}
                path={p}
                color={`rgb(${Math.round(14 + 200 * t)},${Math.round(16 + 205 * t)},${Math.round(24 + 200 * t)})`}
              />
            );
          })}
          {tables.map((p, i) => {
            const t = i / (SHADE_STEPS - 1);
            return (
              <Path
                key={`t${i}`}
                path={p}
                color={`rgb(${Math.round(40 + 215 * t)},${Math.round(42 + 205 * t)},${Math.round(50 + 182 * t)})`}
              />
            );
          })}
          <Group>
            <BlurMask blur={2.2} style="normal" />
            <Path path={sparkle} color="rgba(255,250,240,0.9)" />
          </Group>
        </Group>
      </Canvas>
      {/* The mark sits ON the stones, so it has to be the alpha asset — the
          .jpeg is opaque and would hide the entire field.
          Plain position:absolute, NOT absoluteFillObject: that sets right and
          bottom to 0, which fight an explicit width/height and squash the mark
          to a sliver. */}
      <Image
        source={GHOST_MARK}
        resizeMode="contain"
        style={{
          position: "absolute",
          width: markW,
          height: markH,
          left: (size - markW) / 2,
          top: (size - markH) / 2,
        }}
      />
    </View>
  );
}
