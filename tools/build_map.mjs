// Turns the Swiss boundaries (swiss-maps TopoJSON, ch-combined.json) into SVG
// paths for the map in /v2, at build time, so that the page needs no map
// library and asks no third party when it is opened.
//
//   node tools/build_map.mjs <ch-combined.json> <out.json>
//
// Output: {"viewBox": "0 0 W H", "cantons": {id: d}, "municipalities": {bfs: d},
// "lakes": [d, …], "source": "…"}. Projection: longitude scaled by cos(46.8°),
// enough for an overview of Switzerland; coordinates rounded to 0.1.
import fs from "node:fs";

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error("usage: node tools/build_map.mjs <ch-combined.json> <out.json>");
  process.exit(2);
}
const topo = JSON.parse(fs.readFileSync(inFile, "utf8"));
const { scale, translate } = topo.transform;

// decode the quantised, delta-encoded arcs to longitude/latitude
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});

const K = Math.cos((46.8 * Math.PI) / 180);
const W = 1000;
const lon0 = 5.95, lon1 = 10.5, lat0 = 45.8, lat1 = 47.81;
const S = W / ((lon1 - lon0) * K);
const H = Math.round((lat1 - lat0) * S);
const px = ([lon, lat]) => [((lon - lon0) * K * S).toFixed(1), ((lat1 - lat) * S).toFixed(1)];

const ring = (refs) => {
  const pts = [];
  for (const r of refs) {
    const a = r < 0 ? arcs[~r].slice().reverse() : arcs[r];
    pts.push(...(pts.length ? a.slice(1) : a));
  }
  return "M" + pts.map((p) => px(p).join(",")).join("L") + "Z";
};
const path = (g) => {
  if (g.type === "Polygon") return g.arcs.map(ring).join("");
  if (g.type === "MultiPolygon") return g.arcs.map((poly) => poly.map(ring).join("")).join("");
  return "";
};
const byId = (name) => Object.fromEntries(topo.objects[name].geometries.filter((g) => g.id !== undefined).map((g) => [String(g.id), path(g)]));

const out = {
  viewBox: `0 0 ${W} ${H}`,
  source: "swiss-maps 4.7.0 (interactivethings), Grundlage swisstopo",
  cantons: byId("cantons"),
  municipalities: byId("municipalities"),
  lakes: topo.objects.lakes.geometries.map(path),
};
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`${outFile}: ${Object.keys(out.cantons).length} cantons, ${Object.keys(out.municipalities).length} municipalities, ${out.lakes.length} lakes, ${fs.statSync(outFile).size} bytes`);
