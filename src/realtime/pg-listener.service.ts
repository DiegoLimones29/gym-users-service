import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { getPgClientConfig } from '../database/db-config';

const WATCHED_TABLES = ['users', 'roles'] as const;
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface PgDbChangePayload {
  table: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  timestamp: number;
  source?: string;
}

@Injectable()
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgListenerService.name);
  private pgClient: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private shuttingDown = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureTriggers();
    } catch (error) {
      this.logger.warn(
        `No se pudieron instalar triggers LISTEN/NOTIFY al iniciar: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.connectListener();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.closeClient();
  }

  private getSchema(): string {
    const raw = this.configService.get<string>('DB_SCHEMA')?.trim() || 'public';
    return SAFE_IDENTIFIER.test(raw) ? raw : 'public';
  }

  private async ensureTriggers(): Promise<void> {
    if (!this.dataSource.isInitialized) return;
    const schema = this.getSchema();

    await this.dataSource.query(`
      CREATE OR REPLACE FUNCTION "${schema}".notify_db_change() RETURNS trigger AS $$
      DECLARE
        record_id text;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          record_id := COALESCE(to_jsonb(OLD)->>'id', '');
        ELSE
          record_id := COALESCE(to_jsonb(NEW)->>'id', '');
        END IF;

        PERFORM pg_notify(
          'db_changes',
          json_build_object(
            'table', TG_TABLE_NAME,
            'action', TG_OP,
            'id', record_id,
            'timestamp', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          )::text
        );
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

    for (const table of WATCHED_TABLES) {
      await this.dataSource.query(`
        DO $$
        BEGIN
          IF to_regclass('${schema}.${table}') IS NOT NULL THEN
            DROP TRIGGER IF EXISTS trg_notify_db_change ON "${schema}"."${table}";
            CREATE TRIGGER trg_notify_db_change
              AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${table}"
              FOR EACH ROW EXECUTE FUNCTION "${schema}".notify_db_change();
          END IF;
        END $$;
      `);
    }

    this.logger.log(
      `Triggers LISTEN/NOTIFY verificados en schema "${schema}" para: ${WATCHED_TABLES.join(', ')}`,
    );
  }

  private async connectListener(): Promise<void> {
    if (this.shuttingDown) return;

    await this.closeClient();

    const client = new Client(getPgClientConfig(this.configService));
    this.pgClient = client;

    client.on('error', (err) => {
      if (this.shuttingDown) return;
      this.logger.warn(`Error en listener PostgreSQL: ${err.message}`);
      this.scheduleReconnect();
    });

    client.on('end', () => {
      if (this.shuttingDown) return;
      this.logger.warn('Conexión de listener PostgreSQL cerrada');
      this.scheduleReconnect();
    });

    client.on('notification', (msg) => {
      if (msg.channel !== 'db_changes' || !msg.payload) return;
      void this.handleNotification(msg.payload);
    });

    try {
      await client.connect();
      await client.query('LISTEN db_changes');
      this.reconnectAttempt = 0;
      this.logger.log('Escuchando canal PostgreSQL "db_changes"');
    } catch (error) {
      this.logger.warn(
        `No se pudo conectar listener PostgreSQL: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.closeClient();
      this.scheduleReconnect();
    }
  }

  private async closeClient(): Promise<void> {
    if (!this.pgClient) return;
    const client = this.pgClient;
    this.pgClient = null;
    client.removeAllListeners();
    client.on('error', () => {});
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) return;
    const delayMs = Math.min(1000 * 2 ** this.reconnectAttempt, 30000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectListener();
    }, delayMs);
  }

  private async handleNotification(rawPayload: string): Promise<void> {
    let parsed: PgDbChangePayload;
    try {
      parsed = JSON.parse(rawPayload) as PgDbChangePayload;
    } catch {
      this.logger.warn(`Payload NOTIFY inválido: ${rawPayload}`);
      return;
    }

    const webhookUrl =
      this.configService.get<string>('GATEWAY_WEBHOOK_URL')?.trim() ||
      'http://localhost:3000/internal/realtime/db-change';
    const internalApiKey =
      this.configService.get<string>('INTERNAL_API_KEY')?.trim() || '';

    if (!internalApiKey) {
      this.logger.warn(
        'INTERNAL_API_KEY no configurada; omitiendo webhook de cambios en vivo',
      );
      return;
    }

    const rawTimeout = Number(
      this.configService.get<string>('GATEWAY_WEBHOOK_TIMEOUT_MS'),
    );
    const timeoutMs =
      Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 10000;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': internalApiKey,
        },
        body: JSON.stringify({
          ...parsed,
          source: 'users-service',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        this.logger.warn(
          `Webhook realtime devolvió HTTP ${response.status} para ${parsed.table}:${parsed.action}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo notificar cambio al gateway (${parsed.table}:${parsed.action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
