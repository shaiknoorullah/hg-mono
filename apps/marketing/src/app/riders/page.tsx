import type { Metadata } from 'next';
import { TrackPage } from '@/components/TrackPage';

export const metadata: Metadata = {
  title: 'Deliver with Halal Goes',
  description:
    '$2.99 plus $1.00 per kilometre, paid to you in full. Every Monday, automatically, with no minimum payout.',
};

export default function RiderPage() {
  return <TrackPage audience="rider" />;
}
