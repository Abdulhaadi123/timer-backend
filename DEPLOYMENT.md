# HRMS Timer Backend - Deployment Guide

## Quick Deployment Steps

### 1. Server Requirements
- Node.js 18+ installed
- Redis installed (for queue system)
- PostgreSQL database access

### 2. Clone & Install
```bash
git clone https://github.com/Abdulhaadi123/timer-backend.git
cd timer-backend
npm install
```

### 3. Environment Setup
Copy `.env.deployment` to `.env` and update if needed:
```bash
cp .env.deployment .env
```

### 4. Database Setup
```bash
npx prisma generate
npx prisma db push
```

### 5. Build & Run
```bash
npm run build
npm run start:prod
```

Server will run on port 3001.

### 6. PM2 (Production)
```bash
npm install -g pm2
pm2 start dist/main.js --name hrms-backend
pm2 save
pm2 startup
```

## API Endpoints
- Health: `GET /`
- Login: `POST /auth/login`
- Activity: `POST /activity/samples`
- Stats: `GET /activity/my-stats`

## Environment Variables
See `.env.example` for all available options.

## Desktop App Configuration
Update desktop app API URL to point to deployed backend:
```
http://YOUR_SERVER_IP:3001
```
