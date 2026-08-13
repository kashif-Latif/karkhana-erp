import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F6F4EF",
        surface: "#FFFFFF",
        cream: "#F7F2E8",
        panel: "#F1EEE9",
        line: "#EAE5DD",
        ink: "#141414",
        muted: "#857C72",
        hint: "#B4ABA0",
        salmon: { DEFAULT: "#EBA98F", soft: "#F5D9CE", strong: "#E1876B" },
        amber: { DEFAULT: "#EFD0A6", soft: "#F7EAD3", strong: "#E4B47E" },
        lavender: { DEFAULT: "#D2B9EA", soft: "#ECE1F6", strong: "#B693DD" },
        periwinkle: { DEFAULT: "#A6C0E6", soft: "#DCE7F5", strong: "#7FA3DC" },
        pink: { DEFAULT: "#EDA6D0", soft: "#F8DCEE", strong: "#E07FBE" },
        success: { DEFAULT: "#7FC489", soft: "#E9F6EC" },
        danger: { DEFAULT: "#E5786B", soft: "#FCEAE7" },
      },
      borderRadius: { card: "22px", xl2: "18px" },
      boxShadow: {
        card: "0 10px 30px rgba(20,16,12,0.05)",
        soft: "0 2px 8px rgba(20,16,12,0.04)",
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
