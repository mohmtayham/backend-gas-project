import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Lane } from '@prisma/client';

export class CreateBayDto {
  @IsEnum(Lane) lane: Lane;
  @IsString() @IsNotEmpty() name: string;
}

export class UpdateBayDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
