/**
 * TEMPORARY STUB for the proposed DS `SupportBlock` and `SupportSentence` (ds-request(web): #737).
 * Delete when `@hg/ui-web/ds` or `/proposed` exports them.
 *
 * Partner support as the sign-in boards draw it, from `PublicConfig` only (never hard-coded):
 * - `SupportBlock`: label, the phone as a `tel:` link, the hours, on a sunken surface; with no
 *   contact (`support_enabled` false) the "isn't available" replacement (Ref-SupportUnavailable);
 *   with the contact still unknown (`undefined`: config loading or failed) nothing at all.
 * - `SupportSentence`: one centred line under a card, "{lead}{phone}, {hours}."; nothing unless
 *   a contact is known.
 */
import { TextLink } from "./TextLink";

export interface SupportContactInfo {
  /** E.164, for the `tel:` link. */
  tel: string;
  /** The number as people read it. */
  display: string;
  hours: string | null;
}

export interface SupportBlockProps {
  contact: SupportContactInfo | null | undefined;
  label: string;
  unavailableTitle: string;
  unavailableBody: string;
}

export function SupportBlock({
  contact,
  label,
  unavailableTitle,
  unavailableBody,
}: SupportBlockProps) {
  if (contact === undefined) return null;
  if (contact === null) {
    return (
      <div
        className="flex flex-col gap-1 rounded-[12px] bg-surface-sunken p-4"
        data-testid="support-unavailable"
      >
        <p className="m-0 text-label-lg text-fg-primary">{unavailableTitle}</p>
        <p className="m-0 text-body-sm text-fg-secondary">{unavailableBody}</p>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-1 rounded-[12px] bg-surface-sunken p-4"
      data-testid="support-block"
    >
      <p className="m-0 text-label-md text-fg-secondary">{label}</p>
      <TextLink href={`tel:${contact.tel}`} className="text-heading-sm">
        {contact.display}
      </TextLink>
      {contact.hours ? (
        <p className="m-0 text-body-sm text-fg-secondary">{contact.hours}</p>
      ) : null}
    </div>
  );
}

export interface SupportSentenceProps {
  contact: SupportContactInfo | null | undefined;
  /** The words before the number ("Need help signing in? Call partner support on "). */
  lead: string;
  testId?: string;
}

export function SupportSentence({
  contact,
  lead,
  testId = "support-sentence",
}: SupportSentenceProps) {
  if (!contact) return null;
  return (
    <p
      className="m-0 text-center text-body-sm leading-normal text-fg-secondary"
      data-testid={testId}
    >
      {lead}
      <TextLink href={`tel:${contact.tel}`}>{contact.display}</TextLink>
      {contact.hours ? `, ${contact.hours}.` : "."}
    </p>
  );
}
