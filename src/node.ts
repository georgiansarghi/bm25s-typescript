import { BM25 as BM25Core } from "./bm25.js";
import type { BM25Snapshot } from "./snapshot.js";

/** Backwards-compatible Node entry with filesystem persistence. */
export class BM25<Doc = number> extends BM25Core<Doc> {
  /** Restore a snapshot while retaining Node save/load methods. */
  static override fromSnapshot<D = number>(snapshot: BM25Snapshot<D>): BM25<D> {
    return new BM25<D>().restoreSnapshot(snapshot);
  }

  /** Save using the existing multi-file format (not an atomic operation). */
  async save(
    saveDir: string,
    options: {
      corpus?: any[];
      /** Accepted for API compatibility; no-op. */
      showProgress?: boolean;
      /** Accepted for API compatibility; no-op. */
      leaveProgress?: boolean;
    } = {}
  ): Promise<void> {
    const snapshot = this.toSnapshot();
    const fs = await import("fs/promises");
    const path = await import("path");

    await fs.mkdir(saveDir, { recursive: true });
    await fs.writeFile(path.join(saveDir, "matrix.bin"), new Uint8Array(snapshot.matrix));
    if (snapshot.nonOccurrence) {
      await fs.writeFile(path.join(saveDir, "nonoccurrence.bin"), new Uint8Array(snapshot.nonOccurrence));
    } else {
      await fs.rm(path.join(saveDir, "nonoccurrence.bin"), { force: true });
    }
    await fs.writeFile(path.join(saveDir, "vocab.json"), JSON.stringify(snapshot.vocab));
    await fs.writeFile(path.join(saveDir, "params.json"), JSON.stringify(snapshot.params, null, 2));

    const corpus = options.corpus ?? snapshot.corpus;
    if (corpus) {
      await fs.writeFile(path.join(saveDir, "corpus.jsonl"), corpus.map(doc => JSON.stringify(doc)).join("\n"));
    } else {
      await fs.rm(path.join(saveDir, "corpus.jsonl"), { force: true });
    }
  }

  /**
   * Load the existing file format through the shared snapshot validator.
   * Required files (including an explicitly requested corpus) must be readable.
   */
  static async load<D = number>(
    saveDir: string,
    options: {
      loadCorpus?: boolean;
      /** Accepted for API compatibility; no-op. */
      showProgress?: boolean;
      /** Accepted for API compatibility; no-op. */
      leaveProgress?: boolean;
    } = {}
  ): Promise<BM25<D>> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const params = JSON.parse(await fs.readFile(path.join(saveDir, "params.json"), "utf-8"));
    const matrix = await fs.readFile(path.join(saveDir, "matrix.bin"));
    const vocab = JSON.parse(await fs.readFile(path.join(saveDir, "vocab.json"), "utf-8"));
    // Keep ignoring stale baseline files written by older versions for other methods.
    const nonOccurrence = params.method === "bm25l" || params.method === "bm25+"
      ? await fs.readFile(path.join(saveDir, "nonoccurrence.bin"))
      : undefined;
    const corpus = options.loadCorpus
      ? (await fs.readFile(path.join(saveDir, "corpus.jsonl"), "utf-8"))
          .split("\n").filter(line => line.trim()).map(line => JSON.parse(line))
      : undefined;
    return BM25.fromSnapshot<D>({ version: 1, params, vocab, matrix, nonOccurrence, corpus });
  }
}
