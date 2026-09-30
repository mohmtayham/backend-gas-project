import { IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Lane } from '@prisma/client';

export class CreateDayDto {
  @IsDateString() opDate: string; // 'YYYY-MM-DD'
  @IsEnum(Lane) lane: Lane;
}

export class OpenBookingDto {
  @IsOptional() @IsInt() @Min(1) minutes?: number; // default: setting booking_window_minutes
  @IsOptional() @IsDateString() closesAt?: string;
  @IsOptional() @IsString() actor?: string;
}

export class ExtendBookingDto {
  @IsInt() @Min(1) minutes: number;
  @IsOptional() @IsString() actor?: string;
}

export class ReopenDto {
  @IsString() @IsNotEmpty() reason: string;
  @IsOptional() @IsInt() @Min(1) minutes?: number;
  @IsOptional() @IsString() actor?: string;
}

export class PauseDto {
  @IsString() @IsNotEmpty() reason: string;
  @IsOptional() @IsString() actor?: string;
}

export class CloseDayDto {
  @IsOptional() @IsBoolean() force?: boolean; // resolve CALLED/LOADING tickets by carrying them (reason required)
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() actor?: string;
}
