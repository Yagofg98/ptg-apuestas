/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Verde pádel + fondo oscuro tipo casa de apuestas nocturna
        padel: {
          50: "#e7f7ee",
          400: "#22c55e",
          500: "#16a34a",
          600: "#0a7d3c",
          700: "#076a33",
        },
        ink: {
          900: "#0b1120",
          800: "#111827",
          700: "#1f2937",
          600: "#374151",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
