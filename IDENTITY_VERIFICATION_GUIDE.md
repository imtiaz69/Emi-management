# FinanceLend Identity Cross-Validation Guide

## What It Does

The module compares information supplied by a customer:

1. OCR-extracted fields from the front of a Bangladesh NID.
2. Legitimately readable QR content from the back of the NID.
3. The NID portrait and a live face capture.
4. A basic blink and head-turn liveness challenge.

It does not contact a government database and must not be presented as proof that an NID was issued by the Bangladesh Election Commission.

## Architecture

```text
Officer browser (Vercel)       Customer phone (Vercel)
           |                             |
           +------ Express API ----------+
                    Render
                      |
          MongoDB Atlas + private Cloudinary
                      |
              FastAPI AI service
             Render Docker service
```

The phone uploads directly to authenticated Cloudinary storage. Express validates the stored asset and queues a MongoDB-backed processing job. The FastAPI service receives temporary signed asset URLs and returns observations. Express calculates the final status and updates KYC.

## Local Setup

### 1. Configure the Node server

Add the following to `server/.env` without committing the file:

```env
PUBLIC_CLIENT_URL=http://localhost:5173
IDENTITY_AI_URL=http://localhost:8001
IDENTITY_PUBLIC_API_URL=http://host.docker.internal:5000
IDENTITY_AI_SERVICE_KEY=replace-with-at-least-32-random-characters
IDENTITY_DATA_ENCRYPTION_KEY=replace-with-base64-key
IDENTITY_SESSION_TTL_MINUTES=10
IDENTITY_ARTIFACT_RETENTION_HOURS=24
IDENTITY_AI_TIMEOUT_MS=300000
IDENTITY_LIVENESS_ENABLED=true
```

Generate secrets:

```bash
openssl rand -base64 36
openssl rand -base64 32
```

The second command produces `IDENTITY_DATA_ENCRYPTION_KEY`. Existing Cloudinary variables must also be configured because identity captures intentionally have no local-storage fallback.

### 2. Start the AI service

With Docker:

```bash
cd ai-service
cp .env.example .env
# Put the same IDENTITY_AI_SERVICE_KEY in this file.
docker compose up --build
```

Its health endpoint is `http://localhost:8001/health`.

Without Docker, use Python 3.11 and install Tesseract Bengali/English data and FFmpeg first. Docker is recommended because MediaPipe does not support every host Python version.

### 3. Start MERN

```bash
npm run dev
```

Open `http://localhost:5173`. A phone cannot use the camera through a plain LAN HTTP address. For a real phone test, expose Vite using an HTTPS tunnel, set `PUBLIC_CLIENT_URL` to that HTTPS URL, and restart Express.

## Full Test Flow

1. Log in as an active seller or admin.
2. Open **Identity verification** in the dashboard sidebar.
3. Select an existing active and email-verified buyer. Sellers only see buyers connected to their orders or loans.
4. Click **Start identity verification**.
5. Scan the displayed QR code with the customer phone.
6. Capture the NID front and back in bright, even light.
7. Open the front camera and perform the three displayed actions in order.
8. Submit the captures and return to the laptop.
9. Wait while the status changes from `Queued` to `Waking AI`, `Processing`, and `Completed`.
10. Review each field, face score, liveness result, warnings, and final status.
11. A fully `VERIFIED` result approves the linked KYC automatically. Other results stay pending for human review.

Use synthetic or explicitly consented data during demonstrations.

## Free Deployment

### Render

Deploy `ai-service/` as a free Docker web service. Set `IDENTITY_AI_SERVICE_KEY` on that service and restrict `IDENTITY_ALLOWED_ASSET_HOSTS` to the Node API hostname. Then add these values to the Node API service and redeploy:

```env
PUBLIC_CLIENT_URL=https://your-vercel-domain
IDENTITY_AI_URL=https://your-ai-service.onrender.com
IDENTITY_PUBLIC_API_URL=https://your-render-service.onrender.com
IDENTITY_AI_SERVICE_KEY=the-same-ai-service-secret
IDENTITY_DATA_ENCRYPTION_KEY=the-generated-base64-key
IDENTITY_SESSION_TTL_MINUTES=10
IDENTITY_ARTIFACT_RETENTION_HOURS=24
IDENTITY_AI_TIMEOUT_MS=300000
IDENTITY_LIVENESS_ENABLED=true
```

Both free Render services sleep after inactivity. The application displays a waking state and retries automatically while the AI service starts.

### Vercel

No new client secret is required. Redeploy the existing client after the code is pushed. Keep `VITE_API_URL` and `VITE_SOCKET_URL` pointed at the Render API.

## Results

- `VERIFIED`: readable matching document fields, passing face score, and passing video liveness.
- `PARTIALLY_VERIFIED`: document and face checks pass, but only selfie fallback was available.
- `MANUAL_REVIEW_REQUIRED`: missing, unreadable, low-quality, or borderline evidence.
- `FAILED`: an explicit field, face, or liveness mismatch.

An AI failure never silently rejects a buyer. Admins retain manual approval, rejection, revocation, and recapture controls.

## Privacy and Security

- Link tokens are random, one-time, short-lived, and stored only as hashes.
- Mobile tokens are session-scoped and removed after submission.
- Cloudinary identifiers contain no customer PII.
- Raw OCR/QR values are encrypted with AES-256-GCM.
- Raw documents and videos are deleted after 24 hours.
- Face embeddings are not stored.
- Application and AI-service logs never include raw captures or decoded identity data.

## Known Limitations

- OCR results depend on image quality and NID layout variations.
- Some NID QR payloads may be encrypted or not contain comparable fields.
- The default SFace threshold comes from OpenCV guidance and requires calibration on consented local data before serious use.
- Basic blink/head-turn detection is not certified presentation-attack detection and cannot reliably stop sophisticated replay, masks, or deepfakes.
- Free Render services can have noticeable cold starts.
