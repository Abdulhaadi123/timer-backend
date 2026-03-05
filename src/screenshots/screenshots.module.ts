import { Module } from '@nestjs/common';
import { ScreenshotsService } from './screenshots.service';
import { ScreenshotsController } from './screenshots.controller';
import { StorageService } from './storage.service';

@Module({
  controllers: [ScreenshotsController],
  providers: [ScreenshotsService, StorageService],
  exports: [ScreenshotsService],
})
export class ScreenshotsModule {}
