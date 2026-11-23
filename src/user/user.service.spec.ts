import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../role/entities/role.entity';
import { User } from './entities/user.entity';
import { UserService } from './user.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('UserService', () => {
  let service: UserService;
  const userRepo = {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    preload: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const roleRepo = {
    findOneBy: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('creates a user with hashed password and omits password in response', async () => {
    userRepo.findOneBy.mockResolvedValue(null);
    roleRepo.findOneBy.mockResolvedValue({ id: 1, role: 'member' });
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-secret');
    userRepo.create.mockImplementation((dto) => dto);
    userRepo.save.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'juan@example.com',
      password: 'hashed-secret',
      firstName: 'Juan',
      lastName: 'Pérez',
      roleId: 1,
    });

    const result = await service.create(
      {
        email: 'juan@example.com',
        password: 'plain-password',
        firstName: 'Juan',
        lastName: 'Pérez',
        roleId: 1,
      },
      false,
    );

    expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
    expect(result.data).not.toHaveProperty('password');
    expect(result.data.email).toBe('juan@example.com');
  });

  it('throws ConflictException when email already exists', async () => {
    userRepo.findOneBy.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create({
        email: 'dup@example.com',
        password: 'secret',
        firstName: 'Ana',
        lastName: 'López',
        roleId: 1,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws ForbiddenException when non-admin tries to create non-member user', async () => {
    userRepo.findOneBy.mockResolvedValue(null);
    roleRepo.findOneBy.mockResolvedValue({ id: 2, role: 'worker' });

    await expect(
      service.create(
        {
          email: 'worker@example.com',
          password: 'secret',
          firstName: 'Luis',
          lastName: 'Ruiz',
          roleId: 2,
        },
        false,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('filters invalid UUIDs and deduplicates in findByIds', async () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    userRepo.find.mockResolvedValue([{ id: validUuid, firstName: 'Juan' }]);

    const emptyResult = await service.findByIds(['not-a-uuid', '']);
    expect(emptyResult).toEqual([]);
    expect(userRepo.find).not.toHaveBeenCalled();

    const found = await service.findByIds([
      validUuid,
      ` ${validUuid} `,
      'invalid-id',
    ]);
    expect(userRepo.find).toHaveBeenCalledTimes(1);
    expect(found).toHaveLength(1);
  });

  it('removes an existing user and throws NotFoundException when missing', async () => {
    userRepo.findOneBy.mockResolvedValueOnce(null);
    await expect(service.remove('missing-id')).rejects.toThrow(
      NotFoundException,
    );

    const existing = { id: '11111111-1111-4111-8111-111111111111' };
    userRepo.findOneBy.mockResolvedValueOnce(existing);
    userRepo.remove.mockResolvedValueOnce(existing);

    const res = await service.remove(existing.id);
    expect(userRepo.remove).toHaveBeenCalledWith(existing);
    expect(res).toEqual({ message: 'Usuario eliminado' });
  });
});
