// Recuento del Markdown que devolvió el backend: es lo que la zona de salida
// contabiliza. Va aparte de convert.js sólo para poder testearlo con node.

export function mdStats(text) {
  const src = text ?? "";
  const lineas = src === "" ? [] : src.split("\n");
  const niveles = [0, 0, 0, 0, 0, 0];
  let tablas = 0;
  let enCerca = false;

  for (const linea of lineas) {
    if (/^\s{0,3}(```|~~~)/.test(linea)) {
      enCerca = !enCerca;
      continue;
    }
    if (enCerca) continue;

    const h = /^ {0,3}(#{1,6})\s/.exec(linea);
    if (h) niveles[h[1].length - 1]++;

    // Fila separadora de tabla GFM (|---|:--:|): una por tabla.
    if (/^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/.test(linea)) tablas++;
  }

  // El `[^!]` deja afuera las imágenes: ![alt](src) no es un enlace.
  const enlaces = (src.match(/(^|[^!])\[[^\]]*\]\(/g) || []).length;

  return {
    lines: lineas.length,
    levels: niveles,
    headings: niveles.reduce((a, b) => a + b, 0),
    tables: tablas,
    links: enlaces,
  };
}
