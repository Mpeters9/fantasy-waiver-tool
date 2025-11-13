/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fantasyGreen: "#10B981",
        fantasyBlue: "#3B82F6",
      },
    },
  },
  plugins: [],
};
