export const colors = {
  background: '#0C1015',
  surface: '#1A2029',
  surfaceElevated: '#242C37',
  border: '#303A46',
  text: '#F5F7FA',
  textSecondary: '#A2ADB9',
  textMuted: '#89939E',
  primary: '#79C4FF',
  onPrimary: '#0C1015',
  tabBar: '#0C1015',
  tabActive: '#79C4FF',
  tabInactive: '#A2ADB9',
  status: {
    watching: '#4A91E2',
    caughtUp: '#35BD83',
    completed: '#E8BD64',
    dropped: '#E56D75',
    plan: '#89939E',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const typography = {
  hero: {
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
};

export const theme = {
  colors,
  spacing,
  radii,
  typography,
};

export default theme;
