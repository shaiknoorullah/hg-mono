/**
 * Unit tests for apps/rider/src/api.ts token refresh logic.
 *
 * Tests the onUnauthorized handler which implements:
 * - Single-flight refresh (parallel 401s share one rotation)
 * - Session epoch tracking (refresh started in old session doesn't apply to new one)
 * - Error handling (refresh failure clears tokens)
 * - Token pair rotation (successful refresh updates both access and refresh tokens)
 */

// Mock the token module
jest.mock('../token');

import { getEpoch, getRefreshToken, getToken, setToken, setTokens } from '../token';
import { onUnauthorized, refreshClient } from '../api';

describe('api.ts - onUnauthorized handler', () => {
  let mockRefreshPost: jest.Mock;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock the refreshClient.POST method
    mockRefreshPost = jest.fn();
    (refreshClient.POST as any) = mockRefreshPost;

    // Set up default token returns
    (getEpoch as jest.Mock).mockReturnValue(0);
    (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');
    (getToken as jest.Mock).mockReturnValue('access_token_123');
  });

  describe('401 with no refresh token', () => {
    it('should clear the access token and return false', async () => {
      (getRefreshToken as jest.Mock).mockReturnValue(null);
      (getToken as jest.Mock).mockReturnValue('access_token_123');

      const result = await onUnauthorized();

      expect(result).toBe(false);
      expect(setToken).toHaveBeenCalledWith(null);
    });
  });

  describe('401 with token but no refresh token', () => {
    it('should clear the access token and return false', async () => {
      (getRefreshToken as jest.Mock).mockReturnValue(null);
      (getToken as jest.Mock).mockReturnValue('some_token');

      const result = await onUnauthorized();

      expect(result).toBe(false);
      expect(setToken).toHaveBeenCalledWith(null);
    });
  });

  describe('401 followed by successful refresh', () => {
    it('should call setTokens with new tokens and return true', async () => {
      (getEpoch as jest.Mock).mockReturnValue(0);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      mockRefreshPost.mockResolvedValue({
        data: {
          data: {
            access_token: 'new_access_token',
            refresh_token: 'new_refresh_token',
          },
        },
      });

      const result = await onUnauthorized();

      expect(result).toBe(true);
      expect(setTokens).toHaveBeenCalledWith('new_access_token', 'new_refresh_token');
    });
  });

  describe('concurrent 401s - single-flight refresh', () => {
    it('should execute only one refresh POST for parallel 401s', async () => {
      let resolveRefresh: () => void;
      const refreshPromise = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });

      (getEpoch as jest.Mock).mockReturnValue(0);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      mockRefreshPost.mockReturnValue(
        refreshPromise.then(() => ({
          data: {
            data: {
              access_token: 'new_access_token',
              refresh_token: 'new_refresh_token',
            },
          },
        }))
      );

      // Trigger two concurrent 401s
      const promise1 = onUnauthorized();
      const promise2 = onUnauthorized();

      // POST should be called only once
      expect(mockRefreshPost).toHaveBeenCalledTimes(1);

      // Resolve the refresh
      resolveRefresh!();

      // Both should return true
      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toBe(true);
      expect(result2).toBe(true);

      // Still only one POST
      expect(mockRefreshPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('401 followed by refresh failure', () => {
    it('should clear tokens and return false on refresh error', async () => {
      (getEpoch as jest.Mock).mockReturnValue(0);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      mockRefreshPost.mockRejectedValue(new Error('Network error'));

      const result = await onUnauthorized();

      expect(result).toBe(false);
      expect(setToken).toHaveBeenCalledWith(null);
    });
  });

  describe('epoch change during refresh', () => {
    it('should not apply tokens from old session when epoch changed', async () => {
      let currentEpoch = 0;
      (getEpoch as jest.Mock).mockImplementation(() => currentEpoch);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      let resolveRefresh: () => void;
      const refreshPromise = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });

      mockRefreshPost.mockReturnValue(
        refreshPromise.then(() => ({
          data: {
            data: {
              access_token: 'new_access_token',
              refresh_token: 'new_refresh_token',
            },
          },
        }))
      );

      // Start refresh in epoch 0
      const refreshPromiseP = onUnauthorized();

      // Change epoch
      currentEpoch = 1;

      // Resolve refresh
      resolveRefresh!();

      // Result should be false because epoch changed
      const result = await refreshPromiseP;
      expect(result).toBe(false);

      // Should not apply tokens
      expect(setTokens).not.toHaveBeenCalled();
    });
  });

  describe('refresh with missing grant data', () => {
    it('should clear tokens if refresh response has no grant data', async () => {
      (getEpoch as jest.Mock).mockReturnValue(0);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      mockRefreshPost.mockResolvedValue({
        data: {
          data: null,
        },
      });

      const result = await onUnauthorized();

      expect(result).toBe(false);
      expect(setToken).toHaveBeenCalledWith(null);
    });
  });

  describe('refresh with undefined refresh_token in response', () => {
    it('should handle optional refresh_token and call setTokens with null', async () => {
      (getEpoch as jest.Mock).mockReturnValue(0);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      mockRefreshPost.mockResolvedValue({
        data: {
          data: {
            access_token: 'new_access_token',
            refresh_token: undefined,
          },
        },
      });

      const result = await onUnauthorized();

      expect(result).toBe(true);
      expect(setTokens).toHaveBeenCalledWith('new_access_token', null);
    });
  });

  describe('epoch cleanup on refresh completion', () => {
    it('should clean up refreshing state when refresh completes', async () => {
      (getEpoch as jest.Mock).mockReturnValue(0);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      mockRefreshPost.mockResolvedValue({
        data: {
          data: {
            access_token: 'new_access_token',
            refresh_token: 'new_refresh_token',
          },
        },
      });

      // First refresh
      await onUnauthorized();
      expect(mockRefreshPost).toHaveBeenCalledTimes(1);

      // Subsequent 401 should trigger new refresh
      mockRefreshPost.mockClear();
      mockRefreshPost.mockResolvedValue({
        data: {
          data: {
            access_token: 'another_token',
            refresh_token: 'another_refresh',
          },
        },
      });

      await onUnauthorized();
      expect(mockRefreshPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh started before session change', () => {
    it('should not apply old session tokens after new session is created', async () => {
      let currentEpoch = 0;
      (getEpoch as jest.Mock).mockImplementation(() => currentEpoch);
      (getRefreshToken as jest.Mock).mockReturnValue('refresh_token_123');

      let resolveRefresh: () => void;
      const refreshPromise = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });

      mockRefreshPost.mockReturnValue(
        refreshPromise.then(() => ({
          data: {
            data: {
              access_token: 'old_session_token',
              refresh_token: 'old_session_refresh',
            },
          },
        }))
      );

      // Start refresh for old session
      const oldRefresh = onUnauthorized();

      // Simulate new sign-in
      currentEpoch = 1;

      // Resolve old refresh
      resolveRefresh!();

      // Await old refresh result
      const result = await oldRefresh;
      expect(result).toBe(false);

      // Verify tokens were not applied
      expect(setTokens).not.toHaveBeenCalled();
    });
  });
});

describe('api.ts - clientFor function', () => {
  it('should return api client when scenario is undefined', () => {
    const { clientFor, api } = require('../api');
    const client = clientFor(undefined);
    expect(client).toBe(api);
  });

  it('should return api client when not in mock mode', () => {
    const { clientFor, api, API_BASE_URL } = require('../api');
    // Only test this if we're not in mock mode
    if (API_BASE_URL !== 'http://localhost:4010') {
      const client = clientFor('some-scenario');
      expect(client).toBe(api);
    }
  });

  it('should return the same client instance for the same scenario', () => {
    const { clientFor } = require('../api');
    const scenario = 'test-scenario';
    const client1 = clientFor(scenario);
    const client2 = clientFor(scenario);
    expect(client1).toBe(client2);
  });

  it('should return different client instances for different scenarios', () => {
    const { clientFor } = require('../api');
    const client1 = clientFor('scenario1');
    const client2 = clientFor('scenario2');
    expect(client1).not.toBe(client2);
  });
});
