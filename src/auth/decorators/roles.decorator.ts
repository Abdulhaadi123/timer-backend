import { SetMetadata } from '@nestjs/common';

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  MEMBER = 'MEMBER',
}

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);
