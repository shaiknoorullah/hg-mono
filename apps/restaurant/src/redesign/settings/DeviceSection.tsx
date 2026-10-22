/**
 * "This device" (settings boards `Settings-Device`, `Device-SoundOff`, `Device-SoundPlaying`,
 * `Device-SoundBlocked`, `Device-NotificationsAsk`, `Device-NotificationsAsking`,
 * `Device-NotificationsBlocked`, `Device-NoWakeLock`; canvas `PartDevice`).
 *
 * Everything here belongs to this browser: it is read from the browser and saved in the browser,
 * so there is no server call and no loading or error of its own. The empty case is a browser
 * that cannot do a thing (no notifications, no wake lock): the row says so and does not offer
 * what cannot work.
 */
import { Badge, Button, GlyphIcon, Switch } from '../ds';
import type { BadgeProps } from '../ds';
import { setDevicePrefs } from '../data/devicePrefs';
import { canKeepScreenOn, useDevicePrefs, useNotifications, useSoundTest, type NotificationsState } from './device';

const card = 'flex flex-col gap-4 rounded-lg border border-line-decorative bg-surface-raised p-6';
const row = 'flex flex-col gap-2 border-t border-line-decorative pt-3';

const NOTIFICATION: Record<NotificationsState, { tone: NonNullable<BadgeProps['variant']>; appearance?: BadgeProps['appearance']; icon?: BadgeProps['icon']; label: string; text: string }> = {
  allowed: { tone: 'neutral', icon: 'check', label: 'Allowed', text: 'New orders also show as a browser notification when this tab is in the background.' },
  ask: { tone: 'neutral', appearance: 'outline', label: 'Not turned on', text: 'Turn them on so new orders show even when this tab is in the background.' },
  asking: { tone: 'neutral', appearance: 'outline', label: 'Not turned on', text: 'Your browser is asking whether to allow notifications. Choose Allow in its prompt.' },
  blocked: {
    tone: 'warning',
    label: 'Blocked in this browser',
    text: "To allow them, open this site's settings in your browser (the icon beside the address) and set Notifications to Allow. Then reload this page.",
  },
  unsupported: { tone: 'neutral', appearance: 'outline', label: 'Not available', text: 'This browser can’t show notifications. New orders still ring and appear in the strip at the top of every page.' },
};

const ON_OFF = { on: 'On', off: 'Off' };

export function DeviceSection() {
  const prefs = useDevicePrefs();
  const notifications = useNotifications();
  const test = useSoundTest();
  const note = NOTIFICATION[notifications.state];
  const wakeSupported = canKeepScreenOn();

  return (
    <section aria-labelledby="device-h" className="flex flex-col gap-4" data-testid="section-device">
      <h2 id="device-h" className="m-0 text-heading-md">
        This device
      </h2>
      <div className={card}>
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-heading-lg">On this browser</h3>
          <p className="m-0 text-body-md text-fg-secondary">Keep this screen open and on while you're accepting orders. These settings belong to this browser only.</p>
        </div>

        <div className={row} data-testid="device-sound">
          <Switch
            label="Order sound"
            stateLabel={ON_OFF}
            description="Rings until each new order is accepted, rejected or expires."
            checked={!prefs.soundOff}
            onChange={(on) => setDevicePrefs({ soundOff: !on })}
          />
          {prefs.soundOff ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-label-md text-feedback-warning-tint-text" data-testid="sound-off-warning">
              <GlyphIcon name="warning" size="sm" className="text-feedback-warning-icon" />
              You won't hear new orders. They still appear in the strip at the top of every page. Turn the sound on while you're accepting orders.
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="tertiary" size="md" loading={test.state === 'playing'} onPress={test.play}>
              {test.state === 'playing' ? 'Playing the order sound' : 'Play the order sound'}
            </Button>
            {test.state === 'playing' ? (
              <span role="status" className="text-body-sm text-fg-secondary">
                Playing now. Check the volume on this device.
              </span>
            ) : null}
            {test.state === 'blocked' ? (
              <span role="status" className="text-body-sm text-feedback-warning-tint-text" data-testid="sound-blocked">
                Your browser blocked the sound. Click anywhere on this page, then try again. New orders still show on screen.
              </span>
            ) : null}
          </div>
        </div>

        <div className={row} data-testid="device-notifications">
          <div className="flex items-center gap-3">
            <span className="flex-grow text-label-lg">Browser notifications</span>
            <Badge size="md" variant={note.tone} appearance={note.appearance} icon={note.icon} label={note.label} testId="notifications-badge" />
          </div>
          <span className="text-body-sm text-fg-secondary">{note.text}</span>
          {notifications.state === 'ask' || notifications.state === 'asking' ? (
            <div className="flex">
              <Button variant="tertiary" size="md" iconStart="bell" loading={notifications.state === 'asking'} onPress={() => void notifications.ask()}>
                {notifications.state === 'asking' ? 'Waiting for your browser' : 'Turn on notifications'}
              </Button>
            </div>
          ) : null}
        </div>

        <div className={row} data-testid="device-wake">
          <Switch
            label="Keep the screen on"
            stateLabel={ON_OFF}
            description="Stops the screen dimming while this page is open."
            checked={wakeSupported && !prefs.screenMayDim}
            disabled={!wakeSupported}
            onChange={(on) => setDevicePrefs({ screenMayDim: !on })}
          />
          {!wakeSupported ? (
            <span className="text-body-sm text-fg-secondary" data-testid="no-wake-lock">
              This browser can't keep the screen on. Set your device to stay awake while it's plugged in.
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
