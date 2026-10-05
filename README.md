# PRIMA IT Asset Management

Starter architecture for a company IT Asset Management System.

## Stack
- Node.js + Express
- MySQL
- Bootstrap 5 + JavaScript
- Python + FastAPI

## First setup
1. Copy `.env.example` to `.env`.
2. Create the MySQL database by running `database/schema.sql`.
3. Run `npm install`.
4. Start with `npm start`.
5. Open `http://localhost:3001`.

## Python service
```powershell
cd python-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The core system is intentionally started with the login, left navigation, database foundation, and dashboard summary. The next modules can be added without changing the overall architecture.
