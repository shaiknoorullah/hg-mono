import type { Metadata } from 'next';
import { TrackPage } from '@/components/TrackPage';
import { pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Deliver with us',
  description:
    '$2.99 plus $1.00 per kilometre, paid to you in full. Every Monday, automatically, with no minimum payout.',
  path: '/riders',
});

export default function RiderPage() {
  return <TrackPage audience="rider" />;
}
