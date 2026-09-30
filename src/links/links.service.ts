import { Injectable } from '@nestjs/common';
import { LinkStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLinkDto, UpdateLinkDto } from './dto/link.dto';

const INCLUDE = {
  agent: { select: { id: true, code: true, name: true } },
  transporter: { select: { id: true, name: true } },
} as const;

@Injectable()
export class LinksService {
  constructor(private prisma: PrismaService) {}

  list(q: { agentId?: string; transporterId?: string; status?: LinkStatus }) {
    return this.prisma.agentTransporterLink.findMany({ where: q, include: INCLUDE, orderBy: { id: 'desc' } });
  }

  create(dto: CreateLinkDto) {
    const staff = dto.requestedBy === 'STAFF';
    return this.prisma.agentTransporterLink.create({
      data: {
        ...dto,
        status: staff ? 'APPROVED' : 'PENDING',
        decidedAt: staff ? new Date() : null,
      },
      include: INCLUDE,
    });
  }

  update(id: number, dto: UpdateLinkDto) {
    return this.prisma.agentTransporterLink.update({
      where: { id },
      data: { status: dto.status, decidedAt: new Date() },
      include: INCLUDE,
    });
  }
}
