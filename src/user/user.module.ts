import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserInternalController } from './user-internal.controller';
import { AuthModule } from '../auth/auth.module';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role]),
    forwardRef(() => AuthModule),
  ],
  controllers: [UserController, UserInternalController],
  providers: [UserService, InternalApiKeyGuard],
  exports: [UserService],
})
export class UserModule {}
