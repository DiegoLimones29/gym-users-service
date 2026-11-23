import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.userService.findByEmailForAuth(loginDto.email);

    if (!user || !(await bcrypt.compare(loginDto.password, user.password))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const dbRole = (user.role?.role ?? '').toLowerCase();
    const roleName =
      user.roleId === 7
        ? 'admin'
        : dbRole === 'trainer'
          ? 'worker'
          : dbRole || 'worker';

    const payload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
      role: roleName,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        roleId: user.roleId,
        role: roleName,
      },
    };
  }
}
