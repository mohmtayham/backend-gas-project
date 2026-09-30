import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateAgentDto {
  @IsString() @IsNotEmpty() code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() licenceNo?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateAgentDto extends PartialType(CreateAgentDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
