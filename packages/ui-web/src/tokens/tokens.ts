/* GENERATED FILE — DO NOT EDIT.
 * Source: docs/design/tokens.json
 * Regenerate: pnpm --filter @hg/ui-web generate:tokens
 */

/**
 * Raw palette ramps and scales, resolved from docs/design/tokens.json.
 *
 * Components must NOT read the numbered ramp steps (lint L-2) — read a role
 * from `themes` / `roles` instead, or a CSS custom property from tokens.css.
 * The ramps are exported because the theme layer, the token-drift test and the
 * L-4 lint rule all need them.
 */

export const color = {
  "brand": {
    "50": "#FFF9E6",
    "100": "#FFF0BF",
    "200": "#FFE694",
    "300": "#FFDB69",
    "400": "#FFD147",
    "500": "#FFC220",
    "600": "#DFA400",
    "700": "#A87C00",
    "800": "#7A5800",
    "900": "#513B00",
    "950": "#2B1F00"
  },
  "accent": {
    "50": "#EEF2F9",
    "100": "#D6DFEE",
    "200": "#B0C0DC",
    "300": "#8098C4",
    "400": "#5471A8",
    "500": "#34528C",
    "600": "#24406F",
    "700": "#1B3157",
    "800": "#142542",
    "900": "#0E1A2F",
    "950": "#080F1C"
  },
  "neutral": {
    "0": "#FFFFFF",
    "50": "#FAF9F7",
    "100": "#F3F1ED",
    "200": "#E7E3DC",
    "300": "#D5CFC5",
    "400": "#B6AEA1",
    "500": "#948C7E",
    "600": "#6E6658",
    "700": "#4A443B",
    "800": "#332E28",
    "900": "#1F1B17",
    "950": "#12100D",
    "1000": "#000000"
  },
  "success": {
    "50": "#E7F7F0",
    "100": "#C7EEDE",
    "300": "#4FC79A",
    "500": "#0E9F6E",
    "600": "#067A55",
    "700": "#05603F",
    "800": "#04492F",
    "900": "#03301F"
  },
  "warning": {
    "50": "#FEF1E7",
    "100": "#FDDDC4",
    "300": "#F59A5C",
    "500": "#E8690F",
    "600": "#B84A08",
    "700": "#8F3A06",
    "900": "#52210C"
  },
  "danger": {
    "50": "#FDECEA",
    "100": "#FBD5D1",
    "300": "#F08C82",
    "500": "#D92D20",
    "600": "#B42318",
    "700": "#912018",
    "900": "#55110C"
  },
  "info": {
    "50": "#E9F1FE",
    "100": "#CBDFFC",
    "300": "#6FA9F2",
    "500": "#0B72E7",
    "600": "#0959B8",
    "700": "#07458F",
    "900": "#04264F"
  },
  "halal": {
    "certified": {
      "seal": "#04482A",
      "sealPressed": "#033520",
      "sealDark": "#0F7A46",
      "onSeal": "#FFFFFF",
      "ring": "#D4A72C",
      "ringDark": "#E3BE4A",
      "tint": "#E4F0E9",
      "tintText": "#04482A",
      "tintBorder": "#9DC4AE",
      "tintDark": "#08261A",
      "tintTextDark": "#7BE0A8"
    },
    "expiring": {
      "text": "#7A5600",
      "icon": "#8A6100",
      "tint": "#FBF1D8",
      "border": "#D9BE7A",
      "textDark": "#E8C463",
      "tintDark": "#2A2008"
    },
    "expired": {
      "seal": "#4E5862",
      "sealDark": "#7C8794",
      "onSeal": "#FFFFFF",
      "tint": "#EDEFF1",
      "text": "#39424B",
      "border": "#B9C0C7",
      "tintDark": "#1B1F24",
      "textDark": "#AEB6BF"
    },
    "unverified": {
      "fill": "#00000000",
      "border": "#B6AEA1",
      "text": "#6E6658",
      "borderDark": "#4A443B",
      "textDark": "#B6AEA1"
    }
  },
  "viz": {
    "1": "#24406F",
    "2": "#0B72E7",
    "3": "#7A5800",
    "4": "#8E4EC6",
    "5": "#B84A08",
    "6": "#4E5862",
    "7": "#0F766E",
    "8": "#B42318"
  },
  "map": {
    "routeActive": "#0B72E7",
    "routeTravelled": "#948C7E",
    "pinRestaurant": "#FFC220",
    "pinCustomer": "#24406F",
    "pinRider": "#04482A",
    "geofenceStroke": "#0B72E7",
    "geofenceFill": "#0B72E71F"
  }
} as const;

export const font = {
  "family": {
    "ui": [
      "Inter",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "Helvetica Neue",
      "Arial",
      "Noto Sans",
      "sans-serif"
    ],
    "rtl": [
      "IBM Plex Sans Arabic",
      "Noto Sans Arabic",
      "Geeza Pro",
      "Segoe UI",
      "Tahoma",
      "sans-serif"
    ],
    "mono": [
      "JetBrains Mono",
      "ui-monospace",
      "SFMono-Regular",
      "Menlo",
      "Consolas",
      "Liberation Mono",
      "monospace"
    ]
  },
  "weight": {
    "regular": 400,
    "medium": 500,
    "semibold": 600,
    "bold": 700
  },
  "numeric": {
    "tabular": "tabular-nums"
  }
} as const;

export const typography = {
  "display": {
    "lg": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 36,
      "fontWeight": 700,
      "lineHeight": 1.15,
      "lineHeightPx": 42,
      "letterSpacing": "-0.02em"
    },
    "md": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 30,
      "fontWeight": 700,
      "lineHeight": 1.2,
      "lineHeightPx": 36,
      "letterSpacing": "-0.02em"
    }
  },
  "heading": {
    "xl": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 24,
      "fontWeight": 700,
      "lineHeight": 1.25,
      "lineHeightPx": 30,
      "letterSpacing": "-0.01em"
    },
    "lg": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 20,
      "fontWeight": 600,
      "lineHeight": 1.3,
      "lineHeightPx": 26,
      "letterSpacing": "-0.01em"
    },
    "md": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 18,
      "fontWeight": 600,
      "lineHeight": 1.35,
      "lineHeightPx": 24,
      "letterSpacing": "0"
    },
    "sm": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 16,
      "fontWeight": 600,
      "lineHeight": 1.4,
      "lineHeightPx": 22,
      "letterSpacing": "0"
    }
  },
  "body": {
    "lg": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 17,
      "fontWeight": 400,
      "lineHeight": 1.5,
      "lineHeightPx": 26,
      "letterSpacing": "0"
    },
    "md": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 15,
      "fontWeight": 400,
      "lineHeight": 1.5,
      "lineHeightPx": 22,
      "letterSpacing": "0"
    },
    "sm": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 13,
      "fontWeight": 400,
      "lineHeight": 1.45,
      "lineHeightPx": 19,
      "letterSpacing": "0"
    }
  },
  "label": {
    "lg": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 15,
      "fontWeight": 600,
      "lineHeight": 1.2,
      "lineHeightPx": 18,
      "letterSpacing": "0"
    },
    "md": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 13,
      "fontWeight": 600,
      "lineHeight": 1.2,
      "lineHeightPx": 16,
      "letterSpacing": "0.01em"
    },
    "sm": {
      "fontFamily": [
        "Inter",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "Arial",
        "Noto Sans",
        "sans-serif"
      ],
      "fontSize": 11,
      "fontWeight": 600,
      "lineHeight": 1.2,
      "lineHeightPx": 14,
      "letterSpacing": "0.04em"
    }
  },
  "caption": {
    "fontFamily": [
      "Inter",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "Helvetica Neue",
      "Arial",
      "Noto Sans",
      "sans-serif"
    ],
    "fontSize": 12,
    "fontWeight": 400,
    "lineHeight": 1.4,
    "lineHeightPx": 17,
    "letterSpacing": "0"
  },
  "mono": {
    "md": {
      "fontFamily": [
        "JetBrains Mono",
        "ui-monospace",
        "SFMono-Regular",
        "Menlo",
        "Consolas",
        "Liberation Mono",
        "monospace"
      ],
      "fontSize": 13,
      "fontWeight": 400,
      "lineHeight": 1.45,
      "lineHeightPx": 19,
      "letterSpacing": "0"
    },
    "sm": {
      "fontFamily": [
        "JetBrains Mono",
        "ui-monospace",
        "SFMono-Regular",
        "Menlo",
        "Consolas",
        "Liberation Mono",
        "monospace"
      ],
      "fontSize": 11,
      "fontWeight": 400,
      "lineHeight": 1.4,
      "lineHeightPx": 15,
      "letterSpacing": "0"
    }
  }
} as const;

export const space = {
  "0": 0,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
  "20": 80,
  "24": 96
} as const;

export const density = {
  "comfortable": {
    "rowHeight": 64,
    "cardPadding": 16,
    "gutter": 16
  },
  "compact": {
    "rowHeight": 44,
    "cardPadding": 12,
    "gutter": 12
  },
  "roomy": {
    "rowHeight": 72,
    "cardPadding": 20,
    "gutter": 20
  }
} as const;

export const radius = {
  "none": 0,
  "xs": 4,
  "sm": 8,
  "md": 12,
  "lg": 16,
  "xl": 20,
  "2xl": 24,
  "full": 9999
} as const;

export const elevation = {
  "0": {
    "web": "none",
    "rn": null,
    "android": 0,
    "surfaceStep": "#12100D"
  },
  "1": {
    "web": "0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.08)",
    "rn": {
      "shadowColor": "#000000",
      "shadowOffset": {
        "width": 0,
        "height": 1
      },
      "shadowOpacity": 0.08,
      "shadowRadius": 3
    },
    "android": 1,
    "surfaceStep": "#1F1B17"
  },
  "2": {
    "web": "0 2px 4px rgba(0,0,0,.06), 0 4px 8px rgba(0,0,0,.08)",
    "rn": {
      "shadowColor": "#000000",
      "shadowOffset": {
        "width": 0,
        "height": 2
      },
      "shadowOpacity": 0.1,
      "shadowRadius": 6
    },
    "android": 3,
    "surfaceStep": "#1F1B17"
  },
  "3": {
    "web": "0 4px 8px rgba(0,0,0,.08), 0 8px 16px rgba(0,0,0,.10)",
    "rn": {
      "shadowColor": "#000000",
      "shadowOffset": {
        "width": 0,
        "height": 4
      },
      "shadowOpacity": 0.12,
      "shadowRadius": 12
    },
    "android": 6,
    "surfaceStep": "#332E28",
    "darkHairline": "#332E28"
  },
  "4": {
    "web": "0 8px 16px rgba(0,0,0,.10), 0 16px 32px rgba(0,0,0,.12)",
    "rn": {
      "shadowColor": "#000000",
      "shadowOffset": {
        "width": 0,
        "height": 8
      },
      "shadowOpacity": 0.16,
      "shadowRadius": 24
    },
    "android": 12,
    "surfaceStep": "#332E28",
    "darkHairline": "#332E28"
  },
  "sticky": {
    "web": "0 -2px 8px rgba(0,0,0,.08)",
    "rn": {
      "shadowColor": "#000000",
      "shadowOffset": {
        "width": 0,
        "height": -2
      },
      "shadowOpacity": 0.1,
      "shadowRadius": 8
    },
    "android": 8,
    "surfaceStep": "#332E28"
  }
} as const;

export const motion = {
  "duration": {
    "instant": "75ms",
    "fast": "120ms",
    "base": "180ms",
    "moderate": "240ms",
    "slow": "320ms",
    "deliberate": "480ms"
  },
  "easing": {
    "standard": [
      0.2,
      0,
      0,
      1
    ],
    "decelerate": [
      0,
      0,
      0,
      1
    ],
    "accelerate": [
      0.3,
      0,
      1,
      1
    ],
    "emphasized": [
      0.2,
      0,
      0,
      1.05
    ],
    "linear": [
      0,
      0,
      1,
      1
    ]
  },
  "spring": {
    "snappy": {
      "damping": 22,
      "stiffness": 320,
      "mass": 1
    },
    "smooth": {
      "damping": 26,
      "stiffness": 200,
      "mass": 1
    },
    "gentle": {
      "damping": 30,
      "stiffness": 140,
      "mass": 1
    }
  }
} as const;

export const icon = {
  "sm": 16,
  "md": 20,
  "lg": 24,
  "xl": 32,
  "2xl": 48,
  "strokeDefault": 2,
  "strokeSmall": 1.75
} as const;

export const target = {
  "min": 44,
  "field": 56,
  "criticalField": 72,
  "spacing": 8
} as const;

export const zIndex = {
  "base": 0,
  "sticky": 100,
  "appBar": 200,
  "bottomNav": 200,
  "dropdown": 300,
  "sheet": 400,
  "modal": 500,
  "toast": 600,
  "offerSheet": 700
} as const;

export const breakpoint = {
  "sm": 640,
  "md": 768,
  "lg": 1024,
  "xl": 1280,
  "2xl": 1536
} as const;

/**
 * Role maps, one per colour scheme. `focus.ringOn` records which container
 * colours force the ring to flip to `focus.onColor`; the flip set is computed
 * from measured contrast at generate time, not asserted by hand:
 *
 *   light: brand 2.84:1 → flipped, accent 2.24:1 → flipped, danger 1.05:1 → flipped, warning 1.14:1 → flipped, info 1:1 → flipped, halal 2.33:1 → flipped, inverse 3.73:1
 *   dark: brand 1.5:1 → flipped, accent 4.24:1, danger 1.99:1 → flipped, warning 2.15:1 → flipped, info 1.89:1 → flipped, halal 4.39:1, inverse 7.03:1
 */
export const roles = {
  "light": {
    "surface": {
      "base": "#FFFFFF",
      "sunken": "#FAF9F7",
      "subtle": "#F3F1ED",
      "raised": "#FFFFFF",
      "inverse": "#1F1B17",
      "chrome": "#24406F",
      "scrim": "#1F1B17B8"
    },
    "text": {
      "primary": "#1F1B17",
      "secondary": "#4A443B",
      "tertiary": "#6E6658",
      "placeholder": "#948C7E",
      "disabled": "#B6AEA1",
      "onBrand": "#1F1B17",
      "onInverse": "#F3F1ED",
      "onAccent": "#FFFFFF",
      "link": "#0959B8"
    },
    "border": {
      "decorative": "#E7E3DC",
      "interactive": "#948C7E",
      "strong": "#4A443B",
      "brand": "#DFA400"
    },
    "focus": {
      "ring": "#0B72E7",
      "offset": "#FFFFFF",
      "onColor": "#FFFFFF",
      "ringOn": {
        "brand": "#FFFFFF",
        "accent": "#FFFFFF",
        "danger": "#FFFFFF",
        "warning": "#FFFFFF",
        "info": "#FFFFFF",
        "halal": "#FFFFFF",
        "inverse": "#0B72E7"
      }
    },
    "state": {
      "hoverOverlay": "#1F1B170F",
      "pressedOverlay": "#1F1B171F",
      "selectedTint": "#FFF9E6",
      "disabledOpacity": 0.6
    },
    "action": {
      "primary": {
        "bg": "#FFC220",
        "bgPressed": "#DFA400",
        "fg": "#1F1B17"
      },
      "secondary": {
        "bg": "#24406F",
        "bgPressed": "#1B3157",
        "fg": "#FFFFFF"
      },
      "tertiary": {
        "border": "#948C7E",
        "fg": "#1F1B17"
      },
      "danger": {
        "bg": "#D92D20",
        "bgPressed": "#B42318",
        "fg": "#FFFFFF"
      }
    },
    "control": {
      "bg": "#FFFFFF",
      "border": "#948C7E",
      "borderHover": "#4A443B",
      "selectedBg": "#FFC220",
      "selectedFg": "#1F1B17",
      "trackOff": "#4A443B",
      "trackOn": "#DFA400",
      "thumb": "#FFFFFF"
    },
    "feedback": {
      "success": {
        "tint": "#E7F7F0",
        "tintText": "#05603F",
        "text": "#067A55",
        "icon": "#0E9F6E",
        "border": "#067A55"
      },
      "warning": {
        "tint": "#FEF1E7",
        "tintText": "#8F3A06",
        "text": "#B84A08",
        "icon": "#B84A08",
        "border": "#B84A08",
        "solid": "#B84A08",
        "onSolid": "#FFFFFF"
      },
      "danger": {
        "tint": "#FDECEA",
        "tintText": "#912018",
        "text": "#B42318",
        "icon": "#D92D20",
        "border": "#D92D20",
        "solid": "#D92D20",
        "onSolid": "#FFFFFF"
      },
      "info": {
        "tint": "#E9F1FE",
        "tintText": "#07458F",
        "text": "#0959B8",
        "icon": "#0B72E7",
        "border": "#0B72E7",
        "solid": "#0B72E7",
        "onSolid": "#FFFFFF"
      }
    },
    "skeleton": {
      "base": "#D5CFC5",
      "highlight": "#E7E3DC"
    }
  },
  "dark": {
    "surface": {
      "base": "#12100D",
      "sunken": "#000000",
      "subtle": "#1F1B17",
      "raised": "#332E28",
      "inverse": "#F3F1ED",
      "chrome": "#0E1A2F",
      "scrim": "#000000C4"
    },
    "text": {
      "primary": "#F3F1ED",
      "secondary": "#B6AEA1",
      "tertiary": "#948C7E",
      "placeholder": "#6E6658",
      "disabled": "#4A443B",
      "onBrand": "#12100D",
      "onInverse": "#1F1B17",
      "onAccent": "#FFFFFF",
      "link": "#6FA9F2"
    },
    "border": {
      "decorative": "#332E28",
      "interactive": "#6E6658",
      "strong": "#948C7E",
      "brand": "#FFD147"
    },
    "focus": {
      "ring": "#6FA9F2",
      "offset": "#12100D",
      "onColor": "#FFFFFF",
      "ringOn": {
        "brand": "#FFFFFF",
        "accent": "#6FA9F2",
        "danger": "#FFFFFF",
        "warning": "#FFFFFF",
        "info": "#FFFFFF",
        "halal": "#6FA9F2",
        "inverse": "#6FA9F2"
      }
    },
    "state": {
      "hoverOverlay": "#FFFFFF14",
      "pressedOverlay": "#FFFFFF29",
      "selectedTint": "#2B1F00",
      "disabledOpacity": 0.5
    },
    "action": {
      "primary": {
        "bg": "#FFC220",
        "bgPressed": "#DFA400",
        "fg": "#12100D"
      },
      "secondary": {
        "bg": "#24406F",
        "bgPressed": "#1B3157",
        "fg": "#FFFFFF"
      },
      "tertiary": {
        "border": "#6E6658",
        "fg": "#F3F1ED"
      },
      "danger": {
        "bg": "#D92D20",
        "bgPressed": "#B42318",
        "fg": "#FFFFFF"
      }
    },
    "control": {
      "bg": "#12100D",
      "border": "#6E6658",
      "borderHover": "#948C7E",
      "selectedBg": "#FFC220",
      "selectedFg": "#12100D",
      "trackOff": "#948C7E",
      "trackOn": "#DFA400",
      "thumb": "#FFFFFF"
    },
    "feedback": {
      "success": {
        "tint": "#03301F",
        "tintText": "#4FC79A",
        "text": "#4FC79A",
        "icon": "#4FC79A",
        "border": "#4FC79A"
      },
      "warning": {
        "tint": "#52210C",
        "tintText": "#F59A5C",
        "text": "#F59A5C",
        "icon": "#F59A5C",
        "border": "#F59A5C",
        "solid": "#B84A08",
        "onSolid": "#FFFFFF"
      },
      "danger": {
        "tint": "#55110C",
        "tintText": "#F08C82",
        "text": "#F08C82",
        "icon": "#F08C82",
        "border": "#D92D20",
        "solid": "#D92D20",
        "onSolid": "#FFFFFF"
      },
      "info": {
        "tint": "#04264F",
        "tintText": "#6FA9F2",
        "text": "#6FA9F2",
        "icon": "#6FA9F2",
        "border": "#0B72E7",
        "solid": "#0B72E7",
        "onSolid": "#FFFFFF"
      }
    },
    "skeleton": {
      "base": "#332E28",
      "highlight": "#4A443B"
    }
  }
} as const;

export const tokens = {
  color,
  font,
  typography,
  space,
  density,
  radius,
  elevation,
  motion,
  icon,
  target,
  zIndex,
  breakpoint,
  roles,
} as const;

export type Tokens = typeof tokens;
export type ColorScheme = keyof typeof roles;
export type SurfaceRole = keyof typeof roles.light.surface;
export type TextRole = keyof typeof roles.light.text;
export type BorderRole = keyof typeof roles.light.border;
export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radius;
export type TypographyToken = keyof typeof typography;
export type DensityMode = keyof typeof density;
