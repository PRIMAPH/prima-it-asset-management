# PRIMA IT Asset Management

Versioning and release notes: see [release management](docs/releases.md).

Starter architecture for a company IT Asset Management System.

## Stack
- Node.js + Express
- MySQL
- Bootstrap 5 + JavaScript
- Python + FastAPI

## First setup
1. Copy `.env.example` to `.env`.
2. Create the MySQL database by running `database/schema.sql`.
3. Apply `migrations/005_asset_id_allocation.sql` to the selected database with asset writers stopped (also required for existing installations). See [local verification](docs/asset-id-verification.md).
4. Run `npm install`.
5. Start with `npm start`.
6. Open `http://localhost:3001`.

## Python service
```powershell
cd python-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The core system is intentionally started with the login, left navigation, database foundation, and dashboard summary. The next modules can be added without changing the overall architecture.
