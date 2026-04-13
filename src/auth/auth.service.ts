import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { 
        organization: true,
        user_organization_roles: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);

    let orgId = user.orgId;
    if (!orgId && user.user_organization_roles?.length > 0) {
      orgId = user.user_organization_roles[0].organization_id;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { orgId },
      });
    }

    const payload = { sub: user.id, email: user.email, orgId };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    return {
      accessToken,
      refreshToken,
    };
  }

  async refreshTokens(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      const newPayload = { sub: payload.sub, email: payload.email, orgId: payload.orgId };
      
      const accessToken = this.jwtService.sign(newPayload);
      const refreshToken = this.jwtService.sign(newPayload, { expiresIn: '7d' });

      return {
        accessToken,
        refreshToken,
      };
    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
        user_organization_roles: true,
        tracker_profiles: true,
        createdProjects: {
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, color: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const role = user.user_organization_roles[0]?.role || 'EMPLOYEE';
    const screenshotEnabled = user.tracker_profiles?.screenshot_enabled ?? true;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: role,
      screenshotEnabled: screenshotEnabled,
      customCheckinStart: user.tracker_profiles?.custom_schedule_start?.toString(),
      customCheckinEnd: user.tracker_profiles?.custom_schedule_end?.toString(),
      projects: user.createdProjects,
    };
  }
}
