import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async create(createUserDto: CreateUserDto, isAdmin = true) {
    const existingUser = await this.userRepository.findOneBy({
      email: createUserDto.email,
    });
    if (existingUser) {
      throw new ConflictException('Este correo electrónico ya está registrado');
    }

    const targetRole = await this.roleRepository.findOneBy({
      id: createUserDto.roleId,
    });
    if (!targetRole) {
      throw new NotFoundException(`El rol #${createUserDto.roleId} no existe`);
    }

    if (!isAdmin && targetRole.role.toLowerCase() !== 'member') {
      throw new ForbiddenException(
        'Solo un administrador puede registrar trabajadores o administradores.',
      );
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const newUser = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
    });

    const savedUser = await this.userRepository.save(newUser);
    const { password: _password, ...userWithoutPassword } = savedUser;

    return {
      message: 'Usuario creado correctamente',
      data: userWithoutPassword,
    };
  }

  async findAll() {
    const users = await this.userRepository.find({
      relations: { role: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        roleId: true,
      },
    });
    return { data: users };
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { role: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        roleId: true,
      },
    });
    if (!user) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }
    return { data: user };
  }

  async findByIds(ids: string[]) {
    const uniqueIds = Array.from(
      new Set(
        (ids ?? [])
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => UUID_REGEX.test(id)),
      ),
    );

    if (uniqueIds.length === 0) {
      return [];
    }

    return this.userRepository.find({
      where: { id: In(uniqueIds) },
      relations: { role: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        roleId: true,
      },
    });
  }

  async findByEmailForAuth(email: string) {
    return this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const payload = { ...updateUserDto };

    if (payload.roleId !== undefined) {
      const targetRole = await this.roleRepository.findOneBy({
        id: payload.roleId,
      });
      if (!targetRole) {
        throw new NotFoundException(`El rol #${payload.roleId} no existe`);
      }
    }

    if (payload.password) {
      payload.password = await bcrypt.hash(payload.password, 10);
    }

    const user = await this.userRepository.preload({ id, ...payload });
    if (!user) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }

    try {
      const saved = await this.userRepository.save(user);
      const { password: _password, ...userWithoutPassword } = saved;
      return { message: 'Usuario actualizado', data: userWithoutPassword };
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException('Este correo electrónico ya está registrado');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`Usuario ${id} no encontrado`);
    }
    await this.userRepository.remove(user);
    return { message: 'Usuario eliminado' };
  }
}
