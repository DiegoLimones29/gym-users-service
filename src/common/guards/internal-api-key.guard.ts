import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const rawHeader = request.headers['x-internal-api-key'];
    const providedKey = (
      Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
    )?.trim();
    const expectedKey = this.configService
      .get<string>('INTERNAL_API_KEY')
      ?.trim();

    if (!expectedKey || !providedKey) {
      throw new UnauthorizedException('Clave interna inválida');
    }

    const providedBuf = Buffer.from(providedKey, 'utf8');
    const expectedBuf = Buffer.from(expectedKey, 'utf8');

    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new UnauthorizedException('Clave interna inválida');
    }

    return true;
  }
}
