import { IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Lane, QuotaPeriod } from '@prisma/client';

export class CreateQuotaDto {
  @IsString() @IsNotEmpty() agentId: string;
  @IsEnum(Lane) fillType: Lane;
  @IsEnum(QuotaPeriod) period: QuotaPeriod;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @IsInt() @Min(0) quotaQty: number;
}

export class UpdateQuotaDto {
  @IsInt() @Min(0) quotaQty: number;
  @IsOptional() @IsString() reason?: string;
}
