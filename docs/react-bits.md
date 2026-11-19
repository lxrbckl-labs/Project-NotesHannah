# React Bits in Notes

## What it is

React Bits (https://reactbits.dev) is a collection of animated React components.
It is not a package you install. You copy each component into your own project and then own the copy.
Components come as JavaScript or TypeScript, with plain CSS or Tailwind.
We use TypeScript with Tailwind (`TS-TW`).

## Where it lives

- Components: `apps/web/src/components/bits/`. One file per component, plus:
  - `index.ts`: exports the components that need no animation library.
  - `tokens.ts`: helpers that read theme colours in JavaScript (`useToken`, `useThemeMode`, `readToken`, `prefersReducedMotion`).
  - `LICENSE.md`: the React Bits licence text.
  - `bits.test.tsx`, `bits-test-utils.ts`: tests.
- Registry config: `apps/web/components.json`. It points the shadcn tool at this folder and at the React Bits registry.
  `apps/web/tsconfig.json` has a `@/*` path alias because the tool needs it. Our own code does not use the alias.
- Gallery: route `/design/bits` (sign-in required), code in `apps/web/src/features/design-bits/`.
- Runtime dependency: `motion` 12.43.0 (exact). Only `CountUp` and `BlurText` import it.

## Add another component

Run this from `apps/web`:

```
pnpm dlx shadcn@latest add @react-bits/<Name>-TS-TW
```

Example: `pnpm dlx shadcn@latest add @react-bits/Dock-TS-TW`.
The `<Name>` is the name on reactbits.dev. The full list is at https://reactbits.dev/r/registry.json.
Add `--overwrite` to refresh a component you already have (this throws away our changes, so re-adapt it).

The tool downloads one file into `src/components/bits/<Name>.tsx` and adds the dependencies the component names.
Then finish the job by hand:

1. Open `apps/web/package.json`. The tool adds dependencies with `^` and reorders keys.
   Pin each new version exactly and put `lucide-react` back where it was. Run `pnpm install`.
2. Many components import `@hugeicons/react`. Do not keep it. Swap the icons for `lucide-react`, then remove both hugeicons packages.
3. Adapt the file with the rules below, and write what you changed in a header comment (see any file in the folder).
4. Run `pnpm exec biome check --write apps/web/src/components/bits` from the repo root.
5. Run `pnpm --filter web typecheck`. Upstream code is not written for `noUncheckedIndexedAccess`, so expect errors on array reads.
   Fix them with `!` or `??`, as the existing files do.
6. Export it from `index.ts` (or leave it out if it imports `motion` or `gsap`, and load it with `React.lazy`).
7. Add a section to the gallery and a test in `bits.test.tsx`.

If a component needs three.js, ogl or another large WebGL library, ask first. None of the current ones do.

## Adaptation rules

- Colours come from the theme tokens in `src/app/styles.css`. Never hard-code a palette.
  - Painting with CSS: use `var(--color-surface)`, `var(--color-accent)`, `var(--shadow-card)` and so on. The browser updates them when the theme changes.
  - Painting in JavaScript (canvas, WebGL, colour maths): call `useToken("--color-accent", fallback)`. It re-reads when `data-theme` or the system theme changes.
  - Remove upstream `theme="dark" | "light"` props. We have one theme system.
- Reduced motion: when `prefers-reduced-motion: reduce` is set, nothing animates.
  Show the final state at once. Check the component does this; several upstream ones only shorten the animation.
- Touch: hover effects must be optional extras. Nothing may need a hover. Canvas layers must have `pointer-events: none` so they never block scrolling or taps. Keep tap targets at least 44px.
- No layout shift: the component must take the same space before and after its animation. Hide with `opacity`, not `display`.
- Accessibility: screen readers get the real text once, not letter by letter or number by number. Hide animated copies with `aria-hidden`.
- Lazy loading: a component that imports `motion` (or `gsap`) is not exported from `index.ts`.
  Import it with `React.lazy(() => import(".../CountUp"))` inside `Suspense`, with a same-size fallback.
  Screens that are not the first screen are already lazy routes, so they may import directly.
- Typed props: keep the upstream props type, and add JSDoc on anything we added.
- Header comment: every file starts with the upstream URL and a list of what we changed, so an upstream update can be reapplied.
- Biome: `biome.json` has an override for `components/bits/**` that turns off a few rules that upstream code breaks
  (non-null assertions, hook dependency lists, array-index keys, some a11y rules on custom widgets).
  Our own files in that folder (`tokens.ts`, tests, `index.ts`) should still follow the rules where they can.

## What is in the first set

| Component | Suggested placement | Needs |
| --- | --- | --- |
| DotGrid | Not placed in the app since 2026-11-16 (cards are solid); still in the gallery at `/design/bits` | raw WebGL2 |
| SpotlightCard | Course and lecture cards in the library | nothing |
| CountUp | Stat tiles (cards due, notebook size, scores) | `motion` |
| AnimatedList | Activity feed and inbox | nothing |
| BlurText | Page greetings and the empty-state headline | `motion` |
| ClickSpark | A correct practice answer (call `ref.spark()`) | nothing |
| Stepper | Setup flows: add a course, import a lecture, start an exam | nothing |
| ShinyText | A quiet "syncing" or "generating" status line | nothing |
| StarBorder | The one main action on a screen, such as Start practice | nothing |
| Magnet | Small floating buttons on the computer layout only | nothing |

Not chosen: Dock and PillNav (navigation is another worker's area), GradientText (ShinyText covers it), anything needing three.js or ogl.

Used in the app today (demonstration only):

- `CountUp` on the two stat tiles at the top of the Practice home, through `features/practice/ui/StatNumber.tsx`.
- `BlurText` was on the Library home greeting, through `features/library/GreetingTitle.tsx`. The greeting card was removed on 2026-11-16 (the page opens on Recently opened); the component is no longer placed there.

Both keep the real text in the page for screen readers and tests. The animation only changes the sighted view.

## Size

`motion` is loaded only when `CountUp` or `BlurText` is on screen, as separate chunks (about 14 kB and 72 kB, 6 kB and 23 kB gzip).
The gallery is its own lazy route. The Tailwind classes in the copied files add a little CSS to the first load (about 3 kB gzip).

## Licence

React Bits is under "MIT + Commons Clause License Condition v1.0", copyright 2026 David Haz.
Source: https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md (read 2026-11-16). The text is in `apps/web/src/components/bits/LICENSE.md`.

In plain words:

- You may use, copy, modify and distribute the components as part of an application, website or product.
- You may use them commercially, as long as you do not sell, sublicense or redistribute the components themselves.
  That covers selling them alone, in a bundle, or as a ported version.
- The same limit covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab) and the sound library.
  You also may not offer those tools, or a close copy, as a hosted service.
- Code, images, video and audio you export from the tools are yours to use in any app, free or paid.
  You may not sell or redistribute the exports on their own, such as a sound, texture, background or template pack.
- The copyright notice and permission notice must stay with copies. That is why `LICENSE.md` sits in the folder.
- The software comes with no warranty.

What this means here: Notes may use and change the components. Do not publish the `bits` folder as a package,
a template or a component library for others.

## WarmTooltip (added 2026-11-17)

`apps/web/src/components/bits/WarmTooltip.tsx`, from `@react-bits/WarmTooltip-TS-TW`. It is the
tooltip for every icon-only button, used through `components/ui/tooltip.tsx` (`Tooltip`,
`TooltipGroup`), which sets the theme's colors. One `TooltipGroup` sits at the app root
(`app/providers.tsx`), so the "warmth" is shared: after the first hint, the next button's hint opens
at once.

It imports `motion`, so `motion` is now part of the first load (before, only `CountUp` and
`BlurText` used it).

Changes from upstream, also listed in the file's header:

- The wrapper around the control is `display: contents`, so it adds no box. Upstream wraps the
  control in an inline-flex span, which would have moved every button that relies on its own
  margins, `absolute` position or place in a flex row.
- The bubble is placed against the control itself (the wrapper's first element).
- It opens on the opposite side when the control is too close to the window's edge (`fitSide`).
- The "fuse" bar is not drawn (it needed the wrapper's box).
- Type fixes for this project's strict settings.

When adding a component with the shadcn tool, it rewrites `package.json` (versions with `^`, keys
reordered): put the pinned versions back and run `pnpm install --frozen-lockfile`. Never run the
formatter on a file that does not parse: it rewrites `{...}` in JSX as plain text.
- No long-press hint on touch. Upstream captures the pointer to time a long press, and with our
  box-less wrapper that capture took the tap away from the button (a row's menu did not open on
  phone and tablet in the real-server suite). On touch the button simply works.

A tooltip must never sit between a Radix trigger and its button, including when the button is
passed as a `trigger` prop: the menu is placed against the button, and the tooltip's wrapper has no
box (the block menu opened off screen). Put the tooltip around the trigger instead; `BlockMenu` takes
a `tip` for this.

