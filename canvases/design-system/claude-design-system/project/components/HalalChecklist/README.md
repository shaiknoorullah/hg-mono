# HalalChecklist

The admin review of a restaurant's certificate: the seven A-15 checks, then approve or reject.

```jsx
<HalalChecklist certificate={cert} status={q.status} onRetry={q.refetch}
  onRecord={record} recordingKey={pendingKey}
  onApprove={(gate) => approve(gate)} onReject={(gate, r) => reject(gate, r)} deciding={deciding} />
```

**The seven checks, in fixed order** (`HalalCheckKey`, `contracts/openapi.yaml`; descriptions from `approval-gate.ts`):

| Key | Checks that… |
|---|---|
| H1_LEGIBLE_COMPLETE | the scan is legible, all pages are present, and there is no visible alteration |
| H2_ISSUER_ACCEPTED | the issuing body is ACCEPTED in the registry at this moment |
| H3_NAME_MATCH | the certified legal name equals the registered legal name, or a recorded alias |
| H4_ADDRESS_MATCH | the certified address matches the onboarding premises, or the certificate covers them |
| H5_DATES_VALID | issued on or before today, with enough validity left *(server-computed, locked)* |
| H6_SCOPE_SUFFICIENT | the scope covers what this restaurant will sell on the platform |
| H7_UNIQUE_NOT_REUSED | the body and number are not already approved for another restaurant *(server-computed, locked)* |

- **Never synthesises results.** It takes the API's `HalalCertificate`. With no certificate it shows an empty state; a missing check reads "Not yet recorded". There are `loading` (seven skeleton rows) and `error` (Retry, nothing changed) states.
- **Each check is a `<fieldset>` with a legend**: the key, the description, and a **three-way PASS / FAIL / Not assessed radio group** whose options are 44px or more. The selected option carries a tick and a word, never colour alone. Each check also has a **note field with a counter** and "Record H{n}".
- **H5 and H7 are locked.** They are read-only, show the computed result and a lock glyph, and give the reason in `aria-describedby`. No control is offered.
- **H2, H3 and H4** show "System suggested: …". Departing from the server's evaluation needs a **note of at least 20 characters**. Recording without one is blocked with an explanatory error, not silently disabled.
- **Approve renders only when all seven are PASS.** Otherwise the footer **names the outstanding keys** ("3 checks are outstanding — H3, H4, H6"). **Reject** needs at least one FAIL, a reason code from the closed enum and a reason of at least 20 characters, which is sent verbatim. Approve and Reject are at least 24px apart.
- A persistent note says every value and decision is **audited**.
- A failed check is shown in words and neutral colours, **never red**, and there is no green fill anywhere (the seal owns green).
- Removed: `items`, `onToggle`, `reviewer`, `reviewedAt`, and the met/pending/not-met model.
