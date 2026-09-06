import { mdStats } from "./mdstats.js";

(() => {
  const rec = document.querySelector(".record");
  if (!rec) return;

  const f = (k) => rec.querySelector(`[data-f="${k}"]`);
  const a = (k) => rec.querySelector(`[data-a="${k}"]`);
  const input = rec.querySelector('input[type="file"]');
  const drop = rec.querySelector(".drop");

  let limites = null;
  let archivo = null;
  let salida = null; // { texto, nombre, bytes }
  let peticion = null;
  let reloj = null;

  const pesar = (n) =>
    n < 1024 ? `${n} B`
    : n < 1048576 ? `${(n / 1024).toFixed(1)} kB`
    : `${(n / 1048576).toFixed(2)} MB`;

  const extDe = (nombre) => {
    const i = nombre.lastIndexOf(".");
    return i > 0 ? nombre.slice(i).toLowerCase() : "";
  };

  const estado = (s) => { rec.dataset.state = s; };

  // El curl de la sección API tiene que apuntar a donde esté servida la página,
  // no a un host escrito a mano en el marcado.
  for (const el of document.querySelectorAll("[data-origen]")) el.textContent = location.origin;

  // La Regla del Límite: ningún número que la página no haya leído del backend.
  fetch("/api/limits")
    .then((r) => (r.ok ? r.json() : null))
    .then((l) => {
      if (!l) return;
      limites = l;
      document.documentElement.classList.toggle("ocr", l.ocr_enabled);
      f("hint").textContent =
        `o arrastralo acá · hasta ${l.max_file_size_mb} MB · ${l.allowed_extensions.join(" ")}`;
      for (const el of document.querySelectorAll("[data-lim]")) {
        const v = {
          size: `${l.max_file_size_mb} MB`,
          timeout: `${l.convert_timeout_seconds} s`,
          formats: String(l.allowed_extensions.length),
          lista: l.allowed_extensions.join(" "),
          ocr: l.ocr_enabled ? "activo" : "apagado",
          pill: l.ocr_enabled
            ? "Con OCR: un escaneo o una foto también dan texto"
            : "Se convierte en este servidor · el archivo temporal se borra siempre",
          titular: l.ocr_enabled
            ? "Convertí un documento o un escaneo a Markdown limpio"
            : "Convertí un documento a Markdown limpio",
          bajada: l.ocr_enabled
            ? "La conversión ocurre en este servidor con la librería MarkItDown de Microsoft. El OCR también: RapidOCR corre acá, con los modelos adentro de la imagen. Nada se manda a un tercero, y el archivo temporal se borra siempre."
            : "La conversión ocurre en este servidor con la librería MarkItDown de Microsoft. Nada se manda a un tercero, y el archivo temporal se borra siempre.",
          ocr_red: l.ocr_enabled
            ? "Ni la conversión ni el OCR abren conexiones. Hay dos chequeos que lo comprueban: bloquean los sockets, convierten y leen, y fallan si algo intenta salir. En el contenedor corren directamente sin red."
            : "La conversión no abre conexiones. Hay un chequeo que lo comprueba: bloquea los sockets, convierte varios formatos y falla si MarkItDown intenta salir. En el contenedor corre directamente sin red.",
          ocr_imagenes: l.ocr_enabled ? "las lee el OCR" : "no se extrae su texto",
          ocr_detalle: l.ocr_enabled
            ? "El OCR corre acá mismo, con modelos que viajan dentro de la imagen: un PDF escaneado sí da texto."
            : "El costo es real — un PDF escaneado es imagen de texto y no produce texto.",
        }[el.dataset.lim];
        if (v) el.textContent = v;
      }
    })
    .catch(() => {});

  function limpiarSalida() {
    for (const k of ["lines", "headings", "tables", "links", "bytes"]) f(k).textContent = "—";
    salida = null;
    a("download").hidden = true;
    a("retry").hidden = true;
  }

  // Cada falla tiene su propio mensaje y su propia salida.
  function fallar(mensaje, salidaTexto, reintentable) {
    clearInterval(reloj);
    limpiarSalida();
    f("err").textContent = mensaje;
    f("exit").textContent = salidaTexto;
    f("state").textContent = "falló";
    a("retry").hidden = !reintentable;
    estado("error");
  }

  function elegir(file) {
    peticion?.abort();
    clearInterval(reloj);
    limpiarSalida();
    archivo = file;

    const ext = extDe(file.name);
    f("name").textContent = file.name;
    f("ext").textContent = ext || "sin extensión";
    f("size").textContent = limites
      ? `${pesar(file.size)} de ${limites.max_file_size_mb} MB`
      : pesar(file.size);
    f("state").textContent = "sin convertir";
    // El riel mide qué fracción del límite come este archivo.
    rec.style.setProperty(
      "--carga",
      limites ? Math.min(1, file.size / (limites.max_file_size_mb * 1048576)).toFixed(3) : "1",
    );
    estado("picked");

    // Prevenible en el cliente: no hace falta subir el archivo para saberlo.
    if (file.size === 0) {
      fallar(
        "El archivo está vacío: 0 bytes.",
        "Elegí un archivo con contenido.",
        false,
      );
      return;
    }
    if (limites && !limites.allowed_extensions.includes(ext)) {
      fallar(
        `Extensión no soportada: ${ext || "el archivo no tiene extensión"}.`,
        `Formatos que sí convierte: ${limites.allowed_extensions.join(" ")}`,
        false,
      );
      return;
    }
    if (limites && file.size > limites.max_file_size_mb * 1024 * 1024) {
      fallar(
        `Pesa ${pesar(file.size)} y el límite de este servidor es ${limites.max_file_size_mb} MB.`,
        "Probá con un archivo más chico, o partilo antes de subirlo.",
        false,
      );
      return;
    }
  }

  function nombreDeCabecera(cd, porDefecto) {
    const m = /filename="?([^";]+)"?/i.exec(cd || "");
    return m ? m[1] : porDefecto;
  }

  function convertir() {
    if (!archivo) return;
    limpiarSalida();

    const cuerpo = new FormData();
    cuerpo.append("file", archivo);

    peticion = new XMLHttpRequest();
    peticion.open("POST", "/api/convert");
    peticion.responseType = "text";

    peticion.upload.addEventListener("progress", (e) => {
      estado("uploading");
      const pct = e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null;
      rec.style.setProperty("--subida", pct === null ? "1" : String(pct / 100));
      f("state").textContent = pct === null ? "subiendo" : `subiendo ${pct}%`;
    });

    // La espera es un estado de primera clase: se mide contra el timeout real.
    peticion.upload.addEventListener("load", () => {
      estado("converting");
      const desde = performance.now();
      const tope = limites?.convert_timeout_seconds;
      const pintar = () => {
        const s = Math.floor((performance.now() - desde) / 1000);
        f("state").textContent = tope ? `convirtiendo — ${s} s de ${tope} s` : `convirtiendo — ${s} s`;
      };
      pintar();
      reloj = setInterval(pintar, 1000);
    });

    peticion.addEventListener("load", () => {
      clearInterval(reloj);
      if (peticion.status === 200) {
        terminar(peticion.responseText, nombreDeCabecera(peticion.getResponseHeader("Content-Disposition"), "convertido.md"));
        return;
      }
      let detalle = "";
      try { detalle = JSON.parse(peticion.responseText).detail || ""; } catch {}

      if (peticion.status === 413) {
        fallar(
          detalle || "El archivo supera el límite de tamaño del servidor.",
          "Probá con un archivo más chico, o partilo antes de subirlo.",
          false,
        );
      } else if (peticion.status === 422) {
        fallar(
          "MarkItDown no pudo convertir este archivo.",
          limites?.ocr_enabled
            ? "Ni MarkItDown ni el OCR sacaron texto: puede estar dañado, protegido con contraseña, o ser un escaneo que el OCR no llegó a leer."
            : "Si es un PDF escaneado, son imágenes de texto: esta versión no hace OCR, así que no hay texto que extraer. Si no, puede estar dañado o protegido con contraseña.",
          true,
        );
      } else if (peticion.status === 504) {
        const t = limites?.convert_timeout_seconds;
        fallar(
          t ? `La conversión superó los ${t} s y el servidor la cortó.` : "La conversión superó el tiempo máximo y el servidor la cortó.",
          "Probá con un archivo más chico: el tiempo crece con las páginas.",
          true,
        );
      } else {
        fallar(
          detalle || `El servidor respondió ${peticion.status}.`,
          "Reintentá; si sigue igual, probá con otro archivo.",
          true,
        );
      }
    });

    peticion.addEventListener("error", () => {
      clearInterval(reloj);
      fallar(
        "No se pudo llegar al servidor.",
        "Revisá la conexión y reintentá: el archivo sigue elegido.",
        true,
      );
    });

    rec.style.setProperty("--subida", "0");
    estado("uploading");
    f("state").textContent = "subiendo";
    peticion.send(cuerpo);
  }

  // El estado llega de golpe, como un hunk que se aplica.
  function terminar(texto, nombre) {
    const s = mdStats(texto);
    const bytes = new Blob([texto]).size;
    salida = { texto, nombre, bytes };

    f("lines").textContent = String(s.lines);
    f("headings").textContent = s.headings === 0
      ? "0"
      : s.levels.map((n, i) => (n ? `h${i + 1}·${n}` : null)).filter(Boolean).join(" ");
    f("tables").textContent = String(s.tables);
    f("links").textContent = String(s.links);
    f("bytes").textContent = pesar(bytes);
    f("state").textContent = nombre;

    a("download").hidden = false;
    estado("done");
    descargar();
  }

  function descargar() {
    if (!salida) return;
    const url = URL.createObjectURL(new Blob([salida.texto], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = salida.nombre;
    link.click();
    // Revocar de una corta la descarga en archivos grandes: el navegador
    // todavía está leyendo el blob cuando esto corre en el mismo tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function descartar() {
    peticion?.abort();
    clearInterval(reloj);
    archivo = null;
    input.value = "";
    rec.style.removeProperty("--carga");
    rec.style.removeProperty("--subida");
    limpiarSalida();
    for (const k of ["name", "ext", "size"]) f(k).textContent = "—";
    f("state").textContent = "sin convertir";
    estado("empty");
  }

  input.addEventListener("change", () => {
    if (input.files?.[0]) elegir(input.files[0]);
  });

  a("convert").addEventListener("click", convertir);
  a("retry").addEventListener("click", convertir);
  a("download").addEventListener("click", descargar);
  a("reset").addEventListener("click", descartar);

  // En móvil no hay arrastrar: la zona ya es un target de toque sobre el input.
  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  }
  for (const ev of ["dragleave", "drop"]) {
    drop.addEventListener(ev, () => drop.classList.remove("dragover"));
  }
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      input.files = e.dataTransfer.files;
      elegir(file);
    }
  });
})();
