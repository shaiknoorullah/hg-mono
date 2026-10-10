/**
 * A new account's profile holds the server's placeholder first name ("there", for "Hi there").
 * The Profile screen never shows it as the customer's name or pre-fills it (issue #779).
 */
import * as React from 'react';
import { render, screen } from '@testing-library/react-native';

import customerProfile from '../../../../../contracts/fixtures/platform/customer_profile.json';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

const { ProfileForm } = require('../ProfileScreen') as typeof import('../ProfileScreen');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');

type Profile = React.ComponentProps<typeof ProfileForm>['profile'];

function renderForm(profile: Profile): void {
  render(
    <ThemeProvider>
      <ProfileForm
        profile={profile}
        onSaved={() => {}}
        bottomInset={0}
        onOpenAddresses={() => {}}
        onOpenOrders={() => {}}
        onSignOut={() => {}}
      />
    </ThemeProvider>,
  );
}

const base = customerProfile.payload as unknown as Profile;

describe('ProfileForm', () => {
  it("shows no name and an empty first-name field for the server's placeholder", () => {
    renderForm({ ...base, first_name: 'there', last_name: null });
    expect(screen.queryByText('there')).toBeNull();
    expect(screen.queryByDisplayValue('there')).toBeNull();
  });

  it('shows and pre-fills a name the customer gave', () => {
    renderForm({ ...base, first_name: 'Aisha', last_name: 'Malik' });
    expect(screen.getByText('Aisha Malik')).toBeTruthy();
    expect(screen.getByDisplayValue('Aisha')).toBeTruthy();
  });
});
