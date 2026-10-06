/** Portable BM25 entry: no filesystem, Node built-ins, or platform adapters. */
// Main BM25 class
export { BM25, type BM25Options, type RetrievalResults, type RetrieveOptions } from "./bm25.js";

// Tokenization
export {
  tokenize,
  Tokenizer,
  convertTokenizedToStrings,
  createSplitter,
  defaultSplitter,
  type Tokenized,
  type TokenizerOptions,
  type TokenizeOptions,
  type TokenizeCallOptions,
  type StemmerFn,
  type SplitterFn,
} from "./tokenizer.js";

// Stopwords
export {
  getStopwords,
  STOPWORDS_EN,
  STOPWORDS_EN_PLUS,
  STOPWORDS_GERMAN,
  STOPWORDS_FRENCH,
  STOPWORDS_SPANISH,
  STOPWORDS_PORTUGUESE,
  STOPWORDS_ITALIAN,
  STOPWORDS_DUTCH,
  STOPWORDS_RUSSIAN,
  STOPWORDS_SWEDISH,
  STOPWORDS_NORWEGIAN,
  STOPWORDS_CHINESE,
  STOPWORDS_TURKISH,
  STOPWORDS_KOREAN,
  STOPWORDS_DANISH,
  STOPWORDS_MAP,
  type StopwordsLanguage,
} from "./stopwords.js";

// Scoring utilities (for advanced users)
export {
  type BM25Method,
  scoreTfcRobertson,
  scoreTfcLucene,
  scoreTfcAtire,
  scoreTfcBm25l,
  scoreTfcBm25plus,
  scoreIdfRobertson,
  scoreIdfLucene,
  scoreIdfAtire,
  scoreIdfBm25l,
  scoreIdfBm25plus,
  getTfcScorer,
  getIdfScorer,
} from "./scoring.js";

// Selection utilities
export { topK, batchTopK, argmax, argsortDesc, type TopKResult } from "./selection.js";

// Sparse matrix utilities (for advanced users)
export {
  buildCSCMatrix,
  buildCSCMatrixStable,
  getColumn,
  getColumnNnz,
  getTotalNnz,
  serializeCSC,
  deserializeCSC,
  type CSCMatrix,
} from "./sparse.js";

export type { BM25Snapshot, SnapshotBytes } from "./snapshot.js";
