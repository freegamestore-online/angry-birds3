import { useEffect, useRef, useState, useCallback } from "react";
import { Application, Graphics, Text, TextStyle } from "pixi.js";
import { Shell } from "./components/Shell";
import { useHighScore } from "./hooks/useHighScore";

// ─── Types ────────────────────────────────────────────────────────────────────
type BirdType = "red" | "blue" | "yellow";
type Phase = "aim" | "flying" | "settling" | "won" | "lost";

interface Body {
  id: number;
  kind: "bird" | "pig" | "block";
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  w: number; h: number;
  mass: number;
  rest: number;
  fric: number;
  isStatic: boolean;
  alive: boolean;
  hp: number; maxHp: number;
  birdType?: BirdType;
  mat?: "wood" | "stone" | "glass";
}

// ─── Colours ─────────────────────────────────────────────────────────────────
const BIRD_COL: Record<BirdType, number> = {
  red: 0xe63946, blue: 0x457b9d, yellow: 0xffd60a,
};
const MAT_COL = { wood: 0xc9a84c, stone: 0x909090, glass: 0xa8d8ea };
const MAT_HP  = { wood: 70, stone: 200, glass: 30 };

// ─── Level definitions ────────────────────────────────────────────────────────
interface LevelDef {
  birds: BirdType[];
  blocks: { cx: number; cy: number; bw: number; bh: number; mat: "wood"|"stone"|"glass" }[];
  pigs:  { cx: number; cy: number }[];
}

// Ground at 80% height. Sling at ~18% width.
// Structures on right side (0.55–0.90 cx).
// cy is fraction from top; ground top = 0.80, so cy=0.76 sits just above ground.
const LEVELS: LevelDef[] = [
  {
    birds: ["red", "red"],
    blocks: [{ cx: 0.68, cy: 0.72, bw: 0.04, bh: 0.14, mat: "wood" }],
    pigs:  [{ cx: 0.75, cy: 0.76 }],
  },
  {
    birds: ["red", "red", "blue"],
    blocks: [
      { cx: 0.63, cy: 0.72, bw: 0.04, bh: 0.14, mat: "wood" },
      { cx: 0.63, cy: 0.57, bw: 0.04, bh: 0.04, mat: "wood" },
      { cx: 0.75, cy: 0.72, bw: 0.04, bh: 0.14, mat: "wood" },
      { cx: 0.75, cy: 0.57, bw: 0.04, bh: 0.04, mat: "wood" },
    ],
    pigs: [{ cx: 0.63, cy: 0.52 }, { cx: 0.75, cy: 0.52 }],
  },
  {
    birds: ["red", "yellow", "red"],
    blocks: [
      { cx: 0.60, cy: 0.70, bw: 0.035, bh: 0.18, mat: "stone" },
      { cx: 0.76, cy: 0.70, bw: 0.035, bh: 0.18, mat: "stone" },
      { cx: 0.68, cy: 0.60, bw: 0.20,  bh: 0.035, mat: "stone" },
    ],
    pigs: [{ cx: 0.68, cy: 0.76 }],
  },
  {
    birds: ["yellow", "blue", "red", "red"],
    blocks: [
      { cx: 0.60, cy: 0.72, bw: 0.035, bh: 0.14, mat: "glass" },
      { cx: 0.68, cy: 0.72, bw: 0.035, bh: 0.14, mat: "glass" },
      { cx: 0.76, cy: 0.72, bw: 0.035, bh: 0.14, mat: "glass" },
      { cx: 0.68, cy: 0.61, bw: 0.20,  bh: 0.035, mat: "glass" },
      { cx: 0.68, cy: 0.55, bw: 0.035, bh: 0.09,  mat: "glass" },
    ],
    pigs: [{ cx: 0.60, cy: 0.76 }, { cx: 0.76, cy: 0.76 }, { cx: 0.68, cy: 0.50 }],
  },
  {
    birds: ["red", "yellow", "blue", "yellow", "red"],
    blocks: [
      { cx: 0.57, cy: 0.72, bw: 0.035, bh: 0.14, mat: "stone" },
      { cx: 0.66, cy: 0.72, bw: 0.035, bh: 0.14, mat: "wood"  },
      { cx: 0.75, cy: 0.72, bw: 0.035, bh: 0.14, mat: "stone" },
      { cx: 0.66, cy: 0.61, bw: 0.22,  bh: 0.035, mat: "wood" },
      { cx: 0.61, cy: 0.55, bw: 0.035, bh: 0.09,  mat: "glass" },
      { cx: 0.71, cy: 0.55, bw: 0.035, bh: 0.09,  mat: "glass" },
      { cx: 0.66, cy: 0.48, bw: 0.13,  bh: 0.035, mat: "stone" },
    ],
    pigs: [
      { cx: 0.57, cy: 0.76 }, { cx: 0.75, cy: 0.76 },
      { cx: 0.61, cy: 0.50 }, { cx: 0.71, cy: 0.50 },
    ],
  },
];

// ─── Physics ──────────────────────────────────────────────────────────────────
const GRAVITY    = 1100;
const LAUNCH_POW = 11;
const MAX_DRAG   = 75;
const BIRD_R     = 16;
const PIG_R      = 14;

let _nid = 1;
function mkBody(p: Omit<Body, "id"|"vx"|"vy"|"alive">): Body {
  return { ...p, id: _nid++, vx: 0, vy: 0, alive: true };
}

function step(bodies: Body[], groundY: number, dtMs: number) {
  const dt = Math.min(dtMs / 1000, 0.033);

  for (const b of bodies) {
    if (b.isStatic || !b.alive) continue;
    b.vy += GRAVITY * dt;
    b.x  += b.vx * dt;
    b.y  += b.vy * dt;
  }

  for (const b of bodies) {
    if (b.isStatic || !b.alive) continue;
    const floor = groundY - b.r;
    if (b.y > floor) {
      const impactSpd = Math.abs(b.vy);
      b.y   = floor;
      b.vy *= -b.rest;
      b.vx *= b.fric;
      if (Math.abs(b.vy) < 15) b.vy = 0;
      if (impactSpd > 30) b.hp -= impactSpd * 0.1;
    }
  }

  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (!b.alive) continue;
      if (a.isStatic && b.isStatic) continue;

      const dx   = b.x - a.x;
      const dy   = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = a.r + b.r;
      if (dist >= minD || dist < 0.001) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const ov = minD - dist;

      if (!a.isStatic && !b.isStatic) {
        a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
        b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;
      } else if (!a.isStatic) {
        a.x -= nx * ov; a.y -= ny * ov;
      } else {
        b.x += nx * ov; b.y += ny * ov;
      }

      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const dot = rvx * nx + rvy * ny;
      if (dot >= 0) continue;

      const e   = Math.min(a.rest, b.rest);
      const imp = (-(1 + e) * dot) / (1 / a.mass + 1 / b.mass);
      const spd = Math.sqrt(rvx * rvx + rvy * rvy);
      const dmg = Math.min(spd * 0.4, 60);

      if (!a.isStatic) { a.vx -= (imp * nx) / a.mass; a.vy -= (imp * ny) / a.mass; }
      if (!b.isStatic) { b.vx += (imp * nx) / b.mass; b.vy += (imp * ny) / b.mass; }

      if (dmg > 4) {
        if (!a.isStatic) a.hp -= dmg;
        if (!b.isStatic) b.hp -= dmg;
      }
    }
  }

  for (const b of bodies) if (b.hp <= 0) b.alive = false;
}

// ─── Game state ───────────────────────────────────────────────────────────────
interface GS {
  phase: Phase;
  lvlIdx: number;
  score: number;
  queue: BirdType[];
  bodies: Body[];
  bird: Body | null;
  dragging: boolean;
  dragX: number; dragY: number;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highScore, updateHighScore] = useHighScore("ab3_hs");
  const [uiScore, setUiScore] = useState(0);
  const [uiLevel, setUiLevel] = useState(1);
  const [uiPhase, setUiPhase] = useState<Phase>("aim");
  const [uiBirds, setUiBirds] = useState<BirdType[]>([]);
  const gsRef = useRef<GS | null>(null);

  const buildLevel = useCallback((lvlIdx: number, W: number, H: number): GS => {
    const def = LEVELS[lvlIdx % LEVELS.length]!;
    const bodies: Body[] = [];

    for (const bl of def.blocks) {
      const bw = bl.bw * W;
      const bh = bl.bh * H;
      bodies.push(mkBody({
        kind: "block",
        x: bl.cx * W, y: bl.cy * H,
        r: Math.min(bw, bh) / 2,
        w: bw, h: bh,
        mass: bw * bh * 0.004,
        rest: 0.15, fric: 0.75,
        isStatic: false,
        hp: MAT_HP[bl.mat], maxHp: MAT_HP[bl.mat],
        mat: bl.mat,
      }));
    }

    for (const pg of def.pigs) {
      bodies.push(mkBody({
        kind: "pig",
        x: pg.cx * W, y: pg.cy * H,
        r: PIG_R, w: PIG_R * 2, h: PIG_R * 2,
        mass: 3, rest: 0.3, fric: 0.7,
        isStatic: false,
        hp: 60, maxHp: 60,
      }));
    }

    const queue = [...def.birds];
    const firstType = queue.shift()!;
    const _sx = W * 0.18;
    const _sy = H * 0.80 - 28;

    const bird = mkBody({
      kind: "bird",
      x: _sx, y: _sy,
      r: BIRD_R, w: BIRD_R * 2, h: BIRD_R * 2,
      mass: 2, rest: 0.35, fric: 0.6,
      isStatic: true,
      hp: 999, maxHp: 999,
      birdType: firstType,
    });

    return {
      phase: "aim",
      lvlIdx,
      score: gsRef.current?.score ?? 0,
      queue,
      bodies,
      bird,
      dragging: false,
      dragX: _sx, dragY: _sy,
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dead = false;
    const app = new Application();

    (async () => {
      await app.init({
        resizeTo: container,
        background: 0x87ceeb,
        antialias: true,
      });
      if (dead) { app.destroy(true); return; }
      container.appendChild(app.canvas);

      // Make the canvas fill the container
      app.canvas.style.display = "block";
      app.canvas.style.width   = "100%";
      app.canvas.style.height  = "100%";

      const W = () => app.screen.width;
      const H = () => app.screen.height;
      const gY  = () => H() * 0.80;
      const slX = () => W() * 0.18;
      const slY = () => gY() - 28;

      // ── Graphics layers ──────────────────────────────────────────────
      const bgGfx      = new Graphics();
      const groundGfx  = new Graphics();
      const bodyGfx    = new Graphics();
      const slingGfx   = new Graphics();
      const trajGfx    = new Graphics();
      const overlayGfx = new Graphics();
      app.stage.addChild(bgGfx, groundGfx, bodyGfx, slingGfx, trajGfx, overlayGfx);

      // ── HUD ──────────────────────────────────────────────────────────
      const hudSty = new TextStyle({
        fontFamily: "Manrope,sans-serif", fontSize: 15, fill: 0xffffff,
        fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 3, distance: 1 },
      });
      const scoreTxt = new Text({ text: "Score: 0", style: hudSty });
      const levelTxt = new Text({ text: "Level 1", style: hudSty });
      const hsTxt    = new Text({ text: "Best: 0",  style: hudSty });
      scoreTxt.position.set(10, 8);
      levelTxt.position.set(10, 26);
      hsTxt.position.set(10, 44);
      app.stage.addChild(scoreTxt, levelTxt, hsTxt);

      const overSty = new TextStyle({
        fontFamily: "Fraunces,serif", fontSize: 32, fill: 0xffffff,
        fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 6, distance: 2 },
      });
      const subSty = new TextStyle({
        fontFamily: "Manrope,sans-serif", fontSize: 17, fill: 0xffffff,
        dropShadow: { color: 0x000000, blur: 4, distance: 1 },
      });
      const overTxt = new Text({ text: "", style: overSty });
      const subTxt  = new Text({ text: "", style: subSty });
      overTxt.anchor.set(0.5);
      subTxt.anchor.set(0.5);
      app.stage.addChild(overTxt, subTxt);

      // ── Init ─────────────────────────────────────────────────────────
      let gs = buildLevel(0, W(), H());
      gsRef.current = gs;

      // ── Draw helpers ─────────────────────────────────────────────────
      function drawBg() {
        bgGfx.clear();
        // Sky gradient approximation
        bgGfx.rect(0, 0, W(), gY() * 0.5).fill(0x5bb8f5);
        bgGfx.rect(0, gY() * 0.5, W(), gY() * 0.5).fill(0x87ceeb);
        // Clouds
        const clouds: [number, number, number][] = [
          [0.12, 0.10, 26], [0.32, 0.07, 20], [0.52, 0.13, 28],
          [0.70, 0.08, 22], [0.87, 0.11, 18],
        ];
        for (const [cx, cy, r] of clouds) {
          bgGfx.circle(cx * W(), cy * H(), r).fill(0xffffff);
          bgGfx.circle(cx * W() + r * 0.8, cy * H(), r * 0.7).fill(0xffffff);
          bgGfx.circle(cx * W() - r * 0.8, cy * H(), r * 0.7).fill(0xffffff);
        }
      }

      function drawGround() {
        groundGfx.clear();
        const gy = gY();
        // Grass strip
        groundGfx.rect(0, gy, W(), H() * 0.04).fill(0x5a8a30);
        // Dirt
        groundGfx.rect(0, gy + H() * 0.04, W(), H() - gy - H() * 0.04).fill(0x8b6914);
        // Grass tufts
        for (let i = 0; i < 28; i++) {
          const tx = (i / 28) * W();
          groundGfx.rect(tx,     gy - 3, 3, 7).fill(0x3d7a1a);
          groundGfx.rect(tx + 7, gy - 5, 2, 9).fill(0x3d7a1a);
        }
      }

      function drawBirdShape(g: Graphics, bx: number, by: number, r: number, col: number) {
        g.circle(bx, by, r).fill(col);
        const s = r / BIRD_R;
        // Eye
        g.circle(bx + 7 * s, by - 5 * s, 5 * s).fill(0xffffff);
        g.circle(bx + 8 * s, by - 5 * s, 2.5 * s).fill(0x111111);
        // Beak
        g.poly([bx + 12 * s, by - 2 * s, bx + 19 * s, by, bx + 12 * s, by + 3 * s]).fill(0xffa500);
        // Tuft
        g.poly([bx - 3 * s, by - r, bx, by - r - 8 * s, bx + 3 * s, by - r]).fill(col);
      }

      function drawSling() {
        slingGfx.clear();
        const _gs = gsRef.current;
        if (!_gs) return;
        const _sx = slX(), _sy = slY(), _gy = gY();

        // Sling base post
        slingGfx.rect(_sx - 4, _sy - 5, 8, _gy - _sy + 5).fill(0x8b4513);
        // Fork arms
        slingGfx.moveTo(_sx, _sy - 5).lineTo(_sx - 10, _sy - 24)
          .stroke({ color: 0x8b4513, width: 7, cap: "round" });
        slingGfx.moveTo(_sx, _sy - 5).lineTo(_sx + 10, _sy - 24)
          .stroke({ color: 0x8b4513, width: 7, cap: "round" });

        if (_gs.phase !== "aim") return;

        const bx = _gs.dragging ? _gs.dragX : _sx;
        const by = _gs.dragging ? _gs.dragY : _sy;

        // Rubber bands
        slingGfx.moveTo(_sx - 10, _sy - 24).lineTo(bx, by)
          .stroke({ color: 0x6b3a10, width: 3 });
        slingGfx.moveTo(_sx + 10, _sy - 24).lineTo(bx, by)
          .stroke({ color: 0x6b3a10, width: 3 });

        // Bird on sling
        if (_gs.bird) {
          const col = BIRD_COL[_gs.bird.birdType ?? "red"] ?? 0xe63946;
          drawBirdShape(slingGfx, bx, by, BIRD_R, col);
        }

        // Queued birds sitting on ground to the left
        for (let i = 0; i < _gs.queue.length; i++) {
          const bt  = _gs.queue[i]!;
          const col = BIRD_COL[bt] ?? 0xe63946;
          drawBirdShape(slingGfx, _sx - 55 - i * 36, _gy - 12, 12, col);
        }
      }

      function drawTrajectory() {
        trajGfx.clear();
        const _gs = gsRef.current;
        if (!_gs || _gs.phase !== "aim" || !_gs.dragging) return;
        const _sx = slX(), _sy = slY();
        const dvx = (_sx - _gs.dragX) * LAUNCH_POW;
        const dvy = (_sy - _gs.dragY) * LAUNCH_POW;
        let tx = _sx, ty = _sy, tvx = dvx, tvy = dvy;
        const dt = 0.05;
        for (let i = 0; i < 24; i++) {
          tvy += GRAVITY * dt;
          tx  += tvx * dt;
          ty  += tvy * dt;
          if (ty > gY()) break;
          trajGfx.circle(tx, ty, 3).fill({ color: 0xffffff, alpha: 1 - i / 24 });
        }
      }

      function drawBodies() {
        bodyGfx.clear();
        const _gs = gsRef.current;
        if (!_gs) return;

        for (const b of _gs.bodies) {
          if (!b.alive) continue;

          if (b.kind === "block") {
            const col  = MAT_COL[b.mat ?? "wood"] ?? 0xc9a84c;
            const dmgF = 1 - Math.max(0, b.hp / b.maxHp);
            const r2   = Math.round(((col >> 16) & 0xff) * (1 - dmgF * 0.5));
            const g2   = Math.round(((col >>  8) & 0xff) * (1 - dmgF * 0.5));
            const bl2  = Math.round(( col        & 0xff) * (1 - dmgF * 0.5));
            const fc   = (r2 << 16) | (g2 << 8) | bl2;
            bodyGfx
              .rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h)
              .fill(fc)
              .stroke({ color: 0x000000, width: 1, alpha: 0.3 });

          } else if (b.kind === "pig") {
            const hf  = b.hp / b.maxHp;
            const col = hf > 0.5 ? 0x4caf50 : 0x2e7d32;
            bodyGfx.circle(b.x, b.y, b.r).fill(col);
            bodyGfx.circle(b.x - 5, b.y - 4, 3.5).fill(0xffffff);
            bodyGfx.circle(b.x + 5, b.y - 4, 3.5).fill(0xffffff);
            bodyGfx.circle(b.x - 5, b.y - 4, 1.8).fill(0x111111);
            bodyGfx.circle(b.x + 5, b.y - 4, 1.8).fill(0x111111);
            bodyGfx.ellipse(b.x, b.y + 3, 5, 3.5).fill(0x388e3c);
            bodyGfx.circle(b.x - 2, b.y + 3, 1.2).fill(0x111111);
            bodyGfx.circle(b.x + 2, b.y + 3, 1.2).fill(0x111111);
            if (hf < 0.7) {
              bodyGfx.moveTo(b.x - 9, b.y - 8).lineTo(b.x - 3, b.y - 6)
                .stroke({ color: 0x111111, width: 2 });
              bodyGfx.moveTo(b.x + 3, b.y - 6).lineTo(b.x + 9, b.y - 8)
                .stroke({ color: 0x111111, width: 2 });
            }

          } else if (b.kind === "bird") {
            const col = BIRD_COL[b.birdType ?? "red"] ?? 0xe63946;
            drawBirdShape(bodyGfx, b.x, b.y, b.r, col);
          }
        }
      }

      function drawHud(hs: number) {
        const _gs = gsRef.current;
        if (!_gs) return;
        scoreTxt.text = `Score: ${_gs.score}`;
        levelTxt.text = `Level ${_gs.lvlIdx + 1}`;
        hsTxt.text    = `Best: ${hs}`;
      }

      function drawOverlay() {
        const _gs = gsRef.current;
        overlayGfx.clear();
        overTxt.text = "";
        subTxt.text  = "";
        if (!_gs || (_gs.phase !== "won" && _gs.phase !== "lost")) return;
        overlayGfx.rect(0, 0, W(), H()).fill({ color: 0x000000, alpha: 0.55 });
        overTxt.position.set(W() / 2, H() / 2 - 28);
        subTxt.position.set(W() / 2, H() / 2 + 18);
        if (_gs.phase === "won") {
          overTxt.text = "🎉 Level Clear!";
          subTxt.text  = `Score: ${_gs.score}  —  Tap to continue`;
        } else {
          overTxt.text = "💥 Try Again!";
          subTxt.text  = "Tap to retry";
        }
      }

      // ── Input ────────────────────────────────────────────────────────
      app.stage.eventMode = "static";
      app.stage.hitArea   = app.screen;

      app.stage.on("pointerdown", (e) => {
        const _gs = gsRef.current;
        if (!_gs) return;

        if (_gs.phase === "won") {
          gs = buildLevel(_gs.lvlIdx + 1, W(), H());
          gsRef.current = gs;
          drawBg(); drawGround();
          return;
        }
        if (_gs.phase === "lost") {
          gs = buildLevel(_gs.lvlIdx, W(), H());
          gsRef.current = gs;
          drawBg(); drawGround();
          return;
        }
        if (_gs.phase !== "aim" || !_gs.bird) return;

        const px = e.global.x, py = e.global.y;
        const ddx = px - slX(), ddy = py - slY();
        if (Math.sqrt(ddx * ddx + ddy * ddy) < 55) {
          _gs.dragging = true;
          _gs.dragX = px; _gs.dragY = py;
        }
      });

      app.stage.on("pointermove", (e) => {
        const _gs = gsRef.current;
        if (!_gs || !_gs.dragging) return;
        const px = e.global.x, py = e.global.y;
        const _sx = slX(), _sy = slY();
        const ddx = px - _sx, ddy = py - _sy;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist > MAX_DRAG) {
          const ang = Math.atan2(ddy, ddx);
          _gs.dragX = _sx + Math.cos(ang) * MAX_DRAG;
          _gs.dragY = _sy + Math.sin(ang) * MAX_DRAG;
        } else {
          _gs.dragX = px; _gs.dragY = py;
        }
      });

      app.stage.on("pointerup", () => {
        const _gs = gsRef.current;
        if (!_gs || !_gs.dragging || !_gs.bird) return;
        _gs.dragging = false;

        const _sx = slX(), _sy = slY();
        const ddx  = _sx - _gs.dragX;
        const ddy  = _sy - _gs.dragY;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist < 8) return;

        const b = _gs.bird;
        b.x = _gs.dragX;
        b.y = _gs.dragY;
        b.vx = ddx * LAUNCH_POW;
        b.vy = ddy * LAUNCH_POW;
        b.isStatic = false;
        _gs.bodies.push(b);
        _gs.bird  = null;
        _gs.phase = "flying";
      });

      app.stage.on("pointerupoutside", () => {
        const _gs = gsRef.current;
        if (_gs) _gs.dragging = false;
      });

      // ── Initial draw ─────────────────────────────────────────────────
      drawBg();
      drawGround();

      let settleTimer = 0;

      // ── Game loop ────────────────────────────────────────────────────
      app.ticker.add((ticker) => {
        const _gs = gsRef.current;
        if (!_gs) return;
        const dt = ticker.deltaMS;

        if (_gs.phase === "flying" || _gs.phase === "settling") {
          step(_gs.bodies, gY(), dt);

          if (_gs.phase === "flying") {
            const flyBird = _gs.bodies.find(b => b.kind === "bird" && b.alive);
            if (!flyBird) {
              _gs.phase = "settling"; settleTimer = 2000;
            } else {
              const spd = Math.sqrt(flyBird.vx ** 2 + flyBird.vy ** 2);
              if (spd < 12 && flyBird.y >= gY() - flyBird.r - 4) {
                _gs.phase = "settling"; settleTimer = 1500;
              }
            }
          }

          if (_gs.phase === "settling") {
            settleTimer -= dt;
            if (settleTimer <= 0) {
              const pigsLeft = _gs.bodies.filter(b => b.kind === "pig" && b.alive).length;
              if (pigsLeft === 0) {
                const bonus = (_gs.queue.length + (_gs.bird ? 1 : 0)) * 2000;
                _gs.score += bonus + 3000;
                updateHighScore(_gs.score);
                _gs.phase = "won";
              } else if (_gs.queue.length === 0 && !_gs.bird) {
                _gs.phase = "lost";
              } else {
                const nextType = _gs.queue.shift();
                if (nextType) {
                  const nb = mkBody({
                    kind: "bird", x: slX(), y: slY(),
                    r: BIRD_R, w: BIRD_R * 2, h: BIRD_R * 2,
                    mass: 2, rest: 0.35, fric: 0.6,
                    isStatic: true, hp: 999, maxHp: 999,
                    birdType: nextType,
                  });
                  _gs.bird  = nb;
                  _gs.phase = "aim";
                  _gs.dragX = slX(); _gs.dragY = slY();
                } else {
                  _gs.phase = "lost";
                }
              }
            }
          }

          // Score killed pigs
          for (const b of _gs.bodies) {
            if (b.kind === "pig" && !b.alive && b.hp > -9999) {
              _gs.score += 5000;
              b.hp = -9999;
            }
          }
        }

        drawBodies();
        drawSling();
        drawTrajectory();
        drawHud(highScore);
        drawOverlay();

        setUiScore(_gs.score);
        setUiLevel(_gs.lvlIdx + 1);
        setUiPhase(_gs.phase);
        setUiBirds([
          ...(_gs.bird ? [_gs.bird.birdType ?? "red"] : []),
          ..._gs.queue,
        ]);
      });
    })();

    return () => {
      dead = true;
      app.destroy(true);
    };
  }, [buildLevel, highScore, updateHighScore]);

  const birdEmoji: Record<BirdType, string> = { red: "🔴", blue: "🔵", yellow: "🟡" };

  return (
    <Shell
      sidebar={
        <div className="flex flex-col gap-4 px-4 py-2">
          <div>
            <div className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope,sans-serif" }}>
              Score
            </div>
            <div className="text-3xl font-bold"
              style={{ fontFamily: "Fraunces,serif", color: "var(--fg)" }}>
              {uiScore.toLocaleString()}
            </div>
            <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              Best: {highScore.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope,sans-serif" }}>
              Level
            </div>
            <div className="text-2xl font-bold"
              style={{ fontFamily: "Fraunces,serif", color: "var(--fg)" }}>
              {uiLevel}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest mb-2"
              style={{ color: "var(--muted)", fontFamily: "Manrope,sans-serif" }}>
              Birds Left
            </div>
            <div className="flex flex-wrap gap-1">
              {uiBirds.map((b, i) => (
                <span key={i} className="text-xl">{birdEmoji[b]}</span>
              ))}
            </div>
          </div>
          <div className="text-xs mt-2" style={{ color: "var(--muted)", fontFamily: "Manrope,sans-serif" }}>
            {uiPhase === "aim" && "Drag the bird to aim, release to fire!"}
            {uiPhase === "flying" && "Bird in flight…"}
            {uiPhase === "settling" && "Settling…"}
            {uiPhase === "won" && "🎉 Level complete!"}
            {uiPhase === "lost" && "💥 Out of birds!"}
          </div>
        </div>
      }
      dock={
        <div className="flex items-center gap-2 text-sm"
          style={{ fontFamily: "Manrope,sans-serif", color: "var(--fg)" }}>
          <span>Lv {uiLevel}</span>
          <span style={{ color: "var(--muted)" }}>{uiScore.toLocaleString()} pts</span>
          <span>{uiBirds.map((b) => birdEmoji[b]).join("")}</span>
        </div>
      }
    >
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", display: "block", overflow: "hidden" }}
      />
    </Shell>
  );
}
