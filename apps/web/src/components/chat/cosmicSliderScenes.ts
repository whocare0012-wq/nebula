/**
 * V18 "Starship Launch Stack" continuous fluid scene for the reasoning effort slider.
 * One unmistakable stainless-steel Starship flies seamlessly across 5 high-contrast stages:
 * Pad standby -> Raptor ignition -> Max-Q clouds -> Earth-limb vacuum plume -> Deep-space warp.
 * Uses volumetric radial Gaussian plumes and a reused particle pool (zero hard polygon edges).
 */

const STARSHIP_STORY_BEATS = [
  "Pad standby · cryo mist",
  "Raptors ignite · clamps open",
  "Max-Q · breaking clouds",
  "Edge of space · vacuum plume",
  "Deep-space warp · full mission",
] as const;

export type StarshipStoryBeat = (typeof STARSHIP_STORY_BEATS)[number];

const STARSHIP_ACCENTS = ["#6FA8FF", "#FFA436", "#FF5926", "#D94DFF", "#3CF6FF"] as const;
const STARSHIP_FLASHES = ["#94C2FF", "#FFD978", "#FFB36B", "#F09CFF", "#C4FFFF"] as const;
const SKY_TOP_STOPS = ["#0B1730", "#1E152E", "#0F2E75", "#0B0A2A", "#02040B"] as const;
const SKY_BOT_STOPS = ["#142952", "#522014", "#C44B1A", "#1B0D44", "#06091A"] as const;

export interface StarshipParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  r0: number;
  r1: number;
  kind: 0 | 1 | 2 | 3 | 4;
  seed: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hexRgb(hex: string): readonly [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mixRgb(
  c1: readonly [number, number, number],
  c2: readonly [number, number, number],
  t: number,
): string {
  const k = clamp(t, 0, 1);
  return `rgb(${Math.round(lerp(c1[0], c2[0], k))},${Math.round(lerp(c1[1], c2[1], k))},${Math.round(lerp(c1[2], c2[2], k))})`;
}

function samplePalette(list: ReadonlyArray<string>, ratio: number): string {
  const u = clamp(ratio, 0, 1) * (list.length - 1);
  const i = Math.min(list.length - 2, Math.floor(u));
  return mixRgb(hexRgb(list[i]!), hexRgb(list[i + 1]!), u - i);
}

function createSeededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rng = createSeededRandom(2026);
const STAR_FIELD = Array.from({ length: 84 }, () => ({
  x: rng(),
  y: rng(),
  z: 0.35 + rng() * 1.15,
  r: 0.6 + rng() * 1.5,
  ph: rng() * Math.PI * 2,
  col: rng() > 0.72 ? "#7EF7FF" : rng() > 0.45 ? "#FFE599" : "#FFFFFF",
  sparkle: rng() > 0.84,
}));

const CLOUDS = Array.from({ length: 14 }, () => ({
  x: rng(),
  y: 0.14 + rng() * 0.74,
  w: 22 + rng() * 34,
  h: 5 + rng() * 6,
  sp: 0.6 + rng() * 1.1,
  a: 0.14 + rng() * 0.22,
}));

/** Accent colour along the Starship effort ramp, shared by header dot and composer chip. */
export function sampleStarshipAccent(ratio: number): string {
  return samplePalette(STARSHIP_ACCENTS, ratio);
}

/** Single-frame upshift exposure flash tint at `ratio`. */
export function sampleStarshipFlash(ratio: number): string {
  return samplePalette(STARSHIP_FLASHES, ratio);
}

/** Active flight story beat index (0..4) for `ratio`. */
function starshipBeatIndexAtRatio(ratio: number): number {
  return Math.min(STARSHIP_STORY_BEATS.length - 1, Math.round(clamp(ratio, 0, 1) * 4));
}

/** Active English story beat key (translated via `uiText`) for `ratio`. */
export function starshipStoryAtRatio(ratio: number): StarshipStoryBeat {
  return STARSHIP_STORY_BEATS[starshipBeatIndexAtRatio(ratio)]!;
}

/** Fixed-size particle pool reused across frames to avoid per-frame allocations. */
export function createStarshipParticles(count = 68): StarshipParticle[] {
  return Array.from({ length: count }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 1,
    r0: 2,
    r1: 8,
    kind: 0,
    seed: Math.random() * Math.PI * 2,
  }));
}

export function stepStarshipParticles(
  pool: StarshipParticle[],
  dt: number,
  p: number,
  nx: number,
  ny: number,
  angle: number,
  w: number,
): void {
  const spawnRate = p < 0.08 ? 14 : lerp(40, 125, p);
  let budget = spawnRate * dt;
  const backX = -Math.cos(angle);
  const backY = -Math.sin(angle);
  const perpX = -backY;
  const perpY = backX;

  for (let i = 0; i < pool.length; i++) {
    const pt = pool[i]!;
    if (pt.active) {
      pt.age += dt;
      if (pt.age >= pt.life || pt.x < -30 || pt.x > w + 30) {
        pt.active = false;
      } else {
        const drag = pt.kind === 0 ? 0.94 : pt.kind === 1 ? 0.96 : 0.99;
        pt.vx *= Math.pow(drag, dt * 60);
        pt.vy *= Math.pow(drag, dt * 60);
        if (pt.kind === 0) pt.vy -= 14 * dt;
        if (pt.kind === 1) pt.vy += Math.sin(pt.age * 9 + pt.seed) * 18 * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      }
    }
    if (!pt.active && budget >= 1) {
      budget -= 1;
      pt.active = true;
      pt.age = 0;
      pt.seed = Math.random() * Math.PI * 2;
      if (p < 0.14) {
        pt.kind = 0;
        pt.x = nx + (Math.random() - 0.3) * 14;
        pt.y = ny + (Math.random() - 0.5) * 8;
        pt.vx = -6 + (Math.random() - 0.5) * 10;
        pt.vy = -8 - Math.random() * 10;
        pt.life = 0.7 + Math.random() * 0.6;
        pt.r0 = 2;
        pt.r1 = 9;
      } else if (p < 0.42) {
        const isEmber = Math.random() > 0.62;
        pt.kind = isEmber ? 2 : 1;
        pt.x = nx + backX * 2 + (Math.random() - 0.5) * 4;
        pt.y = ny + backY * 2 + (Math.random() - 0.5) * 4;
        const spd = isEmber ? 75 + Math.random() * 90 : 42 + Math.random() * 68;
        const spread = (Math.random() - 0.5) * (isEmber ? 46 : 54);
        pt.vx = backX * spd + perpX * spread;
        pt.vy = backY * spd + perpY * spread;
        pt.life = isEmber ? 0.28 + Math.random() * 0.25 : 0.55 + Math.random() * 0.45;
        pt.r0 = isEmber ? 1.2 : 3.5;
        pt.r1 = isEmber ? 0.5 : 15;
      } else if (p < 0.68) {
        const isSpark = Math.random() > 0.35;
        pt.kind = isSpark ? 2 : 1;
        pt.x = nx + (Math.random() - 0.5) * 4;
        pt.y = ny + (Math.random() - 0.5) * 5;
        const spd = isSpark ? 150 + Math.random() * 130 : 105 + Math.random() * 80;
        const spread = (Math.random() - 0.5) * (isSpark ? 34 : 26);
        pt.vx = backX * spd + perpX * spread;
        pt.vy = backY * spd + perpY * spread;
        pt.life = isSpark ? 0.32 + Math.random() * 0.24 : 0.38 + Math.random() * 0.25;
        pt.r0 = isSpark ? 1.4 : 3.2;
        pt.r1 = isSpark ? 0.4 : 12;
      } else if (p < 0.88) {
        pt.kind = 3;
        pt.x = nx + (Math.random() - 0.5) * 3;
        pt.y = ny + (Math.random() - 0.5) * 4;
        const spd = 145 + Math.random() * 125;
        const spread = (Math.random() - 0.5) * 44;
        pt.vx = backX * spd + perpX * spread;
        pt.vy = backY * spd + perpY * spread;
        pt.life = 0.36 + Math.random() * 0.28;
        pt.r0 = 2.6;
        pt.r1 = 12;
      } else {
        pt.kind = 4;
        pt.x = nx + (Math.random() - 0.5) * 3;
        pt.y = ny + (Math.random() - 0.5) * 4;
        const spd = 240 + Math.random() * 190;
        const spread = (Math.random() - 0.5) * 24;
        pt.vx = backX * spd + perpX * spread;
        pt.vy = backY * spd + perpY * spread;
        pt.life = 0.28 + Math.random() * 0.22;
        pt.r0 = 1.1;
        pt.r1 = 2.8;
      }
    }
  }
}

export function prewarmStarshipParticles(
  pool: StarshipParticle[],
  ratio: number,
  w = 334,
  h = 50,
): void {
  const angle = lerp(-0.22, 0, smoothstep(0, 0.92, ratio));
  const kx = 28 + clamp(ratio, 0, 1) * (w - 56);
  const shipX = clamp(kx + lerp(6, -2, ratio), 32, w - 24);
  const nx = shipX - Math.cos(angle) * 15;
  const ny = h / 2 + lerp(2, 0, ratio) - Math.sin(angle) * 15;
  for (let k = 0; k < 24; k++) {
    stepStarshipParticles(pool, 0.03, ratio, nx, ny, angle, w);
  }
}

type ColorStop = readonly [number, string];

interface StarshipSpriteAtlas {
  readonly auraWarm: HTMLCanvasElement;
  readonly auraVac: HTMLCanvasElement;
  readonly auraWarp: HTMLCanvasElement;
  readonly puffWarm: HTMLCanvasElement;
  readonly puffVac: HTMLCanvasElement;
  readonly puffWarp: HTMLCanvasElement;
  readonly diamondWarm: HTMLCanvasElement;
  readonly diamondCyan: HTMLCanvasElement;
  readonly heroCold: HTMLCanvasElement;
  readonly heroWarm: HTMLCanvasElement;
  readonly heroPurple: HTMLCanvasElement;
  readonly heroCyan: HTMLCanvasElement;
  readonly bowGlow: HTMLCanvasElement;
  readonly nebulaCyan: HTMLCanvasElement;
  readonly nebulaPink: HTMLCanvasElement;
  readonly cloudPuff: HTMLCanvasElement;
  readonly streakCyan: HTMLCanvasElement;
  readonly streakGold: HTMLCanvasElement;
  readonly streakWhite: HTMLCanvasElement;
  readonly partCryo: HTMLCanvasElement;
  readonly partSmoke: HTMLCanvasElement;
  readonly partIonCyan: HTMLCanvasElement;
  readonly partIonPink: HTMLCanvasElement;
  readonly partWarp: HTMLCanvasElement;
}

let cachedAtlas: StarshipSpriteAtlas | null | undefined;

function bakeRadialSprite(size: number, stops: ReadonlyArray<ColorStop>): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [offset, color] of stops) {
    g.addColorStop(offset, color);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function bakeStreakSprite(color: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 4;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createLinearGradient(0, 0, 32, 0);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 4);
  return c;
}

function getSpriteAtlas(): StarshipSpriteAtlas | null {
  if (cachedAtlas !== undefined) return cachedAtlas;
  const auraWarm = bakeRadialSprite(96, [
    [0, "rgba(255, 240, 150, 0.72)"],
    [0.38, "rgba(255, 118, 24, 0.48)"],
    [0.74, "rgba(215, 40, 12, 0.16)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const auraVac = bakeRadialSprite(96, [
    [0, "rgba(130, 245, 255, 0.58)"],
    [0.38, "rgba(225, 70, 255, 0.36)"],
    [0.72, "rgba(115, 40, 220, 0.15)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const auraWarp = bakeRadialSprite(96, [
    [0, "rgba(130, 252, 255, 0.68)"],
    [0.38, "rgba(110, 70, 255, 0.42)"],
    [0.72, "rgba(255, 50, 195, 0.18)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const puffWarm = bakeRadialSprite(64, [
    [0, "rgba(255, 252, 224, 1)"],
    [0.38, "rgba(255, 182, 46, 0.767)"],
    [0.74, "rgba(255, 70, 16, 0.383)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const puffVac = bakeRadialSprite(64, [
    [0, "rgba(245, 252, 255, 1)"],
    [0.36, "rgba(90, 232, 255, 0.758)"],
    [0.68, "rgba(232, 72, 245, 0.442)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const puffWarp = bakeRadialSprite(64, [
    [0, "rgba(245, 255, 255, 1)"],
    [0.38, "rgba(46, 245, 255, 0.783)"],
    [0.72, "rgba(148, 66, 255, 0.417)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const diamondWarm = bakeRadialSprite(48, [
    [0, "rgba(255,255,255,1)"],
    [0.45, "rgba(255,222,120,0.86)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const diamondCyan = bakeRadialSprite(48, [
    [0, "rgba(255,255,255,1)"],
    [0.45, "rgba(110,248,255,0.81)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const heroCold = bakeRadialSprite(64, [
    [0, "rgba(130, 195, 255, 0.32)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const heroWarm = bakeRadialSprite(64, [
    [0, "rgba(255, 155, 55, 0.42)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const heroPurple = bakeRadialSprite(64, [
    [0, "rgba(205, 110, 255, 0.44)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const heroCyan = bakeRadialSprite(64, [
    [0, "rgba(60, 245, 255, 0.52)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const bowGlow = bakeRadialSprite(64, [
    [0, "rgba(255,255,255,0.9)"],
    [0.45, "rgba(60,248,255,0.55)"],
    [1, "rgba(60,248,255,0)"],
  ]);
  const nebulaCyan = bakeRadialSprite(96, [
    [0, "rgba(40,235,255,0.34)"],
    [0.45, "rgba(130,50,255,0.26)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const nebulaPink = bakeRadialSprite(96, [
    [0, "rgba(255,48,185,0.22)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const cloudPuff = bakeRadialSprite(64, [
    [0, "rgba(235,244,255,1)"],
    [1, "rgba(235,244,255,0)"],
  ]);
  const streakCyan = bakeStreakSprite("#7EF7FF");
  const streakGold = bakeStreakSprite("#FFE599");
  const streakWhite = bakeStreakSprite("#FFFFFF");
  const partCryo = bakeRadialSprite(48, [
    [0, "rgba(195,225,255,1)"],
    [1, "rgba(195,225,255,0)"],
  ]);
  const partSmoke = bakeRadialSprite(48, [
    [0, "rgba(255,236,210,1)"],
    [0.55, "rgba(255,180,120,0.47)"],
    [1, "rgba(255,160,100,0)"],
  ]);
  const partIonCyan = bakeRadialSprite(48, [
    [0, "rgba(130,248,255,1)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const partIonPink = bakeRadialSprite(48, [
    [0, "rgba(235,90,255,1)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  const partWarp = bakeRadialSprite(48, [
    [0, "rgba(220,255,255,1)"],
    [0.45, "rgba(48,242,255,0.65)"],
    [1, "rgba(115,65,255,0)"],
  ]);

  if (
    !auraWarm ||
    !auraVac ||
    !auraWarp ||
    !puffWarm ||
    !puffVac ||
    !puffWarp ||
    !diamondWarm ||
    !diamondCyan ||
    !heroCold ||
    !heroWarm ||
    !heroPurple ||
    !heroCyan ||
    !bowGlow ||
    !nebulaCyan ||
    !nebulaPink ||
    !cloudPuff ||
    !streakCyan ||
    !streakGold ||
    !streakWhite ||
    !partCryo ||
    !partSmoke ||
    !partIonCyan ||
    !partIonPink ||
    !partWarp
  ) {
    cachedAtlas = null;
    return null;
  }

  cachedAtlas = {
    auraWarm,
    auraVac,
    auraWarp,
    puffWarm,
    puffVac,
    puffWarp,
    diamondWarm,
    diamondCyan,
    heroCold,
    heroWarm,
    heroPurple,
    heroCyan,
    bowGlow,
    nebulaCyan,
    nebulaPink,
    cloudPuff,
    streakCyan,
    streakGold,
    streakWhite,
    partCryo,
    partSmoke,
    partIonCyan,
    partIonPink,
    partWarp,
  };
  return cachedAtlas;
}

function drawVolumetricPlume(
  ctx: CanvasRenderingContext2D,
  atlas: StarshipSpriteAtlas | null,
  nx: number,
  ny: number,
  angle: number,
  p: number,
  t: number,
): void {
  if (p < 0.08 || !atlas) return;
  const power = clamp(Math.pow((p - 0.08) / 0.92, 0.55), 0, 1);
  const flameLen = lerp(46, 168, power);
  const vacMix = smoothstep(0.54, 0.8, p);
  const warpMix = smoothstep(0.82, 1, p);

  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(angle);
  ctx.globalCompositeOperation = "lighter";

  // 1. Soft wide ambient aura (pre-baked radial sprite, zero per-frame gradient allocation).
  const auraLen = flameLen * (1.08 + vacMix * 0.26);
  const auraRad = lerp(13, 25, power) * (1 + vacMix * 0.42 - warpMix * 0.14);
  const auraRx = auraLen * 0.64;
  const auraRy = auraRad * (0.64 / 0.52);
  const auraSprite =
    warpMix > 0.5 ? atlas.auraWarp : vacMix > 0.35 ? atlas.auraVac : atlas.auraWarm;
  ctx.globalAlpha = power;
  ctx.drawImage(auraSprite, -auraLen * 0.35 - auraRx, -auraRy, auraRx * 2, auraRy * 2);

  // 2. 22 overlapping radial Gaussian plasma puffs (pre-baked sprites, zero save/restore in loop).
  const puffSprite =
    warpMix > 0.5 ? atlas.puffWarp : vacMix > 0.35 ? atlas.puffVac : atlas.puffWarm;
  const puffBoost = warpMix > 0.5 ? 1.15 : vacMix > 0.35 ? 0.95 : 1.2;
  const blobs = 22;
  for (let i = 0; i < blobs; i++) {
    const u = i / (blobs - 1);
    const dist = 2.5 + u * flameLen;
    const bell = Math.sin(Math.pow(u, 0.7) * Math.PI);
    const expand = vacMix > 0.3 ? lerp(1, 1.52, u) * (1 - warpMix * 0.48) : 1 - u * 0.22;
    const ry = Math.max(1.8, (3.4 + bell * lerp(6.5, 13.5, power)) * expand);
    const rx = Math.max(5.5, ry * lerp(1.8, 3, warpMix));
    const sway = Math.sin(t * 22 - u * 7.5) * (0.7 + u * 2) * (1 - warpMix * 0.65);
    const alpha = Math.pow(1 - u, 1.25) * (0.3 + 0.36 * bell) * power;
    ctx.globalAlpha = clamp(alpha * puffBoost, 0, 1);
    ctx.drawImage(puffSprite, -dist - rx, sway - ry, rx * 2, ry * 2);
  }

  // 3. Mach shock diamonds pulsing right behind the Raptor engine bells.
  const diamondSprite = warpMix > 0.5 || vacMix > 0.4 ? atlas.diamondCyan : atlas.diamondWarm;
  const diamonds = warpMix > 0.5 ? 6 : vacMix > 0.4 ? 3 : 4;
  for (let d = 0; d < diamonds; d++) {
    const du = (d + 0.45) / (diamonds + 0.8);
    const dx = -4 - d * lerp(8.5, 15, power) - Math.sin(t * 32 + d) * 1.1;
    const drx = lerp(6, 10.5, power) * (1 - du * 0.46);
    const dry = lerp(2.4, 4, power) * (1 - du * 0.4);
    ctx.globalAlpha = clamp((0.96 - du * 0.42) * power, 0, 1);
    ctx.drawImage(diamondSprite, dx - drx, -dry, drx * 2, dry * 2);
  }

  ctx.restore();
}

function drawStarshipHero(
  ctx: CanvasRenderingContext2D,
  atlas: StarshipSpriteAtlas | null,
  x: number,
  y: number,
  angle: number,
  p: number,
  t: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (atlas) {
    const heroGlow =
      p < 0.2
        ? atlas.heroCold
        : p < 0.65
          ? atlas.heroWarm
          : p < 0.88
            ? atlas.heroPurple
            : atlas.heroCyan;
    ctx.drawImage(heroGlow, -24, -24, 48, 48);
  }

  // Aft delta flaps.
  ctx.fillStyle = "#3A4660";
  ctx.beginPath();
  ctx.moveTo(-13, -4.2);
  ctx.lineTo(-17.5, -10.5);
  ctx.lineTo(-11, -10.2);
  ctx.lineTo(-6.5, -4.8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-13, 4.2);
  ctx.lineTo(-17.5, 10.5);
  ctx.lineTo(-11, 10.2);
  ctx.lineTo(-6.5, 4.8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(220,238,255,0.65)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-17.2, -10.2);
  ctx.lineTo(-11, -10);
  ctx.lineTo(-6.5, -4.8);
  ctx.stroke();

  // Forward aero canards.
  ctx.fillStyle = "#526282";
  ctx.beginPath();
  ctx.moveTo(6.5, -4.1);
  ctx.lineTo(4.2, -7.8);
  ctx.lineTo(8.5, -6.8);
  ctx.lineTo(11.5, -3.2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6.5, 4.1);
  ctx.lineTo(4.2, 7.8);
  ctx.lineTo(8.5, 6.8);
  ctx.lineTo(11.5, 3.2);
  ctx.closePath();
  ctx.fill();

  // Engine skirt & triple Raptor engine bells.
  ctx.fillStyle = "#1E2538";
  ctx.fillRect(-15.5, -3.6, 3.2, 7.2);
  for (const ey of [-2.4, 0, 2.4]) {
    ctx.fillStyle = p > 0.12 ? (p > 0.65 ? "#9EFAFF" : "#FFF1B8") : "#4B5B78";
    ctx.beginPath();
    ctx.arc(-15.5, ey, 1.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stainless-steel upper fuselage + dark ceramic heatshield belly.
  const hullGrad = ctx.createLinearGradient(0, -5.5, 0, 5.5);
  hullGrad.addColorStop(0, "#FFFFFF");
  hullGrad.addColorStop(0.28, "#DCE6F7");
  hullGrad.addColorStop(0.54, "#92A4C4");
  hullGrad.addColorStop(0.58, "#1B2233");
  hullGrad.addColorStop(1, "#0F1422");
  ctx.fillStyle = hullGrad;
  ctx.beginPath();
  ctx.moveTo(17.5, 0);
  ctx.bezierCurveTo(13, -4.4, 7, -5.2, -13.5, -4.9);
  ctx.lineTo(-13.5, 4.9);
  ctx.bezierCurveTo(7, 5.2, 13, 4.4, 17.5, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-12.5, -3.4);
  ctx.bezierCurveTo(6, -3.6, 11.5, -2.8, 16.2, -0.4);
  ctx.stroke();

  ctx.strokeStyle = "rgba(40,56,88,0.45)";
  ctx.lineWidth = 0.7;
  for (const sx of [-7, -1, 5]) {
    ctx.beginPath();
    ctx.moveTo(sx, -4.8);
    ctx.lineTo(sx, 0.4);
    ctx.stroke();
  }

  ctx.fillStyle = p < 0.2 ? "#7ED6FF" : p < 0.65 ? "#FFE699" : "#66FAFF";
  ctx.beginPath();
  ctx.roundRect(7.5, -2.5, 4.2, 1.9, 0.9);
  ctx.fill();

  // Max-Q soft condensation vapor cone at High.
  const coneStrength = Math.sin(smoothstep(0.38, 0.74, p) * Math.PI);
  if (coneStrength > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const cg = ctx.createRadialGradient(9, 0, 1, 2, 0, 23);
    cg.addColorStop(0, `rgba(255,255,255,${0.78 * coneStrength})`);
    cg.addColorStop(0.48, `rgba(175,228,255,${0.36 * coneStrength})`);
    cg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(16.5, 0);
    ctx.quadraticCurveTo(4, -15, -5, -19);
    ctx.quadraticCurveTo(1, 0, -5, 19);
    ctx.quadraticCurveTo(4, 15, 16.5, 0);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.65 * coneStrength})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(15, -1);
    ctx.quadraticCurveTo(5, -12, -2, -16);
    ctx.moveTo(15, 1);
    ctx.quadraticCurveTo(5, 12, -2, 16);
    ctx.stroke();
    ctx.restore();
  }

  // Max deep-space wingtip ion contrails, double bow shock & nose star flare.
  const bow = smoothstep(0.82, 1, p);
  if (bow > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const wy of [-10, 10]) {
      const wg = ctx.createLinearGradient(-15, wy, -75, wy);
      wg.addColorStop(0, `rgba(105,250,255,${0.7 * bow})`);
      wg.addColorStop(0.45, `rgba(140,80,255,${0.35 * bow})`);
      wg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = wg;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-15, wy);
      ctx.lineTo(-75, wy + (wy > 0 ? 2 : -2));
      ctx.stroke();
    }
    if (atlas) {
      ctx.globalAlpha = bow;
      ctx.drawImage(atlas.bowGlow, 15 - 21, -21, 42, 42);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = `rgba(130, 252, 255, ${0.88 * bow})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(7, 0, 14.5, -0.82, 0.82);
    ctx.stroke();
    ctx.strokeStyle = `rgba(215, 140, 255, ${0.48 * bow})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(7, 0, 18, -0.68, 0.68);
    ctx.stroke();

    const fl = (7.5 + Math.sin(t * 9) * 1.8) * bow;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.moveTo(18, -fl);
    ctx.quadraticCurveTo(18, 0, 18 + fl * 1.45, 0);
    ctx.quadraticCurveTo(18, 0, 18, fl);
    ctx.quadraticCurveTo(18, 0, 18 - fl * 1.45, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

export function drawStarshipScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: number,
  kx: number,
  t: number,
  particles: readonly StarshipParticle[],
  shock: number,
): { readonly nx: number; readonly ny: number; readonly angle: number } {
  const cy = h / 2;
  const atlas = getSpriteAtlas();

  // 1. Continuous sky-to-cosmos backdrop with dramatic saturation & contrast escalation.
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, samplePalette(SKY_TOP_STOPS, p));
  bg.addColorStop(0.55, samplePalette(SKY_BOT_STOPS, p));
  bg.addColorStop(1, samplePalette(SKY_TOP_STOPS, Math.min(1, p + 0.12)));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. High-altitude cobalt atmospheric wash at High (Max-Q).
  const maxQ = Math.sin(smoothstep(0.32, 0.72, p) * Math.PI);
  if (maxQ > 0.01) {
    const qg = ctx.createLinearGradient(0, 0, w, 0);
    qg.addColorStop(0, `rgba(255,95,22,${0.32 * maxQ})`);
    qg.addColorStop(0.55, `rgba(24,84,210,${0.55 * maxQ})`);
    qg.addColorStop(1, `rgba(8,28,96,${0.65 * maxQ})`);
    ctx.fillStyle = qg;
    ctx.fillRect(0, 0, w, h);
  }

  // 3. Stars & high-saturation nebula (faint at Low, streaking & blazing at XHigh -> Max).
  const starVis = p < 0.25 ? lerp(0.42, 0.12, p / 0.25) : smoothstep(0.45, 0.95, p);
  const streakAmt = smoothstep(0.72, 1, p);
  if (starVis > 0.02) {
    const nebVis = smoothstep(0.62, 1, p);
    if (nebVis > 0.01 && atlas) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = nebVis;
      ctx.drawImage(atlas.nebulaCyan, w * 0.72 - 130, h * 0.38 - 130, 260, 260);
      ctx.drawImage(atlas.nebulaPink, w * 0.36 - 95, h * 0.65 - 95, 190, 190);
      ctx.restore();
    }

    for (let i = 0; i < STAR_FIELD.length; i++) {
      const s = STAR_FIELD[i]!;
      const speed = streakAmt > 0.02 ? lerp(18, 210, streakAmt) * s.z : 0;
      const sx = w - ((s.x * w + t * speed) % w);
      const sy = s.y * h;
      const tw = 0.5 + 0.5 * Math.sin(t * (2.5 + streakAmt * 5) + s.ph);
      ctx.globalAlpha = starVis * (0.35 + 0.65 * tw);
      if (streakAmt > 0.08 && atlas) {
        const len = (4 + s.z * 18) * streakAmt;
        const lw = Math.max(0.7, s.r * 0.85);
        const streakSprite =
          s.col === "#7EF7FF"
            ? atlas.streakCyan
            : s.col === "#FFE599"
              ? atlas.streakGold
              : atlas.streakWhite;
        ctx.drawImage(streakSprite, sx, sy - lw * 0.5, len, lw);
      } else {
        ctx.fillStyle = s.col;
        ctx.beginPath();
        ctx.arc(sx, sy, s.r * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s.sparkle && p > 0.82 && tw > 0.65) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(sx - 2.5, sy - 0.5, 5, 1);
        ctx.fillRect(sx - 0.5, sy - 2.5, 1, 5);
      }
    }
    ctx.globalAlpha = 1;
  }

  // 4. Launch pad, Mechazilla gantry & backlit spotlight (recedes smoothly at Medium).
  const padVis = 1 - smoothstep(0.18, 0.44, p);
  if (padVis > 0.01) {
    const shiftX = -smoothstep(0.12, 0.44, p) * 75;
    ctx.save();
    ctx.globalAlpha = padVis;
    ctx.translate(shiftX, 0);
    ctx.fillStyle = "#182745";
    ctx.fillRect(0, h - 7, w, 7);
    ctx.fillStyle = "rgba(130, 185, 255, 0.25)";
    ctx.fillRect(0, h - 7, w, 1);

    const beam = ctx.createLinearGradient(18, h - 6, 48, 8);
    beam.addColorStop(0, p > 0.14 ? "rgba(255,175,70,0.42)" : "rgba(120,195,255,0.34)");
    beam.addColorStop(1, "rgba(120,195,255,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(12, h - 6);
    ctx.lineTo(28, h - 6);
    ctx.lineTo(74, 4);
    ctx.lineTo(36, 4);
    ctx.closePath();
    ctx.fill();

    const tx = 14;
    ctx.strokeStyle = "#3C5482";
    ctx.lineWidth = 1.6;
    ctx.strokeRect(tx, 7, 8, h - 14);
    ctx.lineWidth = 1;
    for (let ty = 11; ty < h - 10; ty += 7) {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + 8, ty + 6);
      ctx.stroke();
    }
    const armOpen = smoothstep(0.1, 0.28, p) * 7;
    ctx.fillStyle = "#5674A8";
    ctx.fillRect(tx + 8, 16 - armOpen, 14, 2);
    ctx.fillRect(tx + 8, 30 + armOpen, 14, 2);
    const bk = 0.35 + 0.65 * Math.abs(Math.sin(t * 2.6));
    ctx.fillStyle = `rgba(255,75,92,${bk})`;
    ctx.beginPath();
    ctx.arc(tx + 4, 6, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5. Soft rushing clouds at Medium -> High (pre-baked cloud puff sprite).
  const cloudVis = Math.sin(smoothstep(0.22, 0.72, p) * Math.PI);
  if (cloudVis > 0.02 && atlas) {
    for (const c of CLOUDS) {
      const cx = w - ((c.x * w + t * lerp(45, 220, p) * c.sp) % (w + c.w * 2)) + c.w;
      const rx = c.w * 0.6;
      const ry = rx * (c.h / (c.w * 0.55));
      ctx.globalAlpha = clamp(c.a * cloudVis, 0, 1);
      ctx.drawImage(atlas.cloudPuff, cx - rx, c.y * h - ry, rx * 2, ry * 2);
    }
    ctx.globalAlpha = 1;
  }

  // 6. Curved Earth limb (XHigh) -> receding glowing blue planet (Max).
  const earthLimb = smoothstep(0.56, 0.78, p) * (1 - smoothstep(0.84, 0.98, p));
  if (earthLimb > 0.01) {
    ctx.save();
    ctx.globalAlpha = earthLimb;
    const ex = w * 0.34;
    const ey = h + 112;
    const eg = ctx.createRadialGradient(ex, ey, 94, ex, ey, 134);
    eg.addColorStop(0, "#07225A");
    eg.addColorStop(0.76, "#146BFF");
    eg.addColorStop(0.89, "#6BEAFF");
    eg.addColorStop(0.95, "rgba(130,245,255,0.45)");
    eg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = eg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  const earthPlanet = smoothstep(0.8, 0.98, p);
  if (earthPlanet > 0.01) {
    ctx.save();
    ctx.globalAlpha = earthPlanet;
    const px = 26;
    const py = h - 13;
    const pr = 13;
    const halo = ctx.createRadialGradient(px, py, pr * 0.7, px, py, pr * 1.9);
    halo.addColorStop(0, "rgba(85,235,255,0.75)");
    halo.addColorStop(0.55, "rgba(30,130,255,0.32)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(px, py, pr * 1.9, 0, Math.PI * 2);
    ctx.fill();
    const pg = ctx.createRadialGradient(px + 4, py - 4, 1, px, py, pr);
    pg.addColorStop(0, "#B8F6FF");
    pg.addColorStop(0.45, "#1F85FF");
    pg.addColorStop(0.85, "#092363");
    pg.addColorStop(1, "#040C24");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 7. Continuous Starship trajectory position & pitch angle.
  const angle = lerp(-0.22, 0, smoothstep(0, 0.92, p));
  const shipX = clamp(kx + lerp(6, -2, p), 32, w - 24);
  const bob = p < 0.08 ? 0 : Math.sin(t * (6 + p * 10)) * (0.4 + p * 0.7);
  const shipY = cy + lerp(2, 0, p) + bob;
  const nx = shipX - Math.cos(angle) * 15;
  const ny = shipY - Math.sin(angle) * 15;

  // 8. Volumetric feathered exhaust plume + batched fluid particles (pre-baked sprites).
  drawVolumetricPlume(ctx, atlas, nx, ny, angle, p, t);

  ctx.save();
  // Pass 1: source-over cryo mist & exhaust smoke sprites.
  if (atlas) {
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i]!;
      if (!pt.active || (pt.kind !== 0 && pt.kind !== 1)) continue;
      const u = pt.age / pt.life;
      const fade = Math.sin(u * Math.PI);
      const r = lerp(pt.r0, pt.r1, u);
      if (pt.kind === 0) {
        ctx.globalAlpha = clamp(0.26 * fade, 0, 1);
        ctx.drawImage(atlas.partCryo, pt.x - r, pt.y - r, r * 2, r * 2);
      } else {
        ctx.globalAlpha = clamp(0.34 * fade, 0, 1);
        ctx.drawImage(atlas.partSmoke, pt.x - r, pt.y - r, r * 2, r * 2);
      }
    }
  }

  // Pass 2: single additive ("lighter") batch for embers, vacuum ions & warp plasma.
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i]!;
    if (!pt.active || pt.kind < 2) continue;
    const u = pt.age / pt.life;
    const fade = Math.sin(u * Math.PI);
    const r = lerp(pt.r0, pt.r1, u);
    if (pt.kind === 2) {
      ctx.globalAlpha = clamp((u < 0.4 ? 0.95 : 0.8) * fade, 0, 1);
      ctx.fillStyle = u < 0.4 ? "#FFF8C3" : "#FF731E";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (pt.kind === 3 && atlas) {
      const young = u < 0.35;
      ctx.globalAlpha = clamp((young ? 0.48 : 0.38) * fade, 0, 1);
      ctx.drawImage(
        young ? atlas.partIonCyan : atlas.partIonPink,
        pt.x - r,
        pt.y - r,
        r * 2,
        r * 2,
      );
    } else if (atlas) {
      ctx.globalAlpha = clamp(0.65 * fade, 0, 1);
      ctx.drawImage(atlas.partWarp, pt.x - r, pt.y - r, r * 2, r * 2);
    }
  }
  ctx.restore();

  // 9. Starship hero spacecraft.
  drawStarshipHero(ctx, atlas, shipX, shipY, angle, p, t);

  // 10. Upshift expanding shockwave ring.
  if (shock > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = sampleStarshipFlash(p);
    ctx.globalAlpha = shock * 0.85;
    ctx.lineWidth = 2.4 * shock;
    const rad = 16 + (1 - shock) * 86;
    ctx.beginPath();
    ctx.ellipse(shipX, shipY, rad, rad * 0.44, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  return { nx, ny, angle };
}
