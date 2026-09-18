/* GENERATED FILE — DO NOT EDIT.
 * Source: docs/design/tokens.json
 * Regenerate: pnpm --filter @hg/ui-web generate:tokens
 */

import type { ColorScheme } from './tokens.js';

/**
 * The two web themes. Both run the `operational` register of
 * 01-foundations.md §10 (Midnight chrome, brand yellow restricted to primary
 * CTAs, status colour carrying more of the visual load). They differ only in
 * density: `restaurant` is a kitchen tablet read at arm's length and runs
 * `compact`; `admin` runs `comfortable` and drops to `compact` inside table
 * regions via [data-hg-density="compact"].
 *
 * A surface never defines a colour. It selects a theme and, at most, overrides
 * density.
 */
export const themes = {
  "restaurant": {
    "light": {
      "name": "restaurant",
      "scheme": "light",
      "register": "operational",
      "density": "compact",
      "metrics": {
        "rowHeight": 44,
        "cardPadding": 12,
        "gutter": 12
      },
      "color": {
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
      "typography": {
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
      },
      "space": {
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
      },
      "radius": {
        "none": 0,
        "xs": 4,
        "sm": 8,
        "md": 12,
        "lg": 16,
        "xl": 20,
        "2xl": 24,
        "full": 9999
      },
      "elevation": {
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
      },
      "motion": {
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
      },
      "icon": {
        "sm": 16,
        "md": 20,
        "lg": 24,
        "xl": 32,
        "2xl": 48,
        "strokeDefault": 2,
        "strokeSmall": 1.75
      },
      "target": {
        "min": 44,
        "field": 56,
        "criticalField": 72,
        "spacing": 8
      },
      "zIndex": {
        "base": 0,
        "sticky": 100,
        "appBar": 200,
        "bottomNav": 200,
        "dropdown": 300,
        "sheet": 400,
        "modal": 500,
        "toast": 600,
        "offerSheet": 700
      },
      "breakpoint": {
        "sm": 640,
        "md": 768,
        "lg": 1024,
        "xl": 1280,
        "2xl": 1536
      }
    },
    "dark": {
      "name": "restaurant",
      "scheme": "dark",
      "register": "operational",
      "density": "compact",
      "metrics": {
        "rowHeight": 44,
        "cardPadding": 12,
        "gutter": 12
      },
      "color": {
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
          "ring": "#6FA9F2",
          "offset": "#171717",
          "onColor": "#FFFFFF",
          "ringOn": {
            "brand": "#FFFFFF",
            "accent": "#6FA9F2",
            "danger": "#FFFFFF",
            "warning": "#FFFFFF",
            "info": "#FFFFFF",
            "halal": "#FFFFFF",
            "inverse": "#6FA9F2"
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
      },
      "typography": {
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
      },
      "space": {
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
      },
      "radius": {
        "none": 0,
        "xs": 4,
        "sm": 8,
        "md": 12,
        "lg": 16,
        "xl": 20,
        "2xl": 24,
        "full": 9999
      },
      "elevation": {
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
      },
      "motion": {
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
      },
      "icon": {
        "sm": 16,
        "md": 20,
        "lg": 24,
        "xl": 32,
        "2xl": 48,
        "strokeDefault": 2,
        "strokeSmall": 1.75
      },
      "target": {
        "min": 44,
        "field": 56,
        "criticalField": 72,
        "spacing": 8
      },
      "zIndex": {
        "base": 0,
        "sticky": 100,
        "appBar": 200,
        "bottomNav": 200,
        "dropdown": 300,
        "sheet": 400,
        "modal": 500,
        "toast": 600,
        "offerSheet": 700
      },
      "breakpoint": {
        "sm": 640,
        "md": 768,
        "lg": 1024,
        "xl": 1280,
        "2xl": 1536
      }
    }
  },
  "admin": {
    "light": {
      "name": "admin",
      "scheme": "light",
      "register": "operational",
      "density": "comfortable",
      "metrics": {
        "rowHeight": 64,
        "cardPadding": 16,
        "gutter": 16
      },
      "color": {
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
      "typography": {
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
      },
      "space": {
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
      },
      "radius": {
        "none": 0,
        "xs": 4,
        "sm": 8,
        "md": 12,
        "lg": 16,
        "xl": 20,
        "2xl": 24,
        "full": 9999
      },
      "elevation": {
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
      },
      "motion": {
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
      },
      "icon": {
        "sm": 16,
        "md": 20,
        "lg": 24,
        "xl": 32,
        "2xl": 48,
        "strokeDefault": 2,
        "strokeSmall": 1.75
      },
      "target": {
        "min": 44,
        "field": 56,
        "criticalField": 72,
        "spacing": 8
      },
      "zIndex": {
        "base": 0,
        "sticky": 100,
        "appBar": 200,
        "bottomNav": 200,
        "dropdown": 300,
        "sheet": 400,
        "modal": 500,
        "toast": 600,
        "offerSheet": 700
      },
      "breakpoint": {
        "sm": 640,
        "md": 768,
        "lg": 1024,
        "xl": 1280,
        "2xl": 1536
      }
    },
    "dark": {
      "name": "admin",
      "scheme": "dark",
      "register": "operational",
      "density": "comfortable",
      "metrics": {
        "rowHeight": 64,
        "cardPadding": 16,
        "gutter": 16
      },
      "color": {
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
          "ring": "#6FA9F2",
          "offset": "#171717",
          "onColor": "#FFFFFF",
          "ringOn": {
            "brand": "#FFFFFF",
            "accent": "#6FA9F2",
            "danger": "#FFFFFF",
            "warning": "#FFFFFF",
            "info": "#FFFFFF",
            "halal": "#FFFFFF",
            "inverse": "#6FA9F2"
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
      },
      "typography": {
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
      },
      "space": {
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
      },
      "radius": {
        "none": 0,
        "xs": 4,
        "sm": 8,
        "md": 12,
        "lg": 16,
        "xl": 20,
        "2xl": 24,
        "full": 9999
      },
      "elevation": {
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
      },
      "motion": {
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
      },
      "icon": {
        "sm": 16,
        "md": 20,
        "lg": 24,
        "xl": 32,
        "2xl": 48,
        "strokeDefault": 2,
        "strokeSmall": 1.75
      },
      "target": {
        "min": 44,
        "field": 56,
        "criticalField": 72,
        "spacing": 8
      },
      "zIndex": {
        "base": 0,
        "sticky": 100,
        "appBar": 200,
        "bottomNav": 200,
        "dropdown": 300,
        "sheet": 400,
        "modal": 500,
        "toast": 600,
        "offerSheet": 700
      },
      "breakpoint": {
        "sm": 640,
        "md": 768,
        "lg": 1024,
        "xl": 1280,
        "2xl": 1536
      }
    }
  }
} as const;

export type ThemeName = keyof typeof themes;
export type Theme = (typeof themes)[ThemeName][ColorScheme];

export const restaurant = themes.restaurant;
export const admin = themes.admin;

export function getTheme(name: ThemeName, scheme: ColorScheme): Theme {
  return themes[name][scheme];
}

/** Attributes to spread on the document root (or any subtree) for a theme. */
export function themeAttributes(
  name: ThemeName,
  scheme?: ColorScheme,
): Record<string, string> {
  const attrs: Record<string, string> = {
    'data-hg-theme': name,
    'data-hg-density': themes[name].light.density,
  };
  if (scheme) attrs['data-theme'] = scheme;
  return attrs;
}
