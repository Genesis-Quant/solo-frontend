import { create } from "zustand";

type Theme = "light" | "dark";
type AppStore = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const storedTheme: Theme = localStorage.getItem("solo.theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = storedTheme;

export const useAppStore = create<AppStore>((set) => ({
  theme: storedTheme,
  setTheme: (theme) => {
    localStorage.setItem("solo.theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  }
}));
