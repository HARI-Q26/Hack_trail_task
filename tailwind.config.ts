import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        kit: {
          primary: "#0E625E",
          "primary-dark": "#094340",
          "primary-light": "#15827D",
          accent: "#F47F20",
          "accent-dark": "#D66710",
          "accent-light": "#FFA04D",
          bg: "#F2F7F8",
          card: "#FFFFFF",
          muted: "#6B7280",
          border: "#E2E8F0",
        },
      },
    },
  },
  plugins: [],
};
export default config;
