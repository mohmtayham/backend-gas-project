import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Lane } from '@prisma/client';

export class CreateVehicleDto {
  @IsString() @IsNotEmpty() transporterId: string;
  @IsString() @IsNotEmpty() plateNo: string;
  @IsInt() @Min(1) capacityQty: number;
  @IsArray() @ArrayNotEmpty() @IsEnum(Lane, { each: true }) fillTypes: Lane[];
}

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
