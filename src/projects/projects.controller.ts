import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  async getUserProjects(@Request() req) {
    return this.projectsService.getUserProjects(req.user.id);
  }

  @Get(':id')
  async getProject(@Param('id') id: string) {
    return this.projectsService.getProject(id);
  }
}
