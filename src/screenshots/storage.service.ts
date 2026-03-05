import { Injectable } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

@Injectable()
export class StorageService {
  private s3Client: S3Client;
  private bucketName: string;
  private useS3: boolean;

  constructor() {
    this.useS3 = process.env.USE_S3 === 'true';
    
    if (this.useS3) {
      this.s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-2',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });
      this.bucketName = process.env.AWS_S3_BUCKET || 'cvbuckets3.11';
      console.log('📦 S3 Storage enabled - Bucket:', this.bucketName);
    } else {
      console.log('💾 Local storage enabled');
    }
  }

  async saveScreenshot(
    userId: string,
    base64Data: string,
    timestamp: Date,
  ): Promise<{ filePath: string; fileSize: number }> {
    const matches = base64Data.match(/^data:image\/jpeg;base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image data');
    }

    const buffer = Buffer.from(matches[1], 'base64');
    
    const compressedBuffer = await sharp(buffer)
      .jpeg({ quality: 70, progressive: true })
      .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    
    console.log(`🗜️ Compressed: ${buffer.length} → ${compressedBuffer.length} bytes (${Math.round((1 - compressedBuffer.length / buffer.length) * 100)}% reduction)`);

    const date = timestamp.toISOString().split('T')[0];
    const filename = `screenshot-${timestamp.getTime()}.jpg`;

    if (this.useS3) {
      const key = `screenshots/${userId}/${date}/${filename}`;
      
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: compressedBuffer,
          ContentType: 'image/jpeg',
        },
      });

      await upload.done();
      
      const s3Url = `https://${this.bucketName}.s3.amazonaws.com/${key}`;
      
      return {
        filePath: s3Url,
        fileSize: compressedBuffer.length,
      };
    } else {
      const path = require('path');
      const fs = require('fs').promises;
      const baseDir = process.cwd() || __dirname;
      const uploadDir = path.join(baseDir, 'public', 'screenshots');
      const userDir = path.join(uploadDir, userId, date);
      await fs.mkdir(userDir, { recursive: true });
      const filePath = path.join(userDir, filename);
      await fs.writeFile(filePath, compressedBuffer);
      const relativePath = path.join('screenshots', userId, date, filename).replace(/\\/g, '/');
      
      return {
        filePath: relativePath,
        fileSize: compressedBuffer.length,
      };
    }
  }

  async deleteScreenshot(filePath: string): Promise<void> {
    if (this.useS3 && filePath.includes('s3.amazonaws.com')) {
      const key = filePath.split('.com/')[1];
      
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
    } else {
      const path = require('path');
      const fs = require('fs').promises;
      const fullPath = path.join(process.cwd(), 'public', filePath);
      try {
        await fs.unlink(fullPath);
      } catch (error) {
        console.error('Failed to delete screenshot:', error);
      }
    }
  }

  getFileUrl(filePath: string): string {
    if (this.useS3 && filePath.includes('s3.amazonaws.com')) {
      return filePath;
    }
    return `/${filePath}`;
  }
}
