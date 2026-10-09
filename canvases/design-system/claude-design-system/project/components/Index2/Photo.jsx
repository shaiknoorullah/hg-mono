/* Photo: PLACEHOLDER for the missing design-system Image/MediaFrame component (K-03, gap
   "MediaFrame"; #109 adds it). It takes the contract's real image field as `src`
   (RestaurantCard.hero_image_url / logo_image_url, MenuItem.image_url, CartLine.image_url).
   None of those fields is required, so `src = null` is a real state: it renders the designed
   no-image fallback (sunken plate + a 'No image' caption; Solar has no food glyph), never a gradient and never a fake photo.
   Identical copies live in components/Index2/Photo.jsx and components/customer-app/Photo.jsx. */

function Photo({ src = null, alt = '', height = 160, aspect, radius = 'lg', style }) {
  const r = typeof radius === 'string' ? 'var(--radius-' + radius + ')' : radius;
  return (
    <div data-gap="MediaFrame" title="Component gap: MediaFrame (placeholder until #109)" style={{
      position: 'relative', height: aspect ? undefined : height, aspectRatio: aspect, background: 'var(--surface-sunken)',
      borderRadius: r, display: 'grid', placeItems: 'center', overflow: 'hidden',
      boxShadow: 'inset 0 0 0 1px var(--border-decorative)', ...style,
    }}>
      {src
        ? <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span role="img" aria-label={alt ? alt + ' (no image)' : 'No image'} style={{ color: 'var(--text-tertiary)', fontSize: 'var(--type-caption-size)', fontWeight: 600, letterSpacing: '.02em' }}>
            {(typeof height === 'number' && height < 56) ? '' : 'No image'}
          </span>}
    </div>
  );
}
Object.assign(window, { Photo });
