/**
 * A2 Edit details (boards `AC/Account-edit` and its `-editemail`, `-editinvalid`, `-editfirstempty`,
 * `-editoffline`, `-editsaving`, `-editerror`, `-editunsaved`, `-addemail`).
 *
 * A sheet owned by the page that opens it (Account, Notification settings), not a route. First
 * name is required; last name and email are optional. The mobile number is how the customer signs
 * in, so it is read-only. An email can be changed but not removed, and a last name cannot be
 * cleared once set: `CustomerProfileUpdateInput` has `minLength: 1` on the name and a
 * non-nullable email, so the sheet says so before saving and sends nothing for an emptied field.
 *
 * Save stays enabled and validates on press; only offline disables it, with the reason beside it.
 * Closing with unsaved changes asks first (Keep editing / Discard changes). A rejected email is a
 * 422 `VALIDATION_FAILED` (customer emails are not unique), drawn as the field's error.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isApiError } from '@hg/api-client';

import { announceError } from '../signin/a11y';
import { Banner, Button, Input, Modal, Sheet, space, useTheme, useTypeStyle } from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { updateProfile } from './accountApi';
import {
  EMAIL_REJECTED,
  draftOf,
  editInput,
  formatPhone,
  isDirty,
  validateEdit,
  type CustomerProfile,
  type EditErrors,
} from './rules';

export const EDIT_COPY = {
  title: 'Your details',
  phoneHint: "Your number is how you sign in, so it can't be changed here.",
  emailHelp: 'You can change your email but not remove it.',
  emailHelpAdd: "We'll email a link to confirm it. Once added, you can change it but not remove it.",
  emailHelpNew: "We'll email a link to this new address. You can change your email but not remove it.",
  failedTitle: "We couldn't save your changes",
  failedBody: 'What you typed is still here.',
  offlineTitle: "You're offline",
  offlineBody: 'What you type stays here; connect to save it.',
  discardTitle: 'Discard your changes?',
  discardBody: "You changed your details but haven't saved them. If you close now, the changes are lost.",
} as const;

export interface EditDetailsSheetProps {
  profile: CustomerProfile;
  /** `addEmail`: opened from "Add an email"; the email field is the one to fill. */
  mode?: 'edit' | 'addEmail';
  onClose: () => void;
  /** The saved profile, and whether the email changed (a new link was sent to it). */
  onSaved: (profile: CustomerProfile, emailChanged: boolean) => void;
}

export function EditDetailsSheet({ profile, mode = 'edit', onClose, onSaved }: EditDetailsSheetProps): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const label = useTypeStyle('label.md');
  const body = useTypeStyle('body.md');
  const { online } = useConnectivity();
  const offline = !online;

  const base = React.useMemo(() => draftOf(profile), [profile]);
  const [first, setFirst] = React.useState(base.first);
  const [last, setLast] = React.useState(base.last);
  const [email, setEmail] = React.useState(base.email);
  const [errors, setErrors] = React.useState<EditErrors>({});
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  const draft = { first, last, email };
  const dirty = isDirty(draft, profile);
  const emailChanged = email.trim() !== '' && email.trim().toLowerCase() !== base.email.toLowerCase();

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  async function save(): Promise<void> {
    const found = validateEdit(draft);
    setErrors(found);
    if (found.first || found.email) {
      announceError((found.first ?? found.email)!);
      return;
    }
    const input = editInput(draft, profile);
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    setFailed(false);
    setSaving(true);
    try {
      const saved = await updateProfile(input);
      onSaved(saved, 'email' in input);
    } catch (e) {
      setSaving(false);
      const fields = isApiError(e) && Array.isArray(e.details) ? e.details : [];
      const emailRejected =
        isApiError(e) &&
        e.status === 422 &&
        (fields.length === 0 ? 'email' in input : fields.some((f: { field?: string }) => f.field === 'email'));
      if (emailRejected) {
        setErrors({ email: EMAIL_REJECTED });
        announceError(EMAIL_REJECTED);
      } else {
        setFailed(true);
      }
    }
  }

  const emailHelp = errors.email
    ? undefined
    : mode === 'addEmail' && !base.email
      ? EDIT_COPY.emailHelpAdd
      : emailChanged && base.email
        ? EDIT_COPY.emailHelpNew
        : EDIT_COPY.emailHelp;

  const footer = (
    <View style={styles.footer}>
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={saving}
        disabled={offline}
        accessibilityHint={offline ? 'Connect to save.' : undefined}
        onPress={save}
        testID="EditDetails-save"
      >
        {saving ? 'Saving' : 'Save changes'}
      </Button>
    </View>
  );

  return (
    <>
      <Sheet
        open
        onClose={requestClose}
        title={EDIT_COPY.title}
        footer={footer}
        scrollable
        keyboardAvoiding
        dismissible={!saving}
        testID="EditDetails"
      >
        <View style={styles.form}>
          {failed ? (
            <Banner
              variant="warning"
              title={EDIT_COPY.failedTitle}
              description={EDIT_COPY.failedBody}
              testID="EditDetails-failed"
            />
          ) : null}
          {offline ? (
            <Banner variant="info" title={EDIT_COPY.offlineTitle} description={EDIT_COPY.offlineBody} testID="EditDetails-offline" />
          ) : null}
          <Input
            label="First name"
            required
            autoComplete="given-name"
            maxLength={50}
            value={first}
            onChange={(v) => {
              setFirst(v);
              if (errors.first) setErrors({ ...errors, first: undefined });
            }}
            readOnly={saving}
            errorText={errors.first}
            testID="EditDetails-first"
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            maxLength={50}
            value={last}
            onChange={setLast}
            readOnly={saving}
            testID="EditDetails-last"
          />
          <Input
            label="Email"
            variant="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(v) => {
              setEmail(v);
              if (errors.email) setErrors({ ...errors, email: undefined });
            }}
            readOnly={saving}
            helperText={emailHelp}
            errorText={errors.email}
            testID="EditDetails-email"
          />
          <View style={styles.phone}>
            <Text style={[label, { color: theme.color.text.secondary }]}>Mobile number</Text>
            <Text style={[body, { color: theme.color.text.primary }]} testID="EditDetails-phone">
              {formatPhone(profile.phone_e164)}
            </Text>
            <Text style={[small, { color: theme.color.text.secondary }]}>{EDIT_COPY.phoneHint}</Text>
          </View>
        </View>
      </Sheet>
      <Modal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        variant="confirm"
        title={EDIT_COPY.discardTitle}
        description={EDIT_COPY.discardBody}
        actions={[
          { label: 'Keep editing', onPress: () => setConfirmDiscard(false) },
          { label: 'Discard changes', destructive: true, onPress: onClose },
        ]}
        testID="EditDetails-discard"
      />
    </>
  );
}

const styles = StyleSheet.create({
  form: { gap: space['4'], paddingBottom: space['2'] },
  phone: { gap: 2 },
  footer: { paddingHorizontal: space['4'], paddingBottom: space['4'] },
});
