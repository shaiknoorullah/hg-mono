import { OrderListPage } from './OrderListPage';

/** `#/disputes`: orders in Disputed, every page loaded, then sorted by next deadline. */
export default function DisputesRoute() {
  return <OrderListPage mode="disputes" />;
}
