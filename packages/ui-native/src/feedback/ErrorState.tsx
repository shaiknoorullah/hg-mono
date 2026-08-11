/**
 * `ErrorState` — 02-components.md §36.
 *
 * The other half of the reason every screen in this product can afford to implement all three of
 * empty, loading and error. Copy is keyed off the stable `error.code` enum, never off
 * `error.message`; an unmapped code falls back to generic copy **and reports the gap**.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';
import type { ErrorCode } from '@hg/api-client';

import { useTheme, type, toneOf, radius, icon } from './internal/theme';
import { renderAction, type ActionSpec } from './internal/primitives';
import { moveAccessibilityFocus } from './internal/a11y';
import { BangGlyph, ChevronGlyph } from './internal/glyphs';
import { copyForCode, GENERIC_COPY, OFFLINE_COPY, type ErrorCopy } from './error-copy';
import { copyToClipboard } from './internal/clipboard';

export type ErrorStateVariant = 'page' | 'inline' | 'toast' | 'table';

export interface ErrorTechnicalDetail {
  /** `x-request-id` from the response. Support cannot work without it. */
  requestId?: string | null;
  code?: string | null;
  /** Anything else worth pasting into a support ticket. Never shown by default. */
  detail?: string | null;
}

export interface ErrorStateProps {
  variant?: ErrorStateVariant;
  /** The contract's stable code. Widened so an unrecognised code is data, not a crash. */
  errorCode?: ErrorCode | (string & {}) | null;
  /** Distinct state with distinct copy — not a generic error (02-components.md §36). */
  offline?: boolean;
  /** Overrides the code-derived copy. Use sparingly; the table is the shared source. */
  title?: string;
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
  onSupport?: () => void;
  technicalDetail?: ErrorTechnicalDetail;
  /** Extra action beyond Retry/Support, e.g. "Clear filters" or "Browse restaurants". */
  action?: ActionSpec;
  illustration?: ReactNode;
  /**
   * Reported for every code with no entry in the copy table, so the gap is discoverable. Wire this
   * to the app's client-error reporter.
   */
  onUnmappedCode?: (code: string) => void;
  /**
   * Move AT focus here on mount. 04-accessibility.md §4.2: focus moves to the error when the error
   * replaces the content the user was acting on. Defaults on for `inline`, which is that case.
   */
  autoFocus?: boolean;
  /** Overrides the built-in clipboard write, e.g. to route through the app's own toast. */
  onCopyDetail?: (text: string) => void;
  style?: ViewStyle;
  testID?: string;
}

function resolveCopy(props: ErrorStateProps, report?: (code: string) => void): ErrorCopy {
  if (props.offline) return OFFLINE_COPY;
  const mapped = copyForCode(props.errorCode);
  if (!mapped && props.errorCode) report?.(String(props.errorCode));
  return mapped ?? GENERIC_COPY;
}

export function ErrorState(props: ErrorStateProps) {
  const {
    variant = 'inline',
    onRetry,
    retrying = false,
    onSupport,
    technicalDetail,
    action,
    illustration,
    onUnmappedCode,
    autoFocus = variant === 'inline' || variant === 'page',
    onCopyDetail,
    style,
    testID = 'ErrorState',
  } = props;

  const theme = useTheme();
  const tone = toneOf(theme, 'danger');
  const headingRef = useRef<Text>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const reportedRef = useRef<string | null>(null);
  const copy = resolveCopy(props, (code) => {
    if (reportedRef.current === code) return;
    reportedRef.current = code;
    onUnmappedCode?.(code);
  });

  const title = props.title ?? copy.title;
  const description = props.description ?? copy.description;

  useEffect(() => {
    if (autoFocus) moveAccessibilityFocus(headingRef);
  }, [autoFocus, title]);

  const detailText = technicalDetail
    ? [
        technicalDetail.code ? `code: ${technicalDetail.code}` : null,
        props.errorCode && !technicalDetail.code ? `code: ${String(props.errorCode)}` : null,
        technicalDetail.requestId ? `request id: ${technicalDetail.requestId}` : null,
        technicalDetail.detail ?? null,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const page = variant === 'page';
  const compact = variant === 'toast';

  return (
    <View
      testID={testID}
      // `role="alert"` for inline — it interrupts, because it replaced what the user was doing.
      accessibilityRole={variant === 'inline' ? 'alert' : 'summary'}
      accessibilityLiveRegion={variant === 'inline' ? 'assertive' : 'polite'}
      style={[
        styles.root,
        {
          gap: theme.target.spacing,
          padding: compact ? theme.density.cardPadding : theme.density.cardPadding * (page ? 2 : 1),
          alignItems: page ? 'center' : 'flex-start',
          backgroundColor: page ? 'transparent' : tone.tint,
          borderColor: tone.border,
          borderWidth: page ? 0 : StyleSheet.hairlineWidth,
          borderRadius: page ? 0 : radius.md,
        },
        style,
      ]}
    >
      {illustration && page ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {illustration}
        </View>
      ) : null}

      <View style={[styles.headingRow, { gap: theme.target.spacing }]}>
        {/* Never colour alone: the bang carries the severity as a shape (04-a11y §1.4). */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <BangGlyph size={icon.lg} color={tone.glyph} />
        </View>
        <Text
          ref={headingRef}
          accessibilityRole="header"
          style={[
            type(theme, page ? 'heading.lg' : 'heading.sm'),
            { color: theme.color.text.primary, flexShrink: 1 },
          ]}
        >
          {title}
        </Text>
      </View>

      <Text style={[type(theme, 'body.md'), { color: theme.color.text.secondary }]}>
        {description}
      </Text>

      {/* Retry is a real button, never a link styled as text (02-components.md §36). */}
      {(onRetry && copy.retryable) || action || (onSupport && copy.supportable) ? (
        <View style={[styles.actions, { gap: theme.target.spacing * 2 }]}>
          {onRetry && copy.retryable
            ? renderAction(
                { label: 'Try again', onPress: onRetry, loading: retrying, testID: `${testID}-retry` },
                { variant: 'primary', size: page ? 'lg' : 'md', fullWidth: page },
              )
            : null}
          {action ? renderAction(action, { variant: 'tertiary', size: page ? 'lg' : 'md', fullWidth: page }) : null}
          {onSupport && copy.supportable
            ? renderAction(
                { label: 'Contact support', onPress: onSupport, testID: `${testID}-support` },
                { variant: 'ghost', size: page ? 'lg' : 'md', fullWidth: page },
              )
            : null}
        </View>
      ) : null}

      {/* Collapsed by default and always copyable — support cannot work from "something went wrong". */}
      {detailText ? (
        <View style={styles.detail}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: detailOpen }}
            accessibilityLabel={detailOpen ? 'Hide technical details' : 'Show technical details'}
            hitSlop={theme.target.spacing}
            onPress={() => setDetailOpen((v) => !v)}
            style={[styles.headingRow, { minHeight: theme.target.min, gap: theme.target.spacing }]}
            testID={`${testID}-detail-toggle`}
          >
            <ChevronGlyph
              size={icon.md}
              color={theme.color.text.secondary}
              direction={detailOpen ? 'up' : 'down'}
            />
            <Text style={[type(theme, 'label.md'), { color: theme.color.text.secondary }]}>
              Technical details
            </Text>
          </Pressable>

          {detailOpen ? (
            <View style={{ gap: theme.target.spacing }}>
              <Text selectable style={[type(theme, 'mono.sm'), { color: theme.color.text.secondary }]}>
                {detailText}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy technical details"
                hitSlop={theme.target.spacing}
                onPress={() => {
                  if (onCopyDetail) onCopyDetail(detailText);
                  else copyToClipboard(detailText);
                  setCopied(true);
                }}
                style={{ minHeight: theme.target.min, justifyContent: 'center' }}
                testID={`${testID}-detail-copy`}
              >
                <Text style={[type(theme, 'label.md'), { color: theme.color.text.link }]}>
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch' },
  headingRow: { flexDirection: 'row', alignItems: 'center' },
  actions: { alignSelf: 'stretch' },
  detail: { alignSelf: 'stretch' },
});
