import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ThemeSwitch } from "../src/app/ThemeSwitch";
import { THEME_KEY } from "../src/app/theme";

test("theme switch sets data-theme, persists, and returns to system", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitch />);
  const html = document.documentElement;

  expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "Dark" }));
  expect(html.dataset.theme).toBe("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");

  await user.click(screen.getByRole("button", { name: "Light" }));
  expect(html.dataset.theme).toBe("light");

  await user.click(screen.getByRole("button", { name: "System" }));
  expect(html.dataset.theme).toBeUndefined();
  expect(localStorage.getItem(THEME_KEY)).toBeNull();
});

test("restores a stored choice on mount", () => {
  localStorage.setItem(THEME_KEY, "dark");
  render(<ThemeSwitch />);
  expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  expect(document.documentElement.dataset.theme).toBe("dark");
});
