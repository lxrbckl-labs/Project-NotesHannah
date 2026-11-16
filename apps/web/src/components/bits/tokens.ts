/*
 * Shared helpers for the React Bits components (not part of upstream).
 * Components that paint in JavaScript (canvas, WebGL) cannot use `var(--color-*)`, so they read
 * the resolved value of a token here and re-read it when the theme changes.
 * Components that paint with CSS should use `var(--color-*)` directly and not need this file.
 */
import { useSyncExternalStore } from "react";

const root = () => (typeof document === "undefined" ? null : document.documentElement);

/** Resolved value of a CSS custom property on the root, e.g. readToken("--color-accent"). */
export function readToken(name: string, fallback = ""): string {
  const el = root();
  if (!el || typeof getComputedStyle === "undefined") return fallback;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** True when the dark theme is showing: data-theme="dark", or no forced light and the system prefers dark. */
export function isDarkTheme(): boolean {
  const el = root();
  if (!el) return false;
  const forced = el.dataset.theme;
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** True when the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const el = root();
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(onChange);
  if (el)
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  media?.addEventListener?.("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.("change", onChange);
  };
}

/** Re-renders when the theme changes. Returns "dark" or "light". */
export function useThemeMode(): "dark" | "light" {
  return useSyncExternalStore(
    subscribe,
    () => (isDarkTheme() ? "dark" : "light"),
    () => "light",
  );
}

/**
 * Resolved value of one token, kept current across theme changes.
 * Example: const accent = useToken("--color-accent", "#2f6f5e").
 */
export function useToken(name: string, fallback = ""): string {
  return useSyncExternalStore(
    subscribe,
    () => readToken(name, fallback),
    () => fallback,
  );
}
