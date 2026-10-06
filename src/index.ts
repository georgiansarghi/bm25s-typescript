/**
 * bm25s - Ultra-fast BM25 implementation for Bun
 * 
 * Zero-dependency, high-performance lexical search library
 * inspired by Python's bm25s library.
 * 
 * @example
 * ```typescript
 * import { BM25, tokenize } from "bm25s";
 * 
 * // Create corpus
 * const corpus = [
 *   "a cat is a feline and likes to purr",
 *   "a dog is the human's best friend and loves to play",
 *   "a bird is a beautiful animal that can fly",
 *   "a fish is a creature that lives in water and swims",
 * ];
 * 
 * // Tokenize corpus
 * const corpusTokens = tokenize(corpus);
 * 
 * // Create and index
 * const retriever = new BM25();
 * retriever.index(corpusTokens);
 * 
 * // Search
 * const query = "does the fish purr like a cat?";
 * const queryTokens = tokenize([query]);
 * const results = retriever.retrieve(queryTokens, { k: 2 });
 * 
 * console.log("Top results:", results.documents);
 * console.log("Scores:", results.scores);
 * 
 * // Save index for later
 * await retriever.save("./my-index");
 * 
 * // Load saved index
 * const loaded = await BM25.load("./my-index");
 * ```
 */

// Preserve the Node API; the explicit export overrides the portable BM25 class.
export * from "./core.js";
export { BM25 } from "./node.js";
