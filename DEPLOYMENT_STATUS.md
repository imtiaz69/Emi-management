# FinanceLend Deployment Status

Deployment completed on 19 July 2026.

## Live Services

- Frontend: https://financelend-emi-management.vercel.app
- Backend: https://financelend-api-imtiaz.onrender.com
- Health check: https://financelend-api-imtiaz.onrender.com/api/health
- Source: https://github.com/imtiaz69/Emi-management

## Hosting

| Component | Provider | Plan |
|---|---|---|
| React/Vite frontend | Vercel | Hobby |
| Express and Socket.IO backend | Render | Free web service |
| Database | MongoDB Atlas | Existing cloud cluster |
| Product and KYC media | Cloudinary | Existing cloud account |
| Test payments | Stripe | Test mode |
| Verification email | Resend | Sandbox sender |

No custom domain or payment card was added during deployment.

## Production Configuration

- Render service: `financelend-api-imtiaz`
- Render service ID: `srv-d9e1emv41pts73e2u3ug`
- Vercel project: `financelend-emi-management`
- Vercel project ID: `prj_2QWGJk7YOIsfvRVvHYXr6CGQnk6Z`
- Git branch: `main`
- Deployed source commit: `59af3e7ae23a6d847530fde3d4e0e2e80169461a`
- Backend region: Singapore
- Application timezone: `Asia/Dhaka`
- Automatic Render deployment: enabled
- Automatic database seeding: disabled
- Production OTP exposure: disabled

All backend secrets are stored in Render environment variables. No
MongoDB, Stripe, Cloudinary, email, or JWT secret is stored in Vercel or
committed to GitHub.

## Verified Checks

- Backend health endpoint returns HTTP 200.
- Frontend home and direct React routes load.
- Production CORS accepts the final Vercel origin.
- Buyer, seller, and administrator logins issue valid JWTs.
- Existing Atlas products load from the public marketplace.
- Product media loads from Cloudinary.
- Authenticated Socket.IO connects to the buyer's private room.
- Stripe creates an exact-value BDT Checkout session.
- The Stripe test webhook is enabled with a Render-only signing secret.
- Resend accepted a deployment verification email.
- Desktop home and mobile marketplace screenshots rendered correctly.
- Backend test suite passed 25 of 25 tests.
- Vite production build completed successfully.

## Important Free-Tier Behavior

- Render sleeps after an idle period, so the first request can take about
  one minute.
- The in-process overdue cron does not run while Render is asleep.
- Cloudinary must remain enabled because Render's local filesystem is
  temporary.
- Stripe is intentionally in test mode.
- Resend's `onboarding@resend.dev` sandbox sender can send only to the
  Resend account owner's email. Sending verification email to every user
  requires a verified sending domain or another HTTPS email provider.

## Redeployment

Render automatically deploys new commits from `main`.

The current Vercel account is not connected to the repository through
the Vercel GitHub App, so deploy frontend changes from the project root:

```bash
cd client
npx vercel --prod
```

The production Vercel environment already stores:

```text
VITE_API_URL=https://financelend-api-imtiaz.onrender.com/api
VITE_SERVER_URL=https://financelend-api-imtiaz.onrender.com
VITE_SOCKET_URL=https://financelend-api-imtiaz.onrender.com
```

## Presentation Preparation

Open the health-check URL a few minutes before presenting so the free
Render service has time to wake. Then verify login, marketplace loading,
and the Socket.IO connection indicator before starting the live demo.
