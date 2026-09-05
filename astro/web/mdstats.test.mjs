// Único check del proyecto: node astro/web/mdstats.test.mjs
import assert from "node:assert/strict";
import { mdStats } from "./src/scripts/mdstats.js";

const vacio = mdStats("");
assert.equal(vacio.lines, 0);
assert.equal(vacio.headings, 0);

const doc = [
  "# Titulo",
  "",
  "Un [enlace](http://a) y una ![imagen](b.png).",
  "",
  "## Seccion",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```",
  "# esto es codigo, no un encabezado",
  "```",
  "",
  "---",
].join("\n");

const s = mdStats(doc);
assert.equal(s.lines, 15);
assert.equal(s.headings, 2, "dos encabezados: el de la cerca no cuenta");
assert.deepEqual(s.levels, [1, 1, 0, 0, 0, 0]);
assert.equal(s.tables, 1, "una separadora = una tabla; el hr --- no cuenta");
assert.equal(s.links, 1, "la imagen no es un enlace");

console.log("mdstats ok");
