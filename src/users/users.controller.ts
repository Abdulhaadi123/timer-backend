import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me/profile')
  async getMyProfile(@Request() req) {
    const userId = req.user.userId
    const profile = await this.usersService.getUserProfile(userId)
    return profile
  }

  @Get()
  async getUsers(@Request() req) {
    return this.usersService.getUsers(req.user.orgId);
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.usersService.getUser(id);
  }

  @Post()
  async createUser(@Request() req, @Body() body: any) {
    return this.usersService.createUser({
      ...body,
      orgId: req.user.orgId,
    });
  }

  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() body: any) {
    return this.usersService.updateUser(id, body);
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }
}
