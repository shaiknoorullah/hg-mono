/**
 * What shows before the console can render: loading the session, a load failure (with a
 * way out), or an account that is not a restaurant account (SI `SignIn-NotRestaurant`).
 */
import { ErrorState, Skeleton } from '../ds';
import type { ConsoleRoute } from '../data/console';

export function ConsoleStatus({ route, onRetry }: { route: ConsoleRoute; onRetry: () => void }) {
  if (route.kind === 'loading') {
    return (
      <div className="flex h-dvh" aria-busy="true" data-testid="console-loading">
        <span className="sr-only" role="status">
          Loading your restaurant…
        </span>
        <div className="w-16 bg-surface-base" />
        <div className="flex flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }
  if (route.kind === 'not-restaurant') {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <ErrorState
          title="This isn’t a restaurant account"
          description="Sign in with the email and password you registered your restaurant with."
          onRetry={() => window.location.assign('/login')}
          retryLabel="Sign in with another account"
        />
      </div>
    );
  }
  return (
    <div className="flex h-dvh items-center justify-center p-6" data-testid="console-error">
      <ErrorState
        title="We couldn’t load your restaurant"
        description="Your orders are safe on the server. Check the connection and try again."
        onRetry={onRetry}
        retryLabel="Try again"
      />
    </div>
  );
}
