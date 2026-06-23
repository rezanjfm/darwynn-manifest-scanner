/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#00B2D8",
          dark:    "#0093B8",
          darker:  "#006D8F",
          light:   "#33C4E0",
          surface: "#0f172a",
        },
      },
      animation: {
        "fade-in":     "fadeIn 0.15s ease-in-out",
        "slide-up":    "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)",
        "slide-down":  "slideDown 0.22s cubic-bezier(0.32,0.72,0,1)",
        "count-bump":  "countBump 0.4s cubic-bezier(0.34,1.56,0.64,1)",
        "ring-1":      "ringPulse 2.2s ease-out infinite",
        "ring-2":      "ringPulse 2.2s ease-out 0.7s infinite",
        "glow-idle":   "glowIdle 3s ease-in-out infinite",
        "scan-line":   "scanLine 1.8s ease-in-out infinite",
        "hid-ring":    "hidRing 1.6s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { transform: "translateY(24px)", opacity: "0" },
          "100%": { transform: "translateY(0)",    opacity: "1" },
        },
        slideDown: {
          "0%":   { transform: "translateY(-110%)", opacity: "0" },
          "100%": { transform: "translateY(0)",     opacity: "1" },
        },
        countBump: {
          "0%":   { transform: "scale(1)" },
          "45%":  { transform: "scale(1.22)" },
          "100%": { transform: "scale(1)" },
        },
        ringPulse: {
          "0%":   { transform: "scale(1)",    opacity: "0.5" },
          "100%": { transform: "scale(1.55)", opacity: "0"   },
        },
        glowIdle: {
          "0%, 100%": { boxShadow: "0 0 24px rgba(0,178,216,0.20), 0 8px 32px rgba(0,0,0,0.4)" },
          "50%":      { boxShadow: "0 0 48px rgba(0,178,216,0.40), 0 8px 32px rgba(0,0,0,0.4)" },
        },
        scanLine: {
          "0%":   { top: "6px",              opacity: "0.9" },
          "45%":  { top: "calc(100% - 8px)", opacity: "0.9" },
          "50%":  { top: "calc(100% - 8px)", opacity: "0" },
          "55%":  { top: "6px",              opacity: "0" },
          "60%":  { top: "6px",              opacity: "0.9" },
          "100%": { top: "6px",              opacity: "0.9" },
        },
        hidRing: {
          "0%, 100%": { transform: "scale(1)",    opacity: "0.6" },
          "50%":      { transform: "scale(1.08)", opacity: "0.3" },
        },
      },
      boxShadow: {
        "brand":     "0 0 0 1px rgba(0,178,216,0.3), 0 8px 32px rgba(0,178,216,0.2)",
        "brand-lg":  "0 0 0 1px rgba(0,178,216,0.3), 0 16px 64px rgba(0,178,216,0.25)",
        "card":      "0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 3px rgba(0,0,0,0.5)",
        "card-hover":"0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 16px rgba(0,0,0,0.4)",
      },
    },
  },
  plugins: [],
};
