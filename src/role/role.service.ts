import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
  ) {}

  async create(createRoleDto: CreateRoleDto) {
    const role = this.roleRepo.create(createRoleDto);
    return await this.roleRepo.save(role);
  }

  async findAll() {
    const roles = await this.roleRepo.find();
    return {
      message: 'roles',
      data: roles,
    };
  }

  async findOne(id: number) {
    const role = await this.roleRepo.findOneBy({ id });

    if (!role) {
      throw new NotFoundException(`Rol #${id} no encontrado`);
    }

    return {
      message: 'Rol encontrado',
      data: role,
    };
  }

  async update(id: number, updateRoleDto: UpdateRoleDto) {
    const role = await this.roleRepo.preload({ id, ...updateRoleDto });
    if (!role) {
      throw new NotFoundException(`Rol #${id} no encontrado`);
    }
    const saved = await this.roleRepo.save(role);
    return {
      message: 'Rol actualizado',
      data: saved,
    };
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.roleRepo.delete(id);

    return {
      message: `Rol #${id} eliminado correctamente`,
    };
  }
}
