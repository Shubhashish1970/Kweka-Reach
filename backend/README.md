# EMS Call Centre Backend API

Node.js/Express backend API for the EMS Call Centre System.

<!-- Redeploy trigger: 2026-02-28 full stack CI -->

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update `.env` with your MongoDB Atlas connection string and other configuration.

4. Run development server:
```bash
npm run dev
```

The server will start on `http://localhost:5000`

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user profile

### Users (MIS Admin only)
- `GET /api/users` - List all users (with filters)
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user
- `PUT /api/users/:id/password` - Reset user password

### Health Checks
- `GET /api/health` - API health check
- `GET /api/health/database` - Database connection status

## Environment Variables

- `MONGODB_URI` - MongoDB Atlas connection string (database: Kweka_Call_Centre)
- `JWT_SECRET` - Secret for JWT token signing
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment (development/production)
- `CORS_ORIGIN` - Allowed CORS origin

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   │   ├── database.ts  # MongoDB connection
│   │   ├── logger.ts    # Winston logger
│   │   └── permissions.ts # RBAC permissions
│   ├── models/          # Mongoose models
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── middleware/      # Express middleware
│   ├── utils/           # Utility functions
│   └── server.ts        # Express app entry point
├── package.json
└── tsconfig.json
```

## MongoDB Models

- **User** - System users with role-based access
- **Farmer** - Farmer demographic data
- **Activity** - Field activity data from FFA App
- **CallTask** - Call tasks with embedded call logs
- **CoolingPeriod** - Prevents over-calling same farmer
- **InboundQuery** - Inbound call queries
- **SamplingAudit** - Audit trail for sampling decisions

## Authentication

Uses JWT (JSON Web Tokens) for authentication. Include token in Authorization header:
```
Authorization: Bearer <token>
```

## Role-Based Access Control

Five user roles with different permissions:
- `cc_agent` - Call Centre Agent
- `team_lead` - Team Lead
- `mis_admin` - MIS Admin
- `core_sales_head` - Core Sales Head
- `marketing_head` - Marketing Head

