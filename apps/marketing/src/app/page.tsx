import type { Metadata } from 'next';
import { TrackPage } from '@/components/TrackPage';
import { absolute } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: absolute('/') },
};

export default function CustomerPage() {
  return <TrackPage audience="customer" />;
}
