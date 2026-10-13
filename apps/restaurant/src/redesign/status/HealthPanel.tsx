/**
 * The Screen health panel (shell panel `health`, `?panel=health`; LO `Board-health-open`,
 * `Board-health-degraded-sheet`; wp1 spec §7). In the right DetailPanel, never a popover;
 * its heading takes focus on open and Close / Escape return focus to the health button.
 *
 * Rows are composed per facet from live state and omitted when not applicable. Sound and the
 * "Play test chime" footer belong to the strip's work package (WP3), which owns the audio.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, DetailPanel, Icon, type IconName } from '../ds';
import { useConsole } from '../data/console';
import { useAvailability } from '../data/availability';
import { useConnection } from '../data/connection';
import { sendHeartbeat, useHeartbeatHealth } from '../data/heartbeat';
import { formatTime } from '../format/time';
import type { ShellPanelProps } from '../shell/slots';

interface Row {
  key: string;
  icon: IconName | null;
  tone: 'secondary' | 'warning' | 'danger';
  title: string;
  body: string;
  action?: ReactNode;
}

const TONE = { secondary: 'text-fg-secondary', warning: 'text-feedback-warning-icon', danger: 'text-feedback-danger-icon' } as const;

function useSecondsSince(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);
  return at === null ? null : Math.max(0, Math.round((now - at) / 1000));
}

export function HealthPanel({ onClose }: ShellPanelProps) {
  const { timezone } = useConsole();
  const availability = useAvailability();
  const connection = useConnection();
  const beat = useHeartbeatHealth();
  const ago = useSecondsSince(beat.lastOkAt);

  const close = () => {
    onClose();
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-health-button]')?.focus(), 0);
  };

  const rows: Row[] = [];
  if (connection.kind === 'offline') {
    rows.push({
      key: 'connection',
      icon: null,
      tone: 'danger',
      title: `Connection: offline${connection.since ? ` since ${formatTime(connection.since, timezone)}` : ''}`,
      body: 'If no other screen is open, HalalGoes stops sending new orders after 5 minutes without a check-in. This screen can’t tell until it reconnects.',
      action: (
        <Button
          variant="tertiary"
          size="md"
          onPress={() => {
            void sendHeartbeat();
            void availability.refresh();
          }}
        >
          Reconnect now
        </Button>
      ),
    });
  } else if (connection.kind === 'reconnecting') {
    rows.push({
      key: 'connection',
      icon: null,
      tone: 'warning',
      title: `Connection: reconnecting${connection.since ? ` since ${formatTime(connection.since, timezone)}` : ''}`,
      body: 'Orders on screen are safe. Accept and Decline still work.',
    });
  } else {
    rows.push({
      key: 'connection',
      icon: 'check',
      tone: 'secondary',
      title: connection.kind === 'live' ? 'Connection: live' : 'Connection: connecting…',
      body: ago !== null ? `Checked in with HalalGoes ${ago} s ago.` : 'Orders on screen are safe. Accept and Decline still work.',
    });
  }

  const permission = typeof Notification !== 'undefined' ? Notification.permission : null;
  if (connection.kind !== 'offline' && permission === 'granted') {
    rows.push({ key: 'notifications', icon: 'check', tone: 'secondary', title: 'Notifications: allowed', body: 'Alerts reach you on another tab too.' });
  } else if (connection.kind !== 'offline' && permission === 'denied') {
    rows.push({ key: 'notifications', icon: null, tone: 'warning', title: 'Notifications: blocked', body: 'Allow them in the browser’s site settings.' });
  }

  return (
    <DetailPanel title="Screen health" label="Screen health details" closeLabel="Close screen health" onClose={close} testId="health-panel">
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className="flex gap-3 border-b border-line-decorative py-3 last:border-b-0">
            <span className={`mt-0.5 w-6 shrink-0 ${TONE[r.tone]}`}>{r.icon ? <Icon name={r.icon} size={22} /> : null}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold">{r.title}</p>
              <p className="text-[15px] text-fg-secondary">{r.body}</p>
              {r.action ? <div className="mt-2">{r.action}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </DetailPanel>
  );
}
