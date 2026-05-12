export const colors = {
  brand: {
    50: "#EEF2FF",
    100: "#E0E7FF",
    200: "#C7D2FE",
    500: "#1B2B65",
    600: "#152253",
    700: "#0F1940",
    800: "#0A1130",
  },
  success: { 50: "#F0FDF4", 100: "#DCFCE7", 500: "#22C55E", 700: "#15803D" },
  warning: { 50: "#FFFBEB", 100: "#FEF3C7", 500: "#F59E0B", 700: "#B45309" },
  danger:  { 50: "#FFF1F2", 100: "#FFE4E6", 500: "#EF4444", 700: "#B91C1C" },
  info:    { 50: "#EFF6FF", 100: "#DBEAFE", 500: "#3B82F6", 700: "#1D4ED8" },
  canvas: "#EEF2F7",
  surface: "#FFFFFF",
  border: { light: "#E2E8F0", medium: "#CBD5E1", strong: "#94A3B8" },
  text: {
    primary: "#1C2B3A",
    secondary: "#6B7A99",
    tertiary: "#9CA3AF",
    inverse: "#FFFFFF",
    link: "#2563EB",
  },
  neutral: {
    50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0",
    300: "#CBD5E1", 400: "#94A3B8", 500: "#64748B",
    600: "#475569", 700: "#334155", 800: "#1E293B", 900: "#0F172A",
  },
} as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 } as const;
export const shadow = {
  card: "0 2px 8px rgba(27,43,101,0.07)",
  modal: "0 8px 24px rgba(15,25,64,0.18)",
  elevated: "0 4px 12px rgba(27,43,101,0.12)",
} as const;
