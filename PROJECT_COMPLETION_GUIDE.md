# EMI Management Project Completion Guide

This guide starts from MongoDB Atlas setup and continues through the remaining work needed to complete, test, polish, and deploy your MERN EMI Management website.

## 1. Create MongoDB Atlas Database

1. Go to:

   ```text
   https://www.mongodb.com/cloud/atlas/register
   ```

2. Create an account or sign in.

3. Create a new project:

   ```text
   Project name: EMI Management
   ```

4. Create a free cluster:

   ```text
   Choose: M0 Free
   Provider: AWS
   Region: closest available region
   Cluster name: emi-management-cluster
   ```

5. Create a database user:

   ```text
   Username: emi_admin
   Password: create a strong password and save it
   ```

6. Allow network access:

   ```text
   Network Access > Add IP Address > Allow Access From Anywhere
   IP: 0.0.0.0/0
   ```

   For final production, you can later restrict this. For development/demo, this is easier.

7. Get your MongoDB connection string:

   ```text
   Database > Connect > Drivers > Node.js
   ```

   It will look like this:

   ```text
   mongodb+srv://emi_admin:<password>@emi-management-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

8. Edit the connection string:

   ```text
   mongodb+srv://emi_admin:YOUR_PASSWORD@emi-management-cluster.xxxxx.mongodb.net/emi_management?retryWrites=true&w=majority
   ```

   Important: replace `YOUR_PASSWORD` with your real database user password.

## 2. Configure Backend Environment

From the project root:

```bash
cd "/home/imtiaz/Emi management"
cp server/.env.example server/.env
```

Open `server/.env` and update it:

```env
PORT=5000
MONGO_URI=mongodb+srv://emi_admin:YOUR_PASSWORD@emi-management-cluster.xxxxx.mongodb.net/emi_management?retryWrites=true&w=majority
JWT_SECRET=make-a-long-random-secret-here
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
UPLOAD_DIR=uploads
SEED_ADMIN_EMAIL=admin@emi.local
SEED_ADMIN_PASSWORD=Admin@123
AUTO_SEED=false
```

Use a strong `JWT_SECRET`, for example:

```text
emi-management-final-year-secret-2026-change-before-production
```

## 3. Install Dependencies

From the project root:

```bash
npm run install:all
```

If dependencies are already installed, this is still safe to run.

## 4. Seed Demo Data Into Atlas

Run:

```bash
npm run seed
```

Expected demo accounts:

```text
Admin:  admin@emi.local / Admin@123
Seller: seller@emi.local / Seller@123
Buyer:  buyer@emi.local / Buyer@123
```

## 5. Run The Website Locally

From the project root:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Backend API:

```text
http://localhost:5000
```

Health check:

```text
http://localhost:5000/api/health
```

## 6. Test The Main Demo Flow

Follow this flow carefully. This should be your final-year project demonstration path.

### 6.1 Admin Flow

1. Login as admin:

   ```text
   admin@emi.local / Admin@123
   ```

2. Open Admin Panel.

3. Check:

   ```text
   Pending seller registrations
   Users list
   Audit trail
   ```

4. Register a new seller from another browser/session.

5. Return to admin and approve that seller.

### 6.2 Seller Flow

1. Login as seller:

   ```text
   seller@emi.local / Seller@123
   ```

2. Confirm dashboard cards show:

   ```text
   Active EMIs
   Due amount
   Overdues
   Monthly collection
   ```

3. Add a product:

   ```text
   Name: Samsung Phone
   Category: Mobile
   Price: 25000
   Stock: 10
   EMI available: checked
   ```

4. Create an offline loan:

   ```text
   Buyer: Demo Buyer
   Product: Samsung Phone
   Down payment: 5000
   Interest: 12
   Tenure: 6
   Interest type: Flat
   ```

5. Record a payment:

   ```text
   Loan: select active loan
   Amount: 3000
   Method: Cash
   ```

6. Run overdue check using the dashboard button.

7. Export report:

   ```text
   Excel
   PDF
   ```

### 6.3 Buyer Flow

1. Login as buyer:

   ```text
   buyer@emi.local / Buyer@123
   ```

2. Go to Buyer Portal.

3. Upload KYC file:

   ```text
   Type: NID
   File: any JPG/PNG/PDF demo file
   ```

4. Go to Marketplace.

5. Select a product and request EMI.

6. Return to Buyer Portal and check EMI list.

7. Use mock payment:

   ```text
   Pay 1000
   ```

## 7. Remaining Features To Complete

The current MVP is working, but these items will make the project feel complete.

## 7.1 Add Seller EMI Request Approval Screen

Goal:

```text
Seller should see online EMI requests from buyers and approve/reject them.
```

Current backend already supports:

```text
GET /api/loans?status=requested
PATCH /api/loans/:id/approve
PATCH /api/loans/:id/reject
```

Frontend task:

1. In `client/src/pages/SellerDashboard.jsx`, add a panel called:

   ```text
   Online EMI Requests
   ```

2. Show requested loans:

   ```text
   Buyer name
   Product name
   Principal
   Down payment
   Tenure
   Interest type
   Approve button
   Reject button
   ```

3. On approve, call:

   ```js
   PATCH /api/loans/:id/approve
   ```

4. On reject, call:

   ```js
   PATCH /api/loans/:id/reject
   ```

5. Refresh dashboard after action.

## 7.2 Add Loan Schedule Details Page

Goal:

```text
Seller and buyer should be able to view installment schedule for each loan.
```

Backend already supports:

```text
GET /api/loans/:id/schedule
```

Frontend task:

1. Add route:

   ```text
   /loans/:id
   ```

2. Create file:

   ```text
   client/src/pages/LoanDetails.jsx
   ```

3. Show:

   ```text
   Installment number
   Due date
   Principal amount
   Interest amount
   Late fee
   Amount due
   Amount paid
   Status
   ```

4. Add "View Schedule" button in:

   ```text
   SellerDashboard
   BuyerPortal
   ```

## 7.3 Add Receipt Download Page

Goal:

```text
Seller/buyer should be able to download a receipt for each payment.
```

Backend currently records transactions with:

```text
receiptNo
paymentDate
amount
method
gatewayRef
```

Frontend task:

1. Add a payment history panel.

2. Add a "Download Receipt" button.

3. Use frontend PDF generation with `jspdf`.

Receipt should include:

```text
Receipt number
Buyer name
Seller name
Loan ID
Payment amount
Payment method
Payment date
```

## 7.4 Add KYC Review Screen

Goal:

```text
Seller/admin should approve or reject uploaded KYC documents.
```

Backend already supports:

```text
GET /api/kyc/pending
PATCH /api/kyc/:id/review
```

Frontend task:

1. Add KYC Review panel in Admin Panel or Seller Dashboard.

2. Show:

   ```text
   Buyer name
   Document type
   Uploaded files
   Approve button
   Reject button
   Rejection reason
   ```

3. On approve:

   ```json
   { "status": "approved" }
   ```

4. On reject:

   ```json
   { "status": "rejected", "rejectionReason": "Invalid document" }
   ```

## 7.5 Add Product Image Upload UI

Backend already supports product images through multipart upload.

Frontend task:

1. Change Add Product form to use `FormData`.

2. Add file input:

   ```text
   Product images, max 5
   ```

3. Send request:

   ```js
   api.post("/products", formData, {
     headers: { "Content-Type": "multipart/form-data" }
   })
   ```

4. Show image preview in Marketplace.

## 7.6 Add Bengali Language Support

Goal:

```text
English/Bengali toggle for main UI labels.
```

Suggested simple approach:

1. Create:

   ```text
   client/src/i18n/strings.js
   ```

2. Add:

   ```js
   export const strings = {
     en: {
       sellerDashboard: "Seller Dashboard",
       activeEmis: "Active EMIs"
     },
     bn: {
       sellerDashboard: "বিক্রেতা ড্যাশবোর্ড",
       activeEmis: "সক্রিয় EMI"
     }
   };
   ```

3. Store selected language in localStorage.

4. Add a language toggle button in `Layout.jsx`.

## 8. Testing Checklist

Before final submission, run:

```bash
npm test
npm run build --prefix client
```

Then manually test:

```text
Register buyer
Register seller
Admin approves seller
Seller adds product
Buyer uploads KYC
Buyer requests EMI
Seller approves EMI
Seller records payment
Buyer makes mock payment
Seller exports report
Run overdue check
Check audit logs
```

## 9. Fix Common Problems

## 9.1 White Screen

Open browser developer console:

```text
Right click > Inspect > Console
```

Then check terminal where client/server is running.

Common fix:

```bash
Ctrl + C
npm run dev
```

## 9.2 MongoDB Atlas Connection Error

Check:

```text
MONGO_URI is correct
Password has no unescaped special characters
Network access includes 0.0.0.0/0
Database user exists
Cluster is active
```

If password contains symbols like `@`, `#`, `/`, replace them with URL encoding or create a simpler password.

## 9.3 Seller Cannot Access Dashboard

Seller may still be pending approval.

Fix:

```text
Login as admin
Go to Admin Panel
Approve seller
Logout
Login as seller again
```

## 9.4 Port Already Used

If port `5000` or `5173` is busy:

```bash
lsof -i :5000
lsof -i :5173
```

Stop the process:

```bash
kill -9 PROCESS_ID
```

Then run again:

```bash
npm run dev
```

## 10. Deployment Plan

Recommended deployment:

```text
Frontend: Vercel
Backend: Render
Database: MongoDB Atlas
Uploads: local for demo, Cloudinary/S3 for real production
```

## 10.1 Deploy Backend To Render

1. Push project to GitHub.

2. Go to:

   ```text
   https://render.com
   ```

3. Create new Web Service.

4. Select GitHub repository.

5. Use:

   ```text
   Root Directory: server
   Build Command: npm install
   Start Command: npm start
   ```

6. Add environment variables:

   ```env
   PORT=5000
   MONGO_URI=your_mongodb_atlas_uri
   JWT_SECRET=your_secret
   JWT_EXPIRES_IN=7d
   CLIENT_URL=https://your-frontend-domain.vercel.app
   UPLOAD_DIR=uploads
   AUTO_SEED=false
   ```

7. Deploy.

8. Copy backend URL:

   ```text
   https://your-backend.onrender.com
   ```

## 10.2 Deploy Frontend To Vercel

1. Go to:

   ```text
   https://vercel.com
   ```

2. Import GitHub repository.

3. Use:

   ```text
   Root Directory: client
   Build Command: npm run build
   Output Directory: dist
   ```

4. Add environment variable:

   ```env
   VITE_API_URL=https://your-backend.onrender.com/api
   VITE_SERVER_URL=https://your-backend.onrender.com
   ```

5. Deploy.

## 11. Final-Year Presentation Checklist

Prepare these:

```text
Project report PDF
GitHub repository
Live website link
Demo video
Screenshots
ER diagram
Use case diagram
API list
Test case list
```

Suggested demo order:

```text
1. Explain problem: small businesses track EMI manually
2. Show marketplace
3. Show buyer KYC upload
4. Show buyer EMI request
5. Show seller dashboard
6. Show seller approving/creating EMI
7. Show EMI schedule and payment
8. Show overdue/risk/report
9. Show admin approval and audit trail
10. Explain future scope: real payment gateway, SMS, mobile app, AI credit scoring
```

## 12. Priority Order From Here

Complete the remaining tasks in this order:

```text
1. MongoDB Atlas setup
2. Seed Atlas data
3. Add seller EMI request approval panel
4. Add loan schedule details page
5. Add receipt download
6. Add KYC review screen
7. Add product image upload UI
8. Polish mobile UI
9. Deploy backend
10. Deploy frontend
11. Prepare final demo video
```

