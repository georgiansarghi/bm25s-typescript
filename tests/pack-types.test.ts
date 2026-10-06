/**
 * Packs the package as npm would publish it, installs the tarball into a
 * throwaway consumer project, and typechecks an import under each module
 * resolution mode a TypeScript user might have (nodenext, node16, bundler).
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const env = { ...process.env, PATH: `${join(root, "node_modules/.bin")}:${process.env.PATH}` };

const consumer = `import { BM25, tokenize, type RetrievalResults } from "bm25s";

const corpus = ["a cat is a feline", "a dog is a canine"];
const retriever = new BM25();
retriever.index(tokenize(corpus, { stopwords: "en" }));
const results: RetrievalResults<string> = retriever.retrieve(tokenize(["cat"], { stopwords: "en" }), { corpus, k: 1 });
console.log(results.documents[0][0]);

import { BM25 as CoreBM25, type BM25Snapshot } from "bm25s/core";
const portable = new CoreBM25<string>();
portable.index(tokenize(corpus), { corpus });
const snapshot: BM25Snapshot<string> = portable.toSnapshot();
const restored: CoreBM25<string> = CoreBM25.fromSnapshot(snapshot);
const doc: string = restored.retrieve([["cat"]]).documents[0][0];
const nodeRestored: BM25<string> = BM25.fromSnapshot(snapshot);
void nodeRestored.save("restored");
// @ts-expect-error portable entry has no filesystem API
portable.save("not-supported");
`;

function run(cmd: string[], cwd: string) {
  const proc = Bun.spawnSync(cmd, { cwd, env });
  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

describe("published types", () => {
  it("typecheck in a consumer under nodenext, node16 and bundler", () => {
    // Inside the repo, so the consumer's own dependencies (none) and tsc resolve.
    const tmp = mkdtempSync(join(root, ".pack-types-"));
    try {
      expect(run(["npm", "run", "build"], root).code).toBe(0);
      const pack = run(["npm", "pack", "--pack-destination", tmp], root);
      expect(pack.code).toBe(0);
      const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"))!;
      const pkgDir = join(tmp, "node_modules", "bm25s");
      mkdirSync(pkgDir, { recursive: true });
      expect(run(["tar", "-xzf", join(tmp, tgz), "-C", pkgDir, "--strip-components=1"], tmp).code).toBe(0);

      writeFileSync(join(tmp, "package.json"), JSON.stringify({ type: "module" }));
      writeFileSync(join(tmp, "index.ts"), consumer);
      for (const [module, resolution] of [["nodenext", "nodenext"], ["node16", "node16"], ["esnext", "bundler"]]) {
        const tsc = run(
          [join(root, "node_modules/.bin/tsc"), "--noEmit", "--strict", "--target", "es2022",
            "--module", module, "--moduleResolution", resolution, "--types", "node", "index.ts"],
          tmp,
        );
        expect(`${resolution}: ${tsc.out}`).toBe(`${resolution}: `);
      }
      // Core declarations must also work without ambient Node types.
      writeFileSync(join(tmp, "portable.ts"), `import { BM25, tokenize } from "bm25s/core";
const index = new BM25();
index.index(tokenize(["cat", "dog"]));
const id: number = BM25.fromSnapshot(index.toSnapshot()).retrieve([["dog"]]).documents[0][0];`);
      writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", types: [], lib: ["es2022"] },
        files: ["portable.ts"],
      }));
      const portable = run([join(root, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], tmp);
      expect(portable.code).toBe(0);
      expect(portable.out).toBe("");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
