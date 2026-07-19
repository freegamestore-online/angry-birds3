import type { ReactNode } from "react";

interface ShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
  dock?: ReactNode;
}

export function Shell({ children, sidebar, dock }: ShellProps) {
  return (
    <>
      {/* Desktop: sidebar + main */}
      <div
        className="hidden md:flex"
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
      >
        <aside
          className="flex flex-col border-r shrink-0"
          style={{
            width: "17rem",
            height: "100%",
            overflow: "hidden",
            borderColor: "var(--line)",
            background: "var(--panel)",
          }}
        >
          <div className="p-6 font-bold text-lg shrink-0" style={{ fontFamily: "Fraunces, serif" }}>
            Angry Birds
          </div>
          <div className="flex-1 overflow-y-auto">
            {sidebar}
          </div>
          <div className="p-4 text-xs shrink-0" style={{ color: "var(--muted)" }}>
            <a
              href="https://freegamestore.online"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              style={{ color: "var(--muted)" }}
            >
              Part of FreeGameStore — free forever
            </a>
          </div>
        </aside>
        <main style={{ flex: 1, overflow: "hidden", height: "100%" }}>
          {children}
        </main>
      </div>

      {/* Mobile: header + main + dock */}
      <div
        className="flex flex-col md:hidden"
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
      >
        <header
          className="flex items-center justify-between px-4 shrink-0 border-b"
          style={{
            height: "3.5rem",
            borderColor: "var(--line)",
            background: "var(--panel)",
          }}
        >
          <span className="font-bold" style={{ fontFamily: "Fraunces, serif" }}>
            Angry Birds
          </span>
          {dock && <div className="flex items-center gap-3">{dock}</div>}
        </header>
        <main style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
          {children}
        </main>
      </div>
    </>
  );
}
