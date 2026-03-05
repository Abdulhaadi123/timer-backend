import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { UploadScreenshotDto } from './dto/upload-screenshot.dto';

@Injectable()
export class ScreenshotsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async uploadScreenshot(userId: string, dto: UploadScreenshotDto) {
    const { filePath, fileSize } = await this.storage.saveScreenshot(
      userId,
      dto.fileUrl,
      new Date(dto.capturedAt),
    );

    const screenshot = await this.prisma.screenshot.create({
      data: {
        userId,
        fileUrl: this.storage.getFileUrl(filePath),
        capturedAt: new Date(dto.capturedAt),
        fileSize,
      },
    });

    return {
      ...screenshot,
      id: screenshot.id.toString(),
    };
  }

  async getScreenshots(userId: string, date?: string) {
    const where: any = { userId };

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      where.capturedAt = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    const screenshots = await this.prisma.screenshot.findMany({
      where,
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });

    return screenshots.map(s => ({
      ...s,
      id: s.id.toString(),
    }));
  }

  async deleteScreenshot(id: number, userId: string) {
    const screenshot = await this.prisma.screenshot.findFirst({
      where: { id: BigInt(id), userId },
    });

    if (screenshot) {
      await this.storage.deleteScreenshot(screenshot.fileUrl);
    }

    return this.prisma.screenshot.deleteMany({
      where: { id: BigInt(id), userId },
    });
  }
}
