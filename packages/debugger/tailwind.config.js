/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        uw: {
          bg: "#0A0A0F",
          panel: "#12121A",
          border: "#1E1E2E",
          input: "#08080D",
          hover: "#10101A",
          selected: "#14141E",
          text: "#E2E2E8",
          muted: "#6B6B80",
          accent: "#7C8AFF",
          error: "#C05B5B",
          success: "#4A8A6A",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
      fontSize: {
        xs: "10px",
        sm: "12px",
        base: "14px",
        lg: "16px",
      },
    },
  },
  plugins: [],
};
