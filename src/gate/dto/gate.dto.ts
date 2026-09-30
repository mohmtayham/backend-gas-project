import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Lane } from '@prisma/client';

export class CallNextDto {
  @IsOptional() @IsEnum(Lane) lane?: Lane; // used when dayId is not given (today's day of this lane)
  @IsOptional() @IsInt() dayId?: number;
  @IsOptional() @IsInt() bayId?: number; // omitted => first free bay of the lane
  @IsOptional() @IsString() actor?: string;
}

export class LoadedLineDto {
  @IsInt() lineId: number;
  @IsInt() @Min(0) qtyLoaded: number;
}

export class LoadedDto {
  /** Omitted => every line loaded exactly as booked. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LoadedLineDto)
  lines?: LoadedLineDto[];
  @IsOptional() @IsString() actor?: string;
}

export class GateActionDto {
  @IsOptional() @IsString() actor?: string;
  @IsOptional() @IsString() reason?: string;
}
