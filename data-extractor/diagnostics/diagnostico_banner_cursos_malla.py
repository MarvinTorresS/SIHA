# diagnostics/buscar_generales.py
"""Ver si GEN, MAT, LIX tienen secciones en Coto."""

import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from extractors.banner_connector import BannerSession

# Período a diagnosticar, por argumento (ya no hay uno hardcodeado).
if len(sys.argv) != 2:
    sys.exit("Uso: python <script> <periodo>  (ej. 202620)")
TERM = sys.argv[1]

# Cargar malla para ver qué códigos GEN, MAT, LIX necesita ISI
with open("output/normalized/syllabi_normalized.json", encoding="utf-8") as f:
    malla = json.load(f)

codigos_isi = set(c["codigo"] for c in malla if c["carrera_sigla"] == "isi")
print(f"Total códigos ISI: {len(codigos_isi)}")

# Agrupar por subject
from collections import defaultdict
por_subject = defaultdict(list)
for codigo in codigos_isi:
    import re
    match = re.match(r'([A-Z]+)', codigo)
    prefijo = match.group(1) if match else codigo
    por_subject[prefijo].append(codigo)

print("\nDistribución por subject:")
for subj, cods in sorted(por_subject.items()):
    print(f"  {subj}: {len(cods)} → {cods}")

# Buscar un ejemplo de cada subject no-EIF
print("\n" + "="*50)
print("Buscando materias generales en Banner...")
print("="*50)

for subject in ["GEN", "MAT", "LIX"]:
    codigos = por_subject.get(subject, [])
    if not codigos:
        continue
    
    # Probar con el primer código
    codigo = codigos[0]
    print(f"\nBuscando {codigo} (subject={subject})...")
    
    sess = BannerSession(TERM)
    sess.login()
    secciones = sess.search(codigo)
    
    if not secciones:
        print(f"  ✗ Sin resultados")
    else:
        primer = secciones[0]
        codigo_resp = f"{primer.get('subject','')}{primer.get('courseNumber','')}"
        print(f"  Respuesta: {codigo_resp} - {primer.get('courseTitle','')}")
        print(f"  Total secciones: {len(secciones)}")
        
        coto = [s for s in secciones if "Campus Coto" in (s.get("campusDescription") or "")]
        if coto:
            print(f"  ✓ {len(coto)} en Campus Coto")
            for s in coto:
                print(f"    CRN={s.get('courseReferenceNumber')} | {s.get('scheduleTypeDescription')}")
        else:
            campus_vistos = {s.get("campusDescription") for s in secciones[:5]}
            print(f"  ✗ 0 en Coto. Campus disponibles: {campus_vistos}")
    
    sess.close()