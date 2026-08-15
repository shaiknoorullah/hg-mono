// GENERATED — do not hand-edit. Run `node scripts/generate.mjs` in @hg/design-tokens.

export const fontFamily = {
  sans: ["Plus Jakarta Sans","-apple-system","BlinkMacSystemFont","Segoe UI","Roboto","Helvetica Neue","Arial","sans-serif"],
} as const;

export const colorLight = {
  primary: "#C1272D",
  primary2: "#9E1E23",
  tint: "#FBE7E4",
  on: "#FFFFFF",
  canvas: "#F5F0EC",
  card: "#FFFFFF",
  ink: "#231A17",
  ink2: "#877A74",
  ink3: "#B7ABA4",
  hair: "#ECE3DD",
  promo: "#D81E6A",
  seal: "#0A5233",
  seal2: "#12784A",
  sealTint: "#E6F1EB",
  sealLine: "#C8E4D6",
  ring: "#F3ECDE",
  link: "#1F6FEB",
  rate: "#1E2A22",
  amber: "#8A5A00",
  page: "#E7DED7",
} as const;

export const colorDark = {
  primary: "#C1272D",
  primary2: "#9E1E23",
  tint: "#3A1614",
  on: "#FFFFFF",
  canvas: "#151210",
  card: "#1F1B17",
  ink: "#F2ECE7",
  ink2: "#9C9089",
  ink3: "#6B625B",
  hair: "#2E2823",
  promo: "#D81E6A",
  seal: "#0A5233",
  seal2: "#12784A",
  sealTint: "#12261D",
  sealLine: "#1E4635",
  ring: "#F3ECDE",
  link: "#1F6FEB",
  rate: "#0F1712",
  amber: "#8A5A00",
  page: "#0C0A09",
} as const;

export const radius = {
  md: "16px",
  sm: "11px",
  pill: "999px",
} as const;

export const fontSize = {
  "2xs": "10px",
  xs: "11px",
  sm: "12.5px",
  base: "13px",
  md: "14.5px",
  lg: "16px",
  xl: "16.5px",
  "2xl": "21px",
  "3xl": "28px",
} as const;

export const fontWeight = {
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

export const letterSpacing = {
  tight: "-0.02em",
  tighter: "-0.03em",
} as const;

export const iconSize = {
  sm: "16px",
  md: "20px",
  lg: "24px",
  xl: "32px",
  "2xl": "48px",
} as const;

export const duration = {
  instant: 75,
  fast: 120,
  base: 180,
  moderate: 240,
  slow: 320,
  deliberate: 480,
} as const;

export const easing = {
  standard: [0.2,0,0,1] as [number, number, number, number],
  decelerate: [0,0,0,1] as [number, number, number, number],
  accelerate: [0.3,0,1,1] as [number, number, number, number],
  emphasized: [0.2,0,0,1.05] as [number, number, number, number],
  linear: [0,0,1,1] as [number, number, number, number],
} as const;

export type ColorToken = keyof typeof colorLight;
export type RadiusToken = keyof typeof radius;
export type DurationToken = keyof typeof duration;
export type EasingToken = keyof typeof easing;
