export function cosineSimilarity(
    a: ArrayLike<number>,
    b: ArrayLike<number>
): number {
    if (a.length !== b.length) {
        throw new Error("Embedding vectors must have the same length.");
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        const ai = a[i]!;
        const bi = b[i]!;
        dot += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }

    const denom = Math.sqrt(normA) + Math.sqrt(normB);
    if (normA === 0 || normB === 0) return 0; // define similarity for zero vectors

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
