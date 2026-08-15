/**
 * The notification inbox (P-24, `GET /v1/notifications`). Reading is non-destructive — this
 * screen never deletes on view; tapping an unread row marks it read via
 * `POST /v1/notifications/{id}/read` and, when the notification names an order, opens tracking.
 */
import * as React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppBar,
  Badge,
  Divider,
  EmptyState,
  ErrorState,
  Spinner,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { Schema } from '@hg/api-client';

import { listNotifications, markNotificationRead } from '../api/notifications';
import { useAsync, type Async } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';

type Notification = Schema['Notification'];

export function NotificationsScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const [readIds, setReadIds] = React.useState<Set<string>>(new Set());

  const { state, reload } = useAsync(() => listNotifications(), []);

  const onOpen = React.useCallback(
    async (n: Notification) => {
      if (n.read_at === null && !readIds.has(n.id)) {
        setReadIds((prev) => new Set(prev).add(n.id));
        markNotificationRead(n.id).catch(() => {
          // Best-effort: the row already reads as read locally; a retry-on-reload will re-sync.
        });
      }
      if (n.order_id) {
        nav.push({ name: 'tracking', orderId: n.order_id });
      }
    },
    [nav, readIds],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar title="Notifications" />
      <View style={{ flex: 1 }}>
        <Body state={state} onRetry={reload} onOpen={onOpen} readIds={readIds} bottomInset={insets.bottom} />
      </View>
      <CustomerTabBar active="notifications" />
    </View>
  );
}

function Body({
  state,
  onRetry,
  onOpen,
  readIds,
  bottomInset,
}: {
  state: Async<{ notifications: Notification[]; meta: unknown }>;
  onRetry: () => void;
  onOpen: (n: Notification) => void;
  readIds: Set<string>;
  bottomInset: number;
}): React.ReactElement {
  if (state.kind === 'loading') {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Spinner label="Loading notifications" />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <ErrorState errorCode={state.code} onRetry={onRetry} />
      </View>
    );
  }

  if (state.data.notifications.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <EmptyState
          title="You're all caught up"
          description="Order updates, offers and account alerts will show up here."
          primaryAction={{ label: 'Refresh', onPress: onRetry }}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={state.data.notifications}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      ItemSeparatorComponent={Divider}
      renderItem={({ item }) => (
        <NotificationRow notification={item} read={item.read_at !== null || readIds.has(item.id)} onPress={() => onOpen(item)} />
      )}
    />
  );
}

function NotificationRow({
  notification,
  read,
  onPress,
}: {
  notification: Notification;
  read: boolean;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const title = useTypeStyle('body.md');
  const body = useTypeStyle('body.sm');
  const caption = useTypeStyle('caption');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}${read ? '' : ', unread'}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          gap: 10,
          padding: 16,
          backgroundColor: pressed
            ? theme.color.state.pressedOverlay
            : read
              ? 'transparent'
              : theme.color.surface.raised,
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          marginTop: 6,
          backgroundColor: read ? 'transparent' : theme.color.action.primary,
        }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[title, { color: theme.color.text.primary, fontWeight: read ? '400' : '700' }]}>
          {notification.title}
        </Text>
        <Text style={[body, { color: theme.color.text.secondary }]}>{notification.body}</Text>
        <Text style={[caption, { color: theme.color.text.tertiary }]}>
          {new Date(notification.created_at).toLocaleString()}
        </Text>
      </View>
      {!read ? <Badge label="New" variant="brand" /> : null}
    </Pressable>
  );
}
