import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeArabic } from '../common/utils';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  list(q?: string, active?: string) {
    const norm = normalizeArabic(q);
    return this.prisma.agent.findMany({
      where: {
        isActive: active === undefined ? undefined : active === 'true',
        ...(q
          ? { OR: [{ nameNorm: { contains: norm } }, { code: { contains: q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  get(id: string) {
    return this.prisma.agent.findUniqueOrThrow({
      where: { id },
      include: { quotas: true, links: { include: { transporter: { select: { id: true, name: true } } } } },
    });
  }

  create(dto: CreateAgentDto) {
    return this.prisma.agent.create({ data: { ...dto, nameNorm: normalizeArabic(dto.name) } });
  }

  update(id: string, dto: UpdateAgentDto) {
    return this.prisma.agent.update({
      where: { id },
      data: { ...dto, ...(dto.name ? { nameNorm: normalizeArabic(dto.name) } : {}) },
    });
  }
}
