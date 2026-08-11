import * as RadixAvatar from '@radix-ui/react-avatar';
import { User } from 'lucide-react';
import { cx } from './utils/cx.js';
import { color } from '../tokens/index.js';

/**
 * Avatar — 02-components.md §11.
 *
 * Initials get a deterministic hue drawn from `viz.*`, so a generated avatar
 * can never land on a reserved colour — in particular it can never be halal
 * green or semantic red.
 *
 * Shape: radius.full for people, radius.md for restaurants. A restaurant is
 * not a person, and the shape is how that reads at a glance.
 *
 * Non-interactive: an Avatar is never a control. If it needs to be pressable
 * the caller wraps it in a Button. No hover/active/disabled/loading/error
 * states — stated explicitly per rule 0.1. (`status` is data, not a state.)
 */

const VIZ = Object.values(color.viz);

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80 };

export interface AvatarProps {
  /** Used for initials, for the deterministic hue, and as the default alt. */
  name: string;
  src?: string;
  size?: AvatarSize;
  shape?: 'person' | 'business';
  /** Rider only. Never the only signal — pair it with text in the row. */
  status?: 'online' | 'offline';
  /** Empty string marks the avatar decorative (the name is adjacent). */
  alt?: string;
  /** Stable id for the hue. Falls back to `name`. */
  id?: string;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stable, non-cryptographic. Same id always lands on the same viz colour. */
function hueFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return VIZ[Math.abs(hash) % VIZ.length] as string;
}

export function Avatar({
  name,
  src,
  size = 'md',
  shape = 'person',
  status,
  alt,
  id,
  className,
}: AvatarProps) {
  const px = SIZE[size];
  const decorative = alt === '';
  const label = decorative ? undefined : (alt ?? name);

  return (
    <span
      className={cx('relative inline-flex shrink-0', className)}
      data-testid="hg-avatar"
      data-size={size}
      data-shape={shape}
    >
      <RadixAvatar.Root
        style={{ width: px, height: px }}
        className={cx(
          'inline-flex select-none items-center justify-center overflow-hidden',
          'bg-surface-subtle',
          shape === 'person' ? 'rounded-full' : 'rounded-md',
        )}
        {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      >
        {src ? (
          <RadixAvatar.Image
            src={src}
            alt=""
            className="size-full object-cover"
            data-testid="hg-avatar-image"
          />
        ) : null}
        <RadixAvatar.Fallback
          delayMs={src ? 300 : 0}
          style={{
            backgroundColor: hueFor(id ?? name),
            fontSize: Math.round(px * 0.4),
          }}
          className="flex size-full items-center justify-center font-semibold text-[var(--hg-text-on-accent)]"
          data-testid="hg-avatar-fallback"
        >
          {name.trim() ? (
            initials(name)
          ) : (
            <User aria-hidden="true" size={Math.round(px * 0.5)} />
          )}
        </RadixAvatar.Fallback>
      </RadixAvatar.Root>

      {status ? (
        <span
          aria-hidden="true"
          data-hg-status={status}
          className={cx(
            'absolute bottom-0 end-0 block size-3 rounded-full border-2 border-surface-base',
            status === 'online' ? 'bg-feedback-info-solid' : 'bg-line-interactive',
          )}
        />
      ) : null}
    </span>
  );
}
