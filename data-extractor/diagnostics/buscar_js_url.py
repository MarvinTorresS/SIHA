# diagnostics/buscar_js_url.py
import requests
import re

# URL de la página de syllabus
url = "https://botsrb.info/syllabus/isi"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0"
}

resp = requests.get(url, headers=headers)
html = resp.text

# Buscar todos los scripts .js referenciados
patron_js = re.compile(r'(/public[^"]+\.js[^"]*)')
scripts = patron_js.findall(html)

print("Scripts .js encontrados en la página:")
for s in set(scripts):
    print(f"  {s}")

# Descargar cada script y buscar 'career_data' o 'mesh'
print("\nBuscando 'career_data' en cada script...")
for s in set(scripts):
    js_url = f"https://botsrb.info{s}"
    try:
        js_resp = requests.get(js_url, headers=headers, timeout=10)
        if js_resp.status_code == 200:
            if 'career_data' in js_resp.text or 'mesh' in js_resp.text:
                print(f"  ✅ ENCONTRADO: {js_url}")
                print(f"     Tamaño: {len(js_resp.text)} chars")
                # Mostrar contexto
                idx = js_resp.text.find('career_data')
                if idx > 0:
                    print(f"     Contexto: ...{js_resp.text[max(0,idx-50):idx+100]}...")
            else:
                print(f"  ❌ No contiene career_data: {s}")
    except Exception as e:
        print(f"  ⚠ Error: {s} → {e}")