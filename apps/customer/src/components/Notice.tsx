/**
 * The canvases' "Proposed component: Banner" — an outlined, tinted notice with a Solar glyph —
 * drawn with `@hg/ui-native`'s `Banner`. Only neutral, info and warning: nothing on these screens
 * is ever red, and a halal state never is (AGENTS.md "Non-negotiable invariants").
 */
import * as React from 'react';
import { Banner, Icon, useTheme } from '@hg/ui-native';
import type { IconName } from '@hg/ui-native';

export function Notice({
  tone,
  icon,
  title,
  description,
  testID,
}: {
  tone: 'neutral' | 'info' | 'warning';
  icon: IconName;
  title: string;
  description?: string;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const glyph =
    tone === 'neutral'
      ? theme.color.text.secondary
      : tone === 'info'
        ? theme.color.feedback.info.icon
        : theme.color.feedback.warning.icon;
  return (
    <Banner
      variant={tone}
      title={title}
      description={description}
      icon={<Icon name={icon} size={20} color={glyph} />}
      testID={testID}
    />
  );
}
