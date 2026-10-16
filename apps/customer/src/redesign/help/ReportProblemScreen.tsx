/**
 * Report a problem: the order-scoped report form behind Get help (the `GetHelp-Refund*`,
 * `GetHelp-Report-Early*` boards of the customer redesign, tracked in issue #921 under the redesign
 * tracker #656). It is the `reportProblem` route.
 *
 * A report is a request for a person to look at the order, not a refund decision. The page says so
 * and never shows an approved outcome the server has not given:
 * - the customer names what went wrong and, after delivery, which part of the order; the server
 *   works out any money, so there is no amount field and none is sent;
 * - the sent page reads "Under review" and shows no amount while the refund is only requested;
 * - several reports may be sent on one order (the contract accepts a later one unless it claims an
 *   item or the fees another report already holds), so nothing here says "once".
 *
 * Validation is on press, not by disabling Send. Sending locks the form and shows the button busy.
 * A failure keeps every answer and "Send again" repeats the same request with the same
 * Idempotency-Key, so a dropped connection can never become two reports; changing an answer first
 * gives the request a new key. A halal concern follows the same path with neutral words, never red.
 *
 * Not on this page, and why: photos (the contract has no upload purpose a customer may use) and a
 * "Something else" reason (the contract's reason list has no such code). Both are filed as contract
 * gaps ([#950](https://github.com/shaiknoorullah/hg-mono/issues/950)) instead of being invented here.
 */
import * as React from 'react';
import { AccessibilityInfo, findNodeHandle, ScrollView, StyleSheet, Text, View } from 'react-native';
import { idempotencyKey } from '@hg/api-client';

import { callSupport, useSupport } from '../api/config';
import {
  AppBar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  QuantityStepper,
  Radio,
  RadioGroup,
  Skeleton,
  Textarea,
  useTheme,
  useTypeStyle,
} from '../ds';
import { errorCodeOf, errorStatusOf, useQuery } from '../lib/query';
import { formatDate, formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import { refundView } from '../orders/format';
import { getOrder, listOrderRefunds, type OrderCustomerView } from '../orders/ordersApi';
import { sendReport, type Refund } from './helpApi';
import {
  EMPTY_FORM,
  KIND_OPTIONS,
  NOTE_MAX,
  formSignature,
  helpKindOf,
  kindCardLabel,
  lineDetail,
  noteLabel,
  noteRequired,
  reasonCardLabel,
  reasonFromParam,
  reasonsFor,
  refundInputOf,
  refusalOf,
  validateForm,
  type FormErrors,
  type HelpKind,
  type ReportForm,
} from './helpModel';

export const REPORT_COPY = {
  title: 'Report a problem',
  intro: 'Tell us what went wrong. A person reviews every report and we work out any refund from your order, so you don\'t enter an amount.',
  introBefore:
    "Your order isn't with you yet. Tell us what's wrong and a person will look at it. We work out any refund from your order, so you don't enter an amount.",
  reasonLegend: 'What went wrong?',
  reasonLegendBefore: "What's wrong?",
  kindLegend: 'Which part of the order?',
  itemsLegend: 'Which items?',
  noteHelp: 'Only our team sees this.',
  send: 'Send report',
  sending: 'Sending report',
  sendAgain: 'Send again',
  failedTitle: "We couldn't send your report",
  failedBody: 'Your answers are kept. Check your connection and send again.',
  invalidBody: 'Check your answers and send again.',
  loading: 'Loading your order',
  errorTitle: "We couldn't load this order",
  errorBody: "This is a problem loading the page. It doesn't change your order.",
  sentTitle: 'Report sent',
  sentBody1: "Thank you for telling us. A person will review it with the order's records, and we'll let you know what happens next.",
  sentBody2: 'You can follow it from this order in Orders.',
  yourReport: 'Your report',
  alreadyTitle: 'A report already covers this',
  alreadyBody: "A person is reviewing it. We'll let you know what happens next. If something else went wrong, you can send a different report.",
  editReport: 'Change my report',
  notRefundableTitle: "We can't take a report for this order here",
  notRefundableBody: 'Nothing was charged for this order, or what you chose has already been refunded.',
  windowTitle: "It's too late to report a problem here",
  windowBody: 'Problems can only be reported for a limited time after delivery.',
  backToOrder: 'Back to order',
  callUs: 'Call us',
} as const;

type Phase =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'failed'; invalid: boolean }
  | { kind: 'sent'; refund: Refund }
  | { kind: 'already' }
  | { kind: 'notRefundable' }
  | { kind: 'windowClosed' };

export function ReportProblemScreen({ orderId, reason }: { orderId: string; reason?: string }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { query, reload } = useQuery(() => getOrder(orderId), [orderId]);
  const order = query.kind === 'ready' ? query.data : null;

  const back = { onPress: nav.back, previousTitle: 'Order' };
  let body: React.ReactElement;
  let title: string = REPORT_COPY.title;
  let subtitle: string | undefined;

  if (query.kind === 'loading') {
    body = (
      <View style={styles.page} testID="Report-loading" accessibilityLabel={REPORT_COPY.loading} aria-busy>
        <Skeleton variant="text" lines={3} />
        <Skeleton variant="text" lines={4} />
      </View>
    );
  } else if (query.kind === 'error') {
    body = (
      <View style={styles.center}>
        <ErrorState
          variant="page"
          errorCode={query.code}
          title={REPORT_COPY.errorTitle}
          description={REPORT_COPY.errorBody}
          onRetry={reload}
          autoFocus
          testID="Report-error"
        />
      </View>
    );
  } else {
    subtitle = `Order ${query.data.code} · ${query.data.restaurant.name}`;
    body = <ReportBody order={query.data} reason={reason} />;
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="ReportProblem">
      <AppBar
        title={title}
        subtitle={subtitle}
        back={back}
        backLabel={order ? `Back to order ${order.code}` : 'Back to order'}
        tone="cream"
        isPageHeading={false}
      />
      {body}
    </View>
  );
}

function ReportBody({ order, reason }: { order: OrderCustomerView; reason?: string }): React.ReactElement {
  const theme = useTheme();
  const kind = helpKindOf(order.state);
  const [form, setForm] = React.useState<ReportForm>(() => ({ ...EMPTY_FORM, reason: reasonFromParam(reason, kind) }));
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [phase, setPhase] = React.useState<Phase>(kind === 'contactOnly' ? { kind: 'notRefundable' } : { kind: 'editing' });
  const attempt = React.useRef<{ sig: string; key: string } | null>(null);
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reasonRef = React.useRef<View>(null);
  const kindRef = React.useRef<View>(null);
  const itemsRef = React.useRef<View>(null);
  const noteRef = React.useRef<View>(null);
  const focus = (ref: React.RefObject<View | null>) => {
    try {
      const node = ref.current ? findNodeHandle(ref.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    } catch {
      /* focus is a courtesy; the error text is on screen either way */
    }
  };

  const update = (patch: Partial<ReportForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      if (patch.reason !== undefined) delete next.reason;
      if (patch.kind !== undefined) delete next.kind;
      if (patch.items !== undefined) delete next.items;
      if (patch.note !== undefined && patch.note.trim().length >= 5) delete next.note;
      return next;
    });
  };

  const send = async () => {
    if (phase.kind === 'sending') return;
    const found = validateForm(form, kind);
    setErrors(found);
    if (found.reason) return focus(reasonRef);
    if (found.kind) return focus(kindRef);
    if (found.items) return focus(itemsRef);
    if (found.note) return focus(noteRef);

    const input = refundInputOf(order.id, form, kind);
    // The same report sent again reuses its key; a changed one gets its own.
    const sig = formSignature(input);
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { sig, key: idempotencyKey() };
    setPhase({ kind: 'sending' });
    try {
      const refund = await sendReport(input, attempt.current.key);
      if (live.current) setPhase({ kind: 'sent', refund });
    } catch (e) {
      if (!live.current) return;
      const refusal = refusalOf(errorStatusOf(e), errorCodeOf(e));
      if (refusal.kind === 'alreadyRequested') setPhase({ kind: 'already' });
      else if (refusal.kind === 'notRefundable') setPhase({ kind: 'notRefundable' });
      else if (refusal.kind === 'windowClosed') setPhase({ kind: 'windowClosed' });
      else if (refusal.kind === 'invalid') {
        // The server's own validation, shown where the form's would be.
        if (noteRequired(form.reason)) setErrors({ note: 'Tell us the right address, in at least 5 characters.' });
        setPhase({ kind: 'failed', invalid: true });
      } else setPhase({ kind: 'failed', invalid: false });
    }
  };

  if (phase.kind === 'sent') return <Sent order={order} refund={phase.refund} kind={kind} />;
  if (phase.kind === 'already') {
    return <AlreadyRequested order={order} onEdit={() => setPhase({ kind: 'editing' })} />;
  }
  if (phase.kind === 'notRefundable') {
    return <Refused order={order} icon="info" title={REPORT_COPY.notRefundableTitle} body={REPORT_COPY.notRefundableBody} testID="Report-notRefundable" />;
  }
  if (phase.kind === 'windowClosed') {
    return (
      <Refused
        order={order}
        icon="clock"
        title={REPORT_COPY.windowTitle}
        body={`${REPORT_COPY.windowBody}${order.delivered_at ? ` This order was delivered on ${formatDate(order.delivered_at)} at ${formatTime(order.delivered_at)}.` : ''}`}
        testID="Report-windowClosed"
      />
    );
  }

  const sending = phase.kind === 'sending';
  const options = reasonsFor(kind).map((r) => ({ ...r }));
  const partial = kind === 'after' && form.kind === 'PARTIAL_ITEMS';
  const failed = phase.kind === 'failed';

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" testID="Report-body">
        {failed ? (
          <Banner
            variant="neutral"
            icon={<Icon name="info" size={22} color={theme.color.text.secondary} />}
            title={REPORT_COPY.failedTitle}
            description={phase.invalid ? REPORT_COPY.invalidBody : REPORT_COPY.failedBody}
            testID="Report-failed"
          />
        ) : null}
        <Intro text={kind === 'before' ? REPORT_COPY.introBefore : REPORT_COPY.intro} />

        <View ref={reasonRef} accessible={false}>
          <RadioGroup
            name="report-reason"
            label={kind === 'before' ? REPORT_COPY.reasonLegendBefore : REPORT_COPY.reasonLegend}
            required
            value={form.reason}
            disabled={sending}
            errorText={errors.reason}
            onChange={(v) => update({ reason: v as ReportForm['reason'] })}
            testID="Report-reasons"
          >
            {options.map((r) => (
              <Radio key={r.value} value={r.value} label={r.label} description={r.description} testID={`Report-reason-${r.value}`} />
            ))}
          </RadioGroup>
        </View>

        {kind === 'after' ? (
          <View ref={kindRef} accessible={false}>
            <RadioGroup
              name="report-kind"
              label={REPORT_COPY.kindLegend}
              required
              value={form.kind}
              disabled={sending}
              errorText={errors.kind}
              onChange={(v) => update({ kind: v as ReportForm['kind'] })}
              testID="Report-kinds"
            >
              {KIND_OPTIONS.map((k) => (
                <Radio key={k.value} value={k.value} label={k.label} description={k.description} testID={`Report-kind-${k.value}`} />
              ))}
            </RadioGroup>
          </View>
        ) : null}

        {partial ? (
          <View ref={itemsRef} accessible={false}>
            <ItemsPicker order={order} items={form.items} error={errors.items ?? null} disabled={sending} onChange={(items) => update({ items })} />
          </View>
        ) : null}

        <View ref={noteRef} accessible={false}>
          <Textarea
            label={noteLabel(form.reason)}
            helperText={REPORT_COPY.noteHelp}
            required={noteRequired(form.reason)}
            value={form.note}
            maxLength={NOTE_MAX}
            errorText={errors.note ?? null}
            readOnly={sending}
            onChange={(note) => update({ note })}
            testID="Report-note"
          />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={sending}
          iconStart={failed && !phase.invalid ? 'refresh' : undefined}
          onPress={() => void send()}
          testID="Report-send"
        >
          {sending ? REPORT_COPY.sending : failed && !phase.invalid ? REPORT_COPY.sendAgain : REPORT_COPY.send}
        </Button>
      </View>
    </View>
  );
}

function Intro({ text }: { text: string }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  return <Text style={[body, { color: theme.color.text.primary }]}>{text}</Text>;
}

/** One stepper per order line, from 0 up to the quantity ordered. No amounts: the server works them out. */
function ItemsPicker({
  order,
  items,
  error,
  disabled,
  onChange,
}: {
  order: OrderCustomerView;
  items: Readonly<Record<number, number>>;
  error: string | null;
  disabled: boolean;
  onChange: (items: Record<number, number>) => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  return (
    <View style={styles.gap12} accessibilityRole="none" accessibilityLabel={REPORT_COPY.itemsLegend} testID="Report-items">
      <Text style={[label, { color: theme.color.text.primary }]}>{REPORT_COPY.itemsLegend}</Text>
      {order.lines.map((line) => {
        const value = items[line.line_no] ?? 0;
        return (
          <View key={line.line_no} style={styles.itemRow} testID={`Report-item-${line.line_no}`}>
            <View style={styles.flex1}>
              <Text style={[body, { color: theme.color.text.primary }]}>{line.name}</Text>
              <Text style={[small, { color: theme.color.text.secondary }]}>{lineDetail(line)}</Text>
            </View>
            <QuantityStepper
              value={value}
              min={0}
              max={line.quantity}
              itemName={line.name}
              disabled={disabled}
              onChange={(q) => onChange({ ...items, [line.line_no]: q })}
              testID={`Report-stepper-${line.line_no}`}
            />
            <Text style={[small, { color: theme.color.text.secondary }]}>{`${value} of ${line.quantity}`}</Text>
          </View>
        );
      })}
      {error ? (
        <Text style={[small, { color: theme.color.feedback.danger.text }]} accessibilityRole="alert" testID="Report-itemsError">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------------------------- views */

function ReportCard({ refund }: { refund: Refund }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const status = refundView(refund, null);
  return (
    <Card variant="outlined" radius={16} testID="Report-card">
      <View style={styles.gap8}>
        <View style={styles.rowBetween}>
          <Text style={[label, { color: theme.color.text.primary }]}>{REPORT_COPY.yourReport}</Text>
          <Badge variant="info" label={status.badge} />
        </View>
        <Text style={[small, { color: theme.color.text.primary }]}>{`${reasonCardLabel(refund.reason_code)} · ${kindCardLabel(refund.kind)}`}</Text>
        <Text style={[small, { color: theme.color.text.secondary }]}>{`Sent ${formatDate(refund.requested_at)}, ${formatTime(refund.requested_at)}`}</Text>
      </View>
    </Card>
  );
}

function Sent({ order, refund }: { order: OrderCustomerView; refund: Refund; kind: HelpKind }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  return (
    <ScrollView contentContainerStyle={styles.page} testID="Report-sent">
      <View style={styles.gap8}>
        <Icon name="check" size={32} color={theme.color.text.primary} />
        <Text accessibilityRole="header" aria-level={1} style={[h1, { color: theme.color.text.primary }]}>
          {REPORT_COPY.sentTitle}
        </Text>
        <Text style={[body, { color: theme.color.text.primary }]}>{REPORT_COPY.sentBody1}</Text>
        <Text style={[body, { color: theme.color.text.primary }]}>{REPORT_COPY.sentBody2}</Text>
      </View>
      <ReportCard refund={refund} />
      <Button variant="primary" size="lg" fullWidth onPress={nav.back} testID="Report-backToOrder">
        {REPORT_COPY.backToOrder}
      </Button>
    </ScrollView>
  );
}

function AlreadyRequested({ order, onEdit }: { order: OrderCustomerView; onEdit: () => void }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const support = useSupport();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  const { query, reload } = useQuery(() => listOrderRefunds(order.id), [order.id]);
  const holding =
    query.kind === 'ready'
      ? [...query.data]
          .filter((r) => r.state !== 'DECLINED' && r.state !== 'CANCELLED')
          .sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at))[0] ?? null
      : null;
  return (
    <ScrollView contentContainerStyle={styles.page} testID="Report-already">
      <View style={styles.gap8}>
        <Icon name="info" size={32} color={theme.color.text.primary} />
        <Text accessibilityRole="header" aria-level={1} style={[h1, { color: theme.color.text.primary }]}>
          {REPORT_COPY.alreadyTitle}
        </Text>
        <Text style={[body, { color: theme.color.text.primary }]}>{REPORT_COPY.alreadyBody}</Text>
      </View>
      {query.kind === 'loading' ? (
        <Card variant="outlined" radius={16}>
          <Skeleton variant="text" lines={2} />
        </Card>
      ) : query.kind === 'error' ? (
        <Button variant="tertiary" size="md" onPress={reload} testID="Report-alreadyRetry">
          Show my report
        </Button>
      ) : holding ? (
        <ReportCard refund={holding} />
      ) : null}
      <View style={styles.gap12}>
        <Button variant="primary" size="lg" fullWidth onPress={nav.back} testID="Report-backToOrder">
          {REPORT_COPY.backToOrder}
        </Button>
        <Button variant="tertiary" size="md" fullWidth onPress={onEdit} testID="Report-edit">
          {REPORT_COPY.editReport}
        </Button>
        {support?.kind === 'open' ? (
          <Button variant="tertiary" size="md" fullWidth iconStart="phone" onPress={() => callSupport(support.phoneE164)} testID="Report-call">
            {REPORT_COPY.callUs}
          </Button>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Refused({
  order,
  icon,
  title,
  body,
  testID,
}: {
  order: OrderCustomerView;
  icon: 'info' | 'clock';
  title: string;
  body: string;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const support = useSupport();
  return (
    <View style={styles.center} testID={testID}>
      <EmptyState
        variant="page"
        headingLevel={1}
        autoFocus
        illustration={<Icon name={icon} size={48} color={theme.color.text.secondary} />}
        title={title}
        description={body}
        primaryAction={{ label: REPORT_COPY.backToOrder, onPress: nav.back }}
        secondaryAction={
          support?.kind === 'open' ? { label: REPORT_COPY.callUs, onPress: () => callSupport(support.phoneE164) } : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: 16 },
  page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  flex1: { flex: 1 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
