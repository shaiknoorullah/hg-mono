/**
 * Deep links (`hgcustomer://`, app.config.js `scheme`): email verification, a restaurant, an order
 * (push "rider arrived" and order updates). Anything else opens nothing.
 *
 *   hgcustomer://verify-email?token=…   → emailVerify
 *   hgcustomer://restaurant/{id}        → restaurant
 *   hgcustomer://order/{id}             → tracking
 */
import type { Route } from './routes';

const UUIDISH = /^[A-Za-z0-9-]{1,64}$/;

export function routeForUrl(url: string | null | undefined): Route | null {
  if (!url) return null;
  const match = /^hgcustomer:\/\/([^?#]*)(\?[^#]*)?/.exec(url.trim());
  if (!match) return null;
  const segments = (match[1] ?? '').split('/').filter(Boolean);
  const query = new URLSearchParams(match[2] ?? '');
  const [head, id] = segments;
  switch (head) {
    case 'verify-email': {
      const token = query.get('token');
      return token ? { name: 'emailVerify', token } : null;
    }
    case 'restaurant':
      return id && UUIDISH.test(id) ? { name: 'restaurant', restaurantId: id } : null;
    case 'order':
      return id && UUIDISH.test(id) ? { name: 'tracking', orderId: id } : null;
    default:
      return null;
  }
}
