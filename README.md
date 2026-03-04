# HRMS Backend API - Complete Edition

NestJS backend for HRMS Time Tracker with all essential features.

## ✅ Features

### **Authentication**
- JWT-based auth
- Login/Logout
- Password hashing with bcrypt
- 7-day token expiry

### **Activity Tracking**
- Session management
- Batch sample upload
- Automatic rollup processing
- Idle threshold detection (5 min)
- Working hours validation
- Break time handling
- Project time tracking

### **Rollup Algorithm**
- Groups samples by minute
- Applies idle threshold
- Creates ACTIVE/IDLE/BREAK entries
- Merges contiguous entries
- Handles overlaps professionally

### **Organizations**
- Organization info
- Schedule management
- Custom user times
- Timezone support

### **Projects**
- List user projects
- Project details
- Color-coded projects

### **Users**
- List users
- Create users
- Update users
- Delete users
- User management

### **Screenshots**
- Base64 upload (50MB limit)
- User-level enable/disable
- Metadata storage

## Tech Stack

- **NestJS** - Framework
- **Prisma** - ORM
- **PostgreSQL** - Database
- **JWT** - Authentication
- **bcrypt** - Password hashing
- **body-parser** - 50MB limit for screenshots
- **date-fns** - Date utilities

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

`.env` file:
```env
DATABASE_URL="postgresql://dexterz_user:User123@18.190.28.199:5432/dexterz_central"
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
PORT=3001
```

### 3. Generate Prisma Client

```bash
npm run prisma:generate
```

### 4. Run Migrations

```bash
npm run prisma:migrate
```

### 5. Start Development Server

```bash
npm run dev
```

Server runs on: `http://localhost:3001/api`

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Activity
- `POST /api/activity/sessions/start` - Start tracking session
- `POST /api/activity/sessions/stop` - Stop tracking session
- `POST /api/activity/batch` - Upload activity samples
- `POST /api/activity/rollup` - Trigger rollup processing

### Organizations
- `GET /api/organizations/me` - Get organization info
- `GET /api/organizations/schedule` - Get working schedule

### Projects
- `GET /api/projects` - List user projects
- `GET /api/projects/:id` - Get project details

### Users
- `GET /api/users` - List users
- `GET /api/users/:id` - Get user details
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Screenshots
- `POST /api/screenshots/upload` - Upload screenshot (50MB limit)

## Key Features

### 50MB Body Limit ✅
Supports large screenshot uploads (base64 encoded)

### Projects Module ✅
Desktop app can fetch and display projects

### Users Module ✅
Complete user management for admin panel

### Clean Code ✅
- Separated RollupService
- Shared utilities
- Professional structure
- Detailed logging

## Database Schema

Same as existing backend with all models:
- Organization
- User
- DeviceSession
- ActivitySample
- TimeEntry
- Schedule
- Team
- Project
- Task
- Screenshot

## Development

```bash
# Development mode
npm run dev

# Build
npm run build

# Production
npm run start:prod

# Prisma Studio (DB GUI)
npm run prisma:studio
```

## What's Included

✅ Core activity tracking
✅ Rollup algorithm (exact copy)
✅ Idle threshold (admin-defined)
✅ Break time handling
✅ 50MB body limit for screenshots
✅ Projects module
✅ Users module
✅ Clean code structure
✅ Professional logging

## What's NOT Included

❌ BullMQ queue system (uses direct calls)
❌ Redis dependency
❌ Worker module
❌ Reports module
❌ Teams module
❌ Tasks module
❌ Manual time module
❌ AWS S3 integration
❌ Static file serving

## Comparison with Existing Backend

| Feature | This Backend | Existing Backend |
|---------|-------------|------------------|
| Core Tracking | ✅ | ✅ |
| Rollup Logic | ✅ Same | ✅ |
| 50MB Limit | ✅ | ✅ |
| Projects | ✅ | ✅ |
| Users | ✅ | ✅ |
| Queue System | ❌ | ✅ Redis |
| Extra Modules | ❌ | ✅ 5+ modules |
| Complexity | Low | High |
| Setup | Easy | Complex |

## When to Use This Backend

✅ Small to medium projects (< 100 users)
✅ Budget constraints (no Redis)
✅ Quick deployment
✅ Simple infrastructure
✅ Learning purposes

## When to Use Existing Backend

✅ Production applications
✅ High traffic (> 100 users)
✅ Need scalability
✅ Need advanced features
✅ Enterprise clients

## License

Proprietary - Dexterz Technologies
