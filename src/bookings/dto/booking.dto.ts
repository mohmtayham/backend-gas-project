import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested,
} from 'class-validator';
import { ActorRole, Lane, Source } from '@prisma/client';

export class BookingLineDto {
  @IsString() @IsNotEmpty() agentId: string;
  @IsInt() @Min(1) qty: number;
}

export class CreateBookingDto {
  @IsEnum(Lane) lane: Lane;
  @IsString() @IsNotEmpty() transporterId: string;
  @IsString() @IsNotEmpty() vehicleId: string;

  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => BookingLineDto)
  lines: BookingLineDto[];

  /** No login: the client says who is booking. AGENT => actorId = agentId, TRANSPORTER => actorId = transporterId. */
  @IsOptional() @IsEnum(ActorRole) bookedByRole?: ActorRole; // default STAFF
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsEnum(Source) source?: Source;
  @IsOptional() @IsDateString() messageAt?: string; // original WhatsApp message time (staff entry)
  @IsOptional() @IsString() note?: string;
}

export class UpdateBookingDto {
  @IsOptional() @IsEnum(ActorRole) actorRole?: ActorRole; // default STAFF
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => BookingLineDto)
  lines?: BookingLineDto[];
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() reason?: string; // required for staff edits after the window closed
}

export class CancelBookingDto {
  @IsOptional() @IsEnum(ActorRole) actorRole?: ActorRole; // default STAFF
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() reason?: string; // required for staff
}
