import React, { useEffect, useRef, useState } from 'react';
import { resolveTimeline, ORDER_STATE_LABELS } from './order-track.js';
import { formatClockTime } from '../internal/format.js';
import { reportClientError } from '../internal/report.js';
import { Skel, Tick } from '../internal/ui.jsx';
import '../internal/css.js';

/* StatusTimeline — 02-components.md §23. Driven by the ORDER STATE and the AUDIENCE, never by
   free labels and an index: the mapping lives in one shared module (order-track.js) so no two
   surfaces can disagree about what an order state is called.
   Step states: complete · current · stalled (deadline passed, still here: warning + a line
   saying so) · failed (CANCELLED / REJECTED / FAILED) · upcoming · unreached.
   Variants: vertical (default) · horizontal · compact (bar + current label).
   States: loading (skeleton with the right number of steps) · reconnecting (keeps the last
   known state and says "Not updating — reconnecting"; never blanks) · unknown state (reported,
   rendered as all-upcoming with a refresh message, never a crash).
   A11y: role=list; each step "{label}, {state}, {time}"; current step aria-current="step";
   changes announced politely ONCE per change (deduplicated). */

const STATE_WORD = { complete: 'done', current: 'in progress', stalled: 'delayed', failed: 'stopped', upcoming: 'not started', unreached: 'will not happen' };

function nodeColours(st) {
  if (st === 'complete' || st === 'current') return { bg: 'var(--action-primary)', fg: 'var(--text-on-brand)', line: 'var(--action-primary)' };
  if (st === 'stalled') return { bg: 'var(--color-warning-600)', fg: 'var(--color-neutral-0)', line: 'var(--color-neutral-200)' };
  if (st === 'failed') return { bg: 'var(--color-danger-500)', fg: 'var(--color-neutral-0)', line: 'var(--color-neutral-200)' };
  return { bg: 'var(--surface-raised)', fg: 'var(--text-tertiary)', line: 'var(--color-neutral-200)', ring: 'var(--border-interactive)' };
}

export function StatusTimeline({
  audience = 'customer', state, transitions, orientation = 'vertical', showTimes = true, estimatedAt,
  deadlineAt, loading = false, connection = 'live', onUnknownState, now, testId, style, ...rest
}) {
  const t = loading ? null : resolveTimeline({ audience, state, transitions, deadlineAt, now });
  const [announce, setAnnounce] = useState('');
  const last = useRef(null);

  useEffect(() => {
    if (!t) return;
    if (t.unknownState) {
      reportClientError('UNKNOWN_ENUM_VALUE', { component: 'StatusTimeline', field: 'state', received: t.unknownState });
      if (onUnknownState) onUnknownState(t.unknownState);
      return;
    }
    const cur = t.steps.find((s) => s.state === 'current' || s.state === 'stalled' || s.state === 'failed');
    const sig = state + '|' + (cur ? cur.key + ':' + cur.state : 'done');
    if (last.current !== null && last.current !== sig) {
      setAnnounce(cur ? cur.label + ', ' + STATE_WORD[cur.state] : 'Order ' + (ORDER_STATE_LABELS[state] || '').toLowerCase());
    }
    last.current = sig;
  }, [state, t && t.steps.map((s) => s.state).join(',')]);

  const root = { 'data-testid': testId || 'StatusTimeline', 'data-orientation': orientation };

  if (loading) {
    const n = { customer: 5, restaurant: 7, rider: 6, admin: 9 }[audience] || 5;
    return (
      <div {...root} aria-busy="true" style={{ display: 'grid', gap: 'var(--space-3)', ...style }} {...rest}>
        <span className="hg-sr">Loading order status.</span>
        {Array.from({ length: orientation === 'compact' ? 1 : n }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <Skel w={20} h={20} r="var(--radius-full)" /><Skel w={i % 2 ? '40%' : '55%'} h={14} />
          </div>
        ))}
      </div>
    );
  }

  const time = (at) => (at ? formatClockTime(at) : null);
  const banner = t.unknownState ? 'This order is in a state this app does not recognise. Refresh to see the latest status.'
    : connection === 'reconnecting' ? 'Not updating — reconnecting' : null;
  const stalledStep = t.steps.find((s) => s.state === 'stalled');
  const failedLine = t.failed ? (ORDER_STATE_LABELS[state] || 'Stopped') : null;
  const eta = estimatedAt ? time(estimatedAt) : null;

  const live = <span className="hg-sr" aria-live="polite" aria-atomic="true">{announce}</span>;
  const notice = banner ? (
    <div role="status" style={{ padding: 'var(--space-2) var(--space-3)', marginBlockEnd: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-50)', border: '1px solid var(--color-warning-100)', color: 'var(--color-warning-700)', fontSize: 'var(--type-body-sm-size)' }}>{banner}</div>
  ) : null;

  if (orientation === 'compact') {
    const done = t.steps.filter((s) => s.state === 'complete').length;
    const cur = t.steps.find((s) => s.state !== 'complete' && s.state !== 'upcoming' && s.state !== 'unreached') || t.steps[t.steps.length - 1];
    const c = nodeColours(cur.state);
    return (
      <div {...root} style={{ display: 'grid', gap: 'var(--space-2)', ...style }} {...rest}>
        {notice}
        <div role="progressbar" aria-valuemin={0} aria-valuemax={t.steps.length} aria-valuenow={done + (cur.state === 'complete' ? 0 : 1)}
          aria-valuetext={cur.label + ', ' + STATE_WORD[cur.state]}
          style={{ blockSize: 4, borderRadius: 'var(--radius-full)', background: 'var(--color-neutral-200)', overflow: 'hidden' }}>
          <div style={{ inlineSize: ((done + 1) / t.steps.length * 100) + '%', blockSize: '100%', background: c.bg, transition: 'inline-size var(--duration-deliberate) var(--ease-standard)' }} />
        </div>
        <div aria-hidden="true" style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-primary)' }}>{failedLine || cur.label}</div>
        {live}
      </div>
    );
  }

  const vertical = orientation !== 'horizontal';
  return (
    <div {...root} style={style} {...rest}>
      {notice}
      <ol role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: vertical ? 'grid' : 'flex', gap: vertical ? 0 : 'var(--space-2)', alignItems: 'flex-start' }}>
        {t.steps.map((s, i) => {
          const c = nodeColours(s.state);
          const at = showTimes ? time(s.at) : null;
          const active = s.state === 'current' || s.state === 'stalled' || s.state === 'failed';
          const name = [s.label, STATE_WORD[s.state], s.at ? time(s.at) : null].filter(Boolean).join(', ');
          const dim = s.state === 'upcoming' || s.state === 'unreached';
          const node = (
            <span aria-hidden="true" style={{ inlineSize: 20, blockSize: 20, display: 'grid', placeItems: 'center', flex: '0 0 auto', borderRadius: 'var(--radius-full)', background: c.bg, color: c.fg, boxShadow: c.ring ? 'inset 0 0 0 1.5px ' + c.ring : 'none', transition: 'background-color var(--duration-deliberate) var(--ease-standard)' }}>
              {s.state === 'complete' ? <Tick size={12} /> : s.state === 'failed' ? <span style={{ inlineSize: 8, blockSize: 2, background: 'currentColor', borderRadius: 1 }} /> : active ? <span style={{ inlineSize: 6, blockSize: 6, borderRadius: 'var(--radius-full)', background: 'currentColor' }} /> : null}
            </span>
          );
          const text = (
            <div aria-hidden="true" style={{ paddingBlockEnd: vertical ? 'var(--space-4)' : 0, minInlineSize: 0 }}>
              <div style={{ fontSize: vertical ? 'var(--type-label-lg-size)' : 'var(--type-label-md-size)', fontWeight: active ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)', color: dim ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: s.state === 'unreached' ? 'line-through' : 'none' }}>{s.label}</div>
              {at ? <div style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)', fontVariantNumeric: 'var(--numeric-tabular)' }}>{at}</div> : null}
              {s.state === 'current' && eta ? <div style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>Estimated {eta}</div> : null}
              {s.state === 'stalled' ? <div style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--color-warning-700)' }}>Taking longer than expected. We’re on it and will update you here.</div> : null}
              {s.state === 'failed' ? <div style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--color-danger-700)' }}>{failedLine}</div> : null}
            </div>
          );
          return (
            <li key={s.key} aria-label={name} aria-current={active && s.state !== 'failed' ? 'step' : undefined} data-step-state={s.state}
              style={vertical ? { display: 'grid', gridTemplateColumns: '20px 1fr', columnGap: 'var(--space-3)' } : { flex: 1, minInlineSize: 0 }}>
              {vertical ? (
                <div style={{ display: 'grid', justifyItems: 'center', gridTemplateRows: 'auto 1fr' }}>
                  {node}
                  {i < t.steps.length - 1 ? <span aria-hidden="true" style={{ inlineSize: 2, minBlockSize: 18, background: s.state === 'complete' ? c.line : 'var(--color-neutral-200)', marginBlockStart: 2 }} /> : null}
                </div>
              ) : (
                <div aria-hidden="true" style={{ blockSize: 4, borderRadius: 'var(--radius-full)', background: dim ? 'var(--color-neutral-200)' : c.bg, marginBlockEnd: 'var(--space-2)' }} />
              )}
              {text}
            </li>
          );
        })}
      </ol>
      {live}
    </div>
  );
}
