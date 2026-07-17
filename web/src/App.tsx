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
const SKY_TOP = 0x87ceeb;
const SKY_BOT = 0xd4eeff;
const GROUND_COLOR = 0x5a8a30;
const DIRT_COLOR = 0x8b6914;
const SLING_COLOR = 0x8b4513;

const BIRD_COLORS: Record<BirdType, number> = {
  red: 0xe63946,
  blue: 0x457b9d,
  yellow: 0xffd60a,
};

const BLOCK_COLORS: Record<string, number> = {
  wood: 0xc9a84c,
  stone: 0x8d8d8d,
  glass: 0xa8d8ea,
};

const BLOCK_HEALTH: Record<string, number> = {
  wood: 80,
  stone: 180,
  glass: 40,
};

const PIG_COLOR = 0x4caf50;
const PIG_HEALTH = 60;

// ─── Game state ─────────────────────────────────────────────────────────────
type Phase = "aim" | "flying" | "settling" | "won" | "lost";

interface GameState {
  phase: Phase;
  levelIndex: number;
  score: number;
  birdsQueue: BirdType[];
  bodies: PhysicsBody[];
  activeBird: PhysicsBody | null;
  // Slingshot drag
  dragging: boolean;
  dragX: number;
  dragY: number;
  // Camera pan
  camX: number;
  targetCamX: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const SLING_X_FRAC = 0.17;
const SLING_Y_FRAC = 0.72;   // fraction of canvas height from top
const SLING_BASE_Y_FRAC = 0.78;
const BIRD_RADIUS = 22;
const PIG_RADIUS = 20;
const LAUNCH_POWER = 1.6;
const MAX_DRAG = 90;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highScore, updateHighScore] = useHighScore("angry_birds3_hs");
  const [displayScore, setDisplayScore] = useState(0);
  const [displayLevel, setDisplayLevel] = useState(1);
  const [displayBirds, setDisplayBirds] = useState<BirdType[]>([]);
  const [displayPhase, setDisplayPhase] = useState<Phase>("aim");
  const stateRef = useRef<GameState | null>(null);

  const buildLevel = useCallback(
    (levelIndex: number, W: number, H: number): GameState => {
      const def: LevelDef = LEVELS[levelIndex % LEVELS.length]!;
      const groundY = H * 0.82;
      const bodies: PhysicsBody[] = [];

      // Structures
      for (const s of def.structures) {
        const bx = s.x * W;
        const by = groundY - s.y * H - (s.h * H) / 2;
        const bw = s.w * W;
        const bh = s.h * H;
        const r = Math.min(bw, bh) / 2;
        const b = createBody("block", bx, by, r, {
          isStatic: false,
          health: BLOCK_HEALTH[s.type] ?? 80,
          mass: bw * bh * 0.005,
          restitution: 0.15,
          friction: 0.8,
          width: bw,
          height: bh,
        });
        (b as PhysicsBody & { blockType: string }).blockType = s.type;
        bodies.push(b);
      }

      // Pigs
      for (const p of def.pigs) {
        const px = p.x * W;
        const py = groundY - p.y * H - PIG_RADIUS;
        const pig = createBody("pig", px, py, PIG_RADIUS, {
          health: PIG_HEALTH,
          mass: 3,
          restitution: 0.3,
        });
        bodies.push(pig);
      }

      const birdsQueue = [...def.birds];
      const firstBird = birdsQueue.shift()!;
      const slingX = SLING_X_FRAC * W;
      const slingY = SLING_Y_FRAC * H;
      const activeBird = createBody("bird", slingX, slingY, BIRD_RADIUS, {
        isStatic: true,
        health: 999,
        mass: 2,
        restitution: 0.4,
      });
      (activeBird as PhysicsBody & { birdType: BirdType }).birdType = firstBird;

      return {
        phase: "aim",
        levelIndex,
        score: stateRef.current?.score ?? 0,
        birdsQueue,
        bodies,
        activeBird,
        dragging: false,
        dragX: slingX,
        dragY: slingY,
        camX: 0,
        targetCamX: 0,
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
        resizeTo: container,
        background: SKY_TOP,
        antialias: true,
      });
      if (destroyed) { app.destroy(true); return; }
      container.appendChild(app.canvas);

      const W = () => app.screen.width;
      const H = () => app.screen.height;

      // ── Layer containers ──────────────────────────────────────────────
      const worldLayer = new Container();   // scrolls with camera
      const uiLayer = new Container();      // fixed HUD
      app.stage.addChild(worldLayer);
      app.stage.addChild(uiLayer);

      // ── Graphics objects ──────────────────────────────────────────────
      const bgGfx = new Graphics();
      const groundGfx = new Graphics();
      const slingGfx = new Graphics();
      const bodiesGfx = new Graphics();
      const trajectoryGfx = new Graphics();
      const hudGfx = new Graphics();

      worldLayer.addChild(bgGfx);
      worldLayer.addChild(groundGfx);
      worldLayer.addChild(trajectoryGfx);
      worldLayer.addChild(slingGfx);
      worldLayer.addChild(bodiesGfx);
      app.stage.addChild(hudGfx);   // fixed, not in worldLayer

      // HUD text
      const hudStyle = new TextStyle({
        fontFamily: "Manrope, sans-serif",
        fontSize: 16,
        fill: 0xffffff,
        fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 4, distance: 1 },
      });
      const scoreText = new Text({ text: "Score: 0", style: hudStyle });
      const levelText = new Text({ text: "Level 1", style: hudStyle });
      const hsText = new Text({ text: "Best: 0", style: hudStyle });
      scoreText.position.set(10, 8);
      levelText.position.set(10, 28);
      hsText.position.set(10, 48);
      uiLayer.addChild(scoreText);
      uiLayer.addChild(levelText);
      uiLayer.addChild(hsText);

      // ── Init game state ───────────────────────────────────────────────
      let gs = buildLevel(0, W(), H());
      stateRef.current = gs;

      // ── Overlay (won/lost) ────────────────────────────────────────────
      const overlayGfx = new Graphics();
      const overlayStyle = new TextStyle({
        fontFamily: "Fraunces, serif",
        fontSize: 36,
        fill: 0xffffff,
        fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 8, distance: 2 },
      });
      const overlayText = new Text({ text: "", style: overlayStyle });
      const subStyle = new TextStyle({
        fontFamily: "Manrope, sans-serif",
        fontSize: 18,
        fill: 0xffffff,
        dropShadow: { color: 0x000000, blur: 4, distance: 1 },
      });
      const subText = new Text({ text: "", style: subStyle });
      overlayText.anchor.set(0.5);
      subText.anchor.set(0.5);
      uiLayer.addChild(overlayGfx);
      uiLayer.addChild(overlayText);
      uiLayer.addChild(subText);

      // ── Helper: groundY ───────────────────────────────────────────────
      const groundY = () => H() * 0.82;
      const slingX = () => SLING_X_FRAC * W();
      const slingY = () => SLING_Y_FRAC * H();

      // ── Draw background ───────────────────────────────────────────────
      function drawBg() {
        bgGfx.clear();
        // Sky gradient via two rects
        bgGfx.rect(0, 0, W() * 3, H() * 0.82).fill(SKY_TOP);
        bgGfx.rect(0, H() * 0.4, W() * 3, H() * 0.42).fill(SKY_BOT);
        // Clouds
        const clouds = [
          { x: 0.1, y: 0.12, r: 30 },
          { x: 0.25, y: 0.08, r: 22 },
          { x: 0.5, y: 0.15, r: 28 },
          { x: 0.75, y: 0.10, r: 35 },
          { x: 0.9, y: 0.18, r: 20 },
          { x: 1.3, y: 0.12, r: 26 },
          { x: 1.6, y: 0.07, r: 30 },
          { x: 1.9, y: 0.14, r: 24 },
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
        groundGfx.rect(0, gy, W() * 3, H() - gy).fill(GROUND_COLOR);
        groundGfx.rect(0, gy + H() * 0.04, W() * 3, H() - gy).fill(DIRT_COLOR);
        // Grass tufts
        for (let i = 0; i < 40; i++) {
          const gx = (i / 40) * W() * 3;
          groundGfx.rect(gx, gy - 4, 4, 8).fill(0x3d7a1a);
          groundGfx.rect(gx + 8, gy - 6, 3, 10).fill(0x3d7a1a);
        }
      }

      function drawSling() {
        slingGfx.clear();
        const sx = slingX();
        const sy = slingY();
        const baseY = SLING_BASE_Y_FRAC * H();
        // Fork posts
        slingGfx.moveTo(sx, baseY)
          .lineTo(sx - 10, sy - 20)
          .stroke({ color: SLING_COLOR, width: 8, cap: "round" });
        slingGfx.moveTo(sx, baseY)
          .lineTo(sx + 10, sy - 20)
          .stroke({ color: SLING_COLOR, width: 8, cap: "round" });

        const gs = stateRef.current;
        if (!gs) return;
        const birdX = gs.dragging ? gs.dragX : sx;
        const birdY = gs.dragging ? gs.dragY : sy;

        // Rubber bands
        if (gs.phase === "aim") {
          slingGfx.moveTo(sx - 10, sy - 20)
            .lineTo(birdX, birdY)
            .stroke({ color: 0x8b4513, width: 3 });
          slingGfx.moveTo(sx + 10, sy - 20)
            .lineTo(birdX, birdY)
            .stroke({ color: 0x8b4513, width: 3 });
        }
      }

      function drawTrajectory() {
        trajectoryGfx.clear();
        const gs = stateRef.current;
        if (!gs || gs.phase !== "aim" || !gs.dragging) return;
        const sx = slingX();
        const sy = slingY();
        const dx = sx - gs.dragX;
        const dy = sy - gs.dragY;
        const vx = dx * LAUNCH_POWER * 4;
        const vy = dy * LAUNCH_POWER * 4;
        const gravity = 980;
        let tx = sx;
        let ty = sy;
        let tvx = vx;
        let tvy = vy;
        const step = 0.05;
        for (let i = 0; i < 25; i++) {
          tvy += gravity * step;
          tx += tvx * step;
          ty += tvy * step;
          if (ty > groundY()) break;
          const alpha = 1 - i / 25;
          trajectoryGfx
            .circle(tx, ty, 3)
            .fill({ color: 0xffffff, alpha });
        }
      }

      function drawBodies() {
        bodiesGfx.clear();
        const gs = stateRef.current;
        if (!gs) return;

        for (const b of gs.bodies) {
          if (!b.isAlive) continue;
          const typed = b as PhysicsBody & { blockType?: string };
          if (b.type === "block") {
            const bw = b.width ?? b.radius * 2;
            const bh = b.height ?? b.radius * 2;
            const col = BLOCK_COLORS[typed.blockType ?? "wood"] ?? 0xc9a84c;
            const maxH = BLOCK_HEALTH[typed.blockType ?? "wood"] ?? 80;
            const damage = 1 - Math.max(0, b.health / maxH);
            // Darken based on damage
            const r = ((col >> 16) & 0xff) * (1 - damage * 0.5);
            const g = ((col >> 8) & 0xff) * (1 - damage * 0.5);
            const bl = (col & 0xff) * (1 - damage * 0.5);
            const finalCol = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
            bodiesGfx
              .rect(b.x - bw / 2, b.y - bh / 2, bw, bh)
              .fill(finalCol)
              .stroke({ color: 0x000000, width: 1, alpha: 0.3 });
            // Wood grain lines
            if (typed.blockType === "wood") {
              bodiesGfx
                .moveTo(b.x - bw / 2 + 4, b.y - bh / 2)
                .lineTo(b.x - bw / 2 + 4, b.y + bh / 2)
                .stroke({ color: 0x8b6914, width: 1, alpha: 0.4 });
            }
          } else if (b.type === "pig") {
            const healthFrac = b.health / PIG_HEALTH;
            const pigCol = healthFrac > 0.5 ? PIG_COLOR : 0x2e7d32;
            // Body
            bodiesGfx.circle(b.x, b.y, b.radius).fill(pigCol);
            // Eyes
            bodiesGfx.circle(b.x - 7, b.y - 6, 5).fill(0xffffff);
            bodiesGfx.circle(b.x + 7, b.y - 6, 5).fill(0xffffff);
            bodiesGfx.circle(b.x - 7, b.y - 6, 2.5).fill(0x1a1a1a);
            bodiesGfx.circle(b.x + 7, b.y - 6, 2.5).fill(0x1a1a1a);
            // Snout
            bodiesGfx.ellipse(b.x, b.y + 4, 7, 5).fill(0x388e3c);
            bodiesGfx.circle(b.x - 3, b.y + 4, 2).fill(0x1a1a1a);
            bodiesGfx.circle(b.x + 3, b.y + 4, 2).fill(0x1a1a1a);
            // Angry brow if damaged
            if (healthFrac < 0.7) {
              bodiesGfx
                .moveTo(b.x - 12, b.y - 10)
                .lineTo(b.x - 4, b.y - 8)
                .stroke({ color: 0x1a1a1a, width: 2 });
              bodiesGfx
                .moveTo(b.x + 4, b.y - 8)
                .lineTo(b.x + 12, b.y - 10)
                .stroke({ color: 0x1a1a1a, width: 2 });
            }
          } else if (b.type === "bird") {
            const typed2 = b as PhysicsBody & { birdType?: BirdType };
            const col = BIRD_COLORS[typed2.birdType ?? "red"] ?? 0xe63946;
            // Body
            bodiesGfx.circle(b.x, b.y, b.radius).fill(col);
            // Eye
            bodiesGfx.circle(b.x + 8, b.y - 6, 6).fill(0xffffff);
            bodiesGfx.circle(b.x + 9, b.y - 6, 3).fill(0x1a1a1a);
            // Beak
            bodiesGfx
              .poly([b.x + 14, b.y - 2, b.x + 22, b.y, b.x + 14, b.y + 4])
              .fill(0xffa500);
            // Feather tuft
            bodiesGfx
              .poly([b.x - 4, b.y - b.radius, b.x, b.y - b.radius - 10, b.x + 4, b.y - b.radius])
              .fill(col);
          }
        }

        // Draw active bird on sling
        if (gs.activeBird) {
          const b = gs.activeBird;
          const typed2 = b as PhysicsBody & { birdType?: BirdType };
          const col = BIRD_COLORS[typed2.birdType ?? "red"] ?? 0xe63946;
          const bx = gs.dragging ? gs.dragX : slingX();
          const by = gs.dragging ? gs.dragY : slingY();
          bodiesGfx.circle(bx, by, BIRD_RADIUS).fill(col);
          bodiesGfx.circle(bx + 8, by - 6, 6).fill(0xffffff);
          bodiesGfx.circle(bx + 9, by - 6, 3).fill(0x1a1a1a);
          bodiesGfx
            .poly([bx + 14, by - 2, bx + 22, by, bx + 14, by + 4])
            .fill(0xffa500);
          bodiesGfx
            .poly([bx - 4, by - BIRD_RADIUS, bx, by - BIRD_RADIUS - 10, bx + 4, by - BIRD_RADIUS])
            .fill(col);
        }

        // Queued birds on ground
        for (let i = 0; i < gs.birdsQueue.length; i++) {
          const bt = gs.birdsQueue[i]!;
          const col = BIRD_COLORS[bt] ?? 0xe63946;
          const qx = slingX() - 60 - i * 40;
          const qy = groundY() - 14;
          const qr = 14;
          bodiesGfx.circle(qx, qy, qr).fill(col);
          bodiesGfx.circle(qx + 5, qy - 4, 4).fill(0xffffff);
          bodiesGfx.circle(qx + 6, qy - 4, 2).fill(0x1a1a1a);
          bodiesGfx
            .poly([qx + 9, qy - 1, qx + 14, qy, qx + 9, qy + 3])
            .fill(0xffa500);
        }
      }

      function drawHud(hs: number) {
        scoreText.text = `Score: ${gs.score}`;
        levelText.text = `Level ${gs.levelIndex + 1}`;
        hsText.text = `Best: ${hs}`;
      }

      function drawOverlay(phase: Phase) {
        overlayGfx.clear();
        overlayText.text = "";
        subText.text = "";
        if (phase !== "won" && phase !== "lost") return;
        overlayGfx
          .rect(0, 0, W(), H())
          .fill({ color: 0x000000, alpha: 0.55 });
        overlayText.position.set(W() / 2, H() / 2 - 30);
        subText.position.set(W() / 2, H() / 2 + 20);
        if (phase === "won") {
          overlayText.text = "🎉 Level Clear!";
          subText.text = `Score: ${gs.score}  •  Tap to continue`;
        } else {
          overlayText.text = "💥 Try Again!";
          subText.text = `Tap to retry`;
        }
      }

      // ── Input ─────────────────────────────────────────────────────────
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      function worldX(screenX: number) {
        return screenX - gs.camX;
      }
      function worldY(screenY: number) {
        return screenY;
      }

      app.stage.on("pointerdown", (e) => {
        const gs2 = stateRef.current;
        if (!gs2) return;

        if (gs2.phase === "won") {
          const nextLevel = gs2.levelIndex + 1;
          gs = buildLevel(nextLevel, W(), H());
          stateRef.current = gs;
          drawBg();
          drawGround();
          return;
        }
        if (gs2.phase === "lost") {
          gs = buildLevel(gs2.levelIndex, W(), H());
          stateRef.current = gs;
          drawBg();
          drawGround();
          return;
        }
        if (gs2.phase !== "aim" || !gs2.activeBird) return;

        const wx = worldX(e.global.x);
        const wy = worldY(e.global.y);
        const dx = wx - slingX();
        const dy = wy - slingY();
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 60) {
          gs2.dragging = true;
          gs2.dragX = wx;
          gs2.dragY = wy;
        }
      });

      app.stage.on("pointermove", (e) => {
        const gs2 = stateRef.current;
        if (!gs2 || !gs2.dragging) return;
        const wx = worldX(e.global.x);
        const wy = worldY(e.global.y);
        const sx = slingX();
        const sy = slingY();
        const dx = wx - sx;
        const dy = wy - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > MAX_DRAG) {
          const angle = Math.atan2(dy, dx);
          gs2.dragX = sx + Math.cos(angle) * MAX_DRAG;
          gs2.dragY = sy + Math.sin(angle) * MAX_DRAG;
        } else {
          gs2.dragX = wx;
          gs2.dragY = wy;
        }
      });

      app.stage.on("pointerup", () => {
        const gs2 = stateRef.current;
        if (!gs2 || !gs2.dragging || !gs2.activeBird) return;
        gs2.dragging = false;

        const sx = slingX();
        const sy = slingY();
        const dx = sx - gs2.dragX;
        const dy = sy - gs2.dragY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 10) return; // too small

        const bird = gs2.activeBird;
        bird.x = gs2.dragX;
        bird.y = gs2.dragY;
        bird.vx = dx * LAUNCH_POWER * 4;
        bird.vy = dy * LAUNCH_POWER * 4;
        bird.isStatic = false;
        gs2.bodies.push(bird);
        gs2.activeBird = null;
        gs2.phase = "flying";
        gs2.targetCamX = 0;
      });

      app.stage.on("pointerupoutside", () => {
        const gs2 = stateRef.current;
        if (gs2) gs2.dragging = false;
      });

      // ── Settling timer ────────────────────────────────────────────────
      let settleTimer = 0;

      // ── Main loop ─────────────────────────────────────────────────────
      drawBg();
      drawGround();

      app.ticker.add((ticker) => {
        const gs2 = stateRef.current;
        if (!gs2) return;

        const dt = ticker.deltaMS;

        if (gs2.phase === "flying" || gs2.phase === "settling") {
          stepPhysics(gs2.bodies, groundY(), dt);

          // Camera: follow the bird
          const flyingBird = gs2.bodies.find(
            (b) => b.type === "bird" && b.isAlive
          );
          if (flyingBird) {
            gs2.targetCamX = Math.max(
              0,
              -(flyingBird.x - W() * 0.35)
            );
          }

          // Check if bird landed
          if (gs2.phase === "flying") {
            const bird = gs2.bodies.find(
              (b) => b.type === "bird" && b.isAlive
            );
            if (!bird) {
              gs2.phase = "settling";
              settleTimer = 2500;
            } else {
              const speed = Math.sqrt(bird.vx ** 2 + bird.vy ** 2);
              if (speed < 15 && bird.y >= groundY() - bird.radius - 5) {
                gs2.phase = "settling";
                settleTimer = 1800;
              }
            }
          }

          if (gs2.phase === "settling") {
            settleTimer -= dt;
            if (settleTimer <= 0) {
              // Count pigs
              const pigsAlive = gs2.bodies.filter(
                (b) => b.type === "pig" && b.isAlive
              ).length;
              if (pigsAlive === 0) {
                // Bonus for remaining birds
                const bonus =
                  (gs2.birdsQueue.length + (gs2.activeBird ? 1 : 0)) * 2000;
                gs2.score += bonus + 3000;
                updateHighScore(gs2.score);
                gs2.phase = "won";
                gs2.targetCamX = 0;
              } else if (
                gs2.birdsQueue.length === 0 &&
                !gs2.activeBird
              ) {
                gs2.phase = "lost";
                gs2.targetCamX = 0;
              } else {
                // Next bird
                const nextType = gs2.birdsQueue.shift();
                if (nextType) {
                  const nb = createBody(
                    "bird",
                    slingX(),
                    slingY(),
                    BIRD_RADIUS,
                    { isStatic: true, health: 999, mass: 2, restitution: 0.4 }
                  );
                  (nb as PhysicsBody & { birdType: BirdType }).birdType = nextType;
                  gs2.activeBird = nb;
                  gs2.phase = "aim";
                  gs2.targetCamX = 0;
                } else {
                  gs2.phase = "lost";
                  gs2.targetCamX = 0;
                }
              }
            }
          }

          // Score killed pigs this frame
          const killedPigs = gs2.bodies.filter(
            (b) => b.type === "pig" && !b.isAlive && b.health <= 0
          );
          gs2.score += killedPigs.length * 5000;
          for (const p of killedPigs) p.health = -999; // prevent double-count
        }

        // Camera smooth pan
        gs2.camX += (gs2.targetCamX - gs2.camX) * 0.08;
        worldLayer.x = gs2.camX;

        // Redraw
        drawSling();
        drawTrajectory();
        drawBodies();
        drawHud(highScore);
        drawOverlay(gs2.phase);

        // Sync React state for sidebar
        setDisplayScore(gs2.score);
        setDisplayLevel(gs2.levelIndex + 1);
        setDisplayBirds([
          ...(gs2.activeBird
            ? [
                (gs2.activeBird as PhysicsBody & { birdType?: BirdType })
                  .birdType ?? "red",
              ]
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
    red: "🔴",
    blue: "🔵",
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
              {displayBirds.map((bt, i) => (
                <span key={i} className="text-xl">
                  {birdEmoji[bt]}
                </span>
              ))}
              {displayBirds.length === 0 && (
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  No birds left
                </span>
              )}
            </div>
          </div>

          <div
            className="mt-2 p-3 rounded-lg text-sm"
            style={{
              background: "var(--surface)",
              color: "var(--muted)",
              fontFamily: "Manrope, sans-serif",
            }}
          >
            <div className="font-semibold mb-1" style={{ color: "var(--fg)" }}>
              How to play
            </div>
            <ul className="space-y-1 text-xs">
              <li>🖱 Drag the bird to aim</li>
              <li>🚀 Release to launch</li>
              <li>🐷 Destroy all pigs!</li>
              <li>⭐ Save birds for bonus</li>
            </ul>
          </div>

          {displayPhase === "won" && (
            <div
              className="p-3 rounded-lg text-center font-bold"
              style={{
                background: "#22c55e22",
                color: "#22c55e",
                fontFamily: "Fraunces, serif",
              }}
            >
              🎉 Level Clear!
            </div>
          )}
          {displayPhase === "lost" && (
            <div
              className="p-3 rounded-lg text-center font-bold"
              style={{
                background: "#ef444422",
                color: "#ef4444",
                fontFamily: "Fraunces, serif",
              }}
            >
              💥 Try Again!
            </div>
          )}
        </div>
      }
    >
      <div ref={containerRef} className="w-full h-full" />
    </Shell>
  );
}
