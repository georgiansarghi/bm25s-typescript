import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { BM25 as NodeBM25 } from "bm25s";
import { BM25, tokenize } from "bm25s/core";

const corpus = ["__proto__ cat cat", "dog", "cat dog", "bird sings"];
const query = [[], ["cat", "cat"], ["dog"], ["__proto__"], ["unknown"]];
function indexed(Class = BM25, method = "lucene") {
  const index = new Class({ method });
  index.index(tokenize(corpus, { stopwords: false }), { corpus });
  return index;
}
function results(index) { return index.retrieve(query, { k: corpus.length }); }
function shifted(value) {
  const data = new Uint8Array(value);
  const padded = Buffer.alloc(data.length + 10, 255);
  padded.set(data, 3);
  return padded.subarray(3, 3 + data.length); // Unaligned, non-zero byteOffset.
}
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "bm25s-snapshot-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

for (const method of ["robertson", "lucene", "atire", "bm25l", "bm25+"]) {
  test(`${method}: portable and Node snapshots preserve exact scores and corpus`, async (t) => {
    const original = indexed(BM25, method);
    const snapshot = original.toSnapshot();
    const restored = BM25.fromSnapshot(snapshot);
    assert.deepEqual(results(restored), results(original));
    assert.equal(restored.getMethod(), method);
    assert.equal(typeof restored.save, "undefined");
    const node = NodeBM25.fromSnapshot(snapshot);
    assert.ok(node instanceof NodeBM25);
    assert.deepEqual(results(node), results(original));
    const dir = await directory(t);
    await node.save(dir);
    const loaded = await NodeBM25.load(dir, { loadCorpus: true });
    assert.deepEqual(results(loaded), results(original));
    assert.deepEqual(results(BM25.fromSnapshot(loaded.toSnapshot())), results(original));
    // Asset/file byte views must respect their offsets, lengths and alignment.
    snapshot.matrix = shifted(snapshot.matrix);
    if (snapshot.nonOccurrence) snapshot.nonOccurrence = shifted(snapshot.nonOccurrence);
    assert.deepEqual(results(BM25.fromSnapshot(snapshot)), results(original));
  });
}

test("snapshot export and hydration own structural data, without deep-cloning documents", () => {
  const original = indexed(BM25, "bm25+");
  const expected = results(original);
  const snapshot = original.toSnapshot();
  const restored = BM25.fromSnapshot(snapshot);
  new Uint8Array(snapshot.matrix).fill(0);
  new Uint8Array(snapshot.nonOccurrence).fill(0);
  snapshot.vocab.cat = 0;
  snapshot.params.numDocs = 99;
  snapshot.corpus.length = 0;
  assert.deepEqual(results(original), expected);
  assert.deepEqual(results(restored), expected);
  assert.throws(() => new BM25().toSnapshot(), /Index not built/);
});

test("custom scoring parameters survive hydration and subsequent indexing", () => {
  const original = new BM25({ method: "bm25l", idfMethod: "atire", k1: 0.7, b: 0.2, delta: 1.2 });
  original.index(tokenize(corpus));
  const restored = BM25.fromSnapshot(original.toSnapshot());
  assert.deepEqual(restored.toSnapshot().params, original.toSnapshot().params);
  assert.deepEqual(results(restored), results(original));
  const replacement = tokenize(["dog dog", "cat bird"]);
  original.index(replacement);
  restored.index(replacement);
  assert.deepEqual(restored.retrieve(query, { k: 2 }), original.retrieve(query, { k: 2 }));
});

test("numeric-ID-only and empty indexes can be hydrated", () => {
  const numeric = new BM25();
  numeric.index([[0], [2], []]); // Sparse IDs and no string vocabulary.
  const restored = BM25.fromSnapshot(numeric.toSnapshot());
  assert.deepEqual(restored.retrieve([[2]], { k: 3 }), numeric.retrieve([[2]], { k: 3 }));
  const empty = new BM25();
  empty.index({ ids: [], vocab: new Map() });
  assert.equal(BM25.fromSnapshot(empty.toSnapshot()).getNumDocs(), 0);
});

// Deliberately malformed JS/decoded-JSON input must fail at hydration, not query time.
test("rejects non-object snapshots", () => {
  for (const value of [null, undefined, 1, [], "snapshot"]) {
    assert.throws(() => BM25.fromSnapshot(value), /Invalid BM25 snapshot/);
  }
});

const invalid = [
  ["unknown version", s => { s.version = 2; }],
  ["missing parameters", s => { delete s.params; }],
  ["unknown method", s => { s.params.method = "typo"; }],
  ["unknown IDF method", s => { s.params.idfMethod = "typo"; }],
  ["non-finite k1", s => { s.params.k1 = NaN; }],
  ["invalid b", s => { s.params.b = 2; }],
  ["invalid delta", s => { s.params.delta = -1; }],
  ["invalid dimensions", s => { s.params.numDocs = -1; }],
  ["inconsistent dimensions", s => { s.params.numDocs++; }],
  ["wrong binary type", s => { s.matrix = []; }],
  ["short header", s => { s.matrix = new ArrayBuffer(15); }],
  ["truncated payload", s => { s.matrix = s.matrix.slice(0, -1); }],
  ["trailing payload", s => { const b = new Uint8Array(s.matrix.byteLength + 1); b.set(new Uint8Array(s.matrix)); s.matrix = b; }],
  ["mismatched lengths", s => { new DataView(s.matrix).setUint32(12, 0, true); }],
  ["huge declared columns", s => { new DataView(s.matrix).setUint32(4, 0xffffffff, true); s.params.vocabSize = 0xffffffff; }],
  ["invalid first pointer", s => { const v = new DataView(s.matrix); v.setUint32(16 + 12 * v.getUint32(8, true), 1, true); }],
  ["invalid last pointer", s => { new DataView(s.matrix).setUint32(s.matrix.byteLength - 4, 0, true); }],
  ["nonmonotonic pointers", s => { const v = new DataView(s.matrix); const p = 16 + 12 * v.getUint32(8, true); v.setUint32(p + 4, 2, true); v.setUint32(p + 8, 1, true); }],
  ["out-of-range document", s => { const v = new DataView(s.matrix); v.setUint32(16 + 8 * v.getUint32(8, true), 999, true); }],
  ["non-finite score", s => { new DataView(s.matrix).setFloat64(16, Infinity, true); }],
  ["missing vocabulary", s => { delete s.vocab; }],
  ["non-dictionary vocabulary", s => { s.vocab = new Map(); }],
  ["truncated vocabulary", s => { delete s.vocab.cat; }],
  ["fractional vocabulary ID", s => { s.vocab.cat = 0.5; }],
  ["out-of-range vocabulary ID", s => { s.vocab.cat = s.params.vocabSize; }],
  ["duplicate vocabulary IDs", s => { s.vocab.cat = s.vocab.dog; }],
  ["invalid corpus", s => { s.corpus = "not an array"; }],
  ["short corpus", s => { s.corpus.pop(); }],
  ["missing required baseline", s => { delete s.nonOccurrence; }],
  ["short baseline", s => { s.nonOccurrence = new ArrayBuffer(0); }],
  ["non-finite baseline", s => { new Float64Array(s.nonOccurrence)[0] = NaN; }],
  ["unexpected baseline", s => { s.params.method = "lucene"; }],
];
for (const [name, mutate] of invalid) {
  test(`rejects ${name}`, () => {
    const snapshot = indexed(BM25, "bm25+").toSnapshot();
    mutate(snapshot);
    assert.throws(() => BM25.fromSnapshot(snapshot), /Invalid BM25 snapshot/);
    assert.throws(() => NodeBM25.fromSnapshot(snapshot), /Invalid BM25 snapshot/);
  });
}

test("Node load applies the same validation to existing disk files", async (t) => {
  const dir = await directory(t);
  await indexed(NodeBM25).save(dir);
  const matrix = await readFile(join(dir, "matrix.bin"));
  matrix.writeDoubleLE(NaN, 16);
  await writeFile(join(dir, "matrix.bin"), matrix);
  await assert.rejects(NodeBM25.load(dir), /non-finite matrix score/);
});

test("both exported entries work via CommonJS", () => {
  const require = createRequire(import.meta.url);
  for (const name of ["bm25s", "bm25s/core"]) {
    const { BM25: Class } = require(name);
    const original = indexed(Class);
    assert.deepEqual(results(Class.fromSnapshot(original.toSnapshot())), results(original));
    assert.equal(typeof original.save, name === "bm25s" ? "function" : "undefined");
  }
});

test("published core bundles for a browser and runs without Node or DOM globals", async () => {
  const bundle = await build({
    stdin: { contents: 'export { BM25, tokenize } from "bm25s/core";', resolveDir: process.cwd() },
    bundle: true, platform: "browser", format: "iife", globalName: "SearchCore", write: false, metafile: true,
  });
  assert.deepEqual(Object.values(bundle.metafile.outputs).flatMap(o => o.imports), []);
  assert.ok(Object.keys(bundle.metafile.inputs).every(p => !p.includes("node.js") && !p.includes("index.js")));
  const value = runInNewContext(bundle.outputFiles[0].text + `
    const index = new SearchCore.BM25();
    index.index(SearchCore.tokenize(["cat", "dog"]));
    SearchCore.BM25.fromSnapshot(index.toSnapshot()).retrieve([["dog"]], { k: 1 }).documents[0][0];
  `);
  assert.equal(value, 1);
});
