# Kweka Reach Call Centre System - EMS

Complete monorepo implementation for the EMS Call Centre System - a data-first call centre platform for validating field activities and capturing farmer feedback.

## Project Structure

```
CC EMS/
├── backend/          # Node.js/Express API (TypeScript)
├── frontend/         # React application (TypeScript)
├── mock-ffa-api/     # Mock FFA API service (to be created in Phase 2)
└── IMPLEMENTATION_PLAN.md  # Complete implementation plan
```

## Quick Start

### Prerequisites
- Node.js v18+
- MongoDB Atlas account (or local MongoDB)
- npm or yarn

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Update `.env` with your MongoDB connection string:
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/Kweka_Call_Centre
JWT_SECRET=your-super-secret-jwt-key
PORT=5000
```

5. Start development server:
```bash
npm run dev
```

Backend will run on `http://localhost:5000`

### Frontend Setup

1. Navigate to frontend directory (or root):
```bash
# From root directory
npm install
```

2. Create `.env` file (optional):
```
VITE_API_URL=http://localhost:5000/api
GEMINI_API_KEY=your-gemini-api-key
```

3. Start development server:
```bash
npm run dev
```

Frontend will run on `http://localhost:3000`

## Phase 1 Status: ✅ Complete

### Backend (Phase 1)
- ✅ Core Infrastructure Module (Express, MongoDB, logging, error handling)
- ✅ Authentication & Authorization Module (JWT, RBAC)
- ✅ User Management Module (CRUD, role assignment, team management)
- ✅ MongoDB Models (User, Farmer, Activity, CallTask, CoolingPeriod, InboundQuery, SamplingAudit)

### Frontend (Phase 1)
- ✅ Authentication Module (Login page, AuthContext, ProtectedRoute)
- ✅ Shared UI Components (Button, Modal, Toast)
- ✅ API Service Layer (replaces mock ApiService)

## API Endpoints (Phase 1)

### Authentication
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user profile

### Users (MIS Admin only)
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user
- `PUT /api/users/:id/password` - Reset password

### Health Checks
- `GET /api/health` - API health check
- `GET /api/health/database` - Database connection status

## User Roles

1. **CC Agent** (`cc_agent`) - Makes calls, submits interactions
2. **Team Lead** (`team_lead`) - Manages team, views team metrics
3. **MIS Admin** (`mis_admin`) - Full system access, user management
4. **Core Sales Head** (`core_sales_head`) - Field team dashboards
5. **Marketing Head** (`marketing_head`) - EMS effectiveness dashboards

## Next Steps (Phase 2)

- Task Management Module
- Mock FFA API service
- FFA Integration Module
- Sampling Module
- Agent Workspace (full 3-pane implementation)

## Development

- Backend: `cd backend && npm run dev`
- Frontend: `npm run dev` (from root)
- Both services run concurrently

## Documentation

- **Implementation:** `IMPLEMENTATION_PLAN.md` – implementation details, module breakdown, and architecture.
- **Frontend UI standards:** `frontend/UI_STANDARDS.md` – dropdowns (use `StyledSelect`, not native `<select>`), form inputs, and shared components so the app stays on-theme.

## License

Private - NACL Internal Use
