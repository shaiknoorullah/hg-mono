// Prints world.json: who is who in the end-to-end world, for the Playwright tests, the Maestro
// flows and tools/e2e/lib/api.mjs. The ids, phones and names are the fixed ones in world.sql
// (change both together); the sign-in secrets come from tools/e2e/seed/seed.sh. The file holds
// this run's throwaway password and TOTP secret, so the workflow deletes it before uploading
// anything.
const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`world.mjs needs ${name}`);
  return value;
};

const world = {
  password: env('PASSWORD'),
  admin: {
    email: env('ADMIN_EMAIL'),
    totpSecret: env('ADMIN_TOTP'),
  },
  restaurant: {
    id: 'e2e00000-0000-4000-8000-0000000000a1',
    name: 'Bismillah Grill',
    ownerEmail: env('RESTAURANT_EMAIL'),
    // Where the rider's emulator stands to be offered its orders (dispatch looks 3 km around).
    latitude: 43.6532,
    longitude: -79.3832,
    certificateId: 'e2e00000-0000-4000-8000-0000000003a1',
    certificateNumber: 'E2E-HMA-0001',
    menuItemId: 'e2e00000-0000-4000-8000-0000000005a1',
    menuItemName: 'Chicken Biryani',
  },
  expiredRestaurant: {
    id: 'e2e00000-0000-4000-8000-0000000000a2',
    name: 'Crescent Kitchen',
    certificateId: 'e2e00000-0000-4000-8000-0000000003a2',
    certificateNumber: 'E2E-HMA-0002',
  },
  customers: {
    // Signs in on the Android app and places the order the other apps then handle.
    app: { id: 'e2e00000-0000-4000-8000-00000000c001', phone: '+14165550110', name: 'Amina', addressId: 'e2e00000-0000-4000-8000-0000000007c1' },
    // Places orders through the API (one active order per customer, so not the same person).
    api: { id: 'e2e00000-0000-4000-8000-00000000c002', phone: '+14165550111', name: 'Omar', addressId: 'e2e00000-0000-4000-8000-0000000007c2' },
  },
  rider: { id: 'e2e00000-0000-4000-8000-00000000d001', phone: '+14165550161', name: 'Bilal' },
};

console.log(JSON.stringify(world, null, 2));
