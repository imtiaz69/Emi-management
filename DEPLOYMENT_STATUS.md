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
| Account email | Gmail SMTP through a protected Vercel Function | Personal Gmail App Password |

No custom domain or payment card was added during deployment.

## Production Configuration

- Render service: `financelend-api-imtiaz`
- Render service ID: `srv-d9e1emv41pts73e2u3ug`
- Vercel project: `financelend-emi-management`
- Vercel project ID: `prj_2QWGJk7YOIsfvRVvHYXr6CGQnk6Z`
- Git branch: `main`
- Deployed application commit: `6fc24df`
- Backend region: Singapore
- Application timezone: `Asia/Dhaka`
- Render deployment method: authenticated CLI
- Automatic database seeding: disabled
- Production OTP exposure: disabled

Backend secrets are stored in Render environment variables. The Gmail
credentials and a private relay secret are stored in Vercel production
environment variables. Secrets are not committed to GitHub.

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
- The protected Vercel email relay delivered a Gmail message to the demo
  recovery inbox and rejected an unauthenticated request.
- Password recovery sends a random, hashed, ten-minute OTP and never
  returns it from the production API.
- Unverified accounts are blocked from cart and checkout actions.
- Buyers with incomplete profiles or missing KYC are blocked before an
  EMI product can be prepared for checkout.
- Desktop home and mobile marketplace screenshots rendered correctly.
- Backend test suite passed 26 of 26 tests.
- Vite production build completed successfully.

## Important Free-Tier Behavior

- Render sleeps after an idle period, so the first request can take about
  one minute.
- The in-process overdue cron does not run while Render is asleep.
- Cloudinary must remain enabled because Render's local filesystem is
  temporary.
- Stripe is intentionally in test mode.
- Registration and password-reset email is relayed over HTTPS from
  Render to a protected Vercel Function, which sends through Gmail SMTP.
- Password-reset messages for the `.local` demo accounts are delivered
  to `imtiazahmed4407@gmail.com`.

## Redeployment

Deploy backend changes from the project root:

```bash
render deploys create srv-d9e1emv41pts73e2u3ug --commit COMMIT_SHA --wait
```

Automatic Render deploys require connecting the repository through the
Render GitHub App. The current service securely clones the public
repository and is deployed through the authenticated Render CLI.

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
