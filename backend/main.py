"""API para convertir archivos a Markdown con MarkItDown.

Sin OCR ni IA: sin llm_client, sin plugins, sin Azure Document Intelligence.
"""

import asyncio
import os
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from markitdown import MarkItDown

ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm",
    ".csv", ".json", ".xml", ".zip", ".epub", ".txt", ".msg",
}

MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "25"))
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
CONVERT_TIMEOUT_SECONDS = int(os.getenv("CONVERT_TIMEOUT_SECONDS", "60"))
CHUNK_SIZE = 1024 * 1024

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "astro" / "web" / "dist"

md = MarkItDown(enable_plugins=False)
app = FastAPI(title="markitdown-web")


def safe_stem(filename: str) -> str:
    """Nombre de descarga seguro: el filename del cliente va a un header HTTP."""
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename or "").stem).strip("._")
    return stem[:100] or "converted"


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/limits")
async def limits():
    """Configuracion vigente de esta instancia.

    La UI la lee de aca para no publicar un limite que el servidor no aplica:
    si MAX_FILE_SIZE_MB cambia, la pagina cambia con el.
    """
    return {
        "max_file_size_mb": MAX_FILE_SIZE_MB,
        "convert_timeout_seconds": CONVERT_TIMEOUT_SECONDS,
        "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
    }


@app.post("/api/convert")
async def convert(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Extension no soportada: '{ext or 'sin extension'}'. "
            f"Permitidas: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        # Nombre propio, nunca el del cliente: evita path traversal.
        path = Path(tmpdir) / f"input{ext}"
        size = 0
        with path.open("wb") as out:
            # En chunks: no se confia en Content-Length, que el cliente puede falsear.
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_FILE_SIZE_BYTES:
                    raise HTTPException(413, f"El archivo supera el limite de {MAX_FILE_SIZE_MB} MB")
                out.write(chunk)

        if size == 0:
            raise HTTPException(400, "El archivo esta vacio")

        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(md.convert_local, str(path)),
                timeout=CONVERT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            raise HTTPException(504, f"La conversion supero los {CONVERT_TIMEOUT_SECONDS} s")
        except Exception as exc:
            raise HTTPException(422, f"MarkItDown no pudo convertir el archivo: {exc}")

    return Response(
        content=result.text_content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_stem(file.filename)}.md"'},
    )


# Al final: las rutas /api/* ganan sobre el static mount en "/".
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
