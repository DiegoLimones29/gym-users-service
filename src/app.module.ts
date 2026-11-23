import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { getTypeOrmOptions } from './database/db-config';
import { RealtimeModule } from './realtime/realtime.module';
import { RoleModule } from './role/role.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getTypeOrmOptions(configService),
    }),
    RoleModule,
    UserModule,
    AuthModule,
    RealtimeModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
