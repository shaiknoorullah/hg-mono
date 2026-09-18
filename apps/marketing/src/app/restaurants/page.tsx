import type { Metadata } from 'next';
import { TrackPage } from '@/components/TrackPage';
import { pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'List your restaurant',
  description:
    '0% commission at launch. We check your halal certificate against seven points before you go live, and tell you which one failed if it does.',
  path: '/restaurants',
});

export default function RestaurantPage() {
  return <TrackPage audience="restaurant" />;
}
