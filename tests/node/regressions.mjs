// Exercise the built public entry under Node, independently of the Bun suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BM25, tokenize } from "../../dist/index.js";

function index(method = "lucene", corpus = ["cat", "dog"]) {
  const bm25 = new BM25({ method });
  bm25.index(tokenize(corpus, { stopwords: false }));
  return bm25;
}

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "bm25s-regression-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function retrieve(bm25) {
  return bm25.retrieve([["dog"], ["cat"], ["unknown"]], { k: 2 });
}

test("empty queries do not determine the token type of later queries", () => {
  const bm25 = index();
  const queries = [[], ["dog"], [], ["cat"], []];
  const batch = bm25.retrieve(queries, { k: 2 });
  queries.forEach((query, i) => {
    const single = bm25.retrieve([query], { k: 2 });
    assert.deepEqual(batch.documents[i], single.documents[0]);
    assert.deepEqual(batch.scores[i], single.scores[0]);
  });
  assert.equal(batch.documents[1][0], 1);
  assert.ok(batch.scores[1][0] > 0);
});

test("empty-first numeric queries and all-empty batches still work", () => {
  const bm25 = new BM25();
  bm25.index([[0], [1]]);
  const batch = bm25.retrieve([[], [1], []], { k: 2 });
  assert.equal(batch.documents[1][0], 1);
  assert.ok(batch.scores[1][0] > 0);
  assert.deepEqual(Array.from(batch.scores[0]), [0, 0]);
  assert.equal(bm25.retrieve([[], []]).documents.length, 2);
});

for (const method of ["lucene", "bm25l", "bm25+"]) {
  test(`${method} scores and stored corpus survive save/load`, async (t) => {
    const dir = await directory(t);
    const bm25 = index(method);
    await bm25.save(dir, { corpus: ["cat label", "dog label"] });
    const loaded = await BM25.load(dir);
    assert.deepEqual(retrieve(loaded), retrieve(bm25));
    const withCorpus = await BM25.load(dir, { loadCorpus: true });
    assert.equal(retrieve(withCorpus).documents[0][0], "dog label");
  });
}

test("saving over an index removes obsolete baseline and corpus files only", async (t) => {
  const dir = await directory(t);
  await index("bm25+").save(dir, { corpus: ["old cat", "old dog"] });
  await writeFile(join(dir, "unrelated.txt"), "keep me");
  const bm25 = index();
  await bm25.save(dir);
  assert.deepEqual(retrieve(await BM25.load(dir)), retrieve(bm25));
  for (const file of ["nonoccurrence.bin", "corpus.jsonl"]) {
    await assert.rejects(readFile(join(dir, file)), { code: "ENOENT" });
  }
  assert.equal(await readFile(join(dir, "unrelated.txt"), "utf8"), "keep me");
  // A later save can supply both optional files again.
  const plus = index("bm25+");
  await plus.save(dir, { corpus: ["new cat", "new dog"] });
  assert.deepEqual(retrieve(await BM25.load(dir)), retrieve(plus));
  assert.equal(retrieve(await BM25.load(dir, { loadCorpus: true })).documents[0][0], "new dog");
});

test("Lucene ignores a stale baseline left by an older writer", async (t) => {
  const dir = await directory(t);
  const bm25 = index();
  await bm25.save(dir);
  await writeFile(join(dir, "nonoccurrence.bin"), new Uint8Array(new Float64Array([10, 20]).buffer));
  assert.deepEqual(retrieve(await BM25.load(dir)), retrieve(bm25));
});

test("reserved object-property names roundtrip in the vocabulary", async (t) => {
  const dir = await directory(t);
  const terms = ["__proto__", "constructor", "tostring"];
  const bm25 = index("lucene", terms);
  await bm25.save(dir);
  const vocab = JSON.parse(await readFile(join(dir, "vocab.json"), "utf8"));
  assert.ok(Object.hasOwn(vocab, "__proto__"));
  const loaded = await BM25.load(dir);
  for (const term of terms) {
    const expected = bm25.retrieve([[term]], { k: 3 });
    assert.ok(expected.scores[0][0] > 0);
    assert.deepEqual(loaded.retrieve([[term]], { k: 3 }), expected);
  }
});

for (const method of ["bm25l", "bm25+"]) {
  test(`${method} requires a complete non-occurrence array`, async (t) => {
    const dir = await directory(t);
    await index(method).save(dir);
    await rm(join(dir, "nonoccurrence.bin"));
    await assert.rejects(BM25.load(dir), { code: "ENOENT" });
    await writeFile(join(dir, "nonoccurrence.bin"), new Uint8Array(8));
    await assert.rejects(BM25.load(dir), /non-occurrence.*length/i);
  });
}

test("a corpus is optional unless explicitly requested; errors are not swallowed", async (t) => {
  const dir = await directory(t);
  const bm25 = index();
  await bm25.save(dir);
  assert.deepEqual(retrieve(await BM25.load(dir)), retrieve(bm25));
  await assert.rejects(BM25.load(dir, { loadCorpus: true }), { code: "ENOENT" });
  await writeFile(join(dir, "corpus.jsonl"), "not json");
  await assert.rejects(BM25.load(dir, { loadCorpus: true }), SyntaxError);
  await writeFile(join(dir, "corpus.jsonl"), '"only one row"\n');
  await assert.rejects(BM25.load(dir, { loadCorpus: true }), /corpus.*length/i);
});

for (const file of ["params.json", "matrix.bin", "vocab.json"]) {
  test(`missing ${file} rejects loading`, async (t) => {
    const dir = await directory(t);
    await index().save(dir);
    await rm(join(dir, file));
    await assert.rejects(BM25.load(dir), { code: "ENOENT" });
  });
}
