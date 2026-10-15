import { OrderListPage } from './OrderListPage';

/** `#/orders`: every restaurant's orders, newest first. */
export default function OrdersRoute() {
  return <OrderListPage mode="orders" />;
}
