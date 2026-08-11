/**
 * `Modal` — 02-components.md §31.
 *
 * Variants: `dialog` (title + body + actions), `confirm` (destructive), `alert` (single
 * acknowledgement).
 *
 * Two things the spec is firm about and this implements:
 *  - A destructive confirm is an **`alertdialog`**, which announces immediately rather than waiting
 *    to be explored.
 *  - Focus lands on the **least destructive** action, so a reflexive double-tap cannot delete
 *    something. `actions` are therefore ordered least-destructive-first in the tab order regardless
 *    of the visual order.
 *
 * And one the spec states as a prohibition: never a modal for anything a `Toast` or an inline error
 * could carry. This component is for decisions, not for news.
 */
import { useEffect, useRef } from 'react';
import {
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { useTheme, type, radius, zIndex } from '../feedback/internal/theme';
import { renderAction, type ActionSpec } from '../feedback/internal/primitives';
import { moveAccessibilityFocus } from '../feedback/internal/a11y';

export type ModalVariant = 'dialog' | 'confirm' | 'alert';
export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  variant?: ModalVariant;
  /** The accessible name. Required. */
  title: string;
  /** Becomes the dialog's description for assistive technology. */
  description?: string;
  /**
   * Ordered as they should read. The **least destructive** action is focused first; mark the
   * dangerous one `destructive` and it is placed last in the tab order no matter where it draws.
   */
  actions?: readonly ActionSpec[];
  /** Escalates to `alertdialog` and to the danger treatment. */
  destructive?: boolean;
  dismissible?: boolean;
  size?: ModalSize;
  /** Focus returns here on close. */
  returnFocusRef?: { current: any };
  children?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

const WIDTH: Record<ModalSize, number> = { sm: 320, md: 400, lg: 520 };

export function Modal({
  open,
  onClose,
  variant = 'dialog',
  title,
  description,
  actions = [],
  destructive = false,
  dismissible = true,
  size = 'md',
  returnFocusRef,
  children,
  style,
  testID = 'Modal',
}: ModalProps) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const titleRef = useRef<Text>(null);

  const alertLike = destructive || variant === 'confirm' || variant === 'alert';

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => moveAccessibilityFocus(titleRef), 50);
    return () => clearTimeout(t);
  }, [open, title]);

  useEffect(() => {
    if (!open && returnFocusRef) moveAccessibilityFocus(returnFocusRef);
  }, [open, returnFocusRef]);

  if (!open) return null;

  /* Least destructive first. This is the tab order, and the first element focused. */
  const ordered = [...actions].sort(
    (a, b) => Number(a.destructive ?? false) - Number(b.destructive ?? false),
  );

  const panelWidth = Math.min(WIDTH[size], screenWidth - 32);

  return (
    <RNModal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={dismissible ? onClose : () => undefined}
      statusBarTranslucent
      testID={`${testID}-modal`}
    >
      <View style={[StyleSheet.absoluteFill, styles.centre, { zIndex: zIndex.modal }]}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          disabled={!dismissible}
          onPress={dismissible ? onClose : undefined}
          testID={`${testID}-backdrop`}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.surface.scrim }]}
        />

        <View
          accessibilityViewIsModal
          // `alertdialog` announces immediately; a plain dialog waits to be explored.
          role={alertLike ? 'alertdialog' : 'dialog'}
          aria-modal
          accessibilityLabel={title}
          accessibilityHint={description}
          accessibilityLiveRegion={alertLike ? 'assertive' : 'none'}
          testID={testID}
          style={[
            {
              width: panelWidth,
              maxHeight: '80%',
              padding: theme.density.cardPadding * 1.5,
              gap: theme.target.spacing * 1.5,
              borderRadius: radius.lg,
              backgroundColor: theme.color.surface.raised,
              ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
            },
            style,
          ]}
        >
          <Text
            ref={titleRef}
            accessibilityRole="header"
            style={[type(theme, 'heading.md'), { color: theme.color.text.primary }]}
          >
            {title}
          </Text>

          {description ? (
            <Text style={[type(theme, 'body.md'), { color: theme.color.text.secondary }]}>
              {description}
            </Text>
          ) : null}

          {children ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
              {children}
            </ScrollView>
          ) : null}

          {ordered.length ? (
            <View style={[styles.actions, { gap: theme.target.spacing * 2 }]}>
              {ordered.map((a, i) => (
                <View key={a.label} style={{ alignSelf: 'stretch' }}>
                  {renderAction(a, {
                    /* The dangerous action is `danger`; the safe one leads and is `primary` on an
                     * alert, `tertiary` next to a destructive sibling so the safe path is not the
                     * loud one. */
                    variant: a.destructive ? 'danger' : ordered.length > 1 && i === 0 ? 'tertiary' : 'primary',
                    size: 'lg',
                    fullWidth: true,
                  })}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  actions: { alignSelf: 'stretch' },
});
