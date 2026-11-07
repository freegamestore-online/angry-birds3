import type { ReactNode } from "react";
import { GameShell } from "@freegamestore/games";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return <GameShell>{children}</GameShell>;
}
