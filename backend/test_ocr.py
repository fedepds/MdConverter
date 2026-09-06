"""Chequeo: el OCR local lee texto y no sale a la red.

Corre solo: ENABLE_OCR=1 python test_ocr.py
En el contenedor, la version dura:
docker run --rm --network none -e ENABLE_OCR=1 markitdown-web python test_ocr.py
"""

import socket
import tempfile
from pathlib import Path

# Los imports van primero: parchear socket antes rompe la carga de ssl.
from PIL import Image, ImageDraw, ImageFont

import main
import ocr

FRASE = "Hola mundo cancion"


def cortar_red():
    """Cualquier intento de conexion pasa a ser un fallo del test."""

    def boom(*args, **kwargs):
        raise AssertionError("el OCR intento salir a la red")

    socket.socket.connect = boom
    socket.create_connection = boom
    socket.getaddrinfo = boom


def escribir_imagen(path: Path):
    img = Image.new("RGB", (900, 200), "white")
    ImageDraw.Draw(img).text((40, 60), FRASE, fill="black", font=ImageFont.load_default(size=64))
    img.save(path)
    return img


def pdf_con_texto(path: Path):
    """Un PDF minimo con texto de verdad, para probar que ese no pasa por OCR."""
    cuerpo = b"BT /F1 24 Tf 72 700 Td (Factura digital 99) Tj ET"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(cuerpo) + cuerpo + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    pos = []
    for i, o in enumerate(objs, 1):
        pos.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for x in pos:
        out += b"%010d 00000 n \n" % x
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    path.write_bytes(out)


def revisar():
    cortar_red()

    with tempfile.TemporaryDirectory() as tmpdir:
        d = Path(tmpdir)

        img = escribir_imagen(d / "a.png")
        leido = ocr.imagen(str(d / "a.png")).lower()
        assert "hola" in leido and "mundo" in leido, f"la imagen dio: {leido!r}"

        img.save(d / "a.pdf", "PDF")
        pdf = ocr.pdf(str(d / "a.pdf"))
        assert "## Pagina 1" in pdf, f"falta el encabezado: {pdf!r}"
        assert "hola" in pdf.lower(), f"el pdf dio: {pdf!r}"

        # El ruteo: un PDF escaneado cae en el OCR...
        escaneado = main.convertir(str(d / "a.pdf"), ".pdf")
        assert "hola" in escaneado.lower(), f"el escaneo no llego al OCR: {escaneado!r}"

        # ...y uno que ya trae texto no, que sale peor y cuesta CPU.
        pdf_con_texto(d / "b.pdf")
        digital = main.convertir(str(d / "b.pdf"), ".pdf")
        assert "Factura digital 99" in digital, f"el pdf con texto dio: {digital!r}"
        assert "## Pagina" not in digital, "un PDF con texto no tiene que pasar por OCR"

    print("ok: el OCR leyo la imagen y el PDF escaneado, sin red; el PDF con texto lo esquivo")


if __name__ == "__main__":
    revisar()
