/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Darwynn brand — teal from the logo
        brand: {
          DEFAULT: "#00B2D8",
          dark:    "#0093B8",
          darker:  "#006D8F",
          // Alias for readable surfaces (nav bars, panels)
          surface: "#0f172a",
        },
      },
      animation: {
        "fade-in":  "fadeIn 0.15s ease-in-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        slideUp: { "0%": { transform: "translateY(20px)", opacity: 0 }, "100%": { transform: "translateY(0)", opacity: 1 } },
      },
    },
  },
  plugins: [],
};
