import { Module } from '@nestjs/common';
import { PgListenerService } from './pg-listener.service';

@Module({
  providers: [PgListenerService],
  exports: [PgListenerService],
})
export class RealtimeModule {}
