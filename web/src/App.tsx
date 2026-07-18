import { useEffect, useRef, useState } from "react";
import { Application, Graphics, Text, TextStyle, Container } from "pixi.js";
import { Shell } from "./components/Shell";
import { useHighScore } from "./hooks/useHighScore";

// ─── Types ───────────────────────────────────────────────────────────────────
type BirdType = "red" | "blue" | "yellow";
type Phase = "aim" | "flying" | "settling" | "won" | "lost";

interface Body {
  id: number;
  type: "bird" | "pig" | "block";
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  w: number; h: number;
  mass: number;
  restitution: number;
  friction: number;
  isStatic: boolean;
  alive: boolean;
  health: number;
  maxHealth: number;
  birdType?: BirdType;
  blockMat?: "wood" | "stone" | "glass";
}

// ─── Colours ─────────────────────────────────────────────────────────────────
const BIRD_COL: Record<BirdType, number> = { red: 0xe63946, blue: 0x457b9d, yellow: 0xffd60a };
const MAT_COL = { wood: 0xc9a84c, stone: 0x8d8d8d, glass: 0xa8d8ea };
const MAT_HP  = { wood: 80, stone: 200, glass: 35 };

// ─── Levels ───────────────────────────────────────────────────────────────────
// All positions are fractions of canvas (0..1). Origin = top-left.
// groundFrac = 0.80 → ground line at 80% of canvas height.
// Structures: cx/cy = centre as fraction; bw/bh = size as fraction.
// Pigs: cx/cy = centre as fraction (cy measured from top).
interface LevelDef {
  birds: BirdType[];
  blocks: { cx: number; cy: number; bw: number; bh: number; mat: "wood" | "stone" | "glass" }[];
  pigs:   { cx: number; cy: number }[];
}

const GROUND_FRAC = 0.80;

const LEVELS: LevelDef[] = [
  // 1 — single pig behind a wooden plank
  {
    birds: ["red", "red"],
    blocks: [
      { cx: 0.72, cy: 0.74, bw: 0.04, bh: 0.12, mat: "wood" },
    ],
    pigs: [{ cx: 0.78, cy: 0.76 }],
  },
  // 2 — two pigs, small tower
  {
    birds: ["red", "red", "blue"],
    blocks: [
      { cx: 0.65, cy: 0.74, bw: 0.04, bh: 0.12, mat: "wood" },
      { cx: 0.65, cy: 0.62, bw: 0.04, bh: 0.04, mat: "wood" },
      { cx: 0.78, cy: 0.74, bw: 0.04, bh: 0.12, mat: "wood" },
      { cx: 0.78, cy: 0.62, bw: 0.04, bh: 0.04, mat: "wood" },
    ],
    pigs: [{ cx: 0.65, cy: 0.57 }, { cx: 0.78, cy: 0.57 }],
  },
  // 3 — stone arch
  {
    birds: ["red", "yellow", "red"],
    blocks: [
      { cx: 0.62, cy: 0.72, bw: 0.035, bh: 0.16, mat: "stone" },
      { cx: 0.78, cy: 0.72, bw: 0.035, bh: 0.16, mat: "stone" },
      { cx: 0.70, cy: 0.635, bw: 0.20, bh: 0.035, mat: "stone" },
    ],
    pigs: [{ cx: 0.70, cy: 0.75 }],
  },
  // 4 — glass tower, 3 pigs
  {
    birds: ["yellow", "blue", "red", "red"],
    blocks: [
      { cx: 0.63, cy: 0.74, bw: 0.035, bh: 0.12, mat: "glass" },
      { cx: 0.70, cy: 0.74, bw: 0.035, bh: 0.12, mat: "glass" },
      { cx: 0.77, cy: 0.74, bw: 0.035, bh: 0.12, mat: "glass" },
      { cx: 0.70, cy: 0.625, bw: 0.175, bh: 0.035, mat: "glass" },
      { cx: 0.70, cy: 0.57, bw: 0.035, bh: 0.09, mat: "glass" },
    ],
    pigs: [{ cx: 0.63, cy: 0.75 }, { cx: 0.77, cy: 0.75 }, { cx: 0.70, cy: 0.52 }],
  },
  // 5 — mixed fortress
  {
    birds: ["red", "yellow", "blue", "yellow", "red"],
    blocks: [
      { cx: 0.60, cy: 0.74, bw: 0.035, bh: 0.12, mat: "stone" },
      { cx: 0.68, cy: 0.74, bw: 0.035, bh: 0.12, mat: "wood"  },
      { cx: 0.76, cy: 0.74, bw: 0.035, bh: 0.12, mat: "stone" },
      { cx: 0.68, cy: 0.625, bw: 0.21, bh: 0.035, mat: "wood" },
      { cx: 0.64, cy: 0.57, bw: 0.035, bh: 0.09, mat: "glass" },
      { cx: 0.72, cy: 0.57, bw: 0.035, bh: 0.09, mat: "glass" },
      { cx: 0.68, cy: 0.50, bw: 0.12, bh: 0.035, mat: "stone" },
    ],
    pigs: [
      { cx: 0.60, cy: 0.75 }, { cx: 0.76, cy: 0.75 },
      { cx: 0.64, cy: 0.52 }, { cx: 0.72, cy: 0.52 },
    ],
  },
];

// ─── Physics constants ────────────────────────────────────────────────────────
const GRAVITY    = 1200; // px/s²
const LAUNCH_POW = 12;   // velocity = drag_px * LAUNCH_POW  (px/s per px)
const MAX_DRAG   = 80;   // max sling stretch in px
const BIRD_R     = 18;
const PIG_R      = 16;

let _nextId = 1;
function makeBody(partial: Omit<Body, "id" | "vx" | "vy" | "alive">): Body {
  return { ...partial, id: _nextId++, vx: 0, vy: 0, alive: true };
}

function stepPhysics(bodies: Body[], groundY: number, dtMs: number) {
  const dt = Math.min(dtMs / 1000, 0.033);

  // Integrate
  for (const b of bodies) {
    if (b.isStatic || !b.alive) continue;
    b.vy += GRAVITY * dt;
    b.x  += b.vx * dt;
    b.y  += b.vy * dt;
  }

  // Ground
  for (const b of bodies) {
    if (b.isStatic || !b.alive) continue;
    const floor = groundY - b.radius;
    if (b.y > floor) {
      const spd = Math.abs(b.vy);
      b.y   = floor;
      b.vy *= -b.restitution;
      b.vx *= b.friction;
      if (Math.abs(b.vy) < 20) b.vy = 0;
      // ground impact damage
      const dmg = spd * 0.15;
      if (dmg > 5) b.health -= dmg;
    }
  }

  // Body vs body (circle vs circle approximation for everything)
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (!b.alive) continue;
      if (a.isStatic && b.isStatic) continue;

      // Use radius for collision (blocks use half-diagonal as radius for simplicity)
      const ar = a.radius;
      const br = b.radius;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      const minD   = ar + br;
      if (distSq >= minD * minD || distSq === 0) continue;

      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minD - dist;

      // Separate
      if (!a.isStatic && !b.isStatic) {
        const ta = b.mass / (a.mass + b.mass);
        const tb = a.mass / (a.mass + b.mass);
        a.x -= nx * overlap * ta;
        a.y -= ny * overlap * ta;
        b.x += nx * overlap * tb;
        b.y += ny * overlap * tb;
      } else if (!a.isStatic) {
        a.x -= nx * overlap; a.y -= ny * overlap;
      } else {
        b.x += nx * overlap; b.y += ny * overlap;
      }

      // Impulse
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const dot = rvx * nx + rvy * ny;
      if (dot >= 0) continue;

      const e   = Math.min(a.restitution, b.restitution);
      const imp = (-(1 + e) * dot) / (1 / a.mass + 1 / b.mass);
      const ix  = imp * nx;
      const iy  = imp * ny;

      const relSpd = Math.sqrt(rvx * rvx + rvy * rvy);
      const dmg    = relSpd * 0.4;

      if (!a.isStatic) { a.vx -= ix / a.mass; a.vy -= iy / a.mass; a.health -= dmg; }
      if (!b.isStatic) { b.vx += ix / b.mass; b.vy += iy / b.mass; b.health -= dmg; }
    }
  }

  // Kill
  for (const b of bodies) {
    if (b.health <= 0) b.alive = false;
  }
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highScore, updateHighScore] = useHighScore("angry_birds3_hs");
  const [uiScore, setUiScore]   = useState(0);
  const [uiLevel, setUiLevel]   = useState(1);
  const [uiPhase, setUiPhase]   = useState<Phase>("aim");
  const [uiBirds, setUiBirds]   = useState<BirdType[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let destroyed = false;
    const app = new Application();

    (async () => {
      await app.init({ resizeTo: container, background: 0x87ceeb, antialias: true });
      if (destroyed) { app.destroy(true); return; }
      container.appendChild(app.canvas);

      const W = () => app.screen.width;
      const H = () => app.screen.height;
      const GY = () => H() * GROUND_FRAC;

      // Sling is always at fixed screen position
      const SX = () => W() * 0.18;
      const SY = () => GY() - H() * 0.08;   // fork top

      // ── Layers ──────────────────────────────────────────────────────
      const worldLayer = new Container(); // bg + ground + bodies (no scroll)
      const uiLayer    = new Container(); // HUD + overlay
      app.stage.addChild(worldLayer);
      app.stage.addChild(uiLayer);

      const bgGfx      = new Graphics();
      const groundGfx  = new Graphics();
      const bodyGfx    = new Graphics();
      const slingGfx   = new Graphics();
      const trajGfx    = new Graphics();
      worldLayer.addChild(bgGfx);
      worldLayer.addChild(groundGfx);
      worldLayer.addChild(bodyGfx);
      worldLayer.addChild(trajGfx);
      worldLayer.addChild(slingGfx);

      const hudStyle = new TextStyle({
        fontFamily: "Manrope, sans-serif", fontSize: 15,
        fill: 0xffffff, fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 3, distance: 1 },
      });
      const scoreTxt = new Text({ text: "Score: 0", style: hudStyle });
      const levelTxt = new Text({ text: "Level 1", style: hudStyle });
      const hsTxt    = new Text({ text: "Best: 0",  style: hudStyle });
      scoreTxt.position.set(8, 6);
      levelTxt.position.set(8, 24);
      hsTxt.position.set(8, 42);
      uiLayer.addChild(scoreTxt);
      uiLayer.addChild(levelTxt);
      uiLayer.addChild(hsTxt);

      const overlayGfx = new Graphics();
      const ovStyle = new TextStyle({
        fontFamily: "Fraunces, serif", fontSize: 34, fill: 0xffffff, fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 8, distance: 2 },
      });
      const ovText  = new Text({ text: "", style: ovStyle });
      const subStyle = new TextStyle({
        fontFamily: "Manrope, sans-serif", fontSize: 17, fill: 0xffffff,
        dropShadow: { color: 0x000000, blur: 4, distance: 1 },
      });
      const subText = new Text({ text: "", style: subStyle });
      ovText.anchor.set(0.5);
      subText.anchor.set(0.5);
      uiLayer.addChild(overlayGfx);
      uiLayer.addChild(ovText);
      uiLayer.addChild(subText);

      // ── Game state ───────────────────────────────────────────────────
      let levelIndex = 0;
      let score      = 0;
      let phase: Phase = "aim";
      let bodies: Body[] = [];
      let queue: BirdType[] = [];
      let activeBird: Body | null = null;
      let dragging = false;
      let dragX = 0, dragY = 0;
      let settleTimer = 0;

      function buildLevel(idx: number) {
        _nextId = 1;
        levelIndex = idx % LEVELS.length;
        phase      = "aim";
        bodies     = [];
        dragging   = false;
        const def  = LEVELS[levelIndex]!;
        queue      = [...def.birds];

        // Place blocks
        for (const s of def.blocks) {
          const bw = s.bw * W();
          const bh = s.bh * H();
          const r  = Math.sqrt(bw * bw + bh * bh) / 2; // half-diagonal
          const b  = makeBody({
            type: "block", x: s.cx * W(), y: s.cy * H(),
            radius: r, w: bw, h: bh,
            mass: bw * bh * 0.003,
            restitution: 0.1, friction: 0.8,
            isStatic: false,
            health: MAT_HP[s.mat], maxHealth: MAT_HP[s.mat],
            blockMat: s.mat,
          });
          bodies.push(b);
        }

        // Place pigs
        for (const p of def.pigs) {
          bodies.push(makeBody({
            type: "pig", x: p.cx * W(), y: p.cy * H(),
            radius: PIG_R, w: PIG_R * 2, h: PIG_R * 2,
            mass: 3, restitution: 0.2, friction: 0.7,
            isStatic: false,
            health: 60, maxHealth: 60,
          }));
        }

        loadNextBird();
      }

      function loadNextBird() {
        const bt = queue.shift();
        if (!bt) { activeBird = null; return; }
        activeBird = makeBody({
          type: "bird", x: SX(), y: SY(),
          radius: BIRD_R, w: BIRD_R * 2, h: BIRD_R * 2,
          mass: 2, restitution: 0.35, friction: 0.6,
          isStatic: true,
          health: 999, maxHealth: 999,
          birdType: bt,
        });
        dragX = SX(); dragY = SY();
      }

      buildLevel(0);

      // ── Draw helpers ─────────────────────────────────────────────────
      function drawBg() {
        bgGfx.clear();
        bgGfx.rect(0, 0, W(), GY()).fill(0x87ceeb);
        // horizon fade
        bgGfx.rect(0, GY() * 0.5, W(), GY() * 0.5).fill({ color: 0xd4eeff, alpha: 0.5 });
        // clouds
        const cls = [
          [0.15, 0.10, 28], [0.35, 0.07, 22], [0.55, 0.13, 32],
          [0.72, 0.08, 25], [0.88, 0.12, 20],
        ] as const;
        for (const [fx, fy, r] of cls) {
          const cx = fx * W(), cy = fy * H();
          bgGfx.circle(cx, cy, r).fill(0xffffff);
          bgGfx.circle(cx + r * 0.7, cy, r * 0.65).fill(0xffffff);
          bgGfx.circle(cx - r * 0.7, cy, r * 0.65).fill(0xffffff);
        }
      }

      function drawGround() {
        groundGfx.clear();
        const gy = GY();
        groundGfx.rect(0, gy, W(), H() - gy).fill(0x5a8a30);
        groundGfx.rect(0, gy + (H() - gy) * 0.25, W(), (H() - gy) * 0.75).fill(0x8b6914);
        // grass tufts
        for (let i = 0; i < 30; i++) {
          const gx = (i / 30) * W();
          groundGfx.rect(gx,     gy - 5, 3, 8).fill(0x3d7a1a);
          groundGfx.rect(gx + 7, gy - 7, 2, 9).fill(0x3d7a1a);
        }
      }

      function drawBirdShape(g: Graphics, bx: number, by: number, r: number, col: number) {
        g.circle(bx, by, r).fill(col);
        const s = r / BIRD_R;
        g.circle(bx + 7 * s, by - 5 * s, 5 * s).fill(0xffffff);
        g.circle(bx + 8 * s, by - 5 * s, 2.5 * s).fill(0x111111);
        g.poly([bx + 12 * s, by - 2 * s, bx + 19 * s, by, bx + 12 * s, by + 3 * s]).fill(0xff8c00);
        g.poly([bx - 3 * s, by - r, bx, by - r - 8 * s, bx + 3 * s, by - r]).fill(col);
      }

      function drawPig(g: Graphics, b: Body) {
        const hf  = b.health / b.maxHealth;
        const col = hf > 0.5 ? 0x4caf50 : 0x2e7d32;
        g.circle(b.x, b.y, b.radius).fill(col);
        g.circle(b.x - 6, b.y - 5, 4).fill(0xffffff);
        g.circle(b.x + 6, b.y - 5, 4).fill(0xffffff);
        g.circle(b.x - 6, b.y - 5, 2).fill(0x111111);
        g.circle(b.x + 6, b.y - 5, 2).fill(0x111111);
        g.ellipse(b.x, b.y + 3, 6, 4).fill(0x388e3c);
        g.circle(b.x - 2, b.y + 3, 1.5).fill(0x111111);
        g.circle(b.x + 2, b.y + 3, 1.5).fill(0x111111);
        if (hf < 0.7) {
          g.moveTo(b.x - 10, b.y - 9).lineTo(b.x - 3, b.y - 7).stroke({ color: 0x111111, width: 2 });
          g.moveTo(b.x + 3,  b.y - 7).lineTo(b.x + 10, b.y - 9).stroke({ color: 0x111111, width: 2 });
        }
      }

      function drawBlock(g: Graphics, b: Body) {
        const mat  = b.blockMat ?? "wood";
        const base = MAT_COL[mat];
        const hf   = Math.max(0, b.health / b.maxHealth);
        const dim  = 1 - hf * 0.5;
        const r2   = Math.round(((base >> 16) & 0xff) * (1 - dim));
        const g2   = Math.round(((base >>  8) & 0xff) * (1 - dim));
        const b2   = Math.round(( base        & 0xff) * (1 - dim));
        const col  = (r2 << 16) | (g2 << 8) | b2;
        const hw   = b.w / 2, hh = b.h / 2;
        g.rect(b.x - hw, b.y - hh, b.w, b.h).fill(col).stroke({ color: 0x00000044, width: 1 });
        if (mat === "wood") {
          g.moveTo(b.x - hw + 3, b.y - hh).lineTo(b.x - hw + 3, b.y + hh)
           .stroke({ color: 0x8b691466, width: 1 });
        }
        if (mat === "glass") {
          g.moveTo(b.x - hw, b.y - hh).lineTo(b.x + hw, b.y + hh)
           .stroke({ color: 0xffffff55, width: 1 });
        }
      }

      function drawSling() {
        slingGfx.clear();
        const sx = SX(), sy = SY(), baseY = GY();
        // posts
        slingGfx.moveTo(sx, baseY).lineTo(sx - 8, sy - 16)
          .stroke({ color: 0x8b4513, width: 7, cap: "round" });
        slingGfx.moveTo(sx, baseY).lineTo(sx + 8, sy - 16)
          .stroke({ color: 0x8b4513, width: 7, cap: "round" });

        if (phase !== "aim") return;
        const bx = dragging ? dragX : sx;
        const by = dragging ? dragY : sy;

        // rubber bands
        slingGfx.moveTo(sx - 8, sy - 16).lineTo(bx, by)
          .stroke({ color: 0x6b3a10, width: 3 });
        slingGfx.moveTo(sx + 8, sy - 16).lineTo(bx, by)
          .stroke({ color: 0x6b3a10, width: 3 });

        // active bird on sling
        if (activeBird) {
          const col = BIRD_COL[activeBird.birdType ?? "red"];
          drawBirdShape(slingGfx, bx, by, BIRD_R, col);
        }

        // queued birds on ground
        for (let i = 0; i < queue.length; i++) {
          const bt  = queue[i]!;
          const col = BIRD_COL[bt];
          const qx  = sx - 45 - i * 32;
          const qy  = GY() - PIG_R;
          drawBirdShape(slingGfx, qx, qy, 12, col);
        }
      }

      function drawTrajectory() {
        trajGfx.clear();
        if (phase !== "aim" || !dragging) return;
        const sx = SX(), sy = SY();
        const vx = (sx - dragX) * LAUNCH_POW;
        const vy = (sy - dragY) * LAUNCH_POW;
        let tx = sx, ty = sy, tvx = vx, tvy = vy;
        const step = 0.05;
        for (let i = 0; i < 30; i++) {
          tvy += GRAVITY * step;
          tx  += tvx * step;
          ty  += tvy * step;
          if (ty > GY()) break;
          trajGfx.circle(tx, ty, 3).fill({ color: 0xffffff, alpha: 1 - i / 30 });
        }
      }

      function drawBodies() {
        bodyGfx.clear();
        for (const b of bodies) {
          if (!b.alive) continue;
          if (b.type === "block") drawBlock(bodyGfx, b);
          else if (b.type === "pig")  drawPig(bodyGfx, b);
          else if (b.type === "bird") drawBirdShape(bodyGfx, b.x, b.y, b.radius, BIRD_COL[b.birdType ?? "red"]);
        }
      }

      function drawHud() {
        scoreTxt.text = `Score: ${score}`;
        levelTxt.text = `Level ${levelIndex + 1}`;
        hsTxt.text    = `Best: ${highScore}`;
      }

      function drawOverlay() {
        overlayGfx.clear();
        ovText.text  = "";
        subText.text = "";
        if (phase !== "won" && phase !== "lost") return;
        overlayGfx.rect(0, 0, W(), H()).fill({ color: 0x000000, alpha: 0.55 });
        ovText.position.set(W() / 2, H() / 2 - 28);
        subText.position.set(W() / 2, H() / 2 + 20);
        if (phase === "won") {
          ovText.text  = "🎉 Level Clear!";
          subText.text = `Score: ${score}  •  Tap to continue`;
        } else {
          ovText.text  = "💥 Try Again!";
          subText.text = "Tap to retry";
        }
      }

      // ── Input ────────────────────────────────────────────────────────
      app.stage.eventMode = "static";
      app.stage.hitArea   = app.screen;

      app.stage.on("pointerdown", (e) => {
        if (phase === "won")  { score = 0; buildLevel(levelIndex + 1); drawBg(); drawGround(); return; }
        if (phase === "lost") { score = 0; buildLevel(levelIndex);     drawBg(); drawGround(); return; }
        if (phase !== "aim" || !activeBird) return;

        const px = e.global.x, py = e.global.y;
        const ddx = px - SX(), ddy = py - SY();
        if (Math.sqrt(ddx * ddx + ddy * ddy) < 60) {
          dragging = true;
          dragX = px; dragY = py;
        }
      });

      app.stage.on("pointermove", (e) => {
        if (!dragging) return;
        const px = e.global.x, py = e.global.y;
        const sx = SX(), sy = SY();
        const ddx = px - sx, ddy = py - sy;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist > MAX_DRAG) {
          const a = Math.atan2(ddy, ddx);
          dragX = sx + Math.cos(a) * MAX_DRAG;
          dragY = sy + Math.sin(a) * MAX_DRAG;
        } else {
          dragX = px; dragY = py;
        }
      });

      app.stage.on("pointerup", () => {
        if (!dragging || !activeBird) return;
        dragging = false;
        const sx = SX(), sy = SY();
        const ddx = sx - dragX, ddy = sy - dragY;
        if (Math.sqrt(ddx * ddx + ddy * ddy) < 8) return;

        activeBird.x  = dragX;
        activeBird.y  = dragY;
        activeBird.vx = ddx * LAUNCH_POW;
        activeBird.vy = ddy * LAUNCH_POW;
        activeBird.isStatic = false;
        bodies.push(activeBird);
        activeBird = null;
        phase = "flying";
      });

      app.stage.on("pointerupoutside", () => { dragging = false; });

      // ── Initial draw ─────────────────────────────────────────────────
      drawBg();
      drawGround();

      // ── Ticker ───────────────────────────────────────────────────────
      app.ticker.add((ticker) => {
        const dt = ticker.deltaMS;

        if (phase === "flying" || phase === "settling") {
          stepPhysics(bodies, GY(), dt);

          // Score newly-killed pigs
          for (const b of bodies) {
            if (b.type === "pig" && !b.alive && b.health !== -9999) {
              score += 5000;
              b.health = -9999;
            }
          }

          if (phase === "flying") {
            const bird = bodies.find(b => b.type === "bird" && b.alive);
            if (!bird) {
              phase = "settling"; settleTimer = 2000;
            } else {
              const spd = Math.sqrt(bird.vx ** 2 + bird.vy ** 2);
              if (spd < 20 && bird.y >= GY() - bird.radius - 4) {
                phase = "settling"; settleTimer = 1500;
              }
            }
          }

          if (phase === "settling") {
            settleTimer -= dt;
            if (settleTimer <= 0) {
              const pigsLeft = bodies.filter(b => b.type === "pig" && b.alive).length;
              if (pigsLeft === 0) {
                score += (queue.length + (activeBird ? 1 : 0)) * 1500 + 2000;
                updateHighScore(score);
                phase = "won";
              } else if (queue.length === 0 && !activeBird) {
                phase = "lost";
              } else {
                loadNextBird();
                phase = "aim";
              }
            }
          }
        }

        drawSling();
        drawTrajectory();
        drawBodies();
        drawHud();
        drawOverlay();

        setUiScore(score);
        setUiLevel(levelIndex + 1);
        setUiPhase(phase);
        setUiBirds(activeBird
          ? [activeBird.birdType ?? "red", ...queue]
          : [...queue]);
      });
    })();

    return () => { destroyed = true; app.destroy(true); };
  }, [highScore, updateHighScore]);

  const birdEmoji: Record<BirdType, string> = { red: "🔴", blue: "🔵", yellow: "🟡" };

  return (
    <Shell
      sidebar={
        <div className="flex flex-col gap-5 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Score</div>
            <div className="text-3xl font-bold" style={{ fontFamily: "Fraunces, serif", color: "var(--fg)" }}>{uiScore.toLocaleString()}</div>
            <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>Best: {highScore.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Level</div>
            <div className="text-2xl font-bold" style={{ fontFamily: "Fraunces, serif", color: "var(--fg)" }}>{uiLevel} / {LEVELS.length}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Birds</div>
            <div className="flex flex-wrap gap-1">
              {uiBirds.map((b, i) => (
                <span key={i} className="text-xl">{birdEmoji[b]}</span>
              ))}
              {uiBirds.length === 0 && <span className="text-sm" style={{ color: "var(--muted)" }}>None left</span>}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Status</div>
            <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
              {uiPhase === "aim"      && "🎯 Aim & shoot!"}
              {uiPhase === "flying"   && "✈️ In flight…"}
              {uiPhase === "settling" && "⏳ Settling…"}
              {uiPhase === "won"      && "🎉 Level clear!"}
              {uiPhase === "lost"     && "💥 Try again!"}
            </div>
          </div>
          <div className="mt-auto text-xs" style={{ color: "var(--muted)" }}>
            Drag the bird back on the sling, release to shoot!
          </div>
        </div>
      }
    >
      <div ref={containerRef} className="w-full h-full" />
    </Shell>
  );
}
