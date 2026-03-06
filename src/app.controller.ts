import { Controller, Get } from '@nestjs/common';

@Controller('app')
export class AppController {
  @Get('version')
  getVersion() {
    return {
      version: '1.0.7',
      downloadUrl: 'http://3.144.130.126:3001/downloads/HRMS Tracker Setup 1.0.7.exe',
      releaseNotes: 'Production build - Connected to production backend',
      mandatory: false,
    };
  }
}
