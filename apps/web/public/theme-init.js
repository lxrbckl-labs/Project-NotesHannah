// Applies a stored light/dark choice before first paint (avoids a flash).
try {
  const stored = localStorage.getItem("notes-theme");
  if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
} catch {
  // storage unavailable: follow the system preference
}
