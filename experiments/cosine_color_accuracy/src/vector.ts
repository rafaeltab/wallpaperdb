import { type OkLab, oklabDistance } from "./colors.ts";

export class Vector {
    vals: Float32Array<ArrayBuffer>

    static fromNumbers(nums: Iterable<number>) {
        return new Vector(new Float32Array(nums));
    }
    private constructor(arr: Float32Array<ArrayBuffer>) {
        this.vals = arr;
    }

    addInverseDistance(color: OkLab, colors: OkLab[]) {
        if (this.vals.length != colors.length) throw Error("Can't add inverse distance when colors length doesn't match");

        for (let i = 0; i < colors.length; i++) {
            this.vals[i] += 1 - oklabDistance(color, colors[i]);
        }
    }

    addSquaredDistance(count: number, weight: number, other: Vector) {
        if (this.vals.length != other.vals.length) throw Error("Can't sum two vectors with different lengths");

        for (let i = 0; i < this.vals.length; i++) {
            this.vals[i] += numberSimilarity(other.vals[i], weight) / count;
        }
    }

    multiply(num: number) {
        for (let i = 0; i < this.vals.length; i++) {
            this.vals[i] *= num;
        }
    }

    copy(): Vector {
        return new Vector(new Float32Array(this.vals.buffer.slice()));
    }

    normalize() {
        this.vals = normalize(this.vals);
    }

    add(other: Vector) {
        if (this.vals.length != other.vals.length) throw Error("Can't sum two vectors with different lengths");
        for (let i = 0; i < this.vals.length; i++) {
            this.vals[i] += other.vals[i];
        }
    }

    static fromInverseDistance(color: OkLab, colors: OkLab[], scaler: number) {
        let vals = colors.map((x) => 1 - oklabDistance(color, x));

        let maxI = 0;
        let maxV = 0;

        for (let i = 0; i < colors.length; i++) {
            if (vals[i] > maxV) {
                maxV = vals[i];
                maxI = i;
            }
        }
        const res = new Array(colors.length).fill(0);
        res[maxI] = 1;
        const vector = Vector.fromNumbers(res)

        // const vector = Vector.fromNumbers(colors.map((x) => 1 - oklabDistance(color, x)));
        return vector;
    }

    static sumAll(vectors: Vector[]): Vector {
        const sum = vectors[0].copy();

        for (let i = 1; i < vectors.length; i++) {
            sum.add(vectors[i]);
        }

        return sum;
    }

    convertString() {
        return `[${[...this.vals].map((x) => x.toFixed(5)).join(", ")}]`;
    }
}

const fallof = 0.1;
// const fallof = 0.14;
function numberSimilarity(a: number, b: number): number {
    return 1 / (1 + Math.abs(a - b) / fallof);
}

function normalize(vec: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
        const v = vec[i];
        sumSq += v * v;
    }
    const len = Math.sqrt(sumSq);
    if (len === 0 || !isFinite(len)) {
        // Return a copy of the original to avoid mutating input; zero stays zero
        return new Float32Array(vec);
    }
    const out = new Float32Array(vec.length);
    const inv = 1 / len;
    for (let i = 0; i < vec.length; i++) {
        out[i] = vec[i] * inv;
    }
    return out;
}
