# EMI Management and Loan Tracking System

Final-year commerce, EMI management, and customer identity cross-validation platform for small businesses and micro-loan providers.

## Tech Stack

- Frontend: React, Vite, React Router, TanStack Query, Recharts
- Backend: Node.js, Express, MongoDB, Mongoose
- Utilities: JWT auth, Multer uploads, node-cron reminders, PDFKit, ExcelJS
- Integrations: Stripe Checkout, Gmail verification email, Cloudinary private media, Socket.IO notifications
- AI service: FastAPI, Tesseract OCR, ZXing, OpenCV YuNet/SFace, and MediaPipe basic liveness

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

## Main Flows

- Register/login for buyers and sellers.
- Admin approval/rejection for seller registration.
- Seller dashboard with summary cards, products, offline loan creation, manual payment recording, overdue risk table, and exports.
- Buyer marketplace with product browsing and EMI request submission.
- Buyer portal with KYC uploads, loan list, Stripe Checkout payment, and mock gateway fallback.
- EMI engine supporting flat, reducing balance, and zero-interest schedules.
- Daily overdue/reminder job plus manual trigger from seller dashboard.
- Audit logs for important actions.
- Laptop-to-phone identity verification sessions with one-time QR links.
- NID front OCR and back QR field comparison.
- NID portrait versus live-face similarity and basic active liveness.
- Automatic KYC approval only for fully verified results, with admin overrides.

See [IDENTITY_VERIFICATION_GUIDE.md](IDENTITY_VERIFICATION_GUIDE.md) for local setup, free Hugging Face deployment, the complete demonstration flow, privacy controls, and limitations.

## API Highlights

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/verify-otp`
- `GET /api/admin/sellers/pending`, `PATCH /api/admin/sellers/:id/approve`, `PATCH /api/admin/sellers/:id/reject`
- `GET/POST/PATCH/DELETE /api/products`
- `POST /api/kyc`, `PATCH /api/kyc/:id/review`
- `POST /api/loans/offline`, `POST /api/loans/requests`, `PATCH /api/loans/:id/approve`, `GET /api/loans`
- `POST /api/payments/manual`, `POST /api/payments/mock-gateway`
- `POST /api/payments/stripe/create-checkout-session`, `POST /api/payments/stripe/confirm-checkout-session`, `POST /api/payments/stripe/webhook`
- `GET /api/reports/summary`, `GET /api/reports/collections`, `GET /api/reports/overdue`, `GET /api/reports/export`
- `GET /api/notifications`

## Notes

- Real bKash, Nagad, SSLCommerz, SMS, email, Google Drive, or S3 integrations can replace the mock services without changing route behavior.
- Stripe runs in test mode from `server/.env`. Use card `4242 4242 4242 4242`, any future expiry, and any CVC for demo payments.
- For local webhook testing, install the Stripe CLI and forward events to `http://localhost:5000/api/payments/stripe/webhook`, then set `STRIPE_WEBHOOK_SECRET`.
- Uploaded files are stored under `server/uploads/` during development.
- Production MongoDB should run as a replica set to support transactions.
