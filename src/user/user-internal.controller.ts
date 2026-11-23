import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { BatchUsersDto } from './dto/batch-users.dto';
import { UserService } from './user.service';

@UseGuards(InternalApiKeyGuard)
@Controller('internal/users')
export class UserInternalController {
  constructor(private readonly userService: UserService) {}

  @HttpCode(HttpStatus.OK)
  @Post('batch')
  async findByIds(@Body() dto: BatchUsersDto) {
    const users = await this.userService.findByIds(dto.ids);
    return { data: users };
  }

  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }
}
