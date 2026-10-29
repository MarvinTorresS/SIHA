# diagnostics/buscar_generales_exhaustivo.py
"""
Buscar TODOS los cursos de Estudios Generales en Campus Coto.
Barre números de curso del 100 al 499.
"""

import sys, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from extractors.banner_connector import BannerSession

# Período a diagnosticar, por argumento (ya no hay uno hardcodeado).
if len(sys.argv) != 2:
    sys.exit("Uso: python <script> <periodo>  (ej. 202620)")
TERM = sys.argv[1]

SUBJECTS_GENERALES = ["EGF", "EGC", "EGS", "EGA"]
RANGO_NUMEROS = range(100, 500)  # Cubre 1XX, 2XX, 3XX, 4XX

resultados = []
total_buscados = 0
total_encontrados = 0

for subject in SUBJECTS_GENERALES:
    print(f"\n{'='*60}")
    print(f"Subject: {subject}")
    print(f"{'='*60}")
    
    encontrados_subject = 0
    
    for num in RANGO_NUMEROS:
        codigo = f"{subject}{num}"
        total_buscados += 1
        
        # Crear sesión limpia para cada búsqueda
        session = BannerSession(TERM)
        try:
            session.login()
        except Exception as e:
            print(f"  ⚠ Error login: {e}")
            session.close()
            continue
        
        try:
            secciones = session.search(codigo)
            
            if secciones:
                primer = secciones[0]
                codigo_resp = f"{primer.get('subject','')}{primer.get('courseNumber','')}"
                
                if codigo_resp == codigo:
                    encontrados_subject += 1
                    total_encontrados += 1
                    
                    coto = [s for s in secciones if "Campus Coto" in (s.get("campusDescription") or "")]
                    
                    if coto:
                        for s in coto:
                            crn = s.get("courseReferenceNumber", "")
                            titulo = s.get("courseTitle", "")
                            creditos = s.get("creditHourLow") or s.get("creditHourHigh") or 0
                            print(f"  ✓ {codigo}: {titulo} | CRN={crn} | {creditos} cr.")
                            resultados.append({
                                "curso": codigo,
                                "nrc": crn,
                                "titulo": titulo,
                                "creditos": creditos,
                                "campus": s.get("campusDescription", ""),
                            })
                    else:
                        # Curso existe pero no en Coto
                        pass
        except Exception as e:
            pass
        finally:
            session.close()
        
        # Mostrar progreso cada 50 búsquedas
        if total_buscados % 200 == 0:
            print(f"  [progreso: {total_buscados} búsquedas, {total_encontrados} cursos encontrados, {len(resultados)} en Coto]")

print(f"\n{'='*60}")
print(f"RESUMEN FINAL")
print(f"{'='*60}")
print(f"Total búsquedas: {total_buscados}")
print(f"Cursos encontrados: {total_encontrados}")
print(f"Cursos en Campus Coto: {len(resultados)}")
print()

if resultados:
    # Agrupar por curso
    from collections import Counter
    conteo = Counter(r["curso"] for r in resultados)
    print("Cursos de generales en Campus Coto:")
    for curso in sorted(conteo):
        print(f"  {curso}: {conteo[curso]} sección(es)")
    print()
    for r in resultados:
        print(f"  {r['curso']}: {r['titulo']} (CRN={r['nrc']})")

# Guardar
ruta = Path("output/raw/generales_coto_completo.json")
with open(ruta, "w", encoding="utf-8") as f:
    json.dump(resultados, f, ensure_ascii=False, indent=2)
print(f"\n✓ Guardado en {ruta}")