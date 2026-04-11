/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        uw: {
          bg: "hsl(var(--uw-bg))",
          surface: "hsl(var(--uw-surface))",
          panel: "hsl(var(--uw-panel))",
          border: "hsl(var(--uw-border))",
          "border-subtle": "hsl(var(--uw-border-subtle))",
          input: "hsl(var(--uw-input))",
          hover: "hsl(var(--uw-hover))",
          selected: "hsl(var(--uw-selected))",
          text: "hsl(var(--uw-text))",
          "text-secondary": "hsl(var(--uw-text-secondary))",
          muted: "hsl(var(--uw-muted))",
          accent: "hsl(var(--uw-accent))",
          "accent-muted": "hsl(var(--uw-accent-muted))",
          error: "hsl(var(--uw-error))",
          success: "hsl(var(--uw-success))",
          warning: "hsl(var(--uw-warning))",
        },
      },
      fontFamily: {
        sans: [
          "'Inter'",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
      fontSize: {
        "2xs": "10px",
        xs: "11px",
        sm: "12px",
        base: "13px",
        lg: "15px",
        xl: "18px",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "uw-sm":
          "0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)",
        "uw-md":
          "0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
        "uw-lg":
          "0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
        "uw-glow":
          "0 0 20px rgba(99,120,255,0.08), 0 4px 12px rgba(0,0,0,0.4)",
      },
      keyframes: {
        "pulse-border": {
          "0%, 100%": { borderColor: "hsl(var(--uw-accent) / 0.4)" },
          "50%": { borderColor: "hsl(var(--uw-accent) / 0.8)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        spin: {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "pulse-border": "pulse-border 2s ease-in-out infinite",
        "fade-in": "fade-in 0.2s ease-out",
        spin: "spin 1s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
