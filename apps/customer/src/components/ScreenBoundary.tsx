/**
 * The last line of defence for the order screens (cart, checkout, tracking, orders).
 *
 * Each screen already turns every API failure into a designed state, so nothing should reach
 * this. It exists for the failures nobody predicted, such as a payload that does not match the
 * contract: a render-time throw unmounts the whole React tree, which on a phone reads as the app
 * crashing. Here it becomes the same full-screen error every screen uses, with "Try again"
 * (remount the screen) and a way out, and the order itself is untouched.
 */
import * as React from 'react';
import { View } from 'react-native';
import { ErrorState, useTheme } from '@hg/ui-native';

interface Props {
  /** What failed to load, for the heading: "We couldn't show your cart". */
  what: string;
  /** Leave the screen, e.g. back to the cart or to Home. */
  exit?: { label: string; onPress: () => void };
  children: React.ReactNode;
}

interface State {
  failed: boolean;
  attempt: number;
}

class Boundary extends React.Component<Props & { background: string }, State> {
  state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // Kept visible in development and in device logs; never shown to the customer.
    console.error('[hg:screen-boundary]', this.props.what, error);
  }

  render(): React.ReactNode {
    if (!this.state.failed) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }
    const { what, exit, background } = this.props;
    return (
      <View
        testID="ScreenBoundary"
        style={{ flex: 1, justifyContent: 'center', padding: 16, backgroundColor: background }}
      >
        <ErrorState
          title={`We couldn't show ${what}`}
          description="Something went wrong on this screen. Nothing was charged and nothing about your order changed."
          onRetry={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}
          action={exit ? { label: exit.label, onPress: exit.onPress } : undefined}
        />
      </View>
    );
  }
}

export function ScreenBoundary(props: Props): React.ReactElement {
  const theme = useTheme();
  return <Boundary {...props} background={theme.color.surface.base} />;
}
