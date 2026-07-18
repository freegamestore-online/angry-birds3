import { useEffect, useRef, useState } from "react";
import { Application, Graphics, Text, TextStyle } from "pixi.js";
import { Shell } from "./components/Shell";
import { useHighScore } from "./hooks/useHighScore";

// ─── Types ────────────────────────────────────────────────────────────────────
type BirdType = "red" | "blue" | "yellow";
type Phase    = "aim" | "flying" | "settling" | "won" | "lost";
type Mat      = "wood" | "stone" | "glass";

interface Body {
  id:      number;
  kind:    "bird" | "pig" | "block";
  // All coords are SCREEN pixels (y increases downward, origin = top-left of canvas)
  x:       number;
  y:       number;
  vx:      number;
  vy:      number;
  r:       number;   // collision radius
  w:       number;   // visual width  (blocks)
  h:       number;   // visual height (blocks)
  alive:   boolean;
  hp:      number;
  maxHp:   number;
  mat?:    Mat;
  birdType?: BirdType;
  scored?: boolean;
}

interface LevelDef {
  birds:  BirdType[];
  // Positions given as offsets from the sling anchor:
  //   dx = pixels to the right of the sling
  //   dy = pixels above the ground line
  pigs:   { dx: number; dy: number }[];
  blocks: { dx: number; dy: number; w: number; h: number; mat: Mat }[];
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const PAL = {
  sky:    0x87ceeb,
  skyBot: 0xb8ddf5,
  ground: 0x5a8a30,
  dirt:   0x7a5c14,
  sling:  0x8b4513,
  bird:   { red: 0xe63946, blue: 0x457b9d, yellow: 0xffd60a } as Record<BirdType, number>,
  block:  { wood: 0xc9a84c, stone: 0x8d8d8d, glass: 0xa8d8ea } as Record<Mat, number>,
  pig:    0x4caf50,
  pigDmg: 0x2e7d32,
};

const MAX_HP: Record<Mat, number> = { wood: 80, stone: 200, glass: 40 };
const PIG_HP   = 60;
const BIRD_R   = 20;
const PIG_R    = 18;
const GRAVITY  = 900;     // px / s²
const LAUNCH   = 12;      // px/s per px of drag
const MAX_DRAG = 85;

// ─── Levels ───────────────────────────────────────────────────────────────────
// dx is rightward from the sling; dy is upward from the ground.
const LEVELS: LevelDef[] = [
  {
    birds: ["red", "red", "red"],
    pigs:   [{ dx: 600, dy: PIG_R }],
    blocks: [
      { dx: 560, dy: 60,  w: 40, h: 120, mat: "wood" },
      { dx: 640, dy: 60,  w: 40, h: 120, mat: "wood" },
      { dx: 600, dy: 135, w: 120, h: 30, mat: "wood" },
    ],
  },
  {
    birds: ["red", "blue", "red"],
    pigs:   [{ dx: 570, dy: PIG_R }, { dx: 760, dy: PIG_R }],
    blocks: [
      { dx: 530, dy: 60,  w: 40, h: 120, mat: "wood"  },
      { dx: 610, dy: 60,  w: 40, h: 120, mat: "wood"  },
      { dx: 570, dy: 135, w: 120, h: 30, mat: "wood"  },
      { dx: 720, dy: 60,  w: 40, h: 120, mat: "stone" },
      { dx: 800, dy: 60,  w: 40, h: 120, mat: "stone" },
    ],
  },
  {
    birds: ["red", "yellow", "blue", "red"],
    pigs:   [{ dx: 570, dy: PIG_R }, { dx: 770, dy: PIG_R }, { dx: 670, dy: 170 }],
    blocks: [
      { dx: 530, dy: 75,  w: 40, h: 150, mat: "stone" },
      { dx: 630, dy: 75,  w: 40, h: 150, mat: "wood"  },
      { dx: 730, dy: 75,  w: 40, h: 150, mat: "stone" },
      { dx: 630, dy: 165, w: 240, h: 30, mat: "stone" },
      { dx: 630, dy: 230, w: 40, h: 100, mat: "wood"  },
    ],
  },
  {
    birds: ["yellow", "red", "blue", "yellow"],
    pigs:   [{ dx: 560, dy: PIG_R }, { dx: 750, dy: PIG_R }, { dx: 655, dy: 170 }],
    blocks: [
      { dx: 520, dy: 75,  w: 35, h: 150, mat: "glass" },
      { dx: 615, dy: 75,  w: 35, h: 150, mat: "glass" },
      { dx: 710, dy: 75,  w: 35, h: 150, mat: "glass" },
      { dx: 520, dy: 165, w: 225, h: 30, mat: "glass" },
      { dx: 590, dy: 215, w: 35, h: 100, mat: "glass" },
      { dx: 675, dy: 215, w: 35, h: 100, mat: "glass" },
    ],
  },
  {
    birds: ["red", "yellow", "blue", "yellow", "red"],
    pigs: [
      { dx: 540, dy: PIG_R }, { dx: 660, dy: PIG_R }, { dx: 780, dy: PIG_R },
      { dx: 600, dy: 185 }, { dx: 720, dy: 185 },
    ],
    blocks: [
      { dx: 500, dy: 80,  w: 40, h: 160, mat: "stone" },
      { dx: 620, dy: 80,  w: 40, h: 160, mat: "wood"  },
      { dx: 740, dy: 80,  w: 40, h: 160, mat: "stone" },
      { dx: 620, dy: 175, w: 280, h: 30, mat: "wood"  },
      { dx: 560, dy: 260, w: 40, h: 120, mat: "glass" },
      { dx: 680, dy: 260, w: 40, h: 120, mat: "glass" },
      { dx: 620, dy: 335, w: 160, h: 30, mat: "stone" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
let _id = 1;
function makeBody(
  kind: Body["kind"], x: number, y: number,
  r: number, w: number, h: number, hp: number,
  extra: Partial<Body> = {}
): Body {
  return { id: _id++, kind, x, y, vx: 0, vy: 0, r, w, h, alive: true, hp, maxHp: hp, ...extra };
}

// Physics runs entirely in screen space (y increases downward).
// groundY = the y-coordinate of the ground line on screen.
function stepPhysics(bodies: Body[], groundY: number, dtSec: number) {
  for (const b of bodies) {
    if (!b.alive) continue;
    b.vy += GRAVITY * dtSec;
    b.x  += b.vx * dtSec;
    b.y  += b.vy * dtSec;
  }

  // Ground collision
  for (const b of bodies) {
    if (!b.alive) continue;
    const floor = groundY - b.r;
    if (b.y >= floor) {
      b.y   = floor;
      b.vy *= -0.35;
      b.vx *= 0.75;
      if (Math.abs(b.vy) < 8) b.vy = 0;
    }
  }

  // Circle vs circle
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (!b.alive) continue;
      const dx   = b.x - a.x;
      const dy   = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = a.r + b.r;
      if (dist >= minD || dist < 0.001) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const ov = minD - dist;

      const mA = a.kind === "block" ? a.w * a.h * 0.004 : a.r * a.r * 0.05;
      const mB = b.kind === "block" ? b.w * b.h * 0.004 : b.r * b.r * 0.05;
      const mt = mA + mB;
      a.x -= nx * ov * (mB / mt);
      a.y -= ny * ov * (mB / mt);
      b.x += nx * ov * (mA / mt);
      b.y += ny * ov * (mA / mt);

      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const dot = rvx * nx + rvy * ny;
      if (dot >= 0) continue;

      const e   = 0.25;
      const imp = (-(1 + e) * dot) / (1 / mA + 1 / mB);
      const spd = Math.sqrt(rvx * rvx + rvy * rvy);
      const dmg = Math.min(spd * 0.4, 60);

      a.vx -= (imp / mA) * nx;
      a.vy -= (imp / mA) * ny;
      b.vx += (imp / mB) * nx;
      b.vy += (imp / mB) * ny;

      if (a.kind !== "bird") a.hp -= dmg;
      if (b.kind !== "bird") b.hp -= dmg;
    }
  }

  for (const b of bodies) {
    if (b.hp <= 0) b.alive = false;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highScore, updateHighScore] = useHighScore("angrybirds3_hs");
  const [uiScore, setUiScore] = useState(0);
  const [uiLevel, setUiLevel] = useState(1);
  const [uiPhase, setUiPhase] = useState<Phase>("aim");
  const [uiBirds, setUiBirds] = useState<BirdType[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let destroyed = false;
    const app = new Application();

    (async () => {
      await app.init({ resizeTo: container, background: PAL.sky, antialias: true });
      if (destroyed) { app.destroy(true); return; }
      container.appendChild(app.canvas);

      const W  = () => app.screen.width;
      const H  = () => app.screen.height;

      // Ground line: fixed fraction of screen height — always visible
      const GY = () => H() * 0.78;

      // Sling anchor on screen (fixed, never moves)
      const SX = () => W() * 0.18;
      const SY = () => GY() - 80;   // fork top, 80px above ground
      const SBY = () => GY() - 8;   // sling base (stick bottom)

      // Camera: world bodies are placed relative to sling screen pos.
      // camX shifts body.x when rendering: screenX = body.x + camX
      // Initially camX=0 so sling-relative positions map directly.

      const gBg      = new Graphics();
      const gGround  = new Graphics();
      const gBodies  = new Graphics();
      const gSling   = new Graphics();
      const gTraj    = new Graphics();
      const gOverlay = new Graphics();

      app.stage.addChild(gBg, gGround, gBodies, gSling, gTraj, gOverlay);

      const hudSt = new TextStyle({
        fontFamily: "Manrope, sans-serif", fontSize: 15,
        fill: 0xffffff, fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 3, distance: 1 },
      });
      const tScore = new Text({ text: "Score: 0", style: hudSt });
      const tLevel = new Text({ text: "Level 1", style: hudSt });
      const tBest  = new Text({ text: "Best: 0",  style: hudSt });
      tScore.position.set(10, 8);
      tLevel.position.set(10, 26);
      tBest.position.set(10,  44);

      const ovSt = new TextStyle({
        fontFamily: "Fraunces, serif", fontSize: 38, fill: 0xffffff, fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 8, distance: 2 },
      });
      const subSt = new TextStyle({
        fontFamily: "Manrope, sans-serif", fontSize: 20, fill: 0xffffff,
        dropShadow: { color: 0x000000, blur: 4, distance: 1 },
      });
      const tOv  = new Text({ text: "", style: ovSt  });
      const tSub = new Text({ text: "", style: subSt });
      tOv.anchor.set(0.5);
      tSub.anchor.set(0.5);
      app.stage.addChild(tScore, tLevel, tBest, tOv, tSub);

      // ── Game state ──────────────────────────────────────────────────────
      let levelIdx = 0;
      let score    = 0;
      let phase: Phase = "aim";
      let bodies: Body[] = [];
      let queue: BirdType[] = [];
      let activeBT: BirdType = "red";
      let dragging  = false;
      let dragSX    = 0;
      let dragSY    = 0;
      let camX      = 0;
      let targetCam = 0;
      let settleT   = 0;

      function buildLevel(idx: number) {
        _id = 1;
        const def = LEVELS[idx % LEVELS.length]!;
        bodies = [];

        // Bodies are placed in screen coords relative to sling screen pos.
        // At build time, SX() is the sling x. Bodies placed at SX() + dx.
        // GY() is the ground y. Bodies placed at GY() - dy (dy is upward offset).
        const sx = SX();
        const gy = GY();

        for (const bl of def.blocks) {
          const bx = sx + bl.dx;
          // dy is from ground up to the BOTTOM of the block
          const by = gy - bl.dy - bl.h / 2; // center y
          const r  = Math.min(bl.w, bl.h) * 0.45;
          bodies.push(makeBody("block", bx, by, r, bl.w, bl.h, MAX_HP[bl.mat], { mat: bl.mat }));
        }

        for (const p of def.pigs) {
          const px = sx + p.dx;
          const py = gy - p.dy;
          bodies.push(makeBody("pig", px, py, PIG_R, PIG_R * 2, PIG_R * 2, PIG_HP));
        }

        queue      = [...def.birds];
        activeBT   = queue.shift() ?? "red";
        dragging   = false;
        phase      = "aim";
        camX       = 0;
        targetCam  = 0;
      }

      buildLevel(levelIdx);

      // ── Draw functions ──────────────────────────────────────────────────
      function drawBg() {
        gBg.clear();
        // Sky covers full canvas
        gBg.rect(0, 0, W(), GY()).fill(PAL.sky);
        // Lighter band near horizon
        gBg.rect(0, GY() * 0.55, W(), GY() * 0.45).fill(PAL.skyBot);
        // Clouds (screen space, fixed)
        const clouds = [
          { x: 0.08, y: 0.10, r: 32 }, { x: 0.22, y: 0.07, r: 24 },
          { x: 0.40, y: 0.13, r: 30 }, { x: 0.58, y: 0.08, r: 36 },
          { x: 0.74, y: 0.11, r: 28 }, { x: 0.90, y: 0.06, r: 22 },
        ];
        for (const c of clouds) {
          const cx = c.x * W();
          const cy = c.y * H();
          gBg.circle(cx,          cy, c.r).fill(0xffffff);
          gBg.circle(cx + c.r,    cy, c.r * 0.7).fill(0xffffff);
          gBg.circle(cx - c.r,    cy, c.r * 0.7).fill(0xffffff);
          gBg.circle(cx + c.r * 0.5, cy - c.r * 0.4, c.r * 0.6).fill(0xffffff);
        }
      }

      function drawGround() {
        gGround.clear();
        const gy = GY();
        // Green strip
        gGround.rect(0, gy, W(), H() * 0.04 + 2).fill(PAL.ground);
        // Dirt below
        gGround.rect(0, gy + H() * 0.04, W(), H() - gy).fill(PAL.dirt);
        // Grass tufts
        for (let i = 0; i < 40; i++) {
          const gx = (i / 40) * W();
          gGround.rect(gx,     gy - 5, 5, 9).fill(0x3d7a1a);
          gGround.rect(gx + 9, gy - 7, 4, 11).fill(0x3d7a1a);
        }
      }

      function birdShape(g: Graphics, x: number, y: number, r: number, bt: BirdType) {
        const col = PAL.bird[bt];
        const s   = r / BIRD_R;
        g.circle(x, y, r).fill(col);
        g.circle(x + 7 * s, y - 5 * s, 5 * s).fill(0xffffff);
        g.circle(x + 8 * s, y - 5 * s, 2.5 * s).fill(0x1a1a1a);
        g.poly([x + 12 * s, y - 2 * s, x + 19 * s, y, x + 12 * s, y + 3 * s]).fill(0xffa500);
        g.poly([x - 3 * s, y - r, x, y - r - 9 * s, x + 3 * s, y - r]).fill(col);
      }

      function pigShape(g: Graphics, x: number, y: number, hp: number) {
        const col = hp / PIG_HP > 0.5 ? PAL.pig : PAL.pigDmg;
        g.circle(x, y, PIG_R).fill(col);
        g.circle(x - 6, y - 5, 4).fill(0xffffff);
        g.circle(x + 6, y - 5, 4).fill(0xffffff);
        g.circle(x - 6, y - 5, 2).fill(0x1a1a1a);
        g.circle(x + 6, y - 5, 2).fill(0x1a1a1a);
        g.ellipse(x, y + 3, 6, 4).fill(0x388e3c);
        g.circle(x - 2, y + 3, 1.5).fill(0x1a1a1a);
        g.circle(x + 2, y + 3, 1.5).fill(0x1a1a1a);
        if (hp / PIG_HP < 0.7) {
          g.moveTo(x - 10, y - 9).lineTo(x - 3, y - 7).stroke({ color: 0x1a1a1a, width: 2 });
          g.moveTo(x + 3,  y - 7).lineTo(x + 10, y - 9).stroke({ color: 0x1a1a1a, width: 2 });
        }
      }

      function blockShape(g: Graphics, x: number, y: number, w: number, h: number, mat: Mat, hp: number) {
        const base = PAL.block[mat];
        const dmg  = 1 - Math.max(0, hp / MAX_HP[mat]);
        const fade = 1 - dmg * 0.55;
        const r2   = ((base >> 16) & 0xff) * fade;
        const g2   = ((base >>  8) & 0xff) * fade;
        const b2   = ( base        & 0xff) * fade;
        const col  = (Math.round(r2) << 16) | (Math.round(g2) << 8) | Math.round(b2);
        g.rect(x - w / 2, y - h / 2, w, h).fill(col).stroke({ color: 0x000000, width: 1, alpha: 0.25 });
        if (mat === "wood") {
          g.moveTo(x - w / 2 + 5, y - h / 2).lineTo(x - w / 2 + 5, y + h / 2)
           .stroke({ color: 0x8b6914, width: 1, alpha: 0.35 });
        }
        if (mat === "glass") {
          g.moveTo(x - w / 2 + 4, y - h / 2 + 4).lineTo(x - w / 2 + 12, y - h / 2 + 4)
           .stroke({ color: 0xffffff, width: 2, alpha: 0.4 });
        }
      }

      function drawSling() {
        gSling.clear();
        const sx  = SX();
        const sy  = SY();
        const sby = SBY();

        // Fork posts
        gSling.moveTo(sx, sby).lineTo(sx - 10, sy)
          .stroke({ color: PAL.sling, width: 9, cap: "round" });
        gSling.moveTo(sx, sby).lineTo(sx + 10, sy)
          .stroke({ color: PAL.sling, width: 9, cap: "round" });

        if (phase !== "aim") return;

        const bx = dragging ? dragSX : sx;
        const by = dragging ? dragSY : sy;

        // Back band
        gSling.moveTo(sx + 10, sy).lineTo(bx, by)
          .stroke({ color: 0x5a2d0c, width: 3 });
        // Bird on sling
        birdShape(gSling, bx, by, BIRD_R, activeBT);
        // Front band (drawn over bird so it looks like it's in the pouch)
        gSling.moveTo(sx - 10, sy).lineTo(bx, by)
          .stroke({ color: PAL.sling, width: 3 });

        // Queue birds sitting on ground to the left
        for (let i = 0; i < queue.length; i++) {
          const bt = queue[i]!;
          const qx = sx - 55 - i * 38;
          const qy = GY() - 14;
          birdShape(gSling, qx, qy, 13, bt);
        }
      }

      function drawTrajectory() {
        gTraj.clear();
        if (phase !== "aim" || !dragging) return;
        const sx  = SX();
        const sy  = SY();
        // Pull vector: from drag pos back to sling centre
        const pvx = (sx - dragSX) * LAUNCH;
        const pvy = (sy - dragSY) * LAUNCH;
        let tx = sx, ty = sy, tvx = pvx, tvy = pvy;
        const step = 0.05;
        for (let i = 0; i < 30; i++) {
          tvy += GRAVITY * step;
          tx  += tvx * step;
          ty  += tvy * step;
          if (ty > GY()) break;
          gTraj.circle(tx, ty, 3.5).fill({ color: 0xffffff, alpha: (1 - i / 30) * 0.8 });
        }
      }

      function drawBodies() {
        gBodies.clear();
        for (const b of bodies) {
          if (!b.alive) continue;
          // Apply camera offset to x; y is unchanged (no vertical scroll)
          const sx = b.x + camX;
          const sy = b.y;
          if (b.kind === "block") {
            blockShape(gBodies, sx, sy, b.w, b.h, b.mat ?? "wood", b.hp);
          } else if (b.kind === "pig") {
            pigShape(gBodies, sx, sy, b.hp);
          } else if (b.kind === "bird") {
            birdShape(gBodies, sx, sy, BIRD_R, b.birdType ?? "red");
          }
        }
      }

      function drawOverlay() {
        gOverlay.clear();
        tOv.text  = "";
        tSub.text = "";
        if (phase !== "won" && phase !== "lost") return;
        gOverlay.rect(0, 0, W(), H()).fill({ color: 0x000000, alpha: 0.5 });
        tOv.position.set(W() / 2, H() / 2 - 35);
        tSub.position.set(W() / 2, H() / 2 + 25);
        if (phase === "won") {
          tOv.text  = "🎉 Level Clear!";
          tSub.text = `Score: ${score}  •  Tap to continue`;
        } else {
          tOv.text  = "💥 Try Again!";
          tSub.text = "Tap to retry";
        }
      }

      function drawHud() {
        tScore.text = `Score: ${score}`;
        tLevel.text = `Level ${levelIdx + 1}`;
        tBest.text  = `Best: ${highScore}`;
      }

      // ── Input ───────────────────────────────────────────────────────────
      app.stage.eventMode = "static";
      app.stage.hitArea   = app.screen;

      app.stage.on("pointerdown", (e) => {
        if (phase === "won") {
          levelIdx++;
          buildLevel(levelIdx);
          drawBg(); drawGround();
          return;
        }
        if (phase === "lost") {
          buildLevel(levelIdx);
          drawBg(); drawGround();
          return;
        }
        if (phase !== "aim") return;

        const px = e.global.x;
        const py = e.global.y;
        const dist = Math.sqrt((px - SX()) ** 2 + (py - SY()) ** 2);
        if (dist < 65) {
          dragging = true;
          dragSX   = px;
          dragSY   = py;
        }
      });

      app.stage.on("pointermove", (e) => {
        if (!dragging) return;
        const px  = e.global.x;
        const py  = e.global.y;
        const dx  = px - SX();
        const dy  = py - SY();
        const d   = Math.sqrt(dx * dx + dy * dy);
        if (d > MAX_DRAG) {
          const a = Math.atan2(dy, dx);
          dragSX  = SX() + Math.cos(a) * MAX_DRAG;
          dragSY  = SY() + Math.sin(a) * MAX_DRAG;
        } else {
          dragSX = px;
          dragSY = py;
        }
      });

      app.stage.on("pointerup", () => {
        if (!dragging) return;
        dragging = false;
        const dx   = SX() - dragSX;
        const dy   = SY() - dragSY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 8) return;

        // Bird starts at the drag position in screen space.
        // camX=0 at launch time, so screen pos = body pos directly.
        // vx = pull direction scaled. vy = pull direction scaled (screen y, up = negative).
        const bird = makeBody(
          "bird",
          dragSX, dragSY,
          BIRD_R, BIRD_R * 2, BIRD_R * 2,
          999,
          { birdType: activeBT }
        );
        bird.vx = dx * LAUNCH;
        bird.vy = dy * LAUNCH;
        bodies.push(bird);
        phase = "flying";
        settleT = 0;
      });

      app.stage.on("pointerupoutside", () => { dragging = false; });

      // ── Initial draw ────────────────────────────────────────────────────
      drawBg();
      drawGround();

      // ── Game loop ───────────────────────────────────────────────────────
      app.ticker.add((ticker) => {
        const dt    = ticker.deltaMS;
        const dtSec = Math.min(dt / 1000, 0.033);

        if (phase === "flying" || phase === "settling") {
          stepPhysics(bodies, GY(), dtSec);

          // Camera: keep flying bird near left-third of screen
          const flyBird = bodies.find(b => b.kind === "bird" && b.alive);
          if (flyBird) {
            // flyBird.x + camX = screen x
            // We want screen x ≈ W() * 0.35
            const desiredCam = W() * 0.35 - flyBird.x;
            // Only scroll right (camX goes negative as bird moves right)
            targetCam = Math.min(0, desiredCam);
          }

          if (phase === "flying") {
            const bird = bodies.find(b => b.kind === "bird" && b.alive);
            if (!bird) {
              phase   = "settling";
              settleT = 2000;
            } else {
              const spd = Math.sqrt(bird.vx ** 2 + bird.vy ** 2);
              if (spd < 20 && bird.y >= GY() - bird.r - 5) {
                phase   = "settling";
                settleT = 1500;
              }
            }
          }

          if (phase === "settling") {
            settleT -= dt;
            if (settleT <= 0) {
              const pigsLeft = bodies.filter(b => b.kind === "pig" && b.alive).length;
              if (pigsLeft === 0) {
                const bonus = (queue.length + 1) * 2000;
                score += bonus + 3000;
                updateHighScore(score);
                phase     = "won";
                targetCam = 0;
              } else if (queue.length === 0) {
                phase     = "lost";
                targetCam = 0;
              } else {
                activeBT  = queue.shift() ?? "red";
                phase     = "aim";
                targetCam = 0;
              }
            }
          }

          // Score killed pigs
          for (const b of bodies) {
            if (b.kind === "pig" && !b.alive && !b.scored) {
              score   += 5000;
              b.scored = true;
            }
          }
        }

        // Smooth camera
        camX += (targetCam - camX) * 0.09;

        // Redraw
        drawSling();
        drawTrajectory();
        drawBodies();
        drawOverlay();
        drawHud();

        // Sync React UI
        setUiScore(score);
        setUiLevel(levelIdx + 1);
        setUiPhase(phase);
        setUiBirds([activeBT, ...queue]);
      });
    })();

    return () => {
      destroyed = true;
      app.destroy(true);
    };
  }, [highScore, updateHighScore]);

  const birdEmoji: Record<BirdType, string> = { red: "🔴", blue: "🔵", yellow: "🟡" };

  return (
    <Shell
      sidebar={
        <div className="flex flex-col gap-4 px-4 py-2">
          <div>
            <div className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Score</div>
            <div className="text-3xl font-bold"
              style={{ fontFamily: "Fraunces, serif", color: "var(--fg)" }}>
              {uiScore.toLocaleString()}
            </div>
            <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              Best: {highScore.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Level</div>
            <div className="text-2xl font-bold"
              style={{ fontFamily: "Fraunces, serif", color: "var(--fg)" }}>
              {uiLevel} / {LEVELS.length}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Birds</div>
            <div className="flex gap-1 flex-wrap">
              {uiBirds.map((b, i) => <span key={i} className="text-xl">{birdEmoji[b]}</span>)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}>Status</div>
            <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
              {uiPhase === "aim"      ? "🎯 Aim & drag to shoot" :
               uiPhase === "flying"  ? "🚀 In flight!" :
               uiPhase === "settling"? "⏳ Settling…" :
               uiPhase === "won"     ? "🎉 Level clear!" :
                                       "💥 Try again!"}
            </div>
          </div>
        </div>
      }
    >
      <div ref={containerRef} className="w-full h-full" />
    </Shell>
  );
}
