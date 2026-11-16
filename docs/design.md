# Design system

The shared look of the web app: tokens, roles, scales and components. Code:
`apps/web/src/app/styles.css` (tokens), `apps/web/src/lib/hues.ts` and `apps/web/src/lib/roles.ts`
(the palette and what each colour means), `apps/web/src/components/ui/` (components). The page
`/design` (Settings, then "Design reference") shows all of it in the current theme.

The last section is the migration brief for the feature folders. Each feature worker follows its
own table.

## Contents

1. [Direction](#direction)
2. [Rules](#rules)
3. [Colour tokens](#colour-tokens)
4. [Roles](#roles)
5. [Scales](#scales)
6. [Utility classes](#utility-classes)
7. [Components](#components)
8. [Migration](#migration)

## Direction

- The person using the app is a pharmacy student, mostly on an iPad and a phone. Readability beats
  decoration.
- The base stays as it was: warm paper neutrals, the faint dotted grid, rounded cards, calm motion.
  The reference is AFFiNE's edgeless canvas.
- Green stays the brand accent. It marks the main action, the current selection and focus.
- Colour now carries meaning across the app. Ten named hues give courses, concept types, callouts,
  statuses and canvas cards their own friendly colour, always soft and never loud.
- One source of truth. A feature never picks a hex value. It names a token or a role.
- Light and dark are tuned separately. Every text colour passes WCAG AA (4.5:1) on its backgrounds
  in both themes, and every solid shade reaches 3:1 on the surface. `apps/web/test/contrast.test.ts`
  checks this.

## Rules

1. Use a token, never a raw colour. If no token fits, add one to `styles.css` (both dark blocks),
   check it in the contrast test and list it here.
2. Name a meaning through `roles.ts`. A drug chip is `CONCEPT_TYPE_HUE.drug`, not "green".
3. Never use colour alone. Every coloured state also has words or an icon.
4. Text on a tint uses the hue's `text` shade, or the normal `--color-text`. Never put text on a
   `solid` shade (it does not reach 4.5:1). For a filled look, invert: the `text` shade as the fill
   and the `soft` shade as the text.
5. Touch targets are at least 44px on phone and tablet. Small visuals get the `hit-area` class.
6. Keep focus visible. The global `:focus-visible` ring uses the accent; do not remove outlines.
7. Motion uses the duration and easing tokens. Reduced motion turns all of it off globally.
8. Do not use Tailwind's built-in numbered colours (`bg-blue-100`, `text-red-600`). Use `hue-*`,
   `tone-*` or the semantic names.

## Colour tokens

Every token is a CSS custom property on `:root`, and every colour is also a Tailwind colour:
`--color-surface` is `bg-surface`, `--hue-blue-soft` is `bg-hue-blue-soft`, `--tone-text` is
`text-tone-text`.

### Base

These kept their names and meanings. Features may keep using them as they are.

| Token | Purpose |
| --- | --- |
| `--color-bg` | The page behind everything; the canvas background. |
| `--color-surface` | Cards, sheets, menus, inputs. |
| `--color-surface-muted` | Hover fills, segmented-control tracks, skeletons. |
| `--color-border` | Hairlines between and around things. |
| `--color-border-strong` | Input borders, dashed empty states, frame borders. |
| `--color-text` | Body text. |
| `--color-text-muted` | Secondary text: hints, captions, counts. |
| `--color-accent` | The brand green: primary buttons, links, focus, current item. |
| `--color-accent-contrast` | Text and icons on an accent or danger fill. |
| `--color-accent-soft` | Accent tint: selected rows, accent badges. |
| `--color-accent-border` | New. Border for accent tints. |
| `--color-dot` | The dotted grid. |
| `--color-chrome` | New. Translucent surface for floating toolbars over the canvas or a page. |
| `--color-overlay` | The dimmed backdrop behind dialogs and sheets. |
| `--color-selection` | New. Selection outlines on the canvas and the editor caret (blue). |

### Palette

Ten hues, with the same names as the schema's colour tokens (`COLOR_TOKENS` in
`packages/schema/src/blocks/tokens.ts`): `green`, `teal`, `blue`, `purple`, `pink`, `red`, `orange`,
`yellow`, `brown` and `gray`. A colour stored on a canvas card, a frame, a mind-map node, a highlight
or a block style is already a hue name, so it needs no mapping.

Each hue has five shades:

| Token | Purpose |
| --- | --- |
| `--hue-<hue>-solid` | Dots, icons, connector lines, swatch rings, progress fills. Not for text. 3:1 on the surface. |
| `--hue-<hue>-soft` | Tinted backgrounds: cards, badges, callouts. |
| `--hue-<hue>-text` | Text and icons on the soft shade, on the surface, on the page and on surface-muted. AA everywhere. |
| `--hue-<hue>-border` | Borders of tinted things. |
| `--hue-<hue>-mark` | Highlighter behind normal body text (AA with `--color-text`). |

`CATEGORICAL_HUES` in `hues.ts` are the eight lively ones (all but `brown` and `gray`). Use them for
things that need a colour of their own: courses, matching pairs, chart series. `gray` means "no colour
chosen".

### Tones

A tone is "the current hue". Set `data-hue="teal"` on an element; inside it the `tone-*` utilities
are teal. `data-hue="accent"` gives the brand green. With no `data-hue`, the tone is gray.

| Token | Tailwind | Purpose |
| --- | --- | --- |
| `--tone-solid` | `bg-tone-solid`, `border-tone-solid` | As the hue's solid. |
| `--tone-soft` | `bg-tone-soft` | As the hue's soft. |
| `--tone-text` | `text-tone-text` | As the hue's text. |
| `--tone-border` | `border-tone-border` | As the hue's border. |
| `--tone-mark` | `bg-tone-mark` | As the hue's mark. |

This is how a colour chosen at run time reaches Tailwind without building class names:

```tsx
<div data-hue={card.color ?? "gray"} className="rounded-card border border-tone-border bg-tone-soft">
  <h3 className="text-tone-text">{card.title}</h3>
</div>
```

Plain CSS reads the same variables: `background: var(--tone-soft)`.

### Semantic colours

Each points at a hue, so there is one source of truth.

| Token | Hue | Purpose |
| --- | --- | --- |
| `--color-success`, `-soft`, `-border`, `-solid` | green | Done, saved, correct. |
| `--color-warning`, `-soft`, `-border`, `-solid` | orange | Needs a look: unverified, declined, partial risk. |
| `--color-info`, `-soft`, `-border`, `-solid` | blue | Neutral information, in progress. |
| `--color-danger`, `-soft`, `-border`, `-solid` | red | Errors, destructive actions. `--color-danger` and `-soft` keep their old values. |

`--color-success` and the others are the text shade (use them for text and as a filled button
background under `--color-accent-contrast`, like danger).

## Roles

`apps/web/src/lib/roles.ts` maps every meaning to a hue. Render a role with a component's `hue` prop
or with `data-hue`.

| Map | Keys and hues |
| --- | --- |
| `CONCEPT_TYPE_HUE` | drug green, drug_class blue, mechanism purple, target pink, indication teal, adverse_effect red, interaction orange, contraindication red, monitoring_parameter blue, counselling_point yellow, other gray |
| `SEVERITY_HUE` | minor gray, moderate orange, major red, contraindicated red |
| `CALLOUT_HUE` | The schema's `CALLOUT_DEFAULT_COLORS`: info blue, tip green, warning orange, important red, definition purple, exam_tip yellow |
| `DOCUMENT_HUE` | citation blue, concept teal, highlight yellow, flag orange, flagDose red, checked green, citationMissing gray |
| `FEEDBACK_HUE` | correct green, incorrect red, partial yellow, skipped gray |
| `RATING_HUE` | again red, hard orange, good green, easy blue |
| `REQUEST_STATUS_HUE` | waiting gray, in_progress blue, done green, declined orange, cancelled gray |
| `FILE_STATUS_HUE` | uploaded gray, converting blue, converted teal, transcribed green, filed green, failed red |
| `CONNECTOR_HUE` | leads_to gray, causes orange, treats green, contrasts purple, part_of blue, related gray (line styles keep leads_to and related apart) |
| `CANVAS_DEFAULT_HUE` | card none (plain surface), frame none, connecting blue |
| `STATUS_TONE` | neutral gray, accent accent, success green, warning orange, info blue, danger red |

`hues.ts` also has:

- `hueForId(id)`: a stable lively hue from an id (FNV-1a hash). The same course always gets the same
  colour on every device.
- `hueOf(id, chosen)`: the chosen colour, or `hueForId(id)`.
- `seriesHue(n)`: the n-th lively hue, cycling.
- `hueVar(hue, shade)`: `"var(--hue-blue-solid)"`, for inline styles and SVG strokes.
- `HUE_LABEL`: plain names for pickers and screen readers.

Library nodes (courses, folders, documents) do not store a colour today. Use `hueForId(node.id)`.
Canvas cards, frames, mind-map nodes, highlights and block styles do store one (a `ColorToken`).

## Scales

All scale tokens are plain custom properties on `:root`; most are also Tailwind names.

### Radius

| Token | Tailwind | Size | Use |
| --- | --- | --- | --- |
| `--radius-inline` | `rounded-inline` | 6px | Inline code, highlights, kbd, small marks. |
| `--radius-control` | `rounded-control` | 12px | Buttons, inputs, menu items, segments. Same as `rounded-xl`. |
| `--radius-card` | `rounded-card` | 16px | Cards, popovers, menus, toasts, canvas cards. Same as `rounded-2xl`. |
| `--radius-panel` | `rounded-panel` | 24px | Sheets, dialogs, empty states, canvas frames. Same as `rounded-3xl`. |
| `--radius-pill` | `rounded-pill` | full | Badges, chips, dots, progress bars. |

Rounding of old ad hoc values: 3 to 6px become inline; 8 to 12px control; 14 to 18px card; 22 to 24px
panel; 999px pill.

### Spacing and size

Use Tailwind's 4px spacing scale. Page gutters are 16px on the phone and 32px from tablet (`Page`).
`--touch-target` (44px) and `--touch-target-compact` (36px) are for CSS that cannot use `min-h-11`.

### Elevation

| Token | Tailwind | Use |
| --- | --- | --- |
| none | | Flat cards inside cards; the page. |
| `--shadow-card` | `shadow-card` | Cards at rest. |
| `--shadow-raised` | `shadow-raised` | New. A card lifted: hover on an interactive card, dragging, a selected canvas card. |
| `--shadow-pop` | `shadow-pop` | Menus, popovers, dialogs, sheets, toasts. |

### Layers

Use with Tailwind's arbitrary value: `z-(--z-popover)`.

| Token | Value | Use |
| --- | --- | --- |
| `--z-raised` | 10 | A card lifted while dragged, sticky table columns, canvas chrome. |
| `--z-sticky` | 20 | Sticky headers inside a page. |
| `--z-nav` | 30 | The shell's tab bar and sidebar. |
| `--z-dock` | 40 | Docked toolbars, the editor format bar, quick find. |
| `--z-float` | 55 | Floating trays (the upload tray). |
| `--z-overlay` | 60 | The backdrop behind a dialog or sheet. |
| `--z-modal` | 61 | Dialogs and sheets. |
| `--z-popover` | 70 | Menus, popovers, selects. Above dialogs, so they work inside one. |
| `--z-toast` | 80 | Toasts. |
| `--z-tooltip` | 90 | Tooltips. |
| `--z-skip` | 100 | The skip link. |

The shared dialog moved from 70/71 to 60/61, menus from 50 to 70 and toasts from 90 to 80.

### Motion

| Token | Value | Use |
| --- | --- | --- |
| `--duration-instant` | 80ms | Hover and press colour changes. |
| `--duration-fast` | 140ms | Popovers, menus, fades, small pops. |
| `--duration-base` | 200ms | Sheets and dialogs. |
| `--duration-slow` | 320ms | Larger moves, progress fills. |
| `--ease-calm` (`ease-calm`) | cubic-bezier(0.2, 0.8, 0.2, 1) | Things arriving. |
| `--ease-exit` (`ease-exit`) | cubic-bezier(0.4, 0, 1, 1) | Things leaving. |
| `--ease-standard` (`ease-standard`) | cubic-bezier(0.4, 0, 0.2, 1) | Things moving on screen. |

In Tailwind: `duration-(--duration-fast) ease-calm`. The `prefers-reduced-motion` rule at the end of
`styles.css` shortens every animation and transition to nothing, for the whole app. Features do not
need their own reduced-motion blocks.

### Type

| Token | Tailwind | Size / line | Use |
| --- | --- | --- | --- |
| `--text-display` | `text-display` | 30 / 36 | Page titles from tablet up. |
| `--text-heading` | `text-heading` | 24 / 32 | Page titles on the phone, section headings. |
| `--text-title` | `text-title` | 20 / 28 | Card, dialog and sheet titles. |
| `--text-reading` | `text-reading` | 17 / 1.7 | Study-guide prose. |
| `--text-body` | `text-body` | 16 / 24 | Inputs on touch (no iOS zoom), interface paragraphs. |
| `--text-ui` | `text-ui` | 14 / 20 | Buttons, menus, most interface text. Same as `text-sm`. |
| `--text-label` | `text-label` | 13 / 18 | Badges, chips, table heads, secondary labels. |
| `--text-caption` | `text-caption` | 12 / 16 | Counts, timestamps. Same as `text-xs`. |

Weights: Tailwind's `font-medium` (500) for controls, `font-semibold` (600) for titles, `font-bold`
(700) only for a drug name or a number that must stand out. Fonts: `--font-sans` for text,
`--font-display` (`font-display`, rounded) for headings, `--font-mono` (`font-mono`) for code and units.

## Utility classes

Defined in `styles.css`:

| Class | What it does |
| --- | --- |
| `.prose-reading` | Study-guide prose: 17px, line height 1.7, 68ch measure, paragraph and list rhythm, styled `code` and `mark` (`<mark data-hue="blue">` picks a highlighter). |
| `.dot-grid` | The faint dotted grid. |
| `.hit-area` | Adds an invisible 44px hit area on coarse pointers, without changing the look. |
| `.anim-fade`, `.anim-pop` | Fade in; fade and rise slightly. |
| `.anim-sheet` | Rise from the bottom. |
| `.anim-slide-right` | Slide in from the right. |
| `.anim-sheet-side` | Rise on the phone, slide from the right from tablet. |
| `.anim-sheet-center` | Rise on the phone, pop from tablet. |
| `.anim-spin` | A spinner's rotation. |
| `.skeleton` | A loading placeholder. |
| `.pb-safe`, `.pt-safe`, `.px-safe` | Safe-area padding. |

## Components

All in `apps/web/src/components/ui/`. Every one works at phone, tablet and computer widths, in
light and dark, shows keyboard focus, and respects reduced motion. Touch targets are 44px on touch
layouts; some get compact on the computer layout (from 1280px).

### Button (`button.tsx`)

Variants: `primary`, `secondary` (default), `subtle`, `ghost`, `ghostAccent`, `ghostDanger`,
`danger`. Sizes: `sm`, `md` (default), `lg`. 44px tall on touch; 32, 36 or 48px on the computer.

```tsx
<Button variant="primary" onClick={save}>Save</Button>
<Button size="sm" variant="ghost">Skip</Button>
```

### IconButton (`button.tsx`)

An icon-only button. It always has a name: `label` (or `aria-label`). Variants: `ghost` (default),
`subtle`, `secondary`, `primary`, `ghostDanger`. Sizes `md` and `sm`. `pressed` makes it a toggle
with the accent fill. Wrap it in a `Tooltip` on the computer if the icon is not obvious.

```tsx
<IconButton label="Bold" pressed={isBold} onClick={toggleBold}><Bold size={18} /></IconButton>
```

### Card (`card.tsx`)

The rounded paper card. `as` picks the element, `padding` is `none`, `sm`, `md` (default) or `lg`,
`hue` tints it, `interactive` lifts it on hover, `flat` drops the shadow. `CardTitle` is a title row
with an optional description and action.

```tsx
<Card as="section" aria-labelledby="due"><CardTitle id="due" title="Due today" /></Card>
<Card hue={FEEDBACK_HUE.correct} padding="sm">Correct</Card>
```

### Badge and Chip (`badge.tsx`)

`Badge` is a small non-interactive label. `hue` takes a palette hue or `"accent"`; `tone` takes a
status tone (`neutral`, `accent`, `success`, `warning`, `info`, `danger`). Variants: `soft`
(default), `outline`, `solid` (inverted). `dot` adds a coloured dot; `icon` adds an icon. The old
`Badge` from `field.tsx` still works and is the same component.

`Chip` is a small pressable pill (a filter, a suggestion, a concept link). It looks 28px tall and
has a 44px hit area on touch. `pressed` makes it a toggle.

```tsx
<Badge hue={CONCEPT_TYPE_HUE[type]}>{CONCEPT_TYPE_INFO[type].label}</Badge>
<Badge tone="danger" icon={<CircleAlert />}>Failed</Badge>
<Chip hue="teal" pressed={on} onClick={toggle}>Indication</Chip>
```

### SegmentedControl, Tabs (`segmented.tsx`)

`SegmentedControl` picks one of a few options (a radio group; arrow keys move). It always has a
value. `Tabs`, `TabList`, `Tab`, `TabPanel` switch panels in place (Radix Tabs). Both take a `look`:
`"segment"` (grey track, chosen item lifted; for view switches) or `"pill"` (separate pills, chosen
one filled with the accent; for tool tabs and filters). For tabs that are links (route changes), use
`segmentItemClass(selected, look)` on the `Link` inside a `role="tablist"` row.

```tsx
<SegmentedControl label="Theme" value={theme} onValueChange={setTheme}
  items={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />

<Tabs defaultValue="browse" look="pill">
  <TabList label="Concept tools"><Tab value="browse">Browse</Tab><Tab value="drill">Drill</Tab></TabList>
  <TabPanel value="browse"><Browse /></TabPanel>
  <TabPanel value="drill"><Drill /></TabPanel>
</Tabs>
```

### Tooltip (`tooltip.tsx`)

A short hint on hover or keyboard focus. Touch screens do not show it, so the control must already
have a name.

```tsx
<Tooltip content="Fit to screen"><IconButton label="Fit"><Maximize size={18} /></IconButton></Tooltip>
```

### Popover (`popover.tsx`)

A panel anchored to its trigger. Takes `label` (accessible name), optional `title`, `side`, `align`,
controlled `open`, `container` (mount point), `focusOnOpen` (off for previews) and `showClose`.
`floatingPanelClass` is the shared look for anything else that floats.

```tsx
<Popover label="Card colour" title="Colour" trigger={<IconButton label="Colour"><Palette /></IconButton>}>
  <HuePicker label="Card colour" value={card.color ?? null} onChange={setColour} />
</Popover>
```

### ActionMenu, ContextActions (`menu.tsx`)

Menus from a list of entries: `item`, `separator`, `label` and, new, `sub` (a nested menu).
`ActionMenu` opens from a button; `ContextActions` on right-click or long-press. For a menu with
custom item content, compose Radix `DropdownMenu` yourself with `menuContentClass`,
`menuItemClass(danger)` and `menuSeparatorClass`.

```tsx
<ActionMenu trigger={<IconButton label="More"><MoreHorizontal /></IconButton>} entries={[
  { type: "item", label: "Rename", icon: <Pencil size={16} />, onSelect: rename },
  { type: "sub", label: "Colour", entries: colourEntries },
  { type: "separator" },
  { type: "item", label: "Move to trash", danger: true, onSelect: trash },
]} />
```

### Sheet (`sheet.tsx`)

A modal surface that suits the screen. On the phone it is always a bottom sheet with a grab handle.
From tablet, `placement` decides: `"side"` (default; a panel from the right), `"center"` (a
centred dialog) or `"bottom"`. Also `wide`, `description`, `headerExtra`, `footer`, `container`,
`testId` and `flush` (no body padding). The layout switch is CSS only; do not pick a placement from
`useLayout()`.

```tsx
<Sheet open={open} onOpenChange={setOpen} title="Outline" placement="side" flush>
  <OutlineList />
</Sheet>
```

### Modal, ConfirmDialog (`dialog.tsx`)

`Modal` is a titled dialog with a footer: a bottom sheet on the phone (`sheet="phone"`) or on phone
and tablet (`sheet="touch"`). `ConfirmDialog` asks before something hard to undo; it names what it
affects. New props: `cancelLabel`, `container`, and `description` now takes any content.

```tsx
<ConfirmDialog open={open} onOpenChange={setOpen} title="Move to trash?"
  description="Beta blockers and its 3 pages move to the trash."
  confirmLabel="Move to trash" danger onConfirm={trash} />
```

### PageHeader (`page-header.tsx`)

The top of a screen: optional `back` link, `eyebrow`, `title`, `description`, `actions`, and an
`icon` in a tinted square (`hue`). Actions wrap under the title on the phone.

```tsx
<PageHeader title="Concepts" description="Drugs, classes and mechanisms from all your courses." />
```

### EmptyState, ErrorState, Spinner, Skeleton, LoadingList, LiveRegion (`states.tsx`)

`EmptyState` has an optional `icon` (tinted with `hue`, the accent by default), a `title`, text and
an `action`; `compact` for use inside a card. `ErrorState` shows a failed load with "Try again".
`Spinner` is a ring with a visible label (`inline` for use in a row). `LiveRegion` announces a
message to screen readers.

```tsx
<EmptyState icon={<BookOpen size={26} />} title="No documents yet" hue="blue" />
<Spinner label="Loading cards" />
```

### Notice (`notice.tsx`)

An inline message in the page: a soft tinted box with an icon, an optional title, text and an
optional action. `tone` is a status tone; `hue` overrides it. Danger is announced.

```tsx
<Notice tone="warning" title="Not checked yet">An agent added this concept.</Notice>
```

### StatTile (`stat.tsx`)

One number with its label, an optional icon, hint and `hue`.

```tsx
<StatTile label="Due today" value={12} icon={<CalendarCheck />} hue="blue" />
```

### ProgressBar (`progress.tsx`)

A labelled progress bar. `hue` colours the fill (accent by default), `size` is `sm` (6px) or `md`
(10px), `showValue` prints "3 of 10".

```tsx
<ProgressBar label="Session" value={answered} max={total} showValue />
```

### Switch (`switch.tsx`)

An on/off setting with its label and optional description. The row is the touch target.

```tsx
<Switch label="Show hints" checked={hints} onCheckedChange={setHints} />
```

### Disclosure (`disclosure.tsx`)

A section that opens and closes, with a chevron.

```tsx
<Disclosure label="Show working"><Working /></Disclosure>
```

### HuePicker (`hue-picker.tsx`)

A radio group of swatches with names, plus "No colour". Use for card, frame, course and highlighter
colours.

```tsx
<HuePicker label="Frame colour" value={frame.color ?? null} onChange={setFrameColour} />
```

### Field, TextInput, TextArea (`field.tsx`)

`Field` labels a control and wires its hint or error. `TextInput` and the new `TextArea` share
`inputClass`; an invalid field gets a red border.

```tsx
<Field label="Dose" error={error}>{(p) => <TextInput {...p} inputMode="decimal" />}</Field>
```

### Toasts (`toast.tsx`)

`useToast()` returns `show(message, action?)`, the new `success(message, action?)` and
`error(error)`. `error` takes any error; for a plain sentence pass `new Error("...")`.

### Not provided

There is no shared Select: no feature uses a native or custom select today. If one is needed, build
it on Radix `Select` with `menuContentClass` and `menuItemClass`, and add it here.

## Migration

Four workers move the features onto the foundation: documents, canvas, practice, and concepts with
requests. Each table lists every private custom property and private component, and what replaces
it. "Delete" means remove it with no replacement because the shared foundation already does the job.

General steps for every feature:

1. Replace private colour variables with tokens, using the table.
2. Remove the light block and both dark blocks for the deleted variables.
3. Replace private components with shared ones. Update imports.
4. Replace hard-coded `rounded-*`, `z-*`, durations and font sizes with the scales where the table
   says so.
5. Remove the feature's own `prefers-reduced-motion` block; the global one covers it.
6. Keep all wording as it is. Keep `data-testid`s.
7. Run the feature's tests, the contrast test and `/design` in light and dark at phone, tablet and
   computer widths.

### Documents (`features/documents/documents.css`, `features/documents/ui/primitives.tsx`)

Custom properties. The pattern covers all ten hues: gray, brown, red, orange, yellow, green, teal,
blue, purple, pink.

| Private | Replace with | Note |
| --- | --- | --- |
| `--doc-<hue>-fg` | `--hue-<hue>-text` | Red, orange and yellow are a touch darker in light; red is the danger colour in both themes. |
| `--doc-<hue>-bg` | `--hue-<hue>-soft` | Red soft is the danger soft in both themes. |
| `--doc-<hue>-border` | `--hue-<hue>-border` | Same values. |
| `--doc-<hue>-hl` | `--hue-<hue>-mark` | Same values. |
| `--doc-<hue>-solid` | `--hue-<hue>-solid` | Gray, brown, red, orange, yellow and pink solids are darker in light, to reach 3:1. |
| `--doc-paper` | `--color-surface` | |
| `--doc-sheet-shadow` | `--shadow-raised` | |
| `--doc-pop-shadow` | `--shadow-pop` | Tailwind: `shadow-pop`. |
| `--doc-focus` | `--color-selection` for the caret; focus rings already use the accent | |
| `--doc-scrim` | `--color-overlay` | |
| `.doc-tone` with `--t-fg`, `--t-bg`, `--t-border`, `--t-hl`, `--t-solid` | `data-hue={token ?? "gray"}` with `--tone-text`, `--tone-soft`, `--tone-border`, `--tone-mark`, `--tone-solid` | Delete `toneVars()` in `ui/hooks.ts`; set `data-hue` instead. In Tailwind, `text-[var(--t-fg)]` becomes `text-tone-text`, and so on. |

Rules in `documents.css`:

| Rule | Change |
| --- | --- |
| `.doc-root` (16.5px, 1.7) | Use `--text-reading` and `--text-reading--line-height` (17px, 1.7), or add `prose-reading` where the block is plain prose. Keep `-webkit-text-size-adjust`. |
| `.doc-root :focus-visible` | Delete; the global rule does the same. |
| `.doc-cite` | Colours from `DOCUMENT_HUE.citation` (`--hue-blue-*`). Active state: `background: var(--hue-blue-text); color: var(--hue-blue-soft)` (white on the solid failed AA). Trashed or deleted: `DOCUMENT_HUE.citationMissing`. Radius `--radius-pill`. |
| `.doc-concept` | `DOCUMENT_HUE.concept` (`--hue-teal-*`). |
| `.doc-hl` and its ten `[data-color]` rules | One rule: render `data-hue={color}` and use `background: var(--tone-mark)`; default `--hue-yellow-mark` (`DOCUMENT_HUE.highlight`). Radius `--radius-inline`. |
| `.doc-root a.doc-link` | `--hue-blue-text`. |
| `.doc-root code` | `--hue-gray-soft`, `--hue-gray-border`, `--radius-inline`, `--font-mono`. |
| `.doc-flag` | `DOCUMENT_HUE.flag` solid; dose, unit and decimal kinds `DOCUMENT_HUE.flagDose` solid. |
| `.doc-check` | Border `--hue-gray-solid`; checked `DOCUMENT_HUE.checked` solid. Keep the white tick (an icon, 3:1 is enough). |
| `.doc-quote-hit`, `.doc-flash` | `--hue-yellow-mark` and `--hue-yellow-solid`. Keep the keyframes. |
| `doc-pop-in`, `.doc-anim-pop` | `.anim-pop`. |
| `doc-sheet-up`, `.doc-anim-sheet` | `.anim-sheet` (or the Sheet component, which animates itself). |
| `doc-slide-in`, `.doc-anim-slide` | `.anim-slide-right`. |
| `doc-fade`, `.doc-anim-fade` | `.anim-fade`. |
| `@media (prefers-reduced-motion)` block | Delete. |
| `.doc-line`, `.doc-lines`, `.doc-block-body`, `.doc-sticky-col`, `.doc-scroll-x`, ProseMirror rules | Keep; layout only. Use `--z-raised` for `.doc-sticky-col`. |

Components in `ui/primitives.tsx`:

| Private | Replace with | Note |
| --- | --- | --- |
| `cx` | `cn` from `lib/cn` | Same behaviour. |
| `Button` `primary` | `Button variant="primary"` | |
| `Button` `subtle` | `Button variant="subtle"` | |
| `Button` `ghost` | `Button variant="ghost" className="text-text-muted hover:text-text"` | The shared ghost uses body text. |
| `Button` `outline` | `Button variant="secondary"` | Border is `border-strong`. |
| `Button` `danger` | `Button variant="danger"` | |
| `Button size="sm"` | `Button size="sm"` | 44px on touch, 32px on the computer. |
| `IconButton` (`label`, `variant`, `size`) | `IconButton` (`label`, `variant`, `size`) | Variants: ghost, subtle, `outline` becomes `secondary`, primary, `danger` becomes `ghostDanger`. |
| `Popover` | `Popover` | Same props; `label` is now required. |
| `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuSub`, `MenuSeparator`, `MenuLabel` | `ActionMenu` with `item`, `sub`, `separator` and `label` entries | Where an item has custom content (colour swatches), compose Radix `DropdownMenu` with `menuContentClass`, `menuItemClass`, `menuSeparatorClass`. The old uppercase `MenuLabel` look becomes the shared label. |
| `Sheet side="bottom"` | `Sheet placement="bottom"` | |
| `Sheet side="right"` | `Sheet placement="side"` | Drop the JS that picks bottom on the phone; the CSS does it. |
| `Sheet side="center"` | `Sheet placement="center"` | |
| `Sheet` body | `Sheet flush` | The old sheet had no body padding. |
| `ConfirmDialog` (`body`) | `ConfirmDialog` (`description`) | |
| `ToastProvider`, `useToast` (`show(message, { tone, action })`) | Shell `useToast()`: `show(message, action)`, `success(message, action)`, `error(new Error(message))` | Remove the feature's `ToastProvider`; the app already has one. |
| `ZoomableImage` | Keep. | |
| Block colours (`style.color`, `style.background`, callouts) | `data-hue`; callout default from `CALLOUT_HUE[kind]` | |
| `z-40`, `z-50`, `z-[60]`, `z-[61]`, `z-[70]` | `--z-overlay`, `--z-modal`, `--z-popover`, `--z-toast`; the format bar `--z-dock` | |
| `rounded-2xl` (popovers, menus) / `rounded-3xl` (sheets, dialogs) | `rounded-card` / `rounded-panel` | |
| `text-[13px]`, `text-[14px]`, `text-[17px]` | `text-label`, `text-ui`, `text-title` | |

### Canvas (`features/canvas/canvas.css`, `features/canvas/ui/primitives.tsx`, `ui/chrome.tsx`)

The canvas switches dark mode with its own `.nc-dark` class (set from `device.dark` in
`CanvasView.tsx`), not with the app's theme. Once its colours come from shared tokens, the canvas
follows the app's theme by itself. Remove `.nc-dark` and the `:root[data-theme="dark"] .nc-canvas`
block together.

| Private | Replace with | Note |
| --- | --- | --- |
| `--nc-bg` | `--color-bg` | |
| `--nc-dot` | `--color-dot` | |
| `--nc-card` | `--color-surface` | |
| `--nc-card-border` | `--color-border` | |
| `--nc-card-shadow` | `--shadow-card` | |
| `--nc-card-shadow-lift` | `--shadow-raised` | |
| `--nc-text` | `--color-text` | |
| `--nc-muted` | `--color-text-muted` | |
| `--nc-accent` | `--color-accent` | |
| `--nc-accent-contrast` | `--color-accent-contrast` | |
| `--nc-select` | `--color-selection` | Also `--xy-handle-border-color`, `--xy-selection-border`. |
| `--nc-frame-bg` | `color-mix(in srgb, var(--hue-gray-soft) 55%, transparent)` | Same mix as tinted frames. |
| `--nc-frame-border` | `--color-border-strong` | |
| `--nc-frame-title` | `--color-text` | |
| `--nc-chrome` | `--color-chrome` | |
| `--nc-chrome-border` | `--color-border` | |
| `--nc-chrome-hover` | `--color-surface-muted` | |
| `--nc-label-bg` | `--color-surface` | |
| `--tint-<hue>-bg` | `--hue-<hue>-soft` | All ten hues. |
| `--tint-<hue>-border` | `--hue-<hue>-border` | |
| `--tint-<hue>-accent` | `--hue-<hue>-text` | |
| `[data-tint="<hue>"]` rules and `--tint-bg`, `--tint-border`, `--tint-accent` | `data-hue="<hue>"` and `--tone-soft`, `--tone-border`, `--tone-text` | Delete the ten rules. `[data-tint]` selectors become `[data-hue]`. |
| `--card-bg`, `--card-border`, `--frame-bg`, `--frame-border`, `--card-max`, `--edge-color` | Keep as local plumbing, but feed them from tone tokens | |
| `--edge-<kind>` (six kinds) | `var(--hue-${CONNECTOR_HUE[kind]}-solid)` for lines; `-text` for label text and the `.nc-kind` buttons | Set `--edge-color` from `hueVar(CONNECTOR_HUE[kind], ...)`. |
| `--st-yellow`, `--st-red`, `--st-blue`, `--st-green`, `--st-pink`, `--st-orange` | `--hue-<colour>-solid` | Sticker art. If a sticker looks dull, keep its own colour and say why in a comment. |
| `--st-ink` | `--color-text` | |
| `--st-paper` | `--color-surface` | |
| `--xy-selection-background-color` (`rgb(47 111 219 / 0.08)`) | `color-mix(in srgb, var(--color-selection) 8%, transparent)` | Same for `.nc-drop-target` and `.nc-edge-label.nc-selected`. |
| `.nc-btn.nc-danger` colours | `--color-danger` | |

Rules and components:

| Private | Replace with | Note |
| --- | --- | --- |
| `.nc-card` radius 14px | `--radius-card` | |
| `.nc-frame` radius 22px | `--radius-panel` | |
| `.nc-callout`, `.nc-chip`, `.nc-concept-dot`, `.nc-frame-step` | Tone tokens (`--tone-*`); callout hue from `CALLOUT_HUE` | `.nc-concept-dot` and `.nc-frame-step` already invert (text as fill); keep that. |
| `.nc-chip` | `Badge` where it is plain React | Inside card bodies that render without React components, keep the class on tone tokens. |
| `IconButton` (`icon`, `label`, `showLabel`, `pressed`, `danger`) | Shared `IconButton` (`label`, `pressed`, `variant="ghostDanger"`) for icon-only; `Button variant="ghost"` with icon and text when `showLabel` | Wrap icon-only ones in `Tooltip` instead of `title`. The `.nc-btn` 44px size matches. |
| `Popover` + `PortalContext` | Shared `Popover` with `container` | With shared tokens the portal no longer has to sit inside `.nc-canvas`; drop `PortalContext` if nothing else needs it. |
| `ConfirmDialog` (`body`, `confirm`, `onCancel`) | Shared `ConfirmDialog` (`description`, `confirmLabel`, `onOpenChange`) | Delete `.nc-dialog*`. |
| `.nc-seg` | `SegmentedControl` | For connector direction and line style pickers. |
| `.nc-swatch`, `.nc-swatch-none` | `HuePicker` | |
| `.nc-kind` | `Chip hue={CONNECTOR_HUE[kind]} pressed={...}` | |
| `.nc-toast` | Shell `useToast()` | If the toast must sit over the canvas, keep the element but use `--color-chrome`, `--radius-card`, `--z-toast`. |
| `.nc-spinner` | `Spinner inline` | |
| `.nc-sr` | Tailwind `sr-only` | |
| `.nc-chrome`, `.nc-toolbar`, `.nc-topbar`, `.nc-panel`, `.nc-stepbar`, `.nc-editor`, `.nc-hint`, `.nc-arranging` | Keep the layout; use `--color-chrome`, `--color-border`, `--shadow-pop`, `--radius-card`, and `z-index: var(--z-raised)` | Their z-indexes (10 to 20) stay inside the canvas stacking context. |
| `.nc-popover` z 50, `.nc-dialog-overlay` 60, `.nc-dialog` 61, edge labels 1000 | `--z-popover`, `--z-overlay`, `--z-modal`; edge labels stay local | |
| Font sizes 11 to 18px | `--text-caption` (11 and 12px), `--text-label` (12.5, 13px), `--text-ui` (14px), `--text-body` (15px), `--text-title` (17, 18px) | Card text stays 14px. |
| Transitions 0.12 to 0.25s | `--duration-fast` and `--duration-base` | |
| `@media (prefers-reduced-motion)` block | Delete. | |

### Practice (`features/practice/practice.css`, `features/practice/ui/primitives.tsx`)

| Private | Replace with | Note |
| --- | --- | --- |
| `--pr-correct`, `--pr-correct-bg`, `--pr-correct-border` | `FEEDBACK_HUE.correct`: `--hue-green-text`, `-soft`, `-border` | |
| `--pr-wrong`, `--pr-wrong-bg`, `--pr-wrong-border` | `FEEDBACK_HUE.incorrect`: `--hue-red-text`, `-soft`, `-border` | |
| `--pr-partial`, `--pr-partial-bg`, `--pr-partial-border` | `FEEDBACK_HUE.partial`: `--hue-yellow-text`, `-soft`, `-border` | |
| `--pr-accent-soft` | `--color-accent-soft` | Nearly the same value. |
| `--pr-shadow` | `--shadow-card` | |
| `--pr-link-1` to `--pr-link-6` | `seriesHue(n - 1)` with `data-hue`: fill `--tone-text`, text `--tone-soft` | Inverted, so the pair number passes AA. |
| `--pr-link-ink` | `--tone-soft` | |
| `--pr-top`, `--pr-bottom`, `--pr-vh`, `--pr-vt` | Keep | Layout only. |
| `.pr-card` | `Card padding="none"` (or `className="rounded-card ..."` where a plain class is needed) | |
| `.pr-ok`, `.pr-bad`, `.pr-part` | `data-hue={FEEDBACK_HUE.x}` with `border-tone-border bg-tone-soft text-tone-text` | `Notice` for whole messages. |
| `.pr-focus` and the `:focus-visible` rule | Delete; the global rule covers it. | |
| `.pr-fade` | `.anim-fade` | |
| `.pr-rise` | `.anim-pop` | |
| `.pr-num` | `rounded-inline bg-accent-soft` with `font-semibold tabular-nums` | |
| `.pr-flip*` | Keep; use `--duration-slow` and `--ease-calm` | Remove its reduced-motion block. |
| `.pr-scroll` | Keep. | |

| Private component | Replace with | Note |
| --- | --- | --- |
| `Button` `primary`, `secondary`, `ghost` | Shared `Button`, same variant | |
| `Button` `quiet` | `Button variant="ghost" className="text-text-muted hover:text-text"` | |
| `Button size` `sm`, `md`, `lg` | Shared `size` | `lg` is 48px (was 52px). |
| `Card` (`as`) | `Card` (`as`, `padding="none"`) | |
| `Chip` (`tone` ok, bad, part, accent, neutral) | `Badge hue={FEEDBACK_HUE.correct}` (ok), `.incorrect` (bad), `.partial` (part), `tone="accent"`, `tone="neutral"` | |
| `ProgressBar` (`color`) | `ProgressBar` (`hue`, `size="sm"`) | Pass a hue name instead of a CSS colour. |
| `ConfirmDialog` (`cancelLabel`) | Shared `ConfirmDialog` with `cancelLabel` | |
| `Disclosure` | Shared `Disclosure` | Chevron icon instead of "⌄". |
| `Empty` | `EmptyState` without `icon`, `headingLevel={3}`, `compact` | |
| `Announce` | `LiveRegion testId="announcer"` | Keeps the test id. |
| `Spinner` | Shared `Spinner` | |
| `ErrorNote` | `Notice tone="danger" action={...}` | |
| `SelfGraded` rating buttons | Keep the buttons; when pressed use `data-hue={RATING_HUE[rating]}` with `border-tone-border bg-tone-soft` | |
| `SourceChips` buttons | `Chip` (accent text) | |
| Overlays at `z-[60]`, `z-[61]`, `z-[70]`, `z-[71]`, Player `z-50` | `--z-overlay`, `--z-modal`; the full-screen player `--z-dock` | `ExamForm` (in `features/exams`) can become a `Sheet placement="center"`. |
| `bg-black/40` backdrops | `bg-(--color-overlay)` | |
| `text-[0.95rem]` | `text-ui` or `text-body` | |

### Concepts (`features/concepts/concepts.css`, `ui/tone.ts`, `ui/parts.tsx`)

| Private | Replace with | Note |
| --- | --- | --- |
| `--cx-green-bg`, `--cx-green-fg` | `--hue-green-soft`, `--hue-green-text` | |
| `--cx-blue-bg`, `--cx-blue-fg` | `--hue-blue-soft`, `--hue-blue-text` | |
| `--cx-violet-bg`, `--cx-violet-fg` | `--hue-purple-soft`, `--hue-purple-text` | |
| `--cx-teal-bg`, `--cx-teal-fg` | `--hue-teal-soft`, `--hue-teal-text` | |
| `--cx-red-bg`, `--cx-red-fg` | `--hue-red-soft`, `--hue-red-text` | |
| `--cx-amber-bg`, `--cx-amber-fg` | `--color-warning-soft`, `--color-warning` (orange) | Used for "unverified" and moderate severity. |
| `--cx-grey-bg`, `--cx-grey-fg` | `--hue-gray-soft`, `--hue-gray-text` | |
| `TONE_CLASS`, `toneOf` (`ui/tone.ts`), `TYPE_TONE` (`model/relations.ts`) | `CONCEPT_TYPE_HUE` with `data-hue` or a component's `hue` | Delete `tone.ts` and `TYPE_TONE`. Colour changes: target violet to pink, interaction amber to orange, monitoring_parameter teal to blue, counselling_point amber to yellow. |
| `tests/model.test.ts` contrast check on `--cx-*` | Delete that case | `test/contrast.test.ts` covers every hue. |
| `.cx-hit` | `.hit-area` | |
| `.cx-nudge` | Keep (the wrong-pair shake). | |
| `.cx-flow` React Flow rules | Keep; already on shared tokens. | |

| Private component | Replace with | Note |
| --- | --- | --- |
| `TypeBadge` | `Badge hue={CONCEPT_TYPE_HUE[type]}` with `CONCEPT_TYPE_INFO[type].label` | |
| `Card` (`ui/parts.tsx`) | `Card as="section"` | Radius goes from 24px to 16px. |
| `Chip` with `onRemove` | Keep, restyled with `rounded-pill`, `text-label` and the shared `IconButton size="sm"` for the remove button | No shared removable chip. |
| `CiteChip` | Keep; `cx-hit` becomes `hit-area`, `rounded-full` becomes `rounded-pill` | |
| `ConceptsIndex` tab bar | `Tabs look="pill"` with `TabList`, `Tab`, `TabPanel` | Keep the ids if tests use them. |
| `Finder` and `Drill` radio groups | `SegmentedControl` where it is one choice of two to five short options; otherwise keep | |
| `ConceptView` severity classes | `Badge hue={SEVERITY_HUE[severity]}` | |
| `ConceptView` amber "unverified" card | `Notice tone="warning"` | |
| `Drill` matched / wrong states | `data-hue={FEEDBACK_HUE.correct}` / `.incorrect` with tone utilities | |
| Hand-made page title | `PageHeader` | |
| `demo/main.tsx` theme pills, `z-[80]` | `SegmentedControl look="pill"`, `--z-toast` | Demo only. |

### Requests (`features/requests/requests.css`, `ui/parts.tsx`, `ui/form.tsx`)

| Private | Replace with | Note |
| --- | --- | --- |
| `--rq-amber-bg`, `--rq-amber-fg` | `--hue-orange-soft`, `--hue-orange-text` (via `REQUEST_STATUS_HUE.declined`) | |
| `.rq-spin` | `.anim-spin` | |
| `StatusPill` and its `TONE` map, `statusTone()` | `Badge hue={REQUEST_STATUS_HUE[status]} icon={STATUS_ICON[status]}` | Keep `data-testid="status"` and `data-status` on a wrapper or pass them through. "Done" was a solid accent pill; it becomes a green soft badge (use `variant="solid"` to keep it bold). In progress becomes blue. |
| `KindTag` | `Badge` | |
| `KindPicker` toggle buttons | `Chip pressed={checked}` | Keep tapping again to clear. |
| `LinkChip` | `Chip hue="accent"` | |
| `Note` | `Notice tone="accent"` | |
| `demo/main.tsx` | As concepts. | Demo only. |

### Shell and other screens (optional, small)

Not part of the four migrations, but worth doing when someone is nearby:

- `app/ThemeSwitch.tsx` becomes a `SegmentedControl look="pill"` (its look already matches).
- `mounts/DocScreen.tsx` Page/Canvas links use `segmentItemClass`.
- `sources/SourceViewer.tsx` Page/Transcript tabs use `SegmentedControl` or `Tabs`.
- `library/LibraryTree.tsx` `FileStatusBadge` uses `Badge hue={FILE_STATUS_HUE[status]}`.
- `settings/SettingsPage.tsx` local `Card` uses `Card` and `CardTitle`.
- `AppShell.tsx` skip link `z-[70]` becomes `z-(--z-skip)`; tab bar `z-30` becomes `z-(--z-nav)`.
- `uploads/UploadTray.tsx` `z-[55]` becomes `z-(--z-float)`.
- `search/QuickFind.tsx` overlay and panel use `--z-overlay` and `--z-modal`.
- Course and folder icons use `hueForId(node.id)`.
