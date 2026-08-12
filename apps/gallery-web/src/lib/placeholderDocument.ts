/**
 * A locally generated PNG, so `DocumentViewer`'s `loaded` state can be shown with no
 * object storage running.
 *
 * The viewer fetches its URL with `cache: 'no-store'` into a blob — that is what keeps a
 * KYC document out of the browser cache — so it needs bytes it can actually fetch. A
 * `data:` URL satisfies `fetch` without a network, and drawing to a canvas means the bytes
 * really are `image/png` rather than something mislabelled to get past the type check.
 *
 * Nothing on this canvas is a real document; it is a stand-in and says so on its face.
 */
export function makePlaceholderCertificatePng(): string {
  const width = 800;
  const height = 600;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#F3F1ED';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#948C7E';
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, width - 48, height - 48);

  ctx.fillStyle = '#1F1B17';
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.fillText('PLACEHOLDER DOCUMENT', 60, 110);

  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = '#4A443B';
  const lines = [
    'Generated in the browser by the gallery.',
    'No object storage is running, so there is nothing real to fetch.',
    '',
    'The viewer around it is real: it fetches with cache: "no-store",',
    'holds the bytes in a blob, revokes the object URL on expiry,',
    'and says out loud that opening it is recorded.',
  ];
  lines.forEach((line, index) => {
    ctx.fillText(line, 60, 180 + index * 34);
  });

  ctx.strokeStyle = '#D5CFC5';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    const y = 430 + i * 26;
    ctx.beginPath();
    ctx.moveTo(60, y);
    ctx.lineTo(width - 60 - (i % 3) * 90, y);
    ctx.stroke();
  }

  return canvas.toDataURL('image/png');
}
