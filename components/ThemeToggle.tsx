"use client";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

// Small light/dark switch. Persists to localStorage ("kk-theme") and toggles
// the `dark` class on <html>. The no-flash script in layout.tsx reads the same key.
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("kk-theme", next ? "dark" : "light"); } catch { /* ignore */ }
    setDark(next);
  }
  return (
    <button
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      className={`flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink transition hover:bg-panel dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/[0.12] ${className}`}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
