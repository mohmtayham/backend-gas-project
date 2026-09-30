import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeArabic } from '../common/utils';
import { CreateTransporterDto, UpdateTransporterDto } from './dto/transporter.dto';

@Injectable()
export class TransportersService {
  constructor(private prisma: PrismaService) {}

  list(q?: string, active?: string) {
    return this.prisma.transporter.findMany({
      where: {
        isActive: active === undefined ? undefined : active === 'true',
        ...(q ? { nameNorm: { contains: normalizeArabic(q) } } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  get(id: string) {
    return this.prisma.transporter.findUniqueOrThrow({
      where: { id },
      include: { vehicles: true, links: { include: { agent: { select: { id: true, code: true, name: true } } } } },
    });
  }

  create(dto: CreateTransporterDto) {
    return this.prisma.transporter.create({ data: { ...dto, nameNorm: normalizeArabic(dto.name) } });
  }

  update(id: string, dto: UpdateTransporterDto) {
    return this.prisma.transporter.update({
      where: { id },
      data: { ...dto, ...(dto.name ? { nameNorm: normalizeArabic(dto.name) } : {}) },
    });
  }
}
