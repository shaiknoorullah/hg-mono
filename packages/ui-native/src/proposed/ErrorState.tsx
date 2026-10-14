/**
 * `ErrorState` on React Native Reusables (proposed, #191; N5). Every screen's error third.
 *
 * Copy is keyed off the contract's stable `error.code` through the shared `ERROR_COPY` table
 * (`feedback/error-copy.ts`), never off `error.message`; an unmapped code falls back to generic
 * copy and reports the gap (`onUnmappedCode`). Offline is its own state with its own copy.
 *
 * `page` replaces a whole screen (no plate; the action sits in the bottom third for the rider);
 * `inline` replaces the part the user was acting on (a tinted plate, assertive, focus moves to
 * its heading). Retry is a real button with a busy state; technical detail is collapsed and
 * always copyable, because support cannot work from "something went wrong".
 *
 * Halal: an error about certification (`RESTAURANT_UNAVAILABLE`, or `halal`) is slate, never
 * danger (invariant 9). `tone` cannot be `danger` when `halal` is set, in the type system.
 */
import * as React from 'react';
import { View as FocusTarget } from 'react-native';
import type { ErrorCode } from '@hg/api-client';

import { copyForCode, GENERIC_COPY, OFFLINE_COPY, type ErrorCopy } from '../feedback/error-copy';
import { moveAccessibilityFocus, useAnnounceOnce } from '../feedback/internal/a11y';
import { copyToClipboard } from '../feedback/internal/clipboard';
import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle } from '../lib/ui/alert';
import { Button } from '../lib/ui/button';
import { Glyph } from '../lib/ui/icon';
import { Text } from '../lib/ui/text';
import { View } from '../lib/ui/view';
import { FeedbackAction } from './feedback/action';
import {
  type ActionSpec,
  type FeedbackTone,
  HALAL_ERROR_CODES,
  type HalalTone,
  resolveTestId,
  useFieldRegister,
} from './feedback/shared';

/** What support needs to find the request. Never shown until asked for. */
export interface ErrorTechnicalDetail {
  /** `x-request-id` from the response. */
  requestId?: string | null;
  code?: string | null;
  detail?: string | null;
}

/** Tones an error may take; there is no success and no brand. */
export type ErrorTone = Exclude<FeedbackTone, 'info'>;

interface ErrorStateBaseProps {
  /** `page` replaces the screen; `inline` (default) replaces the part the user was acting on. */
  placement?: 'page' | 'inline';
  /**
   * @deprecated Use `placement`. Kept for one release; the legacy `toast` and `table` read as
   * `inline`.
   */
  variant?: 'page' | 'inline' | 'toast' | 'table';
  /** The contract's stable code. Widened so an unrecognised code is data, not a crash. */
  errorCode?: ErrorCode | (string & {}) | null;
  /** Network offline: distinct copy, neutral tone. */
  offline?: boolean;
  /** Overrides the code's copy. Use sparingly; the table is the shared source. */
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** Retry in flight: the button stays, says busy and ignores presses. */
  retrying?: boolean;
  onSupport?: () => void;
  technicalDetail?: ErrorTechnicalDetail;
  /** One more way forward ("Browse restaurants"). */
  action?: ActionSpec;
  /** Decorative; hidden from assistive tech. `page` only. */
  illustration?: React.ReactNode;
  /** Called once per unmapped code: wire it to the client-error reporter. */
  onUnmappedCode?: (code: string) => void;
  /** Move screen-reader focus to the heading on mount (default on). */
  autoFocus?: boolean;
  /** Overrides the clipboard write (e.g. to raise the app's own toast). */
  onCopyDetail?: (text: string) => void;
  /** 44pt (`default`) or the rider's 56pt (`field`). Defaults to the theme's register. */
  size?: 'default' | 'field';
  testId?: string;
  testID?: string;
}

/** An error about anything but halal certification. */
export interface GeneralErrorStateProps extends ErrorStateBaseProps {
  halal?: false;
  /** Defaults to danger, or neutral when offline. */
  tone?: ErrorTone;
}

/** An error whose message is about halal certification: slate, never danger. */
export interface HalalErrorStateProps extends ErrorStateBaseProps {
  halal: true;
  tone?: Exclude<HalalTone, 'info'>;
}

/** Props of `ErrorState`: a general error, or one about halal certification (slate, never danger). */
export type ErrorStateProps = GeneralErrorStateProps | HalalErrorStateProps;

function resolveCopy(props: ErrorStateProps, report: (code: string) => void): ErrorCopy {
  if (props.offline) return OFFLINE_COPY;
  const mapped = copyForCode(props.errorCode);
  if (!mapped && props.errorCode) report(String(props.errorCode));
  return mapped ?? GENERIC_COPY;
}

function resolveTone(props: ErrorStateProps): FeedbackTone {
  const halal = props.halal || (props.errorCode != null && HALAL_ERROR_CODES.has(String(props.errorCode)));
  if (halal) return props.tone && props.tone !== ('danger' as FeedbackTone) ? props.tone : 'slate';
  if (props.tone) return props.tone;
  return props.offline ? 'neutral' : 'danger';
}

function detailTextOf(props: ErrorStateProps): string {
  const t = props.technicalDetail;
  if (!t) return '';
  return [
    t.code ? `code: ${t.code}` : props.errorCode ? `code: ${String(props.errorCode)}` : null,
    t.requestId ? `request id: ${t.requestId}` : null,
    t.detail ?? null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The error state of a screen or of a region within it. */
export function ErrorState(props: ErrorStateProps): React.ReactElement {
  const { onRetry, retrying = false, onSupport, action, illustration, onUnmappedCode, onCopyDetail } = props;
  const placement = props.placement ?? (props.variant === 'page' ? 'page' : 'inline');
  const page = placement === 'page';
  const autoFocus = props.autoFocus ?? true;
  const themeField = useFieldRegister();
  const field = props.size ? props.size === 'field' : themeField;
  const testID = resolveTestId(props, 'ErrorState');
  const tone = resolveTone(props);

  const reported = React.useRef<string | null>(null);
  const copy = resolveCopy(props, (code) => {
    if (reported.current === code) return;
    reported.current = code;
    onUnmappedCode?.(code);
  });
  const title = props.title ?? copy.title;
  const description = props.description ?? copy.description;

  const headingRef = React.useRef(null);
  React.useEffect(() => {
    if (autoFocus) moveAccessibilityFocus(headingRef);
  }, [autoFocus, title]);
  useAnnounceOnce(`${title}. ${description}`);

  const [detailOpen, setDetailOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const detailText = detailTextOf(props);

  const showRetry = !!onRetry && copy.retryable;
  const showSupport = !!onSupport && copy.supportable;
  const actions =
    showRetry || action || showSupport ? (
      <View className={page ? 'w-full gap-3' : 'mt-2 gap-2'}>
        {showRetry ? (
          <FeedbackAction
            action={{ label: 'Try again', onPress: onRetry, loading: retrying, testID: `${testID}-retry` }}
            field={field}
            fullWidth={page || field}
          />
        ) : null}
        {action ? <FeedbackAction action={action} variant="outline" field={field} fullWidth={page || field} /> : null}
        {showSupport ? (
          <FeedbackAction
            action={{ label: 'Contact support', onPress: onSupport, testID: `${testID}-support` }}
            variant="ghost"
            field={field}
            fullWidth={page || field}
          />
        ) : null}
      </View>
    ) : null;

  const detail = detailText ? (
    <View className="w-full gap-2">
      <Button
        variant="ghost"
        size={field ? 'field' : 'default'}
        className="self-start px-0"
        accessibilityLabel={detailOpen ? 'Hide technical details' : 'Show technical details'}
        accessibilityState={{ expanded: detailOpen }}
        onPress={() => setDetailOpen((open) => !open)}
        testID={`${testID}-detail-toggle`}
      >
        <Glyph name={detailOpen ? 'chevron-down' : 'chevron-right'} size={16} className="text-fg-secondary" />
        <Text>Technical details</Text>
      </Button>
      {detailOpen ? (
        <View className="gap-2">
          <Text selectable className="font-mono text-mono-md text-fg-secondary">
            {detailText}
          </Text>
          <Button
            variant="outline"
            size={field ? 'field' : 'default'}
            className="self-start"
            accessibilityLabel="Copy technical details"
            onPress={() => {
              if (onCopyDetail) onCopyDetail(detailText);
              else copyToClipboard(detailText);
              setCopied(true);
            }}
            testID={`${testID}-detail-copy`}
          >
            <Text>{copied ? 'Copied' : 'Copy'}</Text>
          </Button>
        </View>
      ) : null}
    </View>
  ) : null;

  if (!page) {
    return (
      <Alert testID={testID} tone={tone} placement="inline" field={field} accessibilityRole="alert">
        <AlertIcon />
        <AlertContent>
          <FocusTarget ref={headingRef} accessible accessibilityRole="header">
            <AlertTitle>{title}</AlertTitle>
          </FocusTarget>
          <AlertDescription>{description}</AlertDescription>
          {actions}
          {detail}
        </AlertContent>
      </Alert>
    );
  }

  return (
    <View testID={testID} accessibilityRole="summary" className={field ? 'flex-1 gap-6 p-6' : 'gap-4 p-6'}>
      <View className="items-center gap-4">
        {illustration ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {illustration}
          </View>
        ) : null}
        <Alert tone={tone} placement="inline" field={field} className="border-0 bg-transparent p-0">
          <AlertIcon />
        </Alert>
        <FocusTarget ref={headingRef} accessible accessibilityRole="header">
          <Text
            className={field ? 'text-center font-sans-bold text-heading-xl' : 'text-center font-sans-semibold text-heading-lg'}
          >
            {title}
          </Text>
        </FocusTarget>
        <Text className={field ? 'text-center text-body-lg' : 'text-center text-fg-secondary'}>{description}</Text>
      </View>
      {/* Rider: the way forward sits in the bottom third, in reach of the thumb. */}
      {actions ? <View className={field ? 'mt-auto' : undefined}>{actions}</View> : null}
      {detail}
    </View>
  );
}
