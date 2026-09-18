import type { Metadata } from 'next';
import { TrackPage } from '@/components/TrackPage';

export const metadata: Metadata = {
  title: 'List your restaurant — Halal Goes',
  description:
    '0% commission at launch. We check your halal certificate against seven points before you go live, and tell you which one failed if it does.',
};

export default function RestaurantPage() {
  return <TrackPage audience="restaurant" />;
}
