import { useEffect } from 'react';
import { ToastProvider, TooltipProvider } from '@hg/ui-web';

import { ControlBar, Rail, SECTIONS } from './gallery/Chrome';
import { useControls, useDocumentScheme, useThemeSubtreeAttributes } from './lib/controls';
import { HalalSection } from './sections/HalalSection';
import { PrimitivesSection } from './sections/PrimitivesSection';
import { ContentSection } from './sections/ContentSection';
import { NavigationSection } from './sections/NavigationSection';
import { FeedbackSection } from './sections/FeedbackSection';
import { DataSection } from './sections/DataSection';
import { ContrastSection } from './sections/ContrastSection';

const RENDERERS: Record<string, () => React.JSX.Element> = {
  halal: HalalSection,
  primitives: PrimitivesSection,
  content: ContentSection,
  navigation: NavigationSection,
  feedback: FeedbackSection,
  data: DataSection,
  contrast: ContrastSection,
};

export function App() {
  const [controls, set] = useControls();
  useDocumentScheme(controls);
  const themeAttributes = useThemeSubtreeAttributes(controls);

  const Current = RENDERERS[controls.section] ?? HalalSection;
  const known = SECTIONS.some((entry) => entry.id === controls.section);

  // Back to the top when the section changes; the rail stays where it is.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [controls.section]);

  return (
    // The theme and density attributes live here rather than on <html>: see the note in
    // src/lib/controls.ts and the finding in the Contrast section.
    <div {...themeAttributes} className="gx-page">
      <Rail controls={controls} onSelect={(section) => set({ section })} />

      <div className="gx-main">
        <ControlBar controls={controls} set={set} />

        {!known ? (
          <p className="mb-6 text-body-md text-fg-secondary">
            Unknown section <code>{controls.section}</code> in the URL — showing the halal
            section instead.
          </p>
        ) : null}

        <Current />
      </div>
    </div>
  );
}

export function Root() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  );
}
