import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#ffffff",
        surface: "#fafafa",
        surfaceAlt: "#f4f4f5",
        border: "#e4e4e7",
        borderStrong: "#d4d4d8",
        text: "#18181b",
        textSecondary: "#52525b",
        muted: "#71717a",
        accent: "#4f46e5",
        accentHover: "#4338ca",
        accentSoft: "#eef2ff",
        success: "#059669",
        successSoft: "#ecfdf5",
        warn: "#d97706",
        warnSoft: "#fffbeb",
        error: "#dc2626",
        errorSoft: "#fef2f2",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
