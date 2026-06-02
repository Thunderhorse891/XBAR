module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        xbar: {
          bg: "#f4f1ec",
          surface: "#fffdf9",
          text: "#201d1a",
          muted: "#756a5f",
          border: "#e3dbd0",
          rail: "#312a24",
          accent: "#3d6b4f",
          copper: "#8b5e3c",
        },
      },
      fontFamily: {
        sans: ["Outfit", "\"Avenir Next\"", "\"Futura PT\"", "\"Segoe UI Variable Text\"", "sans-serif"],
      },
      boxShadow: {
        xbar: "0 20px 40px rgba(31, 26, 22, 0.08), 0 4px 14px rgba(31, 26, 22, 0.05)",
        "xbar-soft": "0 10px 26px rgba(31, 26, 22, 0.06)",
      },
      borderRadius: {
        xbar: "8px",
      },
    },
  },
  plugins: [],
}
