import { Controller, Get } from '@nestjs/common';

@Controller('app')
export class AppController {
  @Get('version')
  getVersion() {
    return {
      version: '1.0.6',
      downloadUrl: 'https://dexterzbackend.online/downloads/Time Tracker Setup 1.0.6.exe',
      releaseNotes: 'Production build with optimized performance',
      mandatory: false,
    };
  }
}
