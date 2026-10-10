# W7b visual evidence: DocumentViewer, LiveMap, AddressCombobox, MapPinPicker

Each PNG shows the approved canvas board first (rendered from the read-only canvas snapshot, so
its design-system parts appear as grey placeholders), then the `@hg/ui-web/proposed`
specimens from `pnpm --filter @hg/ui-web preview:shoot` at 1440px. The live design system has
no preview page for these proposed composites, so the boards are the reference.

- DocumentViewer-states.png: board `admin/restaurant-verification/Viewer-States` (loading, link expired, failed).
- DocumentViewer-ready.png: board `CertPane` (ready); specimens ready (image, two pages) and PDF.
- DocumentViewer-limits.png: board `Viewer-Limits`; specimens no document and no access.
- LiveMap-live.png: board `admin/orders/LiveMapPane`; specimens live (stand-in map engine) and stale.
- LiveMap-fallbacks.png: board `LiveMapError`; specimens failed, no token, loading, empty.
- AddressCombobox.png and AddressCombobox-search-error.png: boards `restaurant/onboarding/Profile-Location` and `Profile-SearchError`.
- MapPinPicker.png: board `Profile-PinMoved`; specimens pin moved, pin placed, no pin, no map.
