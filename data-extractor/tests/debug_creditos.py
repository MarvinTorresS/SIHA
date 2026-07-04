# guardar como diagnostics/debug_creditos.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://botsrb.info/syllabus/isi", wait_until="networkidle")
    page.wait_for_selector('div[data-testid*="rf__node-"]', timeout=15000)
    page.wait_for_timeout(2000)
    
    # Extraer el HTML interno del primer nodo EIF200
    html_nodo = page.evaluate("""
        () => {
            const nodo = document.querySelector('div[data-id="EIF200"]');
            return nodo ? nodo.innerHTML : 'NO ENCONTRADO';
        }
    """)
    
    print("HTML interno de EIF200:")
    print(html_nodo[:2000])
    
    # Extraer TODOS los divs con sus estilos
    divs_info = page.evaluate("""
        () => {
            const nodo = document.querySelector('div[data-id="EIF200"]');
            if (!nodo) return [];
            const divs = nodo.querySelectorAll('div');
            return Array.from(divs).map(d => ({
                text: d.innerText.trim(),
                fontSize: d.style.fontSize,
                fontWeight: d.style.fontWeight,
                className: d.className
            }));
        }
    """)
    
    print("\nDivs dentro de EIF200:")
    for d in divs_info:
        print(f"  fontSize={d['fontSize']}, fontWeight={d['fontWeight']}, class='{d['className']}', text='{d['text'][:60]}'")
    
    browser.close()