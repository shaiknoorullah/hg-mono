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
    "50": "#FEF0EA",
    "100": "#FBD9CB",
    "200": "#F8BCA3",
    "300": "#F5966B",
    "400": "#F3703F",
    "500": "#F1521E",
    "600": "#D8410F",
    "700": "#B0330B",
    "800": "#8A2909",
    "900": "#5E1B06",
    "950": "#2E0D03"
  },
  "accent": {
    "50": "#E7EDEA",
    "100": "#C6D3CC",
    "200": "#9FB2A9",
    "300": "#6F8A7E",
    "400": "#41685A",
    "500": "#274E42",
    "600": "#1B3B31",
    "700": "#143026",
    "800": "#0F241C",
    "900": "#0A1913",
    "950": "#05100B"
  },
  "neutral": {
    "0": "#FFFFFF",
    "50": "#FFFAEA",
    "100": "#F6EFDD",
    "200": "#E6E0D4",
    "300": "#D8D0BF",
    "400": "#B9B0A0",
    "500": "#8B8578",
    "600": "#6E7C77",
    "700": "#4A4E48",
    "800": "#33352F",
    "900": "#232323",
    "950": "#171717",
    "1000": "#000000"
  },
  "success": {
    "50": "#E9F3E4",
    "100": "#CFE6C6",
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
    "50": "#FBE9E7",
    "100": "#F6CFCB",
    "300": "#E88379",
    "500": "#C42B1C",
    "600": "#A0210F",
    "700": "#821A0D",
    "900": "#4C0F07"
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
      "seal": "#0F7A43",
      "sealPressed": "#0C6338",
      "sealDark": "#10864A",
      "onSeal": "#FFFFFF",
      "ring": "#C9A24B",
      "ringDark": "#DDB863",
      "tint": "#E9F3E4",
      "tintText": "#0C4A2A",
      "tintBorder": "#A9CBB4",
      "tintDark": "#0A2A1B",
      "tintTextDark": "#7FE3AB"
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
    "7": "#5B4CC4",
    "8": "#B42318"
  },
  "map": {
    "routeActive": "#0B72E7",
    "routeTravelled": "#948C7E",
    "pinRestaurant": "#F1521E",
    "pinCustomer": "#1B3B31",
    "pinRider": "#0F7A43",
    "geofenceStroke": "#0B72E7",
    "geofenceFill": "#0B72E71F"
  }
} as const;

export const font = {
  "family": {
    "ui": [
      "Plus Jakarta Sans",
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
    "display": [
      "Bricolage Grotesque",
      "Plus Jakarta Sans",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Helvetica Neue",
      "Arial",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
        "Plus Jakarta Sans",
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
      "Plus Jakarta Sans",
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
  },
  "marketing": {
    "hero": {
      "fontFamily": [
        "Bricolage Grotesque",
        "Plus Jakarta Sans",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Helvetica Neue",
        "Arial",
        "sans-serif"
      ],
      "fontSize": 118,
      "fontWeight": 650,
      "lineHeight": 0.9,
      "lineHeightPx": 106,
      "letterSpacing": "-0.03em"
    },
    "heroPhone": {
      "fontFamily": [
        "Bricolage Grotesque",
        "Plus Jakarta Sans",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Helvetica Neue",
        "Arial",
        "sans-serif"
      ],
      "fontSize": 72,
      "fontWeight": 800,
      "lineHeight": 0.85,
      "lineHeightPx": 61,
      "letterSpacing": "-0.045em"
    },
    "section": {
      "fontFamily": [
        "Bricolage Grotesque",
        "Plus Jakarta Sans",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Helvetica Neue",
        "Arial",
        "sans-serif"
      ],
      "fontSize": 60,
      "fontWeight": 700,
      "lineHeight": 1,
      "lineHeightPx": 60,
      "letterSpacing": "-0.03em"
    },
    "sectionPhone": {
      "fontFamily": [
        "Bricolage Grotesque",
        "Plus Jakarta Sans",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Helvetica Neue",
        "Arial",
        "sans-serif"
      ],
      "fontSize": 34,
      "fontWeight": 700,
      "lineHeight": 1.02,
      "lineHeightPx": 35,
      "letterSpacing": "-0.03em"
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
    "surfaceStep": "#171717"
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
    "surfaceStep": "#232323"
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
    "surfaceStep": "#232323"
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
    "surfaceStep": "#33352F",
    "darkHairline": "#33352F"
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
    "surfaceStep": "#33352F",
    "darkHairline": "#33352F"
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
    "surfaceStep": "#33352F"
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
    "spring": [
      0.34,
      1.56,
      0.64,
      1
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
 *   light: brand 1.27:1 → flipped, accent 2.73:1 → flipped, danger 1.26:1 → flipped, warning 1.16:1 → flipped, info 1.02:1 → flipped, halal 1.21:1 → flipped, inverse 3.5:1
 *   dark: brand 1.21:1 → flipped, accent 4.19:1, danger 1.94:1 → flipped, warning 1.79:1 → flipped, info 1.57:1 → flipped, halal 1.85:1 → flipped, inverse 5.39:1
 */
export const roles = {
  "light": {
    "surface": {
      "base": "#FFFAEA",
      "sunken": "#F6EFDD",
      "subtle": "#F6EFDD",
      "raised": "#FFFFFF",
      "inverse": "#232323",
      "chrome": "#1B3B31",
      "scrim": "#232323B8"
    },
    "text": {
      "primary": "#232323",
      "secondary": "#4A4E48",
      "tertiary": "#6E7C77",
      "placeholder": "#8B8578",
      "disabled": "#B9B0A0",
      "onBrand": "#0F241C",
      "onInverse": "#F6EFDD",
      "onAccent": "#FFFFFF",
      "link": "#0959B8"
    },
    "border": {
      "decorative": "#E6E0D4",
      "interactive": "#8B8578",
      "strong": "#4A4E48",
      "brand": "#D8410F"
    },
    "focus": {
      "ring": "#D8410F",
      "offset": "#FFFFFF",
      "onColor": "#FFFFFF",
      "ringOn": {
        "brand": "#FFFFFF",
        "accent": "#FFFFFF",
        "danger": "#FFFFFF",
        "warning": "#FFFFFF",
        "info": "#FFFFFF",
        "halal": "#FFFFFF",
        "inverse": "#D8410F"
      }
    },
    "state": {
      "hoverOverlay": "#2323230F",
      "pressedOverlay": "#2323231F",
      "selectedTint": "#FEF0EA",
      "disabledOpacity": 0.6
    },
    "action": {
      "primary": {
        "bg": "#F1521E",
        "bgPressed": "#F3703F",
        "fg": "#0F241C"
      },
      "secondary": {
        "bg": "#1B3B31",
        "bgPressed": "#143026",
        "fg": "#FFFFFF"
      },
      "tertiary": {
        "border": "#8B8578",
        "fg": "#232323"
      },
      "danger": {
        "bg": "#C42B1C",
        "bgPressed": "#A0210F",
        "fg": "#FFFFFF"
      }
    },
    "control": {
      "bg": "#FFFAEA",
      "border": "#8B8578",
      "borderHover": "#4A4E48",
      "selectedBg": "#F1521E",
      "selectedFg": "#0F241C",
      "trackOff": "#4A4E48",
      "trackOn": "#D8410F",
      "thumb": "#FFFFFF"
    },
    "feedback": {
      "success": {
        "tint": "#E9F3E4",
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
        "tint": "#FBE9E7",
        "tintText": "#821A0D",
        "text": "#A0210F",
        "icon": "#C42B1C",
        "border": "#C42B1C",
        "solid": "#C42B1C",
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
      "base": "#D8D0BF",
      "highlight": "#E6E0D4"
    }
  },
  "dark": {
    "surface": {
      "base": "#171717",
      "sunken": "#000000",
      "subtle": "#232323",
      "raised": "#33352F",
      "inverse": "#F6EFDD",
      "chrome": "#0A1913",
      "scrim": "#000000C4"
    },
    "text": {
      "primary": "#F6EFDD",
      "secondary": "#B9B0A0",
      "tertiary": "#8B8578",
      "placeholder": "#6E7C77",
      "disabled": "#4A4E48",
      "onBrand": "#0F241C",
      "onInverse": "#232323",
      "onAccent": "#FFFFFF",
      "link": "#6FA9F2"
    },
    "border": {
      "decorative": "#33352F",
      "interactive": "#6E7C77",
      "strong": "#8B8578",
      "brand": "#F3703F"
    },
    "focus": {
      "ring": "#F3703F",
      "offset": "#171717",
      "onColor": "#FFFFFF",
      "ringOn": {
        "brand": "#FFFFFF",
        "accent": "#F3703F",
        "danger": "#FFFFFF",
        "warning": "#FFFFFF",
        "info": "#FFFFFF",
        "halal": "#FFFFFF",
        "inverse": "#F3703F"
      }
    },
    "state": {
      "hoverOverlay": "#FFFFFF14",
      "pressedOverlay": "#FFFFFF29",
      "selectedTint": "#2E0D03",
      "disabledOpacity": 0.5
    },
    "action": {
      "primary": {
        "bg": "#F1521E",
        "bgPressed": "#F3703F",
        "fg": "#0F241C"
      },
      "secondary": {
        "bg": "#1B3B31",
        "bgPressed": "#143026",
        "fg": "#FFFFFF"
      },
      "tertiary": {
        "border": "#6E7C77",
        "fg": "#F6EFDD"
      },
      "danger": {
        "bg": "#C42B1C",
        "bgPressed": "#A0210F",
        "fg": "#FFFFFF"
      }
    },
    "control": {
      "bg": "#171717",
      "border": "#6E7C77",
      "borderHover": "#8B8578",
      "selectedBg": "#F1521E",
      "selectedFg": "#0F241C",
      "trackOff": "#8B8578",
      "trackOn": "#D8410F",
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
        "tint": "#4C0F07",
        "tintText": "#E88379",
        "text": "#E88379",
        "icon": "#E88379",
        "border": "#C42B1C",
        "solid": "#C42B1C",
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
      "base": "#33352F",
      "highlight": "#4A4E48"
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
