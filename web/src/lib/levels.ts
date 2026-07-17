export interface LevelDef {
  birds: BirdType[];
  structures: StructureDef[];
  pigs: PigDef[];
}

export type BirdType = "red" | "blue" | "yellow";

export interface PigDef {
  x: number; // fraction of game width
  y: number; // fraction of game height (from bottom)
}

export interface StructureDef {
  x: number;   // fraction of game width
  y: number;   // fraction of game height (from bottom)
  w: number;   // fraction of game width
  h: number;   // fraction of game height
  type: "wood" | "stone" | "glass";
}

export const LEVELS: LevelDef[] = [
  // Level 1 — simple
  {
    birds: ["red", "red", "red"],
    pigs: [
      { x: 0.62, y: 0.065 },
    ],
    structures: [
      { x: 0.60, y: 0.065, w: 0.06, h: 0.13, type: "wood" },
    ],
  },
  // Level 2 — tower
  {
    birds: ["red", "blue", "red"],
    pigs: [
      { x: 0.62, y: 0.065 },
      { x: 0.72, y: 0.065 },
    ],
    structures: [
      { x: 0.60, y: 0.065, w: 0.055, h: 0.13, type: "wood" },
      { x: 0.60, y: 0.195, w: 0.055, h: 0.055, type: "wood" },
      { x: 0.70, y: 0.065, w: 0.055, h: 0.13, type: "wood" },
      { x: 0.70, y: 0.195, w: 0.055, h: 0.055, type: "wood" },
    ],
  },
  // Level 3 — stone fortress
  {
    birds: ["red", "yellow", "blue", "red"],
    pigs: [
      { x: 0.60, y: 0.065 },
      { x: 0.68, y: 0.065 },
      { x: 0.76, y: 0.065 },
    ],
    structures: [
      { x: 0.57, y: 0.065, w: 0.05, h: 0.13, type: "stone" },
      { x: 0.65, y: 0.065, w: 0.05, h: 0.13, type: "stone" },
      { x: 0.73, y: 0.065, w: 0.05, h: 0.13, type: "stone" },
      { x: 0.57, y: 0.195, w: 0.21, h: 0.05, type: "stone" },
      { x: 0.65, y: 0.245, w: 0.05, h: 0.065, type: "wood" },
    ],
  },
  // Level 4 — glass pyramid
  {
    birds: ["yellow", "red", "blue", "yellow"],
    pigs: [
      { x: 0.63, y: 0.065 },
      { x: 0.73, y: 0.065 },
    ],
    structures: [
      { x: 0.60, y: 0.065, w: 0.04, h: 0.13, type: "glass" },
      { x: 0.67, y: 0.065, w: 0.04, h: 0.13, type: "glass" },
      { x: 0.74, y: 0.065, w: 0.04, h: 0.13, type: "glass" },
      { x: 0.60, y: 0.195, w: 0.14, h: 0.04, type: "glass" },
      { x: 0.63, y: 0.235, w: 0.04, h: 0.10, type: "glass" },
      { x: 0.70, y: 0.235, w: 0.04, h: 0.10, type: "glass" },
      { x: 0.63, y: 0.335, w: 0.11, h: 0.04, type: "glass" },
    ],
  },
  // Level 5 — chaos
  {
    birds: ["red", "yellow", "blue", "yellow", "red"],
    pigs: [
      { x: 0.58, y: 0.065 },
      { x: 0.66, y: 0.065 },
      { x: 0.74, y: 0.065 },
      { x: 0.62, y: 0.195 },
      { x: 0.70, y: 0.195 },
    ],
    structures: [
      { x: 0.56, y: 0.065, w: 0.04, h: 0.13, type: "stone" },
      { x: 0.64, y: 0.065, w: 0.04, h: 0.13, type: "wood" },
      { x: 0.72, y: 0.065, w: 0.04, h: 0.13, type: "stone" },
      { x: 0.56, y: 0.195, w: 0.20, h: 0.04, type: "wood" },
      { x: 0.60, y: 0.235, w: 0.04, h: 0.10, type: "glass" },
      { x: 0.68, y: 0.235, w: 0.04, h: 0.10, type: "glass" },
      { x: 0.60, y: 0.335, w: 0.12, h: 0.04, type: "stone" },
    ],
  },
];
