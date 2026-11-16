import type { SVGProps } from "react";

/** Line icons for the canvas chrome (24×24, stroke = currentColor). */
const PATHS = {
  select: "M5 3l14 8-6 2-2 6z",
  hand: "M8 13V5.5a1.5 1.5 0 013 0V12m0-1V4.5a1.5 1.5 0 013 0V12m0-1V6.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-4.6-2.2L4.3 15a1.5 1.5 0 012.3-1.9L8 15",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5",
  sticker: "M12 3a9 9 0 109 9h-5a4 4 0 01-4-4zM8.5 13.5s1 2 3.5 2M9 9.5h.01",
  connect: "M5 19C5 11 11 6 19 6M15 2.5L19 6l-4 3.5M5 21a2 2 0 100-4 2 2 0 000 4z",
  frame: "M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 9h8v6H8z",
  arrange: "M4 5h6v5H4zM14 5h6v5h-6zM4 14h6v5H4zM14 14h6v5h-6z",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  play: "M7 4.5v15l12-7.5z",
  zoomIn: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M11 8v6M8 11h6",
  zoomOut: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8 11h6",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  focus: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  page: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v8",
  unpin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v8M4 4l16 16",
  open: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  read: "M3 6c3-1.5 6-1.5 9 0v14c-3-1.5-6-1.5-9 0zM21 6c-3-1.5-6-1.5-9 0v14c3-1.5 6-1.5 9 0z",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  close: "M6 6l12 12M18 6L6 18",
  map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15",
  plus: "M12 5v14M5 12h14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  palette:
    "M12 3a9 9 0 000 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 004-4c0-4.5-4-8-9-8zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
  alignLeft: "M4 3v18M8 7h12v4H8zM8 14h7v4H8z",
  alignTop: "M3 4h18M7 8h4v12H7zM14 8h4v7h-4z",
  alignCenter: "M12 3v18M6 7h12v4H6zM8.5 14h7v4h-7z",
  distribute: "M4 4v16M20 4v16M9 8h6v8H9z",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  ungroup: "M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M4 4l16 16",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
