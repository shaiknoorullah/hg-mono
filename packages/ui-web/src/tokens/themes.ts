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
      "typography": {
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
      },
      "typography": {
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
      "typography": {
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
      },
      "typography": {
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
