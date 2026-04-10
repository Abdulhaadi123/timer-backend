import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class UsersService {
  private s3Client: S3Client;

  constructor(private prisma: PrismaService) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async getUsers(orgId: string) {
    const users = await this.prisma.user.findMany({
      where: { orgId },
      include: {
        user_organization_roles: true,
        tracker_profiles: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map(user => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.user_organization_roles[0]?.role || 'EMPLOYEE',
      isActive: user.isActive,
      screenshotEnabled: user.tracker_profiles?.screenshot_enabled ?? true,
      createdAt: user.createdAt,
    }));
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        organization: true,
        user_organization_roles: true,
        tracker_profiles: true,
      },
    });

    if (!user) return null;

    return {
      ...user,
      role: user.user_organization_roles[0]?.role || 'EMPLOYEE',
      screenshotEnabled: user.tracker_profiles?.screenshot_enabled ?? true,
    };
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee_profiles_employee_profiles_user_idTousers: true,
      },
    });

    if (!user) return null;

    const avatarPath = user.employee_profiles_employee_profiles_user_idTousers?.avatar_path;
    let avatarUrl = null;
    
    if (avatarPath) {
      // If already full URL with signature, use as is
      if (avatarPath.startsWith('http://') || avatarPath.startsWith('https://')) {
        avatarUrl = avatarPath;
      } else {
        // Generate presigned URL for private S3 bucket
        try {
          const bucket = process.env.AWS_S3_BUCKET_PICTURES || 'hrms-pictures';
          const command = new GetObjectCommand({
            Bucket: bucket,
            Key: avatarPath,
          });
          // URL valid for 24 hours
          avatarUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 86400 });
        } catch (error) {
          console.error('Failed to generate presigned URL:', error);
          avatarUrl = null;
        }
      }
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl,
    };
  }

  async createUser(data: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    orgId: string;
  }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        id: uuidv4(),
        email: data.email,
        passwordHash,
        fullName: data.fullName,
        isActive: true,
        email_verified: false,
        organization: {
          connect: { id: data.orgId },
        },
      },
    });

    await this.prisma.user_organization_roles.create({
      data: {
        user_id: user.id,
        organization_id: data.orgId,
        role: data.role as any,
      },
    });

    await this.prisma.tracker_profiles.create({
      data: {
        user_id: user.id,
        screenshot_enabled: true,
      },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: data.role,
      createdAt: user.createdAt,
    };
  }

  async updateUser(id: string, data: any) {
    const updates: any = {};
    
    if (data.email) updates.email = data.email;
    if (data.fullName) updates.fullName = data.fullName;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    const user = await this.prisma.user.update({
      where: { id },
      data: updates,
      include: {
        user_organization_roles: true,
        tracker_profiles: true,
      },
    });

    if (data.role) {
      await this.prisma.user_organization_roles.updateMany({
        where: { user_id: id },
        data: { role: data.role },
      });
    }

    if (data.screenshotEnabled !== undefined) {
      await this.prisma.tracker_profiles.updateMany({
        where: { user_id: id },
        data: { screenshot_enabled: data.screenshotEnabled },
      });
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.user_organization_roles[0]?.role || 'EMPLOYEE',
      isActive: user.isActive,
      screenshotEnabled: user.tracker_profiles?.screenshot_enabled ?? true,
    };
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({
      where: { id },
    });
  }
}
