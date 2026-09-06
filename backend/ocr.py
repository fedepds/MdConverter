"""OCR local con RapidOCR. Los modelos vienen dentro del wheel: no sale a la red.

Detras del flag ENABLE_OCR, apagado por defecto: suma ~150 MB a la imagen y CPU
por request. El motor (onnxruntime) y el rasterizador de PDF (pypdfium2) ya
estaban instalados, los arrastra MarkItDown.
"""

import os
from functools import lru_cache

ENABLE_OCR = os.getenv("ENABLE_OCR", "0") == "1"
OCR_THREADS = int(os.getenv("OCR_THREADS", "2"))
MAX_OCR_PAGES = int(os.getenv("MAX_OCR_PAGES", "20"))
OCR_DPI = int(os.getenv("OCR_DPI", "200"))

EXTENSIONES_IMAGEN = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


@lru_cache(maxsize=1)
def _motor():
    """Una sola instancia: cargar los modelos onnx cuesta segundos."""
    from rapidocr import RapidOCR

    return RapidOCR(
        params={
            # Por defecto usa todos los cores y una request se come la maquina.
            "EngineConfig.onnxruntime.intra_op_num_threads": OCR_THREADS,
            "Global.log_level": "error",
        }
    )


def _leer(img) -> str:
    salida = _motor()(img)
    return "\n".join(salida.txts) if salida.txts else ""


def imagen(path: str) -> str:
    return _leer(path)


def pdf(path: str) -> str:
    import pypdfium2  # ya instalado: lo trae pdfplumber

    doc = pypdfium2.PdfDocument(path)
    try:
        paginas = []
        for n, pagina in enumerate(doc):
            # Sin tope, un PDF largo a 200 dpi se lleva puesta la memoria:
            # cada pagina son ~8 MB de RGB.
            if n >= MAX_OCR_PAGES:
                paginas.append(f"_(OCR cortado en {MAX_OCR_PAGES} paginas)_")
                break
            # to_pil() y no to_numpy(): RapidOCR asume BGR en un ndarray crudo,
            # y convierte de RGB solo cuando le entra un PIL.Image.
            texto = _leer(pagina.render(scale=OCR_DPI / 72).to_pil())
            paginas.append(f"## Pagina {n + 1}\n\n{texto}")
        return "\n\n".join(paginas)
    finally:
        doc.close()
