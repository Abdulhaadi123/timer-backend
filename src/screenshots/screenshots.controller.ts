import { Controller, Post, Get, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ScreenshotsService } from './screenshots.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, UserRole } from '../auth/decorators/roles.decorator';
import { UploadScreenshotDto } from './dto/upload-screenshot.dto';

@Controller('screenshots')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScreenshotsController {
  constructor(private screenshotsService: ScreenshotsService) {}

  @Post('upload')
  async uploadScreenshot(@Request() req, @Body() dto: UploadScreenshotDto) {
    return this.screenshotsService.uploadScreenshot(req.user.id, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async getScreenshots(
    @Query('userId') userId: string,
    @Query('date') date?: string,
  ) {
    return this.screenshotsService.getScreenshots(userId, date);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async deleteScreenshot(@Param('id') id: string, @Request() req) {
    return this.screenshotsService.deleteScreenshot(
      parseInt(id),
      req.user.id,
    );
  }
}
