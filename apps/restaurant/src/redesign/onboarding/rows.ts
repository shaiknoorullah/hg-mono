/**
 * One row of the documents list as the screen draws it (restaurant onboarding, canvas ON `DocsPanes` and
 * `ReviewPanes`): what the server holds for that document type plus the owner's draft in
 * progress, reduced to a badge, a one-line summary and what can be done to it.
 *
 * Tone rules that bind every row: nothing here is ever red, and nothing is green. An approved
 * document is a neutral check; an expired halal certificate is cool slate (an outlined badge
 * with a clock), "we can't currently vouch", never amber and never a verdict.
 */
import type { BadgeVariant } from '../ds';
import { DOC_META, DOC_TYPES, documentSummary, latestDocs, longDate, previousDoc, type KycDocument, type ShownDocType, type DocMeta } from './model';
import type { Drafts } from './drafts';
import { DOCS, ROW } from './copy';

export type WorkspaceVariant = 'documents' | 'review' | 'fix';

export type RowKind = 'empty' | 'uploading' | 'upload-failed' | 'details' | 'saving' | 'added' | 'in-review' | 'approved' | 'rejected' | 'expired';

export interface RowBadge {
  label: string;
  variant: BadgeVariant;
  appearance?: 'tint' | 'outline';
  icon?: 'check' | 'clock' | null;
  /** The warning glyph (the DS icon set has none yet). */
  warn?: boolean;
}

export interface RowView {
  type: ShownDocType;
  meta: DocMeta;
  kind: RowKind;
  doc: KycDocument | undefined;
  previous: KycDocument | null;
  badge: RowBadge | null;
  /** A plain status word instead of a badge (an expired non-halal document). */
  plain: string | null;
  line: string;
  /** The server holds something the owner can download. */
  canDownload: boolean;
  /** The owner can put a new file on this row right now. */
  canReplace: boolean;
  /** The server says this document must be replaced (rejected, or expired before review). */
  needsUpload: boolean;
}

const check = { icon: 'check' as const };
const clock = { icon: 'clock' as const };

export function buildRows(variant: WorkspaceVariant, docs: readonly KycDocument[], drafts: Drafts): RowView[] {
  const latest = latestDocs(docs);
  return DOC_TYPES.map((type): RowView => {
    const meta = DOC_META[type];
    const doc = latest.get(type);
    const previous = doc ? previousDoc(docs, doc) : null;
    const draft = drafts[type];
    const base = { type, meta, doc, previous, plain: null as string | null, canDownload: !!doc && doc.state !== 'SUPERSEDED', needsUpload: !!doc && (doc.state === 'REJECTED' || doc.state === 'EXPIRED') };

    if (draft) {
      const verb = draft.replacing ? ROW.replacing : ROW.uploading;
      if (draft.phase === 'uploading') {
        return { ...base, kind: 'uploading', badge: { label: verb, variant: 'info', icon: null }, line: `${verb === ROW.replacing ? 'Replacing' : 'Uploading'}, ${draft.pct}%`, canReplace: false };
      }
      if (draft.phase === 'upload-failed') {
        return { ...base, kind: 'upload-failed', badge: { label: draft.failure?.kind === 'network' ? ROW.uploadFailed : ROW.notUploaded, variant: 'warning', warn: true }, line: draft.error?.title ?? ROW.uploadFailed, canReplace: false };
      }
      const failed = !!draft.error;
      return {
        ...base,
        kind: draft.phase === 'saving' ? 'saving' : 'details',
        badge: failed ? { label: ROW.notSaved, variant: 'warning', warn: true } : { label: ROW.detailsNeeded, variant: 'info', icon: null },
        line: failed ? (draft.error?.title ?? ROW.notSaved) : `${draft.fileName} · details needed`,
        canReplace: false,
      };
    }

    if (!doc) {
      return {
        ...base,
        kind: 'empty',
        badge: variant === 'documents' ? { label: ROW.notAdded, variant: 'neutral', appearance: 'outline', icon: null } : { label: ROW.missing, variant: 'warning', warn: true },
        line: DOCS.notAdded,
        canReplace: true,
      };
    }

    const summary = documentSummary(doc, { includeVersion: variant !== 'documents' && doc.version > 1 });
    switch (doc.state) {
      case 'APPROVED':
        return { ...base, kind: 'approved', badge: { label: ROW.approved, variant: 'neutral', ...check }, line: summary, canReplace: false };
      case 'REJECTED':
        return { ...base, kind: 'rejected', badge: { label: ROW.newUpload, variant: 'warning', warn: true }, line: '', canReplace: true };
      case 'EXPIRED': {
        const when = longDate(doc.valid_until);
        if (meta.isHalal) {
          return { ...base, kind: 'expired', badge: { label: ROW.expired, variant: 'neutral', appearance: 'outline', ...clock }, line: `${summary} · ${ROW.expired}`, canReplace: true };
        }
        return { ...base, kind: 'expired', badge: null, plain: `Expired ${when}`.trim(), line: summary, canReplace: true };
      }
      case 'SUBMITTED':
      case 'IN_REVIEW':
        if (variant === 'review') return { ...base, kind: 'in-review', badge: { label: ROW.inReview, variant: 'info', ...clock }, line: summary, canReplace: false };
        return { ...base, kind: 'added', badge: { label: ROW.added, variant: 'neutral', ...check }, line: summary, canReplace: variant === 'documents' };
      default:
        return { ...base, kind: 'added', badge: { label: ROW.added, variant: 'neutral', ...check }, line: summary, canReplace: variant === 'documents' };
    }
  });
}

/** Required documents with something saved on the server (a draft is not yet "added"). */
export function addedCount(docs: readonly KycDocument[]): number {
  return latestDocs(docs).size;
}

/** Which of the four are missing, in board order: from the server's own list when it names them, else from the rows. */
export function missingTypes(named: readonly string[], rows: readonly RowView[]): ShownDocType[] {
  const fromServer = DOC_TYPES.filter((t) => named.includes(t));
  if (fromServer.length > 0) return fromServer;
  return rows.filter((r) => !r.doc).map((r) => r.type);
}
