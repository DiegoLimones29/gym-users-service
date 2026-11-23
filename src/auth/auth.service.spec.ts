import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  const userService = {
    findByEmailForAuth: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('normalizes roleId 7 to admin and signs JWT', async () => {
    userService.findByEmailForAuth.mockResolvedValue({
      id: 'u-1',
      email: 'admin@gym.com',
      password: 'hash',
      firstName: 'Admin',
      lastName: 'User',
      roleId: 7,
      role: { id: 7, role: 'superadmin' },
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue('signed-jwt');

    const res = await service.login({
      email: 'admin@gym.com',
      password: 'secret',
    });

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 'u-1',
      email: 'admin@gym.com',
      roleId: 7,
      role: 'admin',
    });
    expect(res.access_token).toBe('signed-jwt');
    expect(res.user.role).toBe('admin');
  });

  it('normalizes trainer role to worker', async () => {
    userService.findByEmailForAuth.mockResolvedValue({
      id: 'u-2',
      email: 'coach@gym.com',
      password: 'hash',
      firstName: 'Coach',
      lastName: 'One',
      roleId: 3,
      role: { id: 3, role: 'Trainer' },
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue('signed-jwt-2');

    const res = await service.login({
      email: 'coach@gym.com',
      password: 'secret',
    });

    expect(res.user.role).toBe('worker');
  });

  it('throws UnauthorizedException on invalid password', async () => {
    userService.findByEmailForAuth.mockResolvedValue({
      id: 'u-1',
      email: 'admin@gym.com',
      password: 'hash',
      roleId: 7,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.login({ email: 'admin@gym.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
