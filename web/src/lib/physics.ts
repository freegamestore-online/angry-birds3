// Simple 2D physics engine for Angry Birds clone

export interface Vec2 {
  x: number;
  y: number;
}

export interface PhysicsBody {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  restitution: number;
  friction: number;
  isStatic: boolean;
  isAlive: boolean;
  health: number;
  type: "bird" | "pig" | "block" | "ground";
  width?: number;  // for blocks
  height?: number; // for blocks
  rotation?: number;
}

const GRAVITY = 980; // px/s^2
const GROUND_Y_OFFSET = 0; // bodies sit on ground line

let nextId = 1;

export function createBody(
  type: PhysicsBody["type"],
  x: number,
  y: number,
  radius: number,
  options: Partial<PhysicsBody> = {}
): PhysicsBody {
  return {
    id: nextId++,
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    mass: options.mass ?? radius * radius * Math.PI * 0.01,
    restitution: options.restitution ?? 0.3,
    friction: options.friction ?? 0.7,
    isStatic: options.isStatic ?? false,
    isAlive: true,
    health: options.health ?? 100,
    type,
    width: options.width ?? radius * 2,
    height: options.height ?? radius * 2,
    rotation: options.rotation ?? 0,
  };
}

export function stepPhysics(
  bodies: PhysicsBody[],
  groundY: number,
  dt: number
): void {
  const dtSec = Math.min(dt / 1000, 0.033);

  // Integrate
  for (const b of bodies) {
    if (b.isStatic || !b.isAlive) continue;
    b.vy += GRAVITY * dtSec;
    b.x += b.vx * dtSec;
    b.y += b.vy * dtSec;
  }

  // Ground collision
  for (const b of bodies) {
    if (b.isStatic || !b.isAlive) continue;
    const floor = groundY - b.radius;
    if (b.y >= floor) {
      b.y = floor;
      b.vy *= -b.restitution;
      b.vx *= b.friction;
      if (Math.abs(b.vy) < 10) b.vy = 0;
    }
  }

  // Body vs body collisions (circles only for simplicity)
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    if (!a.isAlive) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (!b.isAlive) continue;
      if (a.isStatic && b.isStatic) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.radius + b.radius;

      if (dist < minDist && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        // Push apart
        if (!a.isStatic && !b.isStatic) {
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        } else if (!a.isStatic) {
          a.x -= nx * overlap;
          a.y -= ny * overlap;
        } else {
          b.x += nx * overlap;
          b.y += ny * overlap;
        }

        // Impulse
        const relVx = b.vx - a.vx;
        const relVy = b.vy - a.vy;
        const dot = relVx * nx + relVy * ny;
        if (dot < 0) {
          const e = Math.min(a.restitution, b.restitution);
          const impulse = (-(1 + e) * dot) / (1 / a.mass + 1 / b.mass);
          const impx = impulse * nx;
          const impy = impulse * ny;

          const speed = Math.sqrt(
            (b.vx - a.vx) ** 2 + (b.vy - a.vy) ** 2
          );
          const damage = Math.min(speed * 0.5, 80);

          if (!a.isStatic) {
            a.vx -= impx / a.mass;
            a.vy -= impy / a.mass;
            if (b.type === "bird" || a.type === "pig" || a.type === "block") {
              a.health -= damage;
            }
          }
          if (!b.isStatic) {
            b.vx += impx / b.mass;
            b.vy += impy / b.mass;
            if (a.type === "bird" || b.type === "pig" || b.type === "block") {
              b.health -= damage;
            }
          }
        }
      }
    }
  }

  // Kill dead bodies
  for (const b of bodies) {
    if (b.health <= 0) b.isAlive = false;
  }
}

export function GROUND_Y(_unused: number): number {
  return GROUND_Y_OFFSET;
}
