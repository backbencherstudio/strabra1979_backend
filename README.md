# Liberty Shield Backend

Backend API for the Liberty Shield property inspection and dashboard management platform, built with NestJS.

---

## Tech Stack

- **TypeScript** + **NestJS**
- **Prisma** ORM with **PostgreSQL**
- **Socket.io** — real-time notifications
- **BullMQ** + **Redis** — background job queue (email, notifications)
- **JWT** — authentication
- **Swagger** — API documentation
- **Docker** — containerized deployment

---

## Environment Setup

Create a `.env` file in the root directory with the following variables:
```env
# App
PORT=4000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/liberty_shield

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

# Redis (required for BullMQ queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# Mail (BullMQ mail queue)
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USER=your@email.com
MAIL_PASS=your_mail_password
MAIL_FROM=noreply@libertyshield.com

# AWS S3 (file storage)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your_bucket_name

# Default Admin (auto-created on first run)
DEFAULT_ADMIN_EMAIL=admin@libertyshield.com
DEFAULT_ADMIN_PASSWORD=Admin@123
DEFAULT_ADMIN_USERNAME=admin

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## Installation

Install all dependencies:
```bash
yarn install
```

---

## Database Setup

Run Prisma migrations:
```bash
npx prisma migrate dev
```

Generate Prisma client:
```bash
npx prisma generate
```

Seed the database with default data including:
- 4 default users (Admin, Property Manager, Authorized Viewer, Operational) — password: `12345678`
- Inspection Criteria (Standard Roof Inspection)
- Dashboard Template (Standard Property Dashboard with 9 sections)
- 10 sample properties with dashboards, scheduled inspections, activity logs, and notifications
```bash
yarn seed
```

Default seeded user credentials:

| Role               | Email                        | Password   |
|--------------------|------------------------------|------------|
| Admin              | admin@gmail.com              | 12345678   |
| Property Manager   | property_manager@gmail.com   | 12345678   |
| Authorized Viewer  | authorized_viewer@gmail.com  | 12345678   |
| Operational        | operational@gmail.com        | 12345678   |

---

## Running the App
```bash
# development
yarn start

# watch mode
yarn start:dev

# watch mode with SWC compiler (faster)
yarn start:dev-swc

# production mode
yarn start:prod
```

---

## Docker
```bash
docker compose up
```

---

## API Documentation

Swagger UI is available at:
```
http://{domain_name}/api/docs
```

All APIs are organized by module and fully documented with request/response examples, authentication requirements, and query parameters.

---

## Key Modules

| Module | Description |
|---|---|
| **Auth** | Login, registration, password reset, JWT authentication |
| **User Management** | Role management, approval, access control, expiration |
| **Property Dashboard** | Property creation, dashboard management, templates |
| **Inspection Criteria** | Dynamic form config — scoring, media, health thresholds |
| **Inspections** | Full inspection workflow — submit, start, publish, delete |
| **Scheduled Inspections** | Assign, track, and manage inspection schedules |
| **Property Access** | Grant, revoke, and expire dashboard access per user |
| **Access Requests** | Authorized Viewer request and approval workflow |
| **Notifications** | Real-time WebSocket notifications + preferences |
| **Activity Logs** | System-wide action logs with filtering and pagination |
| **Inspection Folders** | Organize inspection reports into folders per dashboard |
| **Settings** | Branding settings and notification preferences |
| **Reports** | Inspection report management with search and pagination |
