/**
 * Modal specimens for the design preview. `Full` mirrors the live components/Modal/preview.html:
 * a 200px stage with the destructive confirm open, contained. On web Modal is confirm and alert
 * only, so `Alert` is the other specimen.
 */

import type { ReactNode } from 'react';

import { Modal } from './Modal.js';

/** The design system's component name, pairing these specimens with its preview page. */
export const component = 'Modal';

const noop = () => undefined;

function Stage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 640,
        height: 260,
        border: '1px dashed var(--hg-border-decorative)',
        borderRadius: 'var(--hg-radius-lg)',
        overflow: 'hidden',
        background: 'var(--hg-surface-sunken)',
      }}
    >
      {children}
    </div>
  );
}

/** The reference page's default: the destructive confirm, focus on Keep order. */
export function Full() {
  return (
    <Stage>
      <Modal
        contained
        open
        variant="confirm"
        destructive
        title="Cancel this order?"
        description="The authorisation on your card is released. This cannot be undone."
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        onConfirm={noop}
        onClose={noop}
      />
    </Stage>
  );
}
