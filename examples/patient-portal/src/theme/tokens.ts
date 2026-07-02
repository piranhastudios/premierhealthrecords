// PHC design tokens (imperative copy of tailwind.config.js for gradients, charts,
// and any place that needs raw color values rather than utility classes).
// Palette is derived from the Premier Health logo: warm orange / red / gold.

export const colors = {
  orange: '#EE6A1F', // primary
  ember: '#C24E12', // pressed / dark accent
  red: '#E0231F', // brand swoosh accent
  gold: '#F7A91E', // secondary accent
  bg: '#FBF8F5',
  card: '#FFFFFF',
  muted: '#F3ECE6',
  ink: '#1A1110',
  inkSecondary: '#6B5B53',
  inkFaint: '#9A8B82',
  line: '#EFE6DF',
  success: '#1F9D55',
  warn: '#F7A91E',
  error: '#D11A14',
  white: '#FFFFFF',
} as const;

/** 135° warm sunrise — headers, hero, ID-card face. */
export const heroGradient = {
  colors: [colors.gold, colors.orange, colors.red] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

/** Deep orange→red for the ID card. */
export const cardGradient = {
  colors: [colors.orange, colors.red] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

export const radius = { field: 14, card: 20, pill: 999 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const cardShadow = {
  shadowColor: colors.ember,
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;
