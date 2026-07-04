# diagnostics/diagnostico_banner_login.py
"""
Diagnóstico rápido: inspecciona la página de login de Banner
para encontrar dónde está el x-synchronizer-token.
"""

import requests
import re

url = "https://studentssb.una.ac.cr/StudentRegistrationSsb/ssb/term/termSelection?mode=courseSearch"

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

session = requests.Session()
response = session.get(url, headers=headers, timeout=30)
html = response.text

print(f"Status: {response.status_code}")
print(f"Cookies: {dict(session.cookies)}")
print(f"\n{'='*60}")
print("HEADERS de respuesta:")
print(f"{'='*60}")
for k, v in response.headers.items():
    print(f"  {k}: {v}")

print(f"\n{'='*60}")
print("Buscando 'token' en el HTML...")
print(f"{'='*60}")

# Buscar todas las menciones de "token"
for m in re.finditer(r'[^.]*token[^.]*\.?', html, re.IGNORECASE):
    linea = m.group().strip()[:200]
    print(f"  → {linea}")

print(f"\n{'='*60}")
print("Buscando 'synchronizer' en el HTML...")
print(f"{'='*60}")
for m in re.finditer(r'[^.]*synchronizer[^.]*\.?', html, re.IGNORECASE):
    linea = m.group().strip()[:200]
    print(f"  → {linea}")

print(f"\n{'='*60}")
print("Buscando 'uniqueSession' en el HTML...")
print(f"{'='*60}")
for m in re.finditer(r'[^.]*uniqueSession[^.]*\.?', html, re.IGNORECASE):
    linea = m.group().strip()[:200]
    print(f"  → {linea}")

print(f"\n{'='*60}")
print("Primeros 2000 caracteres del HTML:")
print(f"{'='*60}")
print(html[:2000])

# Guardar HTML completo
with open("output/raw/banner_login_page.html", "w", encoding="utf-8") as f:
    f.write(html)
print(f"\n✓ HTML guardado en output/raw/banner_login_page.html")