import { useEffect, useRef, useState, useCallback } from "react";
import {
  Application,
  Graphics,
  Container,
  Text,
  TextStyle,
} from "pixi.js";
import { Shell } from "./components/Shell";
import { useHighScore } from "./hooks/useHighScore";
import { LEVELS } from "./lib/levels";
import type { BirdType, LevelDef } from "./lib/levels";
import { createBody, stepPhysics } from "./lib/physics";
import type { PhysicsBody } from "./lib/physics";

// ─── Colours ────────────────────────────────────────────────────────────────
const SKY_TOP    = 0x87ceeb;
const SKY_BOT    = 0xd4eeff;
const GROUND_COLOR = 0x5a8a30;
const DIRT_COLOR   = 0x8b6914;
const SLING_COLOR  = 0x8b4513;

const BIRD_COLORS: Record<BirdType, number> = {
  red:    0xe63946,
  blue:   0x457b9d,
  yellow: 0xffd60a,
};

const BLOCK_COLORS: Record<string, number> = {
  wood:  0xc9a84c,
  stone: 0x8d8d8d,
  glass: 0xa8d8ea,
};

const BLOCK_HEALTH: Record<string, number> = {
  wood:  80,
  stone: 180,
  glass: 40,
};

const PIG_COLOR  = 0x4caf50;
const PIG_HEALTH = 60;

// ─── Game state ─────────────────────────────────────────────────────────────
type Phase = "aim" | "flying" | "settling" | "won" | "lost";

interface GameState {
  phase: Phase;
  levelIndex: number;
  score: number;
  birdsQueue: BirdType[];
  bodies: PhysicsBody[];          // world-space bodies (structures + pigs + flying bird)
  activeBird: PhysicsBody | null; // sits on sling (screen-space, not in bodies yet)
  dragging: boolean;
  dragX: number;  // screen-space drag position
  dragY: number;
  camX: number;       // current camera offset (applied to worldLayer only)
  targetCamX: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
// Sling is always at a fixed screen position — NOT scrolled with the world
const SLING_SCREEN_X_FRAC = 0.17;
const SLING_SCREEN_Y_FRAC = 0.72;
const SLING_BASE_Y_FRAC   = 0.78;
const BIRD_RADIUS  = 22;
const PIG_RADIUS   = 20;
const LAUNCH_POWER = 14;   // pixels/sec per pixel of drag
const MAX_DRAG     = 90;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highScore, updateHighScore] = useHighScore("angry_birds3_hs");
  const [displayScore, setDisplayScore]   = useState(0);
  const [displayLevel, setDisplayLevel]   = useState(1);
  const [displayBirds, setDisplayBirds]   = useState<BirdType[]>([]);
  const [displayPhase, setDisplayPhase]   = useState<Phase>("aim");
  const stateRef = useRef<GameState | null>(null);

  // Build a level — all world bodies are placed in world-space (camX=0 origin)
  const buildLevel = useCallback(
    (levelIndex: number, W: number, H: number): GameState => {
      const def: LevelDef = LEVELS[levelIndex % LEVELS.length]!;
      const gY = H * 0.82;
      const bodies: PhysicsBody[] = [];

      for (const s of def.structures) {
        const bx = s.x * W;
        const by = gY - s.y * H - (s.h * H) / 2;
        const bw = s.w * W;
        const bh = s.h * H;
        const r  = Math.min(bw, bh) / 2;
        const b  = createBody("block", bx, by, r, {
          isStatic:    false,
          health:      BLOCK_HEALTH[s.type] ?? 80,
          mass:        bw * bh * 0.005,
          restitution: 0.15,
          friction:    0.8,
          width:       bw,
          height:      bh,
        });
        (b as PhysicsBody & { blockType: string }).blockType = s.type;
        bodies.push(b);
      }

      for (const p of def.pigs) {
        const px  = p.x * W;
        const py  = gY - p.y * H - PIG_RADIUS;
        const pig = createBody("pig", px, py, PIG_RADIUS, {
          health: PIG_HEALTH,
          mass: 3,
          restitution: 0.3,
        });
        bodies.push(pig);
      }

      const birdsQueue = [...def.birds];
      const firstType  = birdsQueue.shift()!;
      // activeBird position is screen-space sling — stored separately, not in bodies
      const sx = SLING_SCREEN_X_FRAC * W;
      const sy = SLING_SCREEN_Y_FRAC * H;
      const activeBird = createBody("bird", sx, sy, BIRD_RADIUS, {
        isStatic: true,
        health:   999,
        mass:     2,
        restitution: 0.4,
      });
      (activeBird as PhysicsBody & { birdType: BirdType }).birdType = firstType;

      return {
        phase:       "aim",
        levelIndex,
        score:       stateRef.current?.score ?? 0,
        birdsQueue,
        bodies,
        activeBird,
        dragging:    false,
        dragX:       sx,
        dragY:       sy,
        camX:        0,
        targetCamX:  0,
      };
    },
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;
    const app = new Application();

    (async () => {
      await app.init({
        resizeTo:   container,
        background: SKY_TOP,
        antialias:  true,
      });
      if (destroyed) { app.destroy(true); return; }
      container.appendChild(app.canvas);

      const W = () => app.screen.width;
      const H = () => app.screen.height;

      // ── Layer setup ───────────────────────────────────────────────────
      // worldLayer scrolls (structures, pigs, flying bird after launch)
      // slingLayer is fixed to screen (sling fork, rubber bands, active bird, queue)
      // uiLayer is fixed HUD
      const worldLayer = new Container();
      const slingLayer = new Container();
      const uiLayer    = new Container();
      app.stage.addChild(worldLayer);
      app.stage.addChild(slingLayer);
      app.stage.addChild(uiLayer);

      // Graphics objects
      const bgGfx         = new Graphics();
      const groundGfx     = new Graphics();
      const worldBodiesGfx = new Graphics();   // world-space bodies
      const trajectoryGfx = new Graphics();    // screen-space trajectory dots
      const slingGfx      = new Graphics();    // sling fork + rubber bands + active bird
      const hudGfx        = new Graphics();

      worldLayer.addChild(bgGfx);
      worldLayer.addChild(groundGfx);
      worldLayer.addChild(worldBodiesGfx);
      slingLayer.addChild(trajectoryGfx);
      slingLayer.addChild(slingGfx);
      app.stage.addChild(hudGfx);

      // HUD text
      const hudStyle = new TextStyle({
        fontFamily: "Manrope, sans-serif",
        fontSize:   16,
        fill:       0xffffff,
        fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 4, distance: 1 },
      });
      const scoreText = new Text({ text: "Score: 0", style: hudStyle });
      const levelText = new Text({ text: "Level 1", style: hudStyle });
      const hsText    = new Text({ text: "Best: 0",  style: hudStyle });
      scoreText.position.set(10, 8);
      levelText.position.set(10, 28);
      hsText.position.set(10, 48);
      uiLayer.addChild(scoreText);
      uiLayer.addChild(levelText);
      uiLayer.addChild(hsText);

      // Overlay
      const overlayGfx  = new Graphics();
      const overlayStyle = new TextStyle({
        fontFamily: "Fraunces, serif",
        fontSize:   36,
        fill:       0xffffff,
        fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 8, distance: 2 },
      });
      const overlayText = new Text({ text: "", style: overlayStyle });
      const subStyle    = new TextStyle({
        fontFamily: "Manrope, sans-serif",
        fontSize:   18,
        fill:       0xffffff,
        dropShadow: { color: 0x000000, blur: 4, distance: 1 },
      });
      const subText = new Text({ text: "", style: subStyle });
      overlayText.anchor.set(0.5);
      subText.anchor.set(0.5);
      uiLayer.addChild(overlayGfx);
      uiLayer.addChild(overlayText);
      uiLayer.addChild(subText);

      // ── Helpers ───────────────────────────────────────────────────────
      const groundY  = () => H() * 0.82;
      // Sling is fixed to screen — these are SCREEN coords
      const slingX   = () => SLING_SCREEN_X_FRAC * W();
      const slingY   = () => SLING_SCREEN_Y_FRAC * H();
      const slingBaseY = () => SLING_BASE_Y_FRAC * H();

      // ── Init ──────────────────────────────────────────────────────────
      let gs = buildLevel(0, W(), H());
      stateRef.current = gs;

      // ── Draw background (world-space, wide) ───────────────────────────
      function drawBg() {
        bgGfx.clear();
        bgGfx.rect(0, 0, W() * 4, H() * 0.82).fill(SKY_TOP);
        bgGfx.rect(0, H() * 0.4, W() * 4, H() * 0.42).fill(SKY_BOT);
        const clouds = [
          { x: 0.1, y: 0.12, r: 30 }, { x: 0.25, y: 0.08, r: 22 },
          { x: 0.5, y: 0.15, r: 28 }, { x: 0.75, y: 0.10, r: 35 },
          { x: 0.9, y: 0.18, r: 20 }, { x: 1.3,  y: 0.12, r: 26 },
          { x: 1.6, y: 0.07, r: 30 }, { x: 1.9,  y: 0.14, r: 24 },
          { x: 2.2, y: 0.09, r: 32 },
        ];
        for (const c of clouds) {
          bgGfx.circle(c.x * W(), c.y * H(), c.r).fill(0xffffff);
          bgGfx.circle(c.x * W() + c.r * 0.8, c.y * H(), c.r * 0.7).fill(0xffffff);
          bgGfx.circle(c.x * W() - c.r * 0.8, c.y * H(), c.r * 0.7).fill(0xffffff);
        }
      }

      function drawGround() {
        groundGfx.clear();
        const gy = groundY();
        groundGfx.rect(0, gy, W() * 4, H() - gy).fill(GROUND_COLOR);
        groundGfx.rect(0, gy + H() * 0.04, W() * 4, H() - gy).fill(DIRT_COLOR);
        for (let i = 0; i < 60; i++) {
          const gx = (i / 60) * W() * 4;
          groundGfx.rect(gx, gy - 4, 4, 8).fill(0x3d7a1a);
          groundGfx.rect(gx + 8, gy - 6, 3, 10).fill(0x3d7a1a);
        }
      }

      // ── Draw sling + active bird (screen-space, never scrolls) ────────
      function drawSling() {
        slingGfx.clear();
        const gs2 = stateRef.current;
        if (!gs2) return;

        const sx  = slingX();
        const sy  = slingY();
        const bsy = slingBaseY();

        // Fork posts
        slingGfx
          .moveTo(sx, bsy)
          .lineTo(sx - 10, sy - 20)
          .stroke({ color: SLING_COLOR, width: 8, cap: "round" });
        slingGfx
          .moveTo(sx, bsy)
          .lineTo(sx + 10, sy - 20)
          .stroke({ color: SLING_COLOR, width: 8, cap: "round" });

        if (gs2.phase !== "aim" && gs2.phase !== "flying") return;

        // Bird position on sling (screen-space)
        const bx = gs2.dragging ? gs2.dragX : sx;
        const by = gs2.dragging ? gs2.dragY : sy;

        // Rubber bands (only in aim phase)
        if (gs2.phase === "aim") {
          slingGfx
            .moveTo(sx - 10, sy - 20)
            .lineTo(bx, by)
            .stroke({ color: 0x8b4513, width: 3 });
          slingGfx
            .moveTo(sx + 10, sy - 20)
            .lineTo(bx, by)
            .stroke({ color: 0x8b4513, width: 3 });

          // Active bird (only in aim phase — in flying it moves into worldLayer)
          if (gs2.activeBird) {
            const typed = gs2.activeBird as PhysicsBody & { birdType?: BirdType };
            const col   = BIRD_COLORS[typed.birdType ?? "red"] ?? 0xe63946;
            drawBirdAt(slingGfx, bx, by, BIRD_RADIUS, col);
          }
        }

        // Queued birds (screen-space, to the left of sling)
        for (let i = 0; i < gs2.birdsQueue.length; i++) {
          const bt  = gs2.birdsQueue[i]!;
          const col = BIRD_COLORS[bt] ?? 0xe63946;
          const qx  = sx - 60 - i * 40;
          const qy  = groundY() - 14;
          drawBirdAt(slingGfx, qx, qy, 14, col);
        }
      }

      // ── Trajectory dots (screen-space) ───────────────────────────────
      function drawTrajectory() {
        trajectoryGfx.clear();
        const gs2 = stateRef.current;
        if (!gs2 || gs2.phase !== "aim" || !gs2.dragging) return;

        const sx  = slingX();
        const sy  = slingY();
        const dx  = sx - gs2.dragX;
        const dy  = sy - gs2.dragY;
        // Launch velocity in pixels/sec
        const vx  = dx * LAUNCH_POWER;
        const vy  = dy * LAUNCH_POWER;
        const g   = 980;
        let tx = sx, ty = sy, tvx = vx, tvy = vy;
        const step = 0.05;
        for (let i = 0; i < 28; i++) {
          tvy += g * step;
          tx  += tvx * step;
          ty  += tvy * step;
          if (ty > groundY()) break;
          const alpha = 1 - i / 28;
          trajectoryGfx.circle(tx, ty, 3).fill({ color: 0xffffff, alpha });
        }
      }

      // ── Helper: draw a bird shape ─────────────────────────────────────
      function drawBirdAt(
        gfx: Graphics,
        bx: number,
        by: number,
        r: number,
        col: number
      ) {
        gfx.circle(bx, by, r).fill(col);
        const eyeScale = r / BIRD_RADIUS;
        gfx.circle(bx + 8 * eyeScale, by - 6 * eyeScale, 6 * eyeScale).fill(0xffffff);
        gfx.circle(bx + 9 * eyeScale, by - 6 * eyeScale, 3 * eyeScale).fill(0x1a1a1a);
        gfx
          .poly([
            bx + 14 * eyeScale, by - 2 * eyeScale,
            bx + 22 * eyeScale, by,
            bx + 14 * eyeScale, by + 4 * eyeScale,
          ])
          .fill(0xffa500);
        gfx
          .poly([
            bx - 4 * eyeScale, by - r,
            bx,                by - r - 10 * eyeScale,
            bx + 4 * eyeScale, by - r,
          ])
          .fill(col);
      }

      // ── Draw world bodies (structures + pigs + flying bird) ───────────
      function drawWorldBodies() {
        worldBodiesGfx.clear();
        const gs2 = stateRef.current;
        if (!gs2) return;

        for (const b of gs2.bodies) {
          if (!b.isAlive) continue;
          const typed = b as PhysicsBody & { blockType?: string; birdType?: BirdType };

          if (b.type === "block") {
            const bw  = b.width  ?? b.radius * 2;
            const bh  = b.height ?? b.radius * 2;
            const col = BLOCK_COLORS[typed.blockType ?? "wood"] ?? 0xc9a84c;
            const maxH = BLOCK_HEALTH[typed.blockType ?? "wood"] ?? 80;
            const dmg  = 1 - Math.max(0, b.health / maxH);
            const r2   = ((col >> 16) & 0xff) * (1 - dmg * 0.5);
            const g2   = ((col >>  8) & 0xff) * (1 - dmg * 0.5);
            const bl2  = ( col        & 0xff) * (1 - dmg * 0.5);
            const fc   = (Math.round(r2) << 16) | (Math.round(g2) << 8) | Math.round(bl2);
            worldBodiesGfx
              .rect(b.x - bw / 2, b.y - bh / 2, bw, bh)
              .fill(fc)
              .stroke({ color: 0x000000, width: 1, alpha: 0.3 });
            if (typed.blockType === "wood") {
              worldBodiesGfx
                .moveTo(b.x - bw / 2 + 4, b.y - bh / 2)
                .lineTo(b.x - bw / 2 + 4, b.y + bh / 2)
                .stroke({ color: 0x8b6914, width: 1, alpha: 0.4 });
            }

          } else if (b.type === "pig") {
            const hf     = b.health / PIG_HEALTH;
            const pigCol = hf > 0.5 ? PIG_COLOR : 0x2e7d32;
            worldBodiesGfx.circle(b.x, b.y, b.radius).fill(pigCol);
            worldBodiesGfx.circle(b.x - 7, b.y - 6, 5).fill(0xffffff);
            worldBodiesGfx.circle(b.x + 7, b.y - 6, 5).fill(0xffffff);
            worldBodiesGfx.circle(b.x - 7, b.y - 6, 2.5).fill(0x1a1a1a);
            worldBodiesGfx.circle(b.x + 7, b.y - 6, 2.5).fill(0x1a1a1a);
            worldBodiesGfx.ellipse(b.x, b.y + 4, 7, 5).fill(0x388e3c);
            worldBodiesGfx.circle(b.x - 3, b.y + 4, 2).fill(0x1a1a1a);
            worldBodiesGfx.circle(b.x + 3, b.y + 4, 2).fill(0x1a1a1a);
            if (hf < 0.7) {
              worldBodiesGfx
                .moveTo(b.x - 12, b.y - 10).lineTo(b.x - 4, b.y - 8)
                .stroke({ color: 0x1a1a1a, width: 2 });
              worldBodiesGfx
                .moveTo(b.x + 4, b.y - 8).lineTo(b.x + 12, b.y - 10)
                .stroke({ color: 0x1a1a1a, width: 2 });
            }

          } else if (b.type === "bird") {
            const col = BIRD_COLORS[typed.birdType ?? "red"] ?? 0xe63946;
            drawBirdAt(worldBodiesGfx, b.x, b.y, b.radius, col);
          }
        }
      }

      function drawHud(hs: number) {
        const gs2 = stateRef.current;
        if (!gs2) return;
        scoreText.text = `Score: ${gs2.score}`;
        levelText.text = `Level ${gs2.levelIndex + 1}`;
        hsText.text    = `Best: ${hs}`;
      }

      function drawOverlay(phase: Phase) {
        const gs2 = stateRef.current;
        if (!gs2) return;
        overlayGfx.clear();
        overlayText.text = "";
        subText.text     = "";
        if (phase !== "won" && phase !== "lost") return;
        overlayGfx.rect(0, 0, W(), H()).fill({ color: 0x000000, alpha: 0.55 });
        overlayText.position.set(W() / 2, H() / 2 - 30);
        subText.position.set(W() / 2, H() / 2 + 20);
        if (phase === "won") {
          overlayText.text = "🎉 Level Clear!";
          subText.text     = `Score: ${gs2.score}  •  Tap to continue`;
        } else {
          overlayText.text = "💥 Try Again!";
          subText.text     = "Tap to retry";
        }
      }

      // ── Input — all in SCREEN space ───────────────────────────────────
      app.stage.eventMode = "static";
      app.stage.hitArea   = app.screen;

      app.stage.on("pointerdown", (e) => {
        const gs2 = stateRef.current;
        if (!gs2) return;

        if (gs2.phase === "won") {
          gs = buildLevel(gs2.levelIndex + 1, W(), H());
          stateRef.current = gs;
          drawBg(); drawGround();
          return;
        }
        if (gs2.phase === "lost") {
          gs = buildLevel(gs2.levelIndex, W(), H());
          stateRef.current = gs;
          drawBg(); drawGround();
          return;
        }
        if (gs2.phase !== "aim" || !gs2.activeBird) return;

        // Drag detection in SCREEN space (sling is fixed to screen)
        const px = e.global.x;
        const py = e.global.y;
        const dx = px - slingX();
        const dy = py - slingY();
        if (Math.sqrt(dx * dx + dy * dy) < 60) {
          gs2.dragging = true;
          gs2.dragX    = px;
          gs2.dragY    = py;
        }
      });

      app.stage.on("pointermove", (e) => {
        const gs2 = stateRef.current;
        if (!gs2 || !gs2.dragging) return;

        const px = e.global.x;
        const py = e.global.y;
        const sx = slingX();
        const sy = slingY();
        const dx = px - sx;
        const dy = py - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > MAX_DRAG) {
          const angle = Math.atan2(dy, dx);
          gs2.dragX   = sx + Math.cos(angle) * MAX_DRAG;
          gs2.dragY   = sy + Math.sin(angle) * MAX_DRAG;
        } else {
          gs2.dragX = px;
          gs2.dragY = py;
        }
      });

      app.stage.on("pointerup", () => {
        const gs2 = stateRef.current;
        if (!gs2 || !gs2.dragging || !gs2.activeBird) return;
        gs2.dragging = false;

        const sx   = slingX();
        const sy   = slingY();
        const dx   = sx - gs2.dragX;
        const dy   = sy - gs2.dragY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 10) return; // too short — cancel

        // Convert launch position from screen to world space
        const worldStartX = gs2.dragX - gs2.camX;
        const worldStartY = gs2.dragY; // Y is never scrolled

        const bird = gs2.activeBird;
        bird.x       = worldStartX;
        bird.y       = worldStartY;
        bird.vx      = dx * LAUNCH_POWER;
        bird.vy      = dy * LAUNCH_POWER;
        bird.isStatic = false;

        gs2.bodies.push(bird);
        gs2.activeBird = null;
        gs2.phase      = "flying";
      });

      app.stage.on("pointerupoutside", () => {
        const gs2 = stateRef.current;
        if (gs2) gs2.dragging = false;
      });

      // ── Initial draw ──────────────────────────────────────────────────
      drawBg();
      drawGround();

      let settleTimer = 0;

      // ── Main loop ─────────────────────────────────────────────────────
      app.ticker.add((ticker) => {
        const gs2 = stateRef.current;
        if (!gs2) return;

        const dt = ticker.deltaMS;

        if (gs2.phase === "flying" || gs2.phase === "settling") {
          stepPhysics(gs2.bodies, groundY(), dt);

          // Camera: follow the flying bird (world-space x → screen offset)
          const flyingBird = gs2.bodies.find(b => b.type === "bird" && b.isAlive);
          if (flyingBird) {
            // We want flyingBird.x + camX ≈ W() * 0.35 (keep bird at 35% of screen)
            gs2.targetCamX = Math.min(0, W() * 0.35 - flyingBird.x);
          }

          // Transition flying → settling
          if (gs2.phase === "flying") {
            const bird = gs2.bodies.find(b => b.type === "bird" && b.isAlive);
            if (!bird) {
              gs2.phase = "settling";
              settleTimer = 2500;
            } else {
              const speed = Math.sqrt(bird.vx ** 2 + bird.vy ** 2);
              if (speed < 15 && bird.y >= groundY() - bird.radius - 5) {
                gs2.phase   = "settling";
                settleTimer = 1800;
              }
            }
          }

          if (gs2.phase === "settling") {
            settleTimer -= dt;
            if (settleTimer <= 0) {
              const pigsAlive = gs2.bodies.filter(b => b.type === "pig" && b.isAlive).length;
              if (pigsAlive === 0) {
                const bonus = (gs2.birdsQueue.length + (gs2.activeBird ? 1 : 0)) * 2000;
                gs2.score += bonus + 3000;
                updateHighScore(gs2.score);
                gs2.phase      = "won";
                gs2.targetCamX = 0;
              } else if (gs2.birdsQueue.length === 0 && !gs2.activeBird) {
                gs2.phase      = "lost";
                gs2.targetCamX = 0;
              } else {
                // Load next bird onto sling
                const nextType = gs2.birdsQueue.shift();
                if (nextType) {
                  const nb = createBody("bird", slingX(), slingY(), BIRD_RADIUS, {
                    isStatic: true, health: 999, mass: 2, restitution: 0.4,
                  });
                  (nb as PhysicsBody & { birdType: BirdType }).birdType = nextType;
                  gs2.activeBird = nb;
                  gs2.phase      = "aim";
                  gs2.targetCamX = 0;
                } else {
                  gs2.phase      = "lost";
                  gs2.targetCamX = 0;
                }
              }
            }
          }

          // Score killed pigs (health flipped to -999 to avoid double-count)
          for (const b of gs2.bodies) {
            if (b.type === "pig" && !b.isAlive && b.health > -999) {
              gs2.score += 5000;
              b.health   = -999;
            }
          }
        }

        // Smooth camera pan — only worldLayer scrolls
        gs2.camX    += (gs2.targetCamX - gs2.camX) * 0.08;
        worldLayer.x = gs2.camX;
        // slingLayer and uiLayer stay at x=0 always

        // Redraw
        drawSling();
        drawTrajectory();
        drawWorldBodies();
        drawHud(highScore);
        drawOverlay(gs2.phase);

        // Sync React state
        setDisplayScore(gs2.score);
        setDisplayLevel(gs2.levelIndex + 1);
        setDisplayBirds([
          ...(gs2.activeBird
            ? [(gs2.activeBird as PhysicsBody & { birdType?: BirdType }).birdType ?? "red"]
            : []),
          ...gs2.birdsQueue,
        ]);
        setDisplayPhase(gs2.phase);
      });
    })();

    return () => {
      destroyed = true;
      app.destroy(true);
    };
  }, [buildLevel, highScore, updateHighScore]);

  const birdEmoji: Record<BirdType, string> = {
    red:    "🔴",
    blue:   "🔵",
    yellow: "🟡",
  };

  return (
    <Shell
      sidebar={
        <div className="flex flex-col gap-4 px-4 py-2">
          <div>
            <div
              className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}
            >
              Score
            </div>
            <div
              className="text-3xl font-bold"
              style={{ fontFamily: "Fraunces, serif", color: "var(--fg)" }}
            >
              {displayScore.toLocaleString()}
            </div>
            <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              Best: {highScore.toLocaleString()}
            </div>
          </div>

          <div>
            <div
              className="text-xs uppercase tracking-widest mb-1"
              style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}
            >
              Level
            </div>
            <div
              className="text-2xl font-bold"
              style={{ fontFamily: "Fraunces, serif", color: "var(--fg)" }}
            >
              {displayLevel}
            </div>
          </div>

          <div>
            <div
              className="text-xs uppercase tracking-widest mb-2"
              style={{ color: "var(--muted)", fontFamily: "Manrope, sans-serif" }}
            >
              Birds Left
            </div>
            <div className="flex flex-wrap gap-1">
              {displayBirds.map((b, i) => (
                <span key={i} className="text-xl">{birdEmoji[b]}</span>
              ))}
              {displayBirds.length === 0 && (
                <span className="text-sm" style={{ color: "var(--muted)" }}>None</span>
              )}
            </div>
          </div>

          {displayPhase === "aim" && (
            <div
              className="text-sm p-3 rounded-lg"
              style={{ background: "var(--panel)", color: "var(--muted)" }}
            >
              🎯 Drag the bird to aim, release to fire!
            </div>
          )}
          {displayPhase === "flying" && (
            <div
              className="text-sm p-3 rounded-lg"
              style={{ background: "var(--panel)", color: "var(--muted)" }}
            >
              🚀 Bird in flight…
            </div>
          )}
          {displayPhase === "won" && (
            <div
              className="text-sm p-3 rounded-lg font-bold"
              style={{ background: "#16a34a22", color: "#16a34a" }}
            >
              🎉 Level cleared! Tap to continue.
            </div>
          )}
          {displayPhase === "lost" && (
            <div
              className="text-sm p-3 rounded-lg font-bold"
              style={{ background: "#dc262622", color: "#dc2626" }}
            >
              💥 Out of birds! Tap to retry.
            </div>
          )}
        </div>
      }
    >
      <div ref={containerRef} className="w-full h-full" />
    </Shell>
  );
}
