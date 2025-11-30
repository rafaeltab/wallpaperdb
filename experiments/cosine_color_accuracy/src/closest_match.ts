import { cosineSimilarity } from "./similarity.ts";
import { Vector } from "./vector.ts";

export function closestMatch(colorEmbedding: Vector, embeddings: { embedding: Vector, path: string }[]) {
    const similarities = embeddings.map((x) => ({ path: x.path, similarity: cosineSimilarity(colorEmbedding.vals, x.embedding.vals), embedding: x.embedding }));
    similarities.sort((a, b) => a.similarity - b.similarity);
    return similarities;
}
