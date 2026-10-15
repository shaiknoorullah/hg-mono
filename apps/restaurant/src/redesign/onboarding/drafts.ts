/**
 * The owner's work in progress on each document row (restaurant onboarding, canvas ON `Docs-Uploading`,
 * `Docs-AttachErrors`, `Docs-UploadErrors`, `Fix-Uploading`, `Fix-Details`): a chosen file being
 * uploaded, then its details waiting to be saved. Nothing here is a server fact; the document
 * list is. A draft holds the `File` and an `AbortController` in refs (never state, never
 * storage) and the presigned address never leaves `uploadKycFile`.
 */
import { idempotencyKey } from '@hg/api-client';
import { useCallback, useRef, useState } from 'react';
import { serverNow } from '../data/serverClock';
import { isoDateIn } from '../format/time';
import { DOC_META, type KycDocument, type ShownDocType } from './model';
import { attachDocument, uploadKycFile, type DocumentDetails, type UploadFailure } from './upload';
import { DRAFT_COPY } from './copy';

export type DraftPhase = 'uploading' | 'upload-failed' | 'details' | 'saving';

export interface DraftError {
  title: string;
  message: string;
  /** The server's code, shown small under the message. */
  code?: string;
  /** The same save can simply be sent again. */
  retry?: boolean;
  /** The file itself is the problem: offer another one. */
  chooseOther?: boolean;
}

export interface Draft {
  type: ShownDocType;
  phase: DraftPhase;
  fileName: string;
  pct: number;
  objectId: string | null;
  values: DocumentDetails;
  failure: UploadFailure | null;
  error: DraftError | null;
  /** The message under the "Valid until" field. */
  validError: string | null;
  /** A replacement for an existing file (the old version stays on file until this is saved). */
  replacing: boolean;
}

export type Drafts = Partial<Record<ShownDocType, Draft>>;

const EMPTY_VALUES: DocumentDetails = { issuer: '', certificateNumber: '', issuedOn: '', validUntil: '' };

/** Details carried over from the version being replaced, so only what changed is retyped. */
export function prefillFrom(doc: KycDocument | undefined): DocumentDetails {
  if (!doc) return EMPTY_VALUES;
  return { issuer: doc.issuer ?? '', certificateNumber: doc.certificate_number ?? '', issuedOn: '', validUntil: '' };
}

export function failureToError(f: UploadFailure): DraftError {
  const c = DRAFT_COPY;
  switch (f.kind) {
    case 'type':
      return { ...c.type, code: f.code, chooseOther: true };
    case 'size':
      return { ...c.size, code: f.code, chooseOther: true };
    case 'checksum':
      return { ...c.checksum, code: f.code, retry: true };
    case 'scan':
      return { ...c.scan, code: f.code, chooseOther: true };
    case 'network':
      return { ...c.network, retry: true };
    case 'session':
      return { ...c.session, code: f.code, retry: true };
    default:
      return { ...c.other, code: f.code, retry: true };
  }
}

export interface UseDraftsOptions {
  timezone: string;
  /** Called after a document was saved, so the list is read again. */
  onSaved: () => void;
  /** The attach call answered 409: the step moved on (another device sent the documents). */
  onLocked: () => void;
}

export function useDocumentDrafts({ timezone, onSaved, onLocked }: UseDraftsOptions) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const files = useRef(new Map<ShownDocType, File>());
  const aborts = useRef(new Map<ShownDocType, AbortController>());
  const keys = useRef(new Map<ShownDocType, string>());
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const patch = useCallback((type: ShownDocType, change: Partial<Draft>) => {
    setDrafts((d) => (d[type] ? { ...d, [type]: { ...d[type]!, ...change } } : d));
  }, []);

  const run = useCallback(
    async (type: ShownDocType, file: File) => {
      const controller = new AbortController();
      aborts.current.set(type, controller);
      let result;
      try {
        result = await uploadKycFile(file, { signal: controller.signal, onProgress: (f) => patch(type, { pct: Math.round(f * 100) }) });
      } catch {
        // Cancelled by the owner: `cancel` has already reset the row.
        return;
      } finally {
        if (aborts.current.get(type) === controller) aborts.current.delete(type);
      }
      if (controller.signal.aborted) return;
      if (result.ok) patch(type, { phase: 'details', pct: 100, objectId: result.objectId, failure: null, error: null });
      else patch(type, { phase: 'upload-failed', failure: result.failure, error: failureToError(result.failure) });
    },
    [patch],
  );

  const start = useCallback(
    (type: ShownDocType, file: File, previous?: KycDocument) => {
      files.current.set(type, file);
      keys.current.set(type, idempotencyKey());
      setDrafts((d) => ({
        ...d,
        [type]: {
          type,
          phase: 'uploading',
          fileName: file.name,
          pct: 0,
          objectId: null,
          values: prefillFrom(previous),
          failure: null,
          error: null,
          validError: null,
          replacing: !!previous,
        },
      }));
      void run(type, file);
    },
    [run],
  );

  /** Same file again (a network failure or a changed-on-the-way checksum). */
  const retryUpload = useCallback(
    (type: ShownDocType) => {
      const file = files.current.get(type);
      if (!file) return;
      patch(type, { phase: 'uploading', pct: 0, failure: null, error: null });
      void run(type, file);
    },
    [patch, run],
  );

  const cancel = useCallback((type: ShownDocType) => {
    const fileName = files.current.get(type)?.name ?? '';
    aborts.current.get(type)?.abort();
    aborts.current.delete(type);
    files.current.delete(type);
    setDrafts((d) => {
      const rest = { ...d };
      delete rest[type];
      return rest;
    });
    // Remembered for one message ("Upload of x cancelled. Nothing was saved.").
    setCancelledNote({ type, fileName });
  }, []);

  const [cancelledNote, setCancelledNote] = useState<{ type: ShownDocType; fileName: string } | null>(null);

  const discard = useCallback((type: ShownDocType) => {
    aborts.current.get(type)?.abort();
    aborts.current.delete(type);
    files.current.delete(type);
    keys.current.delete(type);
    setDrafts((d) => {
      const rest = { ...d };
      delete rest[type];
      return rest;
    });
  }, []);

  const setValue = useCallback((type: ShownDocType, field: keyof DocumentDetails, value: string) => {
    setDrafts((d) => {
      const cur = d[type];
      if (!cur) return d;
      return { ...d, [type]: { ...cur, values: { ...cur.values, [field]: value }, ...(field === 'validUntil' ? { validError: null } : {}), error: field === 'validUntil' ? null : cur.error } };
    });
  }, []);

  const save = useCallback(
    async (type: ShownDocType): Promise<boolean> => {
      const cur = draftsRef.current[type];
      if (!cur || !cur.objectId) return false;
      const meta = DOC_META[type];
      const today = isoDateIn(serverNow(), timezone);
      // Checks the server also makes, made first so a typo costs no round trip. The server has the last word.
      if (meta.validRequired && !cur.values.validUntil) {
        patch(type, { validError: type === 'OWNER_ID' ? DRAFT_COPY.validRequiredId : DRAFT_COPY.validRequired, error: { title: DRAFT_COPY.notSaved, message: DRAFT_COPY.checkDate } });
        return false;
      }
      if (cur.values.validUntil && cur.values.validUntil <= today) {
        patch(type, { validError: DRAFT_COPY.datePassed, error: { title: DRAFT_COPY.notSaved, message: DRAFT_COPY.checkDate, code: '422 DOCUMENT_ALREADY_EXPIRED', chooseOther: true } });
        return false;
      }
      if (meta.isHalal && !cur.values.issuer.trim()) {
        patch(type, { error: { title: DRAFT_COPY.notSaved, message: DRAFT_COPY.issuerRequired } });
        return false;
      }
      patch(type, { phase: 'saving', error: null, validError: null });
      const key = keys.current.get(type) ?? idempotencyKey();
      keys.current.set(type, key);
      const res = await attachDocument(type, cur.objectId, cur.values, key);
      if (res.ok) {
        discard(type);
        onSaved();
        return true;
      }
      if (res.network) {
        patch(type, { phase: 'details', error: { ...DRAFT_COPY.saveNetwork, retry: true } });
        return false;
      }
      if (res.status === 409) {
        patch(type, { phase: 'details' });
        onLocked();
        return false;
      }
      if (res.code === 'DOCUMENT_ALREADY_EXPIRED') {
        patch(type, { phase: 'details', validError: DRAFT_COPY.datePassed, error: { title: DRAFT_COPY.notSaved, message: DRAFT_COPY.checkDate, code: '422 DOCUMENT_ALREADY_EXPIRED', chooseOther: true } });
        keys.current.set(type, idempotencyKey());
        return false;
      }
      if (res.code === 'DOCUMENT_EXPIRES_TOO_SOON') {
        patch(type, { phase: 'details', validError: DRAFT_COPY.tooSoon, error: { title: DRAFT_COPY.notSaved, message: DRAFT_COPY.checkDate, code: '422 DOCUMENT_EXPIRES_TOO_SOON', chooseOther: true } });
        keys.current.set(type, idempotencyKey());
        return false;
      }
      if (res.code === 'UNRECOGNISED_CERTIFIER') {
        patch(type, { phase: 'details', values: { ...cur.values, issuer: '' }, error: { ...DRAFT_COPY.certifier, code: '422 UNRECOGNISED_CERTIFIER' } });
        keys.current.set(type, idempotencyKey());
        return false;
      }
      if (res.status === 422) {
        const msg = res.fields['valid_until'];
        patch(type, {
          phase: 'details',
          validError: msg ? DRAFT_COPY.checkDate : null,
          error: { title: DRAFT_COPY.notSaved, message: msg ?? DRAFT_COPY.checkDetails, code: `422 ${res.code}` },
        });
        keys.current.set(type, idempotencyKey());
        return false;
      }
      patch(type, { phase: 'details', error: { ...DRAFT_COPY.saveNetwork, retry: true } });
      return false;
    },
    [discard, onLocked, onSaved, patch, timezone],
  );

  const anyBusy = Object.values(drafts).some((d) => d && d.phase === 'uploading');
  const clearCancelledNote = useCallback(() => setCancelledNote(null), []);
  return { drafts, start, retryUpload, cancel, discard, setValue, save, anyBusy, cancelledNote, clearCancelledNote };
}

export type DraftsApi = ReturnType<typeof useDocumentDrafts>;
