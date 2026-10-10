/**
 * R09 Document capture: the camera, the photo of you, a chosen file.
 *
 * Boards: SO `Capture-Starting`, `-Camera`, `-TorchOn`, `-Review`, `-TooSoon`, `-Selfie`,
 * `-SelfieReview`, `-Selfie-Denied`, `-Selfie-TooSmall`, `-Selfie-Interrupted`, `-PdfPicked`,
 * `-PdfError`, `-FileUnreadable`, `-CameraDenied`, `Capture-Camera-Light`.
 *
 * - The camera is `expo-camera` (torch is a Switch inside the frame; the photo of you uses the
 *   front camera only, has no file option and no expiry).
 * - "Choose a file" uses `src/capture.ts` (`expo-image-picker`): the app has no document-picker
 *   dependency yet, so a chosen file is a photo; the PDF path waits for that dependency (listed
 *   in the PR). A chosen file over 15 MB, or one that is not a photo or a PDF, is refused here
 *   before anything is sent.
 * - "Use this photo" checks the typed expiry (at least 30 days away; too soon makes Back to
 *   documents the primary), hands the bytes to the upload queue (`uploads.ts`) and returns to
 *   the list, where the row shows the upload. The camera still works offline: the photo waits in
 *   the queue.
 * - Reopened for a photo of you whose upload stopped, it shows that state first
 *   (`Capture-Selfie-TooSmall`, `Capture-Selfie-Interrupted`).
 */
import * as React from 'react';
import { Linking, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { base64ToBytes } from '../../base64';
import { pickImage } from '../../capture';
import { Button, Switch, radius, space, typeStyle, useTheme } from '../ds';
import { useSupport } from '../data/config';
import { useOnline } from '../data/connectivity';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { Frame, OfflineAlert, SupportGhost } from '../application/ApplicationScreen';
import { TRY_AGAIN } from '../application/copy';
import { BACK_TO_DOCUMENTS, CAPTURE, DOC } from './copy';
import { MAX_FILE_BYTES, checkExpiry, dayDate } from './data';
import { Alert, DateFields, Heading, Thumbnail, type DateValue } from './DocumentsScreen';
import { retryUpload, startUpload, useUploads, type PickedFile } from './uploads';

type Phase =
  | { kind: 'camera' }
  | { kind: 'review'; file: PickedFile }
  | { kind: 'file'; file: PickedFile }
  | { kind: 'too-large'; file: PickedFile }
  | { kind: 'unreadable'; file: PickedFile }
  | { kind: 'too-soon'; file: PickedFile; iso: string }
  | { kind: 'stopped' };

const READABLE = /^(image\/(jpeg|png|heic|heif|webp)|application\/pdf)$/;
const EMPTY_DATE: DateValue = { day: '', month: '', year: '' };

export function CaptureScreen({ params }: ScreenProps<'applicationCapture'>): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const support = useSupport();
  const online = useOnline();
  const { docType } = params;
  const selfie = docType === 'PROFILE_PHOTO';
  const copy = DOC[docType];
  const uploads = useUploads();
  const stopped = selfie ? uploads.get(docType) : undefined;

  const [permission, requestPermission] = useCameraPermissions();
  const asked = React.useRef(false);
  const camera = React.useRef<CameraView | null>(null);
  const [ready, setReady] = React.useState(false);
  const [torch, setTorch] = React.useState(false);
  const [shotFailed, setShotFailed] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>(() => (stopped?.phase === 'failed' ? { kind: 'stopped' } : { kind: 'camera' }));
  const [date, setDate] = React.useState<DateValue>(EMPTY_DATE);
  const [dateError, setDateError] = React.useState<string | null>(null);
  // A second tap lands before the re-render: one shot at a time, and the photo is handed over (and
  // the screen popped) once, or a double tap on "Use this photo" would pop Documents too.
  const shooting = React.useRef(false);
  const handedOver = React.useRef(false);

  // Ask once; a refusal shows the denied board rather than asking again.
  React.useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !asked.current) {
      asked.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const chooseFile = React.useCallback(async () => {
    const picked = await pickImage();
    if (!picked.ok) return; // cancelled, or no library access: stay where the rider was
    const bytes = picked.image.bytes;
    const file: PickedFile = { bytes, contentType: picked.image.contentType, name: null, uri: null };
    setDate(EMPTY_DATE);
    setDateError(null);
    if (!READABLE.test(file.contentType)) setPhase({ kind: 'unreadable', file });
    else if (bytes.byteLength > MAX_FILE_BYTES) setPhase({ kind: 'too-large', file });
    else setPhase({ kind: 'file', file });
  }, []);

  React.useEffect(() => {
    if (params.start === 'file' && !selfie) void chooseFile();
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shoot = async () => {
    if (shooting.current) return;
    shooting.current = true;
    setShotFailed(false);
    try {
      // Camera photos are taken at a reduced quality so they stay well under the 15 MB cap.
      const shot = await camera.current?.takePictureAsync({ base64: true, quality: 0.5 });
      if (!shot?.base64) throw new Error('no photo');
      setDate(EMPTY_DATE);
      setDateError(null);
      setPhase({ kind: 'review', file: { bytes: base64ToBytes(shot.base64), contentType: 'image/jpeg', name: null, uri: shot.uri } });
    } catch {
      setShotFailed(true);
    } finally {
      shooting.current = false;
    }
  };

  /** Leave for Documents once, whatever the number of taps. */
  const handOver = (fn: () => void) => {
    if (handedOver.current) return;
    handedOver.current = true;
    fn();
    nav.pop();
  };

  const use = (file: PickedFile) => {
    if (selfie) return handOver(() => startUpload(docType, file, null));
    const check = checkExpiry(date.day, date.month, date.year);
    if (check.kind === 'invalid') return setDateError(CAPTURE.expiryInvalid);
    if (check.kind === 'too-soon') return setPhase({ kind: 'too-soon', file, iso: check.iso });
    handOver(() => startUpload(docType, file, check.iso));
  };

  const retake = () => {
    setShotFailed(false);
    setPhase({ kind: 'camera' });
  };
  const back = { label: BACK_TO_DOCUMENTS, onPress: () => void nav.pop() };
  const body = { ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary };
  const frame = (testID: string, footer: React.ReactNode, children: React.ReactNode) => (
    <Frame testID={testID} title={copy.label} back={back} footer={footer}>
      {children}
    </Frame>
  );
  const dateFields = (helper: string, error: string | null) => (
    <DateFields
      testID="expiry"
      label={CAPTURE.expiryLabel(copy.noun)}
      helper={helper}
      value={date}
      onChange={(v) => {
        setDate(v);
        setDateError(null);
      }}
      error={error}
    />
  );
  const button = (testID: string, label: string, onPress: () => void, variant: 'primary' | 'tertiary' | 'ghost' = 'primary', disabled = false) => (
    <Button testID={testID} variant={variant} size="xl" fullWidth disabled={disabled} onPress={onPress}>
      {label}
    </Button>
  );

  switch (phase.kind) {
    case 'stopped': {
      const tooSmall = stopped?.failure === 'too-small';
      return frame(
        tooSmall ? 'capture-selfie-too-small' : 'capture-selfie-interrupted',
        <>
          {tooSmall ? null : button('capture-try-again', TRY_AGAIN, () => handOver(() => retryUpload(docType)))}
          {button('capture-retake', CAPTURE.retake, retake, tooSmall ? 'primary' : 'tertiary')}
        </>,
        <>
          {!tooSmall && !online ? <OfflineAlert body={CAPTURE.interruptedOffline} /> : null}
          <Thumbnail uri={stopped?.file.uri ?? null} />
          {tooSmall ? (
            <Alert tone="warning" title={CAPTURE.selfieTooSmallTitle} body={CAPTURE.selfieTooSmallBody} />
          ) : (
            <Alert tone="neutral" title={CAPTURE.interruptedTitle} body={CAPTURE.interruptedBody} />
          )}
        </>,
      );
    }
    case 'review':
      return frame(
        selfie ? 'capture-selfie-review' : 'capture-review',
        <>
          {button('capture-use', CAPTURE.usePhoto, () => use(phase.file))}
          {button('capture-retake', CAPTURE.retake, retake, 'tertiary')}
        </>,
        <>
          <Thumbnail uri={phase.file.uri} />
          <Text style={body}>{selfie ? CAPTURE.selfieCheck : CAPTURE.reviewCheck}</Text>
          {selfie ? null : dateFields(CAPTURE.expiryHelper(copy.noun), dateError)}
        </>,
      );
    case 'file':
      return frame(
        'capture-file',
        <>
          {button('capture-use-file', CAPTURE.useFile, () => use(phase.file))}
          {button('capture-choose-different', CAPTURE.chooseDifferent, () => void chooseFile(), 'tertiary')}
        </>,
        <>
          <FileLine file={phase.file} label={copy.label} />
          <Text style={body}>{CAPTURE.fileSent(copy.noun)}</Text>
          {dateFields(CAPTURE.expiryHelperShort, dateError)}
        </>,
      );
    case 'too-large':
    case 'unreadable':
      return frame(
        phase.kind === 'too-large' ? 'capture-too-large' : 'capture-unreadable',
        <>
          {button('capture-choose-different', CAPTURE.chooseDifferent, () => void chooseFile())}
          {button('capture-take-instead', CAPTURE.takeInstead, retake, 'tertiary')}
        </>,
        <>
          <FileLine file={phase.file} label={copy.label} />
          {phase.kind === 'too-large' ? (
            <Alert tone="warning" title={CAPTURE.tooLargeTitle} body={CAPTURE.tooLargeBody} />
          ) : (
            <Alert tone="warning" title={CAPTURE.unreadableTitle} body={CAPTURE.unreadableBody} />
          )}
        </>,
      );
    case 'too-soon':
      return frame(
        'capture-too-soon',
        <>
          {button('capture-back', BACK_TO_DOCUMENTS, () => void nav.pop())}
          <Text style={{ ...typeStyle(theme, 'body.md'), color: theme.color.text.primary, textAlign: 'center' }}>{CAPTURE.wrongDate}</Text>
          {button('capture-change-date', CAPTURE.changeDate, () => setPhase(phase.file.uri ? { kind: 'review', file: phase.file } : { kind: 'file', file: phase.file }), 'tertiary')}
        </>,
        <>
          <Thumbnail uri={phase.file.uri} />
          {dateFields('', CAPTURE.tooSoon(copy.noun, dayDate(phase.iso)))}
        </>,
      );
    case 'camera':
      break;
  }

  // ── the camera ──
  const denied = permission != null && !permission.granted && (!permission.canAskAgain || asked.current);
  if (denied) {
    return frame(
      selfie ? 'capture-selfie-denied' : 'capture-denied',
      <>
        {button('capture-open-settings', CAPTURE.openSettings, () => void Linking.openSettings())}
        {selfie
          ? button('capture-back', BACK_TO_DOCUMENTS, () => void nav.pop(), 'tertiary')
          : button('capture-choose-file', CAPTURE.choosePdf, () => void chooseFile(), 'tertiary')}
      </>,
      <View style={{ gap: space['3'], paddingTop: space['6'] }}>
        <Heading text={selfie ? CAPTURE.selfieDeniedTitle : CAPTURE.deniedTitle} level="xl" />
        <Text style={body}>{selfie ? CAPTURE.selfieDeniedBody : CAPTURE.deniedBody}</Text>
      </View>,
    );
  }

  const granted = permission?.granted === true;
  const starting = !granted || !ready;
  return frame(
    selfie ? 'capture-selfie' : starting ? 'capture-starting' : 'capture-camera',
    <>
      {/* "Take photo" is primary xl (60), not 72: 72 is kept for the offer's Accept and Decline. */}
      {button('capture-take', CAPTURE.takePhoto, () => void shoot(), 'primary', starting)}
      {selfie ? null : button('capture-choose-file', starting ? CAPTURE.choosePdf : CAPTURE.chooseFile, () => void chooseFile(), 'ghost')}
      <SupportGhost support={support} />
    </>,
    <>
      {/* ds-request(native): CameraCapture (frame, oval, permission states) — SO Capture-Camera, Capture-Selfie (expo-camera's CameraView stands in) */}
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', aspectRatio: selfie ? 0.8 : 1.4, backgroundColor: theme.color.surface.inverse }}>
        {granted ? (
          <CameraView
            ref={camera}
            style={{ flex: 1 }}
            facing={selfie ? 'front' : 'back'}
            enableTorch={!selfie && torch}
            onCameraReady={() => setReady(true)}
          />
        ) : null}
      </View>
      {starting ? (
        <Text accessibilityLiveRegion="polite" style={body}>
          {CAPTURE.starting}
        </Text>
      ) : null}
      {selfie ? (
        <>
          <Heading text={CAPTURE.selfieFit} />
          <Text style={body}>{CAPTURE.selfieBody}</Text>
        </>
      ) : (
        <>
          {starting ? null : <Heading text={CAPTURE.fit(copy.noun)} />}
          <Text style={body}>{CAPTURE.flat}</Text>
          {/* ds-request(native): Switch 56 (field) — SO Capture-Camera, Capture-TorchOn */}
          <Switch testID="capture-torch" label={CAPTURE.torch} checked={torch} disabled={starting} onChange={setTorch} />
        </>
      )}
      {shotFailed ? <Alert tone="warning" title={CAPTURE.shotFailed} /> : null}
    </>,
  );
}

/** "licence-scan.pdf · 1.4 MB" (Capture-PdfPicked); a photo from the library has no name, so the document's. */
function FileLine({ file, label }: { file: PickedFile; label: string }): React.ReactElement {
  const theme = useTheme();
  return (
    // ds-request(native): FileUpload PDF preview — SO Capture-PdfPicked, Capture-PdfError, Capture-FileUnreadable
    <View testID="capture-file-line" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
      <Text style={{ ...typeStyle(theme, 'label.lg'), color: theme.color.text.primary }}>{file.name ?? label}</Text>
      <Text style={{ ...typeStyle(theme, 'body.lg'), color: theme.color.text.primary }}>{CAPTURE.size(file.bytes.byteLength)}</Text>
    </View>
  );
}
