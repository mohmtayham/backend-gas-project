import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateTransporterDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() phone?: string;
}

export class UpdateTransporterDto extends PartialType(CreateTransporterDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
