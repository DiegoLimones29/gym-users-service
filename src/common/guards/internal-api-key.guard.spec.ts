import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalApiKeyGuard } from './internal-api-key.guard';

function createContext(headers: Record<string, string | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalApiKeyGuard', () => {
  const configService = {
    get: jest.fn().mockReturnValue('super-internal-secret-key'),
  } as unknown as ConfigService;
  const guard = new InternalApiKeyGuard(configService);

  it('allows request with matching x-internal-api-key', () => {
    const ctx = createContext({
      'x-internal-api-key': 'super-internal-secret-key',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException when header is missing', () => {
    const ctx = createContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when header does not match', () => {
    const ctx = createContext({ 'x-internal-api-key': 'wrong-key' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
