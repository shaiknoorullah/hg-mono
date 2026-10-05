/**
 * `MediaFrame` — a restaurant or dish photo with a designed fallback.
 *
 * The contract makes every image optional (`hero_image_url`, `image_url`), and a URL that
 * exists can still fail to load. Both cases land on the same neutral plate: the sunken surface,
 * a plate glyph and, where there is room, "No image". Never a bundled photograph (C-13 rule 4):
 * a stock picture of food the restaurant does not cook would be a claim about its kitchen.
 *
 * Purely decorative: the name next to it carries the identity, so the frame is hidden from
 * assistive technology.
 */
import * as React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { Icon, useTheme, useTypeStyle } from '@hg/ui-native';

export interface MediaFrameProps {
  uri: string | null | undefined;
  width?: DimensionValue;
  height?: number;
  aspectRatio?: number;
  radius?: number;
  /** Shows "No image" under the glyph. Off for thumbnails too small to hold it. */
  caption?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function MediaFrame({
  uri,
  width = '100%',
  height,
  aspectRatio,
  radius = 0,
  caption = false,
  style,
  testID = 'MediaFrame',
}: MediaFrameProps): React.ReactElement {
  const theme = useTheme();
  const captionType = useTypeStyle('label.sm');
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [uri]);

  const showImage = Boolean(uri) && !failed;
  const glyph = typeof height === 'number' && height < 80 ? 24 : 32;

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[
        styles.frame,
        {
          width,
          height,
          aspectRatio,
          borderRadius: radius,
          backgroundColor: theme.color.surface.sunken,
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          testID={`${testID}-image`}
          source={{ uri: uri as string }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <View testID={`${testID}-fallback`} style={styles.fallback}>
          <Icon name="plate" size={glyph} color={theme.color.text.tertiary} />
          {caption ? (
            <Text style={[captionType, { color: theme.color.text.secondary }]}>No image</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', position: 'relative' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
});
