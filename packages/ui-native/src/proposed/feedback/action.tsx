/**
 * One `ActionSpec` rendered as the RNR `Button` from `@hg/ui-native/lib`: the shared action of
 * Banner, InlineAlert, ErrorState and EmptyState.
 *
 * `loading` is not `disabled`: a busy action keeps its colour and its name, says it is busy and
 * swallows presses, so a double tap cannot send the request twice.
 */
import * as React from 'react';

import { Button } from '../../lib/ui/button';
import { Spinner } from '../../lib/ui/spinner';
import { Text } from '../../lib/ui/text';
import type { ActionSpec } from './shared';

const noop = () => undefined;

/** The RNR Button for one action: 44pt, or 56pt in the rider register. */
export function FeedbackAction({
  action,
  variant = 'default',
  field,
  fullWidth = false,
}: {
  action: ActionSpec;
  variant?: 'default' | 'outline' | 'ghost';
  field: boolean;
  fullWidth?: boolean;
}): React.ReactElement {
  const busy = !!action.loading;
  return (
    <Button
      variant={action.destructive ? 'destructive' : variant}
      size={field ? 'field' : 'default'}
      disabled={!!action.disabled}
      onPress={busy ? noop : action.onPress}
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={{ disabled: !!action.disabled, busy }}
      testID={action.testID}
      className={fullWidth ? 'self-stretch' : 'self-start'}
    >
      {busy ? <Spinner size="sm" /> : null}
      <Text>{action.label}</Text>
    </Button>
  );
}
