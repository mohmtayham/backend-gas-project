import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ActorRole, LinkStatus } from '@prisma/client';

export class CreateLinkDto {
  @IsString() @IsNotEmpty() agentId: string;
  @IsString() @IsNotEmpty() transporterId: string;
  @IsEnum(ActorRole) requestedBy: ActorRole; // STAFF => approved immediately
}

export class UpdateLinkDto {
  @IsEnum(LinkStatus) status: LinkStatus;
}
