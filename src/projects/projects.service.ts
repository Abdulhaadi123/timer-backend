import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async getUserProjects(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });

    return this.prisma.project.findMany({
      where: {
        organization_id: user.orgId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        color: true,
        description: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getProject(id: string) {
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        team: true,
        createdBy: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });
  }
}
