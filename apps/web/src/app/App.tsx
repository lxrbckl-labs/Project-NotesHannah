import { ThemeSwitch } from "./ThemeSwitch";

const SECTIONS = ["Library", "Practice", "Concepts", "Requests"];

function Placeholder({ title }: { title: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-text-muted">Placeholder content.</p>
    </section>
  );
}

/** Shell placeholder: phone = single column + bottom tab bar; tablet = sidebar + content;
 *  computer = sidebar + content + right panel. */
export function App() {
  return (
    <div className="flex min-h-dvh md:grid md:grid-cols-[14rem_1fr] xl:grid-cols-[14rem_1fr_18rem]">
      <aside
        data-testid="sidebar"
        className="hidden border-r border-border bg-surface p-4 md:block"
      >
        <p className="mb-4 font-semibold">Notes</p>
        <nav className="flex flex-col gap-2 text-sm">
          {SECTIONS.map((s) => (
            <span key={s} className="text-text-muted">
              {s}
            </span>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-4 pb-20 md:pb-4">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Notes</h1>
          <ThemeSwitch />
        </header>
        <div className="grid gap-3">
          <Placeholder title="Pharmacology II" />
          <Placeholder title="Lecture 07 · Beta blockers" />
        </div>
      </main>

      <aside
        data-testid="right-panel"
        className="hidden border-l border-border bg-surface p-4 xl:block"
      >
        <p className="mb-2 font-medium">Details</p>
        <p className="text-sm text-text-muted">Right panel placeholder.</p>
      </aside>

      <nav
        data-testid="tab-bar"
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 flex justify-around border-t border-border bg-surface py-3 text-sm text-text-muted md:hidden"
      >
        {SECTIONS.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </nav>
    </div>
  );
}
