import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { ClientConfig } from 'pg';

export function getTypeOrmOptions(
  configService: ConfigService,
): TypeOrmModuleOptions {
  const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();
  const sslEnabled = configService.get<string>('DB_SSL') === 'true';
  const synchronize = configService.get<string>('DB_SYNCHRONIZE') !== 'false';
  const schema = configService.get<string>('DB_SCHEMA')?.trim() || 'public';

  const baseOptions: TypeOrmModuleOptions = {
    type: 'postgres',
    schema,
    autoLoadEntities: true,
    synchronize,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  };

  if (databaseUrl) {
    return {
      ...baseOptions,
      url: databaseUrl,
    };
  }

  return {
    ...baseOptions,
    host: configService.get<string>('DB_HOST') || 'localhost',
    port: Number(configService.get<string>('DB_PORT') || 5432),
    username: configService.get<string>('DB_USERNAME'),
    password: configService.get<string>('DB_PASSWORD') || undefined,
    database: configService.get<string>('DB_NAME'),
  };
}

export function getPgClientConfig(configService: ConfigService): ClientConfig {
  const realtimeUrl = configService
    .get<string>('REALTIME_DATABASE_URL')
    ?.trim();
  const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();
  const connectionString = realtimeUrl || databaseUrl;
  const sslEnabled = configService.get<string>('DB_SSL') === 'true';

  if (connectionString) {
    return {
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      keepAlive: true,
    };
  }

  return {
    host: configService.get<string>('DB_HOST') || 'localhost',
    port: Number(configService.get<string>('DB_PORT') || 5432),
    user: configService.get<string>('DB_USERNAME'),
    password: configService.get<string>('DB_PASSWORD') || undefined,
    database: configService.get<string>('DB_NAME'),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    keepAlive: true,
  };
}
