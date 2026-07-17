import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";
import { Shell } from "./components/Shell";

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;
    const app = new Application();

    (async () => {
      await app.init({ resizeTo: container, background: "#0f172a" });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      container.appendChild(app.canvas);

      const rect = new Graphics().rect(-50, -50, 100, 100).fill(0x2563eb);
      rect.position.set(app.screen.width / 2, app.screen.height / 2);
      app.stage.addChild(rect);

      app.ticker.add(() => {
        rect.rotation += 0.01;
      });
    })();

    return () => {
      destroyed = true;
      app.destroy(true);
    };
  }, []);

  return (
    <Shell>
      <div ref={containerRef} className="w-full h-full min-h-[400px]" />
    </Shell>
  );
}
