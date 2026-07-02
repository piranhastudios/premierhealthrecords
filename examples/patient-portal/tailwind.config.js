/** @type {import('tailwindcss').Config} */
// PHC brand palette — derived from the Premier Health logo (warm orange/red/gold).
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        phc: {
          orange: '#EE6A1F', // primary
          ember: '#C24E12', // pressed / dark accent
          red: '#E0231F', // brand swoosh accent
          gold: '#F7A91E', // secondary accent
        },
        surface: {
          bg: '#FBF8F5',
          card: '#FFFFFF',
          muted: '#F3ECE6',
        },
        ink: {
          DEFAULT: '#1A1110',
          secondary: '#6B5B53',
          faint: '#9A8B82',
        },
        line: '#EFE6DF',
        status: {
          success: '#1F9D55',
          warn: '#F7A91E',
          error: '#D11A14',
        },
      },
      borderRadius: {
        card: '20px',
        pill: '999px',
        field: '14px',
      },
      fontFamily: {
        sans: ['Inter', 'System'],
      },
    },
  },
  plugins: [],
};
