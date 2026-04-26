import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const configMock = vi.hoisted(() => {
  return {
    supabaseClient: {
      auth: {
        signInWithPassword: vi.fn(),
        getUser: vi.fn(),
        getSession: vi.fn(),
        mfa: {
          enroll: vi.fn(),
          challenge: vi.fn(),
          verify: vi.fn(),
          unenroll: vi.fn(),
          listFactors: vi.fn(),
          getAuthenticatorAssuranceLevel: vi.fn(),
        }
      },
      from: vi.fn(() => ({
          select: vi.fn(() => ({
              ilike: vi.fn()
          }))
      }))
    }
  };
});

vi.mock('../../src/resources/config/config', () => ({
  default: configMock
}));

vi.mock('../../src/resources/resources', () => ({
  default: {
    config: configMock
  }
}));

const servicesMock = vi.hoisted(() => ({
  authentication: {
    getUserDetails: vi.fn(),
  }
}));

vi.mock('../../src/services/services', () => ({
  default: servicesMock
}));

// Mock global localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
});

// Mock window.location for node environment
const originalLocation = typeof window !== 'undefined' ? window.location : undefined;
if (typeof global.window === 'undefined') {
    (global as any).window = { location: { href: '' } };
}

import emailLogin from '../../src/services/authentication/emailLogin';
import getAccessToken from '../../src/services/authentication/getAccessToken';
import isLoggedIn from '../../src/services/authentication/isLoggedIn';
import getSession from '../../src/services/authentication/getSession';
import checkRegistrationStatus from '../../src/services/authentication/checkRegistrationStatus';
import mfaService from '../../src/services/authentication/mfaService';

describe('Authentication Service', () => {
    beforeEach(() => {
        delete (global.window as any).location;
        global.window.location = { ...(originalLocation || {}), href: '' } as any;
    });
    
    afterEach(() => {
        if (originalLocation) {
            global.window.location = originalLocation as any;
        }
        vi.clearAllMocks();
    });

    describe('emailLogin', () => {
        it('returns "error" if supabaseClient is not initialized', async () => {
            const originalClient = configMock.supabaseClient;
            (configMock as any).supabaseClient = null;
            const result = await emailLogin('test@example.com', 'password');
            expect(result).toStrictEqual('error');
            configMock.supabaseClient = originalClient;
        });

        it('returns "error" on failed sign in', async () => {
            configMock.supabaseClient.auth.signInWithPassword.mockResolvedValueOnce({ data: null, error: new Error('Failed') });
            const result = await emailLogin('test@example.com', 'wrongpassword');
            expect(result).toStrictEqual('error');
        });

        it('returns "email_not_verified" if email is not confirmed', async () => {
            configMock.supabaseClient.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: '1' } }, error: null });
            configMock.supabaseClient.auth.getUser.mockResolvedValueOnce({ data: { user: { id: '1', email_confirmed_at: null } }, error: null });
            
            const result = await emailLogin('test@example.com', 'password');
            expect(result).toStrictEqual('email_not_verified');
        });

        it('sets localStorage, redirects and returns data on successful login', async () => {
            const mockData = { user: { id: '1' }, session: { access_token: 'token' } };
            configMock.supabaseClient.auth.signInWithPassword.mockResolvedValueOnce({ data: mockData, error: null });
            configMock.supabaseClient.auth.getUser.mockResolvedValueOnce({ data: { user: { id: '1', email_confirmed_at: '2023-01-01T00:00:00' } }, error: null });
            
            const result = await emailLogin('test@example.com', 'password');
            expect(localStorageMock.setItem).toHaveBeenCalledWith('isLoggedIn', 'true');
            expect(window.location.href).toStrictEqual('/hushh-user-profile');
            expect(result).toStrictEqual(mockData);
        });

        it('catches and returns "error" on exception', async () => {
            configMock.supabaseClient.auth.signInWithPassword.mockRejectedValueOnce(new Error('Network error'));
            const result = await emailLogin('test@example.com', 'password');
            expect(result).toStrictEqual('error');
        });
    });

    describe('getAccessToken', () => {
        it('returns null when user details or data is missing', async () => {
            servicesMock.authentication.getUserDetails.mockResolvedValueOnce(null);
            const result1 = await getAccessToken(() => {});
            expect(result1).toStrictEqual(null);

            servicesMock.authentication.getUserDetails.mockResolvedValueOnce({ data: null });
            const result2 = await getAccessToken(() => {});
            expect(result2).toStrictEqual(null);
        });

        it('returns access token and calls setAccessToken if provided', async () => {
            servicesMock.authentication.getUserDetails.mockResolvedValueOnce({ data: { access_token: 'token123' } as any });
            const setAccessTokenMock = vi.fn();
            const result = await getAccessToken(setAccessTokenMock);
            expect(setAccessTokenMock).toHaveBeenCalledWith('token123');
            expect(result).toStrictEqual('token123');
        });

        it('returns access token even if setAccessToken is null', async () => {
            servicesMock.authentication.getUserDetails.mockResolvedValueOnce({ data: { access_token: 'token123' } as any });
            const result = await getAccessToken(null as any);
            expect(result).toStrictEqual('token123');
        });
    });

    describe('isLoggedIn', () => {
        it('returns false and sets false when data is missing', async () => {
            servicesMock.authentication.getUserDetails.mockResolvedValueOnce({ data: null });
            const setIsLoggedInMock = vi.fn();
            const result = await isLoggedIn(setIsLoggedInMock);
            expect(setIsLoggedInMock).toHaveBeenCalledWith(false);
            expect(result).toStrictEqual(false);
        });

        it('returns true and sets true when data exists', async () => {
            servicesMock.authentication.getUserDetails.mockResolvedValueOnce({ data: { id: '1' } });
            const setIsLoggedInMock = vi.fn();
            const result = await isLoggedIn(setIsLoggedInMock);
            expect(setIsLoggedInMock).toHaveBeenCalledWith(true);
            expect(result).toStrictEqual(true);
        });

        it('returns truthy value even if setIsLoggedIn is null', async () => {
            servicesMock.authentication.getUserDetails.mockResolvedValueOnce({ data: { id: '1' } });
            const result = await isLoggedIn(null);
            expect(result).toStrictEqual(true);
        });
    });

    describe('getSession', () => {
        it('calls native Supabase getSession Auth properly', async () => {
            configMock.supabaseClient.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
            await getSession();
            expect(configMock.supabaseClient.auth.getSession).toHaveBeenCalled();
        });

        it('throws error if supabase throws', async () => {
            const err = new Error('get session failed');
            configMock.supabaseClient.auth.getSession.mockRejectedValueOnce(err);
            await expect(getSession()).rejects.toThrow('get session failed');
        });
    });

    describe('checkRegistrationStatus', () => {
        let mockIlike: any;
        let mockSelect: any;
        let mockFrom: any;

        beforeEach(() => {
            mockIlike = vi.fn();
            mockSelect = vi.fn(() => ({ ilike: mockIlike }));
            mockFrom = vi.fn(() => ({ select: mockSelect }));
            configMock.supabaseClient.from = mockFrom;
        });

        it('returns false states on error', async () => {
            mockIlike.mockResolvedValueOnce({ data: null, error: { message: 'db error' } });
            const result = await checkRegistrationStatus('test@example.com');
            expect(result).toStrictEqual({ isRegistered: false, hasHushhId: false, userData: null });
            expect(mockFrom).toHaveBeenCalledWith('users');
            expect(mockSelect).toHaveBeenCalledWith('*');
            expect(mockIlike).toHaveBeenCalledWith('email', '%test@example.com%');
        });

        it('returns false states when user does not exist', async () => {
            mockIlike.mockResolvedValueOnce({ data: [], error: null });
            const result = await checkRegistrationStatus('test@example.com');
            expect(result).toStrictEqual({ isRegistered: false, hasHushhId: false, userData: null });
        });

        it('returns true when user exists and has hushh_id', async () => {
            const userData = { id: '1', hushh_id: 'hushh123' };
            mockIlike.mockResolvedValueOnce({ data: [userData], error: null });
            const result = await checkRegistrationStatus('test@example.com');
            expect(result).toStrictEqual({ isRegistered: true, hasHushhId: true, userData });
        });

        it('returns false for registration if user exists but lacks hushh_id', async () => {
            const userData = { id: '1', hushh_id: '   ' };
            mockIlike.mockResolvedValueOnce({ data: [userData], error: null });
            const result = await checkRegistrationStatus('test@example.com');
            expect(result).toStrictEqual({ isRegistered: false, hasHushhId: false, userData });
        });

        it('handles unexpected exceptions safely', async () => {
            mockIlike.mockRejectedValueOnce(new Error('unexpected error'));
            const result = await checkRegistrationStatus('test@example.com');
            expect(result).toStrictEqual({ isRegistered: false, hasHushhId: false, userData: null });
        });
    });

    describe('mfaService', () => {
        describe('enrollMFA', () => {
            it('handles missing client initialization safely', async () => {
                const originalClient = configMock.supabaseClient;
                (configMock as any).supabaseClient = null;
                const result = await mfaService.enrollMFA();
                expect(result.data).toStrictEqual(null);
                expect(result.error).toBeInstanceOf(Error);
                configMock.supabaseClient = originalClient;
            });

            it('returns error on enroll failure', async () => {
                configMock.supabaseClient.auth.mfa.enroll.mockResolvedValueOnce({ data: null, error: { message: 'enroll error' } });
                const result = await mfaService.enrollMFA();
                expect(result).toStrictEqual({ data: null, error: { message: 'enroll error' } });
            });

            it('returns data on enroll success', async () => {
                const mockData = { id: 'factor123', totp: { qr_code: 'qr', secret: 'sec', uri: 'uri' } };
                configMock.supabaseClient.auth.mfa.enroll.mockResolvedValueOnce({ data: mockData, error: null });
                const result = await mfaService.enrollMFA();
                expect(configMock.supabaseClient.auth.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Authenticator App' });
                expect(result).toStrictEqual({ data: mockData, error: null });
            });

            it('catches and handles exceptions', async () => {
                configMock.supabaseClient.auth.mfa.enroll.mockRejectedValueOnce(new Error('exception'));
                const result = await mfaService.enrollMFA();
                expect(result).toStrictEqual({ data: null, error: new Error('exception') });
            });
        });

        describe('verifyMFAEnrollment', () => {
            it('returns error on challenge step failure', async () => {
                configMock.supabaseClient.auth.mfa.challenge.mockResolvedValueOnce({ data: null, error: { message: 'challenge fail' } });
                const result = await mfaService.verifyMFAEnrollment('factor123', '123456');
                expect(result).toStrictEqual({ data: null, error: { message: 'challenge fail' } });
            });

            it('returns error on verify step failure', async () => {
                configMock.supabaseClient.auth.mfa.challenge.mockResolvedValueOnce({ data: { id: 'chal123' }, error: null });
                configMock.supabaseClient.auth.mfa.verify.mockResolvedValueOnce({ data: null, error: { message: 'verify fail' } });
                const result = await mfaService.verifyMFAEnrollment('factor123', '123456');
                expect(result).toStrictEqual({ data: null, error: { message: 'verify fail' } });
            });

            it('returns verify data on success', async () => {
                configMock.supabaseClient.auth.mfa.challenge.mockResolvedValueOnce({ data: { id: 'chal123' }, error: null });
                configMock.supabaseClient.auth.mfa.verify.mockResolvedValueOnce({ data: { verified: true }, error: null });
                const result = await mfaService.verifyMFAEnrollment('factor123', '123456');
                expect(configMock.supabaseClient.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor123' });
                expect(configMock.supabaseClient.auth.mfa.verify).toHaveBeenCalledWith({ factorId: 'factor123', challengeId: 'chal123', code: '123456' });
                expect(result).toStrictEqual({ data: { verified: true }, error: null });
            });
            
            it('catches and handles exceptions', async () => {
                configMock.supabaseClient.auth.mfa.challenge.mockRejectedValueOnce(new Error('exception'));
                const result = await mfaService.verifyMFAEnrollment('factor1', '123');
                expect(result).toStrictEqual({ data: null, error: new Error('exception') });
            });
        });

        describe('challengeMFA', () => {
            it('handles missing client safely', async () => {
                const originalClient = configMock.supabaseClient;
                (configMock as any).supabaseClient = null;
                const result = await mfaService.challengeMFA('factor123');
                expect(result.data).toBe(null);
                expect(result.error).toBeInstanceOf(Error);
                configMock.supabaseClient = originalClient;
            });

            it('returns error on challenge fail', async () => {
                configMock.supabaseClient.auth.mfa.challenge.mockResolvedValueOnce({ data: null, error: new Error('fail') });
                const result = await mfaService.challengeMFA('factor123');
                expect(result.error).toBeInstanceOf(Error);
            });

            it('returns challenge data', async () => {
                configMock.supabaseClient.auth.mfa.challenge.mockResolvedValueOnce({ data: { id: 'chal123' }, error: null });
                const result = await mfaService.challengeMFA('factor123');
                expect(result).toStrictEqual({ data: { id: 'chal123' }, error: null });
            });
        });

        describe('verifyMFAChallenge', () => {
            it('handles missing client safely', async () => {
                const originalClient = configMock.supabaseClient;
                (configMock as any).supabaseClient = null;
                const result = await mfaService.verifyMFAChallenge('factor123', 'chal123', '123456');
                expect(result.data).toBe(null);
                expect(result.error).toBeInstanceOf(Error);
                configMock.supabaseClient = originalClient;
            });

            it('returns error on fallback', async () => {
                configMock.supabaseClient.auth.mfa.verify.mockResolvedValueOnce({ data: null, error: new Error('fail') });
                const result = await mfaService.verifyMFAChallenge('factor123', 'chal123', '123456');
                expect(result.error).toBeInstanceOf(Error);
            });

            it('returns check data', async () => {
                configMock.supabaseClient.auth.mfa.verify.mockResolvedValueOnce({ data: { success: true }, error: null });
                const result = await mfaService.verifyMFAChallenge('factor123', 'chal123', '123456');
                expect(result).toStrictEqual({ data: { success: true }, error: null });
            });
        });

        describe('unenrollMFA', () => {
            it('returns null on unenroll success', async () => {
                configMock.supabaseClient.auth.mfa.unenroll.mockResolvedValueOnce({ data: null, error: null });
                const result = await mfaService.unenrollMFA('factor123');
                expect(result).toStrictEqual({ data: null, error: null });
            });
            
            it('handles exceptions in unenroll', async () => {
                configMock.supabaseClient.auth.mfa.unenroll.mockRejectedValueOnce(new Error('err'));
                const result = await mfaService.unenrollMFA('1');
                expect(result.error).toBeInstanceOf(Error);
            });

            it('handles missing client safely', async () => {
                 const originalClient = configMock.supabaseClient;
                 (configMock as any).supabaseClient = null;
                 const result = await mfaService.unenrollMFA('factor123');
                 expect(result.data).toBe(null);
                 expect(result.error).toBeInstanceOf(Error);
                 configMock.supabaseClient = originalClient;
            });

            it('handles error from unenroll', async () => {
                configMock.supabaseClient.auth.mfa.unenroll.mockResolvedValueOnce({ data: null, error: new Error('fail') });
                const result = await mfaService.unenrollMFA('factor123');
                expect(result.error).toBeInstanceOf(Error);
            });
        });

        describe('getMFAFactors', () => {
            it('handles missing client safely', async () => {
                 const originalClient = configMock.supabaseClient;
                 (configMock as any).supabaseClient = null;
                 const result = await mfaService.getMFAFactors();
                 expect(result.data).toBe(null);
                 expect(result.error).toBeInstanceOf(Error);
                 configMock.supabaseClient = originalClient;
            });
            it('handles error from listFactors', async () => {
                configMock.supabaseClient.auth.mfa.listFactors.mockResolvedValueOnce({ data: null, error: new Error('fail') });
                const result = await mfaService.getMFAFactors();
                expect(result.error).toBeInstanceOf(Error);
            });
        });

        describe('getVerifiedMFAFactors', () => {
            it('returns empty array when error occurs fetching factors', async () => {
                configMock.supabaseClient.auth.mfa.listFactors.mockResolvedValueOnce({ data: null, error: new Error('fail') });
                const result = await mfaService.getVerifiedMFAFactors();
                expect(result.data).toStrictEqual([]);
            });

            it('filters verified statuses explicitly', async () => {
                const factors = [
                    { id: '1', status: 'unverified' },
                    { id: '2', status: 'verified' },
                    { id: '3', status: 'verified' }
                ];
                configMock.supabaseClient.auth.mfa.listFactors.mockResolvedValueOnce({ data: { all: factors }, error: null });
                const result = await mfaService.getVerifiedMFAFactors();
                expect(result).toStrictEqual({
                    data: [
                        { id: '2', status: 'verified' },
                        { id: '3', status: 'verified' }
                    ],
                    error: null
                });
            });
            
            it('returns default empty array on missing data.all safely', async () => {
                configMock.supabaseClient.auth.mfa.listFactors.mockResolvedValueOnce({ data: {}, error: null });
                const result = await mfaService.getVerifiedMFAFactors();
                expect(result.data).toStrictEqual([]);
            });
        });

        describe('getAssuranceLevel', () => {
            it('returns check data correctly', async () => {
                configMock.supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: { currentLevel: 'aal2' }, error: null });
                const result = await mfaService.getAssuranceLevel();
                expect(result).toStrictEqual({ data: { currentLevel: 'aal2' }, error: null });
            });
            
            it('handles missing client safely', async () => {
                 const originalClient = configMock.supabaseClient;
                 (configMock as any).supabaseClient = null;
                 const result = await mfaService.getAssuranceLevel();
                 expect(result.data).toBe(null);
                 expect(result.error).toBeInstanceOf(Error);
                 configMock.supabaseClient = originalClient;
            });
            it('handles error correctly', async () => {
                 configMock.supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: null, error: new Error('fail') });
                 const result = await mfaService.getAssuranceLevel();
                 expect(result.error).toBeInstanceOf(Error);
            });
        });

        describe('hasMFAEnrolled', () => {
            it('returns true when factors exist', async () => {
                configMock.supabaseClient.auth.mfa.listFactors.mockResolvedValueOnce({ data: { all: [{id: 1}] }, error: null });
                const result = await mfaService.hasMFAEnrolled();
                expect(result).toBe(true);
            });
            it('returns false when no factors exist', async () => {
                configMock.supabaseClient.auth.mfa.listFactors.mockResolvedValueOnce({ data: { all: [] }, error: null });
                const result = await mfaService.hasMFAEnrolled();
                expect(result).toBe(false);
            });
            it('returns false when error', async () => {
                configMock.supabaseClient.auth.mfa.listFactors.mockResolvedValueOnce({ data: null, error: new Error('err') });
                const result = await mfaService.hasMFAEnrolled();
                expect(result).toBe(false);
            });
        });
    });
});
