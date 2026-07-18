import { useEffect, useRef, useState } from "react";
import { Application, Graphics, Text, Container } from "pixi.js";
import { Shell } from "./components/Shell";
import { useHighScore } from "./hooks/useHighScore";

// Keep types and constants as before (see full file above)
// ─── Small Scene Constants ────────────────
const SCENE_W = 400;
const SCENE_H = 300;
const GROUND_FRAC = 0.83; // ground at 83% height
const SLING_X = 60;
const SLING_Y = SCENE_H * GROUND_FRAC - 20;

// ─── App ──────────────────────────────────
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const { highScore, setHighScore } = useHighScore("angry_birds3_highscore");

  useEffect(() => {
    const app = new Application();
    app.init({ resizeTo: containerRef.current! }).then(() => {
      if (!containerRef.current) return;
      containerRef.current.appendChild(app.canvas);

      // Draw static background
      const bg = new Graphics().rect(0, 0, SCENE_W, SCENE_H).fill(0x90cdf4);
      app.stage.addChild(bg);
      // Draw ground
      const groundY = SCENE_H * GROUND_FRAC;
      app.stage.addChild(
        new Graphics()
          .rect(0, groundY, SCENE_W, SCENE_H - groundY)
          .fill(0x5d4037)
      );
      // Draw slingshot
      app.stage.addChild(
        new Graphics()
          .rect(SLING_X - 8, groundY - 30, 16, 30)
          .fill(0x9e7a4c)
      );
      // Dummy bird
      app.stage.addChild(
        new Graphics().circle(SLING_X + 10, groundY - 12, 16).fill(0xe63946)
      );
      // Dummy pig
      app.stage.addChild(
        new Graphics().circle(320, groundY - 16, 14).fill(0x6fcf97)
      );
      // Dummy block
      app.stage.addChild(
        new Graphics().rect(300, groundY - 40, 40, 24).fill(0xc9a84c)
      );

      // Show score
      app.stage.addChild(
        new Text({
          text: `Score: ${score}`,
          style: { fontFamily: "Manrope", fontSize: 18, fill: 0x222 } as any,
          x: 10,
          y: 10,
        })
      );
    });
    return () => { app.destroy(); };
  }, [score]);

  return (
    <Shell>
      <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-transparent" />
    </Shell>
  );
}
