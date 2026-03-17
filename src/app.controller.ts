import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import * as path from 'path';

@Controller('app')
export class AppController {
  @Get('version')
  getVersion() {
    return {
      version: '1.0.0',
      downloadUrl: 'http://3.144.130.126/downloads/desktop-app',
      releaseNotes: 'Production build - Connected to production backend',
      mandatory: false,
    };
  }

  @Get('downloads/desktop-app')
  downloadDesktopApp(@Res() res: Response) {
    const filePath = '/home/ec2-user/backend/public/downloads/HRMS-Desktop-App-Setup.exe';
    res.download(filePath, 'HRMS-Desktop-App-Setup.exe');
  }
}
