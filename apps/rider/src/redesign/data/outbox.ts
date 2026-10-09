/**
 * The transition outbox: delivery steps the rider tapped that the server has not confirmed.
 *
 * A rider in a dead zone must still be able to tap "I'm at the restaurant" or "I've got the
 * food". The contract accepts transitions up to two hours late with their original
 * `occurred_at`, and the `Idempotency-Key` makes a resend safe. So every step goes through here:
 *
 * - `send()` tries at once. On a transport failure the step is queued and the rider moves on
 *   ("Waiting for signal"); an API error (wrong code, geofence, 409) is thrown to the screen,
 *   which owns that board.
 * - Steps for one assignment replay strictly in order, each with its own original key and
 *   `occurred_at`. A new step never jumps a queued one.
 * - A queued step the server later refuses is held as `rejected` (it blocks the steps behind it)
 *   and reported to listeners, so the trip screen can open the board for it
 *   (`PickupCodeRejectedLater`, `QueuedRejected`). The rider dismisses it; nothing is retried
 *   blindly.
 * - Signing out does not empty it. A 401 stops the drain; the next sign-in resumes it.
 * - Proof of delivery never queues (WP5 rule: `DELIVERED` needs its proof in the same
 *   transaction), so `DELIVERED` is refused here.
 */
import { HgApiError, HgTransportError, idempotencyKey, unwrap, type Schema } from '@hg/api-client';

import { rider } from './client';
import { subscribeConnectivity, isOnline } from './connectivity';
import { toRiderError, type RiderError } from './errors';
import { memoryStore, type KeyValueStore } from './storage';

export type TransitionInput = Schema['AssignmentTransitionInput'];
export type Assignment = Schema['Assignment'];

export interface OutboxEntry {
  /** Doubles as the `Idempotency-Key`, so a replay is the same request. */
  id: string;
  assignmentId: string;
  input: TransitionInput;
  queuedAt: string;
  status: 'pending' | 'rejected';
  error?: Pick<RiderError, 'code' | 'status' | 'title' | 'message' | 'details'>;
}

export type SendResult =
  | { queued: false; assignment: Assignment }
  | { queued: true; entry: OutboxEntry };

export type Poster = (entry: OutboxEntry) => Promise<Assignment>;

const STORAGE_KEY = 'hg.rider.outbox.v1';

const defaultPoster: Poster = async (entry) => {
  const body = await unwrap(
    rider.POST('/v1/riders/me/assignments/{assignmentId}/transitions', {
      params: { path: { assignmentId: entry.assignmentId }, header: { 'Idempotency-Key': entry.id } },
      body: entry.input,
    }),
  );
  return (body as { data: Assignment }).data;
};

function isTransport(e: unknown): boolean {
  return e instanceof HgTransportError || e instanceof TypeError;
}

export class Outbox {
  private entries: OutboxEntry[] = [];
  private loaded: Promise<void> | null = null;
  private draining: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private rejectListeners = new Set<(entry: OutboxEntry) => void>();
  private stopConnectivity: (() => void) | null = null;

  constructor(
    private store: KeyValueStore = memoryStore(),
    private post: Poster = defaultPoster,
  ) {}

  /** Swap the backing store (call before first use) and reload from it. */
  useStore(store: KeyValueStore): void {
    this.store = store;
    this.loaded = null;
    this.entries = [];
  }

  /** Read the persisted queue once. Every public method awaits it. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw = await this.store.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
        // Entries queued while this instance was already running come after the stored ones.
        this.entries = [...parsed, ...this.entries.filter((e) => !parsed.some((p) => p.id === e.id))];
      } catch {
        this.entries = [];
      }
      this.emit();
    })();
    return this.loaded;
  }

  /** Start draining whenever the API becomes reachable again. Returns a stop. */
  start(): () => void {
    this.stopConnectivity ??= subscribeConnectivity(() => {
      if (isOnline()) void this.drain();
    });
    void this.load().then(() => this.drain());
    return () => {
      this.stopConnectivity?.();
      this.stopConnectivity = null;
    };
  }

  snapshot(): readonly OutboxEntry[] {
    return this.entries;
  }

  /** Steps not yet confirmed for one assignment, oldest first. */
  pendingFor(assignmentId: string): readonly OutboxEntry[] {
    return this.entries.filter((e) => e.assignmentId === assignmentId);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Called once per queued step the server refused on replay. */
  onRejected(fn: (entry: OutboxEntry) => void): () => void {
    this.rejectListeners.add(fn);
    return () => {
      this.rejectListeners.delete(fn);
    };
  }

  /**
   * Send a step now, or queue it if the phone cannot reach us. API errors are thrown (as
   * `HgApiError`) for the screen to show. `occurred_at` defaults to now.
   */
  async send(
    assignmentId: string,
    input: Omit<TransitionInput, 'occurred_at'> & { occurred_at?: string },
  ): Promise<SendResult> {
    if (input.to_state === 'DELIVERED') {
      throw new Error('DELIVERED never queues: it is sent with its proof (submitProofOfDelivery).');
    }
    await this.load();
    const entry: OutboxEntry = {
      id: idempotencyKey(),
      assignmentId,
      input: { ...input, occurred_at: input.occurred_at ?? new Date().toISOString() } as TransitionInput,
      queuedAt: new Date().toISOString(),
      status: 'pending',
    };
    // Something for this assignment is already waiting: keep the order, queue behind it.
    if (this.pendingFor(assignmentId).length > 0) {
      await this.append(entry);
      void this.drain();
      return { queued: true, entry };
    }
    try {
      const assignment = await this.post(entry);
      return { queued: false, assignment };
    } catch (e) {
      if (!isTransport(e)) throw e;
      await this.append(entry);
      return { queued: true, entry };
    }
  }

  /** Replay everything sendable, in order. Concurrent calls share one run. */
  drain(): Promise<void> {
    this.draining ??= (async () => {
      try {
        await this.load();
        const blocked = new Set<string>();
        for (const entry of [...this.entries]) {
          if (entry.status === 'rejected') {
            blocked.add(entry.assignmentId);
            continue;
          }
          if (blocked.has(entry.assignmentId)) continue;
          try {
            await this.post(entry);
            await this.remove(entry.id);
          } catch (e) {
            if (isTransport(e)) return; // still offline: try again on the next signal
            if (e instanceof HgApiError && e.status === 401) return; // signed out: keep everything
            const err = toRiderError(e);
            const rejected: OutboxEntry = {
              ...entry,
              status: 'rejected',
              error: { code: err.code, status: err.status, title: err.title, message: err.message, details: err.details },
            };
            this.entries = this.entries.map((x) => (x.id === entry.id ? rejected : x));
            blocked.add(entry.assignmentId);
            await this.persist();
            for (const fn of this.rejectListeners) fn(rejected);
          }
        }
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  /** The rider has seen a refused step: drop it and let the queue behind it continue. */
  async dismiss(id: string): Promise<void> {
    await this.remove(id);
    void this.drain();
  }

  /** Forget every step for an assignment that ended (cancelled, reassigned, delivered). */
  async clearAssignment(assignmentId: string): Promise<void> {
    await this.load();
    this.entries = this.entries.filter((e) => e.assignmentId !== assignmentId);
    await this.persist();
  }

  private async append(entry: OutboxEntry): Promise<void> {
    this.entries = [...this.entries, entry];
    await this.persist();
  }

  private async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.id !== id);
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.emit();
    try {
      await this.store.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      /* a full disk must not stop the rider; the queue stays in memory */
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** The app's one outbox. */
export const outbox = new Outbox();
