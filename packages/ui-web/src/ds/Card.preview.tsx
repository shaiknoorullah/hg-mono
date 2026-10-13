/**
 * Card specimens: the four variants, as the live components/Card/preview.html draws them.
 */

import { Card } from './Card.js';

/** The live design system's component name. */
export const component = 'Card';

function Text({ title, line }: { title: string; line: string }) {
  return (
    <>
      <div className="hg-specimen-title">{title}</div>
      <div className="hg-specimen-caption">{line}</div>
    </>
  );
}

/** All four variants, paired with the reference's full page. */
export function Full() {
  return (
    <div className="hg-specimen-cards">
      <Card variant="elevated"><Text title="Elevated" line="Elevation 1 on the cream canvas" /></Card>
      <Card variant="outlined"><Text title="Outlined" line="1px border.decorative" /></Card>
      <Card variant="filled"><Text title="Filled" line="surface.subtle" /></Card>
      <Card onPress={() => {}} accessibilityLabel="Zaytoun Grill, open, 25 to 35 minutes">
        <Text title="Interactive" line="Tab to it, press Enter or Space" />
      </Card>
    </div>
  );
}
