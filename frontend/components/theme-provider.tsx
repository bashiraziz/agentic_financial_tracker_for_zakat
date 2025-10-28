"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "mid" | "dark";
export type ThemeMode = Theme;

type ThemeContextValue = {
  theme: Theme;
  setTheme: (nextTheme: Theme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "aft-theme-preference";

const ThemeContext = createContext<ThemeContextValue | null>(null);

const KNOWN_THEMES: Theme[] = ["light", "mid", "dark"];

const getPreferredTheme = (): Theme => {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && KNOWN_THEMES.includes(stored as Theme)) {
    return stored as Theme;
  }
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
};

const applyThemeAttribute = (theme: Theme) => {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const preferred = getPreferredTheme();
    setThemeState(preferred);
  }, []);

  useEffect(() => {
    applyThemeAttribute(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && KNOWN_THEMES.includes(stored as Theme)) {
        return;
      }
      setThemeState(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((previous) => {
      const index = KNOWN_THEMES.indexOf(previous);
      const nextIndex = (index + 1) % KNOWN_THEMES.length;
      return KNOWN_THEMES[nextIndex];
    });
  }, []);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
};
