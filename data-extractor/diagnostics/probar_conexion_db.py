# diagnostics/probar_conexion_db.py
"""Verifica que la conexión a PostgreSQL funcione."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import psycopg2
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

try:
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )
    cur = conn.cursor()
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;")
    tablas = [row[0] for row in cur.fetchall()]
    print(f"✓ Conectado a {DB_NAME}")
    print(f"  Tablas: {', '.join(tablas)}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"✗ Error: {e}")