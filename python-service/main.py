from fastapi import FastAPI
import mysql.connector

app = FastAPI(title="PRIMA IT Asset Analytics")


# ============================================================
# DATABASE
# ============================================================

def get_db_connection():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="",
        database="prima_asset_management"
    )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "python-analytics"
    }


# ============================================================
# OVERVIEW
# ============================================================

@app.get("/api/analytics/overview")
def overview():

    connection = None
    cursor = None

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                COUNT(*) AS total_assets,
                COALESCE(SUM(status = 'Available'), 0) AS available,
                COALESCE(SUM(status = 'Assigned'), 0) AS assigned,
                COALESCE(SUM(status = 'For Repair'), 0) AS for_repair,
                COALESCE(SUM(status = 'Repairing'), 0) AS repairing,
                COALESCE(SUM(status = 'Broken'), 0) AS broken,
                COALESCE(SUM(status = 'Lost'), 0) AS lost,
                COALESCE(SUM(status = 'Disposed'), 0) AS disposed,
                COALESCE(SUM(status = 'Retired'), 0) AS retired,
                COALESCE(SUM(purchase_cost), 0) AS inventory_value
            FROM assets
        """)

        result = cursor.fetchone()

        return {
            "ok": True,
            "data": result
        }

    except Exception as error:

        return {
            "ok": False,
            "error": str(error)
        }

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()


# ============================================================
# ASSETS BY DEPARTMENT
# ============================================================

@app.get("/api/analytics/by-department")
def by_department():

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                COALESCE(d.name, 'Unassigned') AS department,
                COUNT(*) AS asset_count,
                COALESCE(SUM(a.purchase_cost), 0) AS total_value
            FROM assets a

            LEFT JOIN asset_assignments aa
                ON aa.asset_id = a.id
                AND aa.returned_at IS NULL

            LEFT JOIN employees e
                ON e.id = aa.employee_id

            LEFT JOIN departments d
                ON d.id = e.department_id

            GROUP BY d.id, d.name

            ORDER BY asset_count DESC
        """)

        rows = cursor.fetchall()

        return {
            "ok": True,
            "rows": rows
        }

    except Exception as error:

        return {
            "ok": False,
            "error": str(error)
        }

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()


# ============================================================
# ASSETS BY CATEGORY
# ============================================================

@app.get("/api/analytics/by-category")
def by_category():

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                COALESCE(c.name, 'Uncategorized') AS category,
                COUNT(*) AS asset_count,
                COALESCE(SUM(a.purchase_cost), 0) AS total_value
            FROM assets a

            LEFT JOIN asset_categories c
                ON c.id = a.category_id

            GROUP BY c.id, c.name

            ORDER BY asset_count DESC
        """)

        rows = cursor.fetchall()

        return {
            "ok": True,
            "rows": rows
        }

    except Exception as error:

        return {
            "ok": False,
            "error": str(error)
        }

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()


# ============================================================
# ASSETS BY LOCATION
# ============================================================

@app.get("/api/analytics/by-location")
def by_location():

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                COALESCE(l.name, 'Unassigned') AS location,
                COUNT(*) AS asset_count,
                COALESCE(SUM(a.purchase_cost), 0) AS total_value
            FROM assets a

            LEFT JOIN locations l
                ON l.id = a.location_id

            GROUP BY l.id, l.name

            ORDER BY asset_count DESC
        """)

        rows = cursor.fetchall()

        return {
            "ok": True,
            "rows": rows
        }

    except Exception as error:

        return {
            "ok": False,
            "error": str(error)
        }

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()


# ============================================================
# ASSETS BY STATUS
# ============================================================

@app.get("/api/analytics/by-status")
def by_status():

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                status,
                COUNT(*) AS asset_count,
                COALESCE(SUM(purchase_cost), 0) AS total_value
            FROM assets
            GROUP BY status
            ORDER BY asset_count DESC
        """)

        rows = cursor.fetchall()

        return {
            "ok": True,
            "rows": rows
        }

    except Exception as error:

        return {
            "ok": False,
            "error": str(error)
        }

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()



# ============================================================
# REPAIR ANALYTICS
# ============================================================

@app.get("/api/analytics/repairs")
def repairs():

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                status,
                COUNT(*) AS repair_count,
                COALESCE(SUM(total_cost), 0) AS total_cost
            FROM asset_repairs
            GROUP BY status
            ORDER BY repair_count DESC
        """)

        rows = cursor.fetchall()

        return {
            "ok": True,
            "rows": rows
        }

    except Exception as error:

        return {
            "ok": False,
            "error": str(error)
        }

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()

# ============================================================
# WARRANTY ANALYTICS
# ============================================================

@app.get("/api/analytics/warranty")
def warranty():

    connection = None
    cursor = None

    try:

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                COUNT(*) AS total_with_warranty,

                SUM(
                    warranty_expiry IS NOT NULL
                    AND warranty_expiry >= CURDATE()
                    AND warranty_expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                ) AS expiring_30_days,

                SUM(
                    warranty_expiry IS NOT NULL
                    AND warranty_expiry < CURDATE()
                ) AS expired,

                SUM(
                    warranty_expiry IS NOT NULL
                    AND warranty_expiry > DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                ) AS active

            FROM assets
            WHERE warranty_expiry IS NOT NULL
        """)

        result = cursor.fetchone()

        return {
            "ok": True,
            "data": result
        }

    except Exception as error:

        return {
            "ok": False,
            "error": str(error)
        }

    finally:

        if cursor:
            cursor.close()

        if connection:
            connection.close()