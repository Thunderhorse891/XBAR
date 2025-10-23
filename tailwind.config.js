module.exports = {
  content: ["\*/**/.*/*/*[.ts\}]", "src/**/*.jsx"],
  theme: {
    extend: {
      colors: {
        primary: "#1a365d",
        secondary: "#2d3748",
        accent: "#3182ce",
        success: "#38a169",
        warning: "#d69e2e",
        error: "#e53e3e",
      },
      fontFamily: {
        heading: ["Inter", "sans-serif"],
        body: ["Inter", "sans-serif"]
      }
    }
  }
};