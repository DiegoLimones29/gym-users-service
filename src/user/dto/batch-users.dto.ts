import { IsArray, IsString } from 'class-validator';

export class BatchUsersDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}
