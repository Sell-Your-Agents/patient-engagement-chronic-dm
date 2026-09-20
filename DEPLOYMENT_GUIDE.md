# Deployment Guide - Patient Engagement App

## Quick Start: Deploy to Render

### Prerequisites
1. **GitHub Account** - Sign up at https://github.com (free)
2. **Render Account** - Sign up at https://render.com (free)

---

## STEP 1: Create GitHub Account & Repository

### 1a. Create GitHub Account (if you don't have one)
- Go to https://github.com/signup
- Enter email, password, username
- Verify email
- Choose "Free" plan

### 1b. Create a New Repository
1. Log in to GitHub
2. Click **+** icon → **New repository**
3. Fill in:
   - **Repository name**: `patient-engagement-chronic-dm`
   - **Description**: Patient Engagement for Chronic Disease Management
   - **Visibility**: Public (required for free Render deployment)
   - **Add .gitignore**: Already done ✓
4. Click **Create repository**

You'll get a link like: `https://github.com/YOUR_USERNAME/patient-engagement-chronic-dm`

---

## STEP 2: Initialize Git & Push Code

### 2a. Initialize Git Repository (Windows PowerShell)

```powershell
cd "f:\Zensark\Code\AI PRojects\UseCase3-PatientEngagementChronicDM"

# Initialize git
git init

# Add all files
git add .

# Create first commit
git commit -m "Initial commit: Patient Engagement App with FastAPI backend and React frontend"

# Add remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/patient-engagement-chronic-dm.git

# Push to GitHub (will ask for credentials)
git branch -M main
git push -u origin main
```

When prompted for credentials:
- **Username**: Your GitHub username
- **Password**: Create a Personal Access Token:
  1. GitHub Settings → Developer settings → Personal access tokens
  2. Create new token with `repo` scope
  3. Copy and paste as password

---

## STEP 3: Deploy to Render

### 3a. Create Render Account
1. Go to https://render.com
2. Click **Sign up**
3. Connect with GitHub (easiest option)
4. Authorize Render to access your repositories

### 3b. Deploy Backend Service

1. In Render dashboard, click **New +** → **Web Service**
2. Select your repository: `patient-engagement-chronic-dm`
3. Fill in:
   - **Name**: `patient-engagement-backend`
   - **Environment**: Python 3
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Scroll to **Environment** and add variables:
   ```
   JWT_SECRET_KEY = generate-a-random-string-here-at-least-32-chars
   DATABASE_URL = sqlite+aiosqlite:///./patient_engagement.db
   APP_NAME = Patient Engagement for Chronic Disease Management
   ORG_NAME = Hospital System
   ```
5. Click **Create Web Service**

**Wait for deployment** (takes 2-3 minutes). You'll get a URL like: `https://patient-engagement-backend.onrender.com`

### 3c. Deploy Frontend Service

1. Click **New +** → **Static Site** (NOT Web Service)
2. Select your repository
3. Fill in:
   - **Name**: `patient-engagement-frontend`
   - **Build Command**: `cd frontend && npm install && npm run build`
   - **Publish Directory**: `frontend/dist`
4. Click **Create Static Site**

**Wait for deployment**. Frontend URL will be: `https://patient-engagement-frontend.onrender.com`

---

## STEP 4: Connect Frontend to Backend

After both are deployed:

1. Go to **Frontend** service in Render
2. Click **Environment** → **Add Environment Variable**
3. Add:
   ```
   VITE_API_URL = https://patient-engagement-backend.onrender.com
   ```
4. Click **Save** → **Redeploy** (redeploy from master)

---

## STEP 5: Test Your App

1. Open your frontend URL in browser
2. Should see your Patient Engagement app loading
3. Backend API will be at: `https://patient-engagement-backend.onrender.com/docs` (FastAPI Swagger UI)

---

## Important Notes

### Free Tier Limits (Render)
- Web services spin down after 15 min of inactivity
- First request after spin-down takes ~30 seconds
- 0.5GB RAM memory
- Limited database space

### Environment Variables in Production
- Change `JWT_SECRET_KEY` to a strong random value (32+ characters)
- For production: Consider PostgreSQL instead of SQLite
  - Render offers **free PostgreSQL**: add in Render dashboard
  - Update `DATABASE_URL` to PostgreSQL connection string

### Auto-Deploy from GitHub
- Any push to `main` branch auto-deploys
- Builds take 2-5 minutes
- Check build logs in Render dashboard if deployment fails

---

## Troubleshooting

### Backend not starting?
1. Check **Logs** in Render dashboard
2. Common issues:
   - Missing environment variables
   - Python version mismatch (use 3.11+)
   - Requirements not installed

### Frontend not loading?
1. Check **Logs** in Render dashboard
2. Open browser DevTools (F12) → Console tab
3. Look for API endpoint errors

### Database not persisting?
- SQLite on Render gets deleted when service restarts
- **Solution**: Switch to PostgreSQL (free on Render)

---

## Next Steps

1. **Add PostgreSQL database** for persistent data
2. **Set up custom domain** (free)
3. **Enable HTTPS** (automatic on Render)
4. **Monitor logs** in Render dashboard
5. **Scale up** if needed (paid plans)

---

## Useful Commands

```powershell
# Check git status
git status

# Make changes and push
git add .
git commit -m "Description of changes"
git push

# View deployment logs
# → Go to Render dashboard → select service → Logs tab
```

---

**Questions?** Check Render docs: https://render.com/docs
