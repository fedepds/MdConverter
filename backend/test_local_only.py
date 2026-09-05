"""Chequeo: MarkItDown convierte sin salir a la red.

El backend recibe archivos de desconocidos, asi que MarkItDown no tiene que hacer
requests hacia afuera: ni OCR remoto, ni descargar lo que un archivo referencie.
Corre solo: python test_local_only.py

En el contenedor la prueba fuerte es sin red en absoluto:
docker run --rm --network none markitdown-web python test_local_only.py
"""

import socket
import tempfile
from pathlib import Path

# El import va primero: parchear socket antes rompe la carga de ssl.
from markitdown import MarkItDown

import openpyxl


def cortar_red():
    """Cualquier intento de conexion pasa a ser un fallo del test."""

    def boom(*args, **kwargs):
        raise AssertionError("MarkItDown intento salir a la red")

    socket.socket.connect = boom
    socket.create_connection = boom
    socket.getaddrinfo = boom


def main():
    cortar_red()
    md = MarkItDown(enable_plugins=False)

    with tempfile.TemporaryDirectory() as tmpdir:
        d = Path(tmpdir)

        (d / "a.csv").write_text("a,b\n1,2\n")
        assert "| a | b |" in md.convert_local(str(d / "a.csv")).text_content

        # Una imagen remota se cita como link, no se descarga.
        (d / "a.html").write_text('<h1>Hola</h1><img src="https://example.com/x.png">')
        html = md.convert_local(str(d / "a.html")).text_content
        assert "# Hola" in html
        assert "https://example.com/x.png" in html

        wb = openpyxl.Workbook()
        wb.active.append(["a", "b"])
        wb.active.append([1, 2])
        wb.save(d / "a.xlsx")
        assert "| 1 | 2 |" in md.convert_local(str(d / "a.xlsx")).text_content

        # Sin extension: el tipo sale de magika, cuyo modelo viene en el wheel.
        (d / "sin_extension").write_text("a,b\n1,2\n")
        assert "| a | b |" in md.convert_local(str(d / "sin_extension")).text_content

    print("ok: MarkItDown convirtio todo sin red")


if __name__ == "__main__":
    main()
