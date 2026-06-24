# EMI Management and Loan Tracking System

Final-year MERN MVP for small businesses and micro-loan providers. It supports seller product management, offline EMI creation, buyer marketplace EMI requests, admin seller approval, KYC upload, payment recording, overdue automation, risk buckets, and PDF/Excel report exports.

## Tech Stack

- Frontend: React, Vite, React Router, TanStack Query, Recharts
- Backend: Node.js, Express, MongoDB, Mongoose
- Utilities: JWT auth, Multer uploads, node-cron reminders, PDFKit, ExcelJS
- Demo integrations: mock OTP, mock SMS/email/in-app notifications, mock payment gateway

## Quick Start

```bash
npm run install:all
npm run dev
```

The API runs on `http://localhost:5000` and the app runs on `http://localhost:5173`.

If no `MONGO_URI` is configured, the server starts an in-memory MongoDB replica set and auto-seeds demo data. For a real local database, copy `server/.env.example` to `server/.env`, set `MONGO_URI`, then run:

```bash
npm run seed
```

## Demo Accounts

- Admin: `admin@emi.local` / `Admin@123`
- Seller: `seller@emi.local` / `Seller@123`
- Buyer: `buyer@emi.local` / `Buyer@123`

## Main Scripts

```bash
npm run dev            # run client and server together
npm run server         # run Express API only
npm run client         # run React app only
npm test               # run backend EMI unit tests
npm run seed           # seed configured MongoDB
```

## Implemented MVP Flows

- Register/login for buyers and sellers.
- Admin approval/rejection for seller registration.
- Seller dashboard with summary cards, products, offline loan creation, manual payment recording, overdue risk table, and exports.
- Buyer marketplace with product browsing and EMI request submission.
- Buyer portal with KYC uploads, loan list, and mock gateway payment.
- EMI engine supporting flat, reducing balance, and zero-interest schedules.
- Daily overdue/reminder job plus manual trigger from seller dashboard.
- Audit logs for important actions.

## API Highlights

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/verify-otp`
- `GET /api/admin/sellers/pending`, `PATCH /api/admin/sellers/:id/approve`, `PATCH /api/admin/sellers/:id/reject`
- `GET/POST/PATCH/DELETE /api/products`
- `POST /api/kyc`, `PATCH /api/kyc/:id/review`
- `POST /api/loans/offline`, `POST /api/loans/requests`, `PATCH /api/loans/:id/approve`, `GET /api/loans`
- `POST /api/payments/manual`, `POST /api/payments/mock-gateway`
- `GET /api/reports/summary`, `GET /api/reports/collections`, `GET /api/reports/overdue`, `GET /api/reports/export`
- `GET /api/notifications`

## Notes

- Real bKash, Nagad, SSLCommerz, SMS, email, Google Drive, or S3 integrations can replace the mock services without changing route behavior.
- Uploaded files are stored under `server/uploads/` during development.
- Production MongoDB should run as a replica set to support transactions.
