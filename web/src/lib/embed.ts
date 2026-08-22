import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Same base model (all-MiniLM-L6-v2, 384-dim) used to embed job_titles in the ETL
// (see etl/embed_job_titles.py), so query vectors and stored vectors are comparable.
// Runs fully locally via ONNX — no external API calls, no per-request cost.
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

declare global {
  // eslint-disable-next-line no-var
  var _embedPipeline: Promise<FeatureExtractionPipeline> | undefined;
}

function getPipeline() {
  if (!global._embedPipeline) {
    global._embedPipeline = pipeline("feature-extraction", MODEL_NAME);
  }
  return global._embedPipeline;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
