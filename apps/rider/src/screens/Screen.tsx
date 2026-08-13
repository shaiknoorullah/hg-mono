/**
 * Shared chrome and state views for the rider work-loop screens.
 *
 * `Screen` gives every flow the same skeleton: an `AppBar` with a back affordance wired to the
 * nav stack, and a scrolling body sized off the RIDER register (roomy gutters, 56pt targets).
 * `LoadingView` / `ErrorView` / `EmptyView` are the three states the design system requires on
 * every screen (03/§ AGENTS.md), built from real `@hg/ui-native` components so they read at the
 * register's density — not ad-hoc `<Text>Loading…</Text>` placeholders.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  AppBar,
  Card,
  EmptyState,
  ErrorState,
  Spinner,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { useNav } from '../nav';

export function Screen({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar
        title={title}
        subtitle={subtitle}
        loading={loading}
        back={nav.canGoBack ? { onPress: nav.pop, previousTitle: 'Shift' } : undefined}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: theme.density.gutter,
          gap: theme.density.gutter,
          maxWidth: 640,
          alignSelf: 'center',
          width: '100%',
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** A labelled loading row inside a card — used while a GET is in flight. */
export function LoadingView({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.lg');
  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.density.gutter,
          minHeight: theme.target.min,
        }}
      >
        <Spinner size="md" />
        <Text style={{ ...body, color: theme.color.text.secondary }}>{label}</Text>
      </View>
    </Card>
  );
}

export function ErrorView({
  message,
  errorCode,
  onRetry,
  retrying,
}: {
  message?: string;
  errorCode?: string | null;
  onRetry: () => void;
  retrying?: boolean;
}): React.ReactElement {
  return (
    <ErrorState
      variant="inline"
      errorCode={errorCode ?? undefined}
      description={message}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}

export function EmptyView({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <EmptyState
      variant="inline"
      title={title}
      description={description}
      primaryAction={actionLabel && onAction ? { label: actionLabel, onPress: onAction } : undefined}
    />
  );
}
