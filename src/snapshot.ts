import type { BM25Options } from "./bm25.js";
import { deserializeCSC } from "./sparse.js";

/** Binary input from a file, fetch response, or native asset loader. */
export type SnapshotBytes = ArrayBuffer | Uint8Array;

/** Versioned in-memory envelope around the existing little-endian CSC layout. */
export interface BM25Snapshot<Doc = number> {
  version: 1;
  params: Required<BM25Options> & { numDocs: number; vocabSize: number };
  /** Empty for numeric-ID-only indexes; otherwise one distinct ID per column. */
  vocab: Record<string, number>;
  matrix: SnapshotBytes;
  nonOccurrence?: SnapshotBytes;
  corpus?: Doc[];
}

function requireValid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid BM25 snapshot: ${message}`);
}

/** Version 1 uses native typed-array payloads on little-endian platforms. */
export function assertSnapshotByteOrder(): void {
  requireValid(new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, "requires a little-endian platform");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function bytes(value: SnapshotBytes): Uint8Array {
  requireValid(value instanceof ArrayBuffer || value instanceof Uint8Array, "expected binary bytes");
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

/** Internal hydration boundary: validate once, then retain owned binary storage. */
export function decodeSnapshot<Doc>(snapshot: BM25Snapshot<Doc>) {
  assertSnapshotByteOrder();
  requireValid(isObject(snapshot) && snapshot.version === 1, "unsupported version");
  const { params, vocab, corpus } = snapshot;
  requireValid(isObject(params), "missing parameters");
  const methods = ["robertson", "lucene", "atire", "bm25l", "bm25+"];
  requireValid(methods.includes(params.method) && methods.includes(params.idfMethod), "unknown scoring method");
  requireValid(Number.isFinite(params.k1) && params.k1 >= 0, "invalid k1");
  requireValid(Number.isFinite(params.b) && params.b >= 0 && params.b <= 1, "invalid b");
  requireValid(Number.isFinite(params.delta) && params.delta >= 0, "invalid delta");
  requireValid(isUint32(params.numDocs) && isUint32(params.vocabSize), "invalid dimensions");

  // Own the exact view before inspecting it, including headers. This also aligns
  // slices and avoids Node Buffer.slice(), which would retain caller storage.
  const input = new Uint8Array(bytes(snapshot.matrix));
  requireValid(input.byteLength >= 16, "truncated matrix header");
  const header = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const rows = header.getUint32(0, true), cols = header.getUint32(4, true);
  const nnz = header.getUint32(8, true), indicesLength = header.getUint32(12, true);
  requireValid(rows === params.numDocs && cols === params.vocabSize, "matrix dimensions disagree with parameters");
  requireValid(nnz === indicesLength && input.byteLength === 16 + 12 * nnz + 4 * (cols + 1), "invalid matrix length");
  const matrix = deserializeCSC(input.buffer);
  requireValid(matrix.indptr[0] === 0 && matrix.indptr[cols] === nnz, "invalid column pointer endpoints");
  for (let i = 0; i < cols; i++) {
    requireValid(matrix.indptr[i] <= matrix.indptr[i + 1] && matrix.indptr[i + 1] <= nnz, "invalid column pointers");
  }
  for (let i = 0; i < nnz; i++) {
    requireValid(matrix.indices[i] < rows, "document ID out of range");
    requireValid(Number.isFinite(matrix.data[i]), "non-finite matrix score");
  }

  requireValid(isObject(vocab) && (Object.getPrototypeOf(vocab) === Object.prototype || Object.getPrototypeOf(vocab) === null), "invalid vocabulary");
  const entries = Object.entries(vocab);
  requireValid(entries.length === 0 || entries.length === cols, "invalid vocabulary size");
  const ids = new Set<number>();
  for (const [, id] of entries) {
    requireValid(isUint32(id) && id < cols && !ids.has(id), "invalid or duplicate vocabulary ID");
    ids.add(id);
  }

  const needsBaseline = params.method === "bm25l" || params.method === "bm25+";
  let nonOccArray: Float64Array | null = null;
  if (needsBaseline) {
    requireValid(snapshot.nonOccurrence !== undefined, "missing non-occurrence array");
    const baseline = bytes(snapshot.nonOccurrence);
    requireValid(baseline.byteLength === cols * 8, "invalid non-occurrence array length");
    nonOccArray = new Float64Array(new Uint8Array(baseline).buffer);
    for (const score of nonOccArray) {
      requireValid(Number.isFinite(score), "non-finite non-occurrence score");
    }
  } else {
    requireValid(snapshot.nonOccurrence === undefined, "unexpected non-occurrence array");
  }
  requireValid(corpus === undefined || (Array.isArray(corpus) && corpus.length === rows), "invalid corpus length");

  return { matrix, nonOccArray, vocab: new Map(entries), corpus: corpus?.slice() ?? null };
}
