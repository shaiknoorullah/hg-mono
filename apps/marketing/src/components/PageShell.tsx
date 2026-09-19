import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { type Audience } from '@/lib/audiences';

/**
 * The frame every non-track page sits in — same gutters, same header, same
 * footer as a track page, so the blog does not feel like a different website.
 */
export function PageShell({
  children,
  current = 'customer',
}: {
  children: React.ReactNode;
  current?: Audience;
}) {
  return (
    <div className="mx-auto box-border flex min-h-dvh max-w-[1280px] flex-col px-5 pt-4 lg:px-14 lg:pt-8">
      <SiteHeader current={current} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
