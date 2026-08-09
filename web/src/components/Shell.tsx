import type { ReactNode } from "react";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <div style={{ width: "100%", height: "100dvh", overflow: "hidden" }}>
      {children}
    </div>
  );
}
