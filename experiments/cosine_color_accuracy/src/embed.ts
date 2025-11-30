import sharp from "sharp";
import { Vector } from "./vector.ts";
import { rgbToOklab } from "./colors.ts";

export async function embed(img: sharp.Sharp): Promise<Vector> {
    const { data, info } = await img
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const c = info.channels; // should be 4 (RGBA)

    if (c != 4) throw Error("Expected 4 channels!!!");

    console.log(data[0]);

    return embedColors(data);
}

// const nums = 44;
// const baseNumbers = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, ...new Array(nums - 11).fill(0)]
//
// function shuffle(nums: number[]): number[] {
//     const arr = nums.slice(); // copy to avoid mutating input
//     for (let i = arr.length - 1; i > 0; i--) {
//         const j = Math.floor(Math.random() * (i + 1)); // 0 <= j <= i
//         [arr[i], arr[j]] = [arr[j], arr[i]];
//     }
//     return arr;
// }
//
// const base = [
//     Vector.fromNumbers(shuffle(baseNumbers)),
//     Vector.fromNumbers(shuffle(baseNumbers)),
//     Vector.fromNumbers(shuffle(baseNumbers)),
//     Vector.fromNumbers(shuffle(baseNumbers)),
// ]


// function genBases(n: number): [Vector, Vector, Vector] {
//     const arrR: number[] = [];
//     const arrG: number[] = [];
//     const arrB: number[] = [];
//
//     for (let r = 0; r < n; r++) {
//         for (let g = 0; g < n; g++) {
//             for (let b = 0; b < n; b++) {
//                 arrR.push(r / (n-1));
//                 arrG.push(g / (n-1));
//                 arrB.push(b / (n-1));
//             }
//         }
//     }
//
//     return [
//         Vector.fromNumbers(arrR),
//         Vector.fromNumbers(arrG),
//         Vector.fromNumbers(arrB),
//     ]
// }
//
// const base = genBases(8);
// console.log(base);

const colorPalette = [
    { r: 211, g: 0, b: 141 },
    { r: 83, g: 84, b: 117 },
    { r: 26, g: 185, b: 213 },
    { r: 255, g: 115, b: 169 },
    { r: 253, g: 151, b: 2 },
    { r: 0, g: 0, b: 172 },
    { r: 149, g: 174, b: 179 },
    { r: 225, g: 0, b: 63 },
    { r: 137, g: 153, b: 115 },
    { r: 166, g: 149, b: 212 },
    { r: 255, g: 0, b: 232 },
    { r: 219, g: 68, b: 194 },
    { r: 87, g: 81, b: 180 },
    { r: 0, g: 166, b: 0 },
    { r: 164, g: 157, b: 0 },
    { r: 156, g: 0, b: 161 },
    { r: 235, g: 84, b: 114 },
    { r: 93, g: 0, b: 97 },
    { r: 0, g: 0, b: 0 },
    { r: 186, g: 29, b: 0 },
    { r: 128, g: 51, b: 198 },
    { r: 44, g: 0, b: 38 },
    { r: 0, g: 97, b: 1 },
    { r: 192, g: 214, b: 255 },
    { r: 0, g: 76, b: 137 },
    { r: 44, g: 170, b: 113 },
    { r: 147, g: 0, b: 105 },
    { r: 215, g: 179, b: 196 },
    { r: 255, g: 30, b: 150 },
    { r: 0, g: 126, b: 0 },
    { r: 152, g: 70, b: 78 },
    { r: 0, g: 35, b: 119 },
    { r: 103, g: 94, b: 255 },
    { r: 0, g: 205, b: 173 },
    { r: 123, g: 255, b: 129 },
    { r: 23, g: 105, b: 162 },
    { r: 204, g: 81, b: 9 },
    { r: 72, g: 31, b: 56 },
    { r: 0, g: 17, b: 42 },
    { r: 1, g: 135, b: 197 },
    { r: 255, g: 195, b: 255 },
    { r: 0, g: 0, b: 226 },
    { r: 173, g: 70, b: 166 },
    { r: 54, g: 135, b: 255 },
    { r: 61, g: 47, b: 0 },
    { r: 152, g: 0, b: 46 },
    { r: 255, g: 199, b: 172 },
    { r: 255, g: 231, b: 75 },
    { r: 132, g: 104, b: 120 },
    { r: 97, g: 167, b: 254 },
    { r: 235, g: 112, b: 0 },
    { r: 159, g: 209, b: 193 },
    { r: 132, g: 54, b: 0 },
    { r: 38, g: 29, b: 27 },
    { r: 36, g: 25, b: 75 },
    { r: 122, g: 122, b: 80 },
    { r: 53, g: 43, b: 153 },
    { r: 0, g: 69, b: 255 },
    { r: 141, g: 132, b: 255 },
    { r: 167, g: 21, b: 250 },
    { r: 191, g: 1, b: 202 },
    { r: 160, g: 112, b: 171 },
    { r: 59, g: 52, b: 102 },
    { r: 211, g: 47, b: 255 },
    { r: 77, g: 18, b: 229 },
    { r: 209, g: 255, b: 0 },
    { r: 200, g: 148, b: 92 },
    { r: 0, g: 80, b: 72 },
    { r: 0, g: 158, b: 165 },
    { r: 184, g: 20, b: 90 },
    { r: 113, g: 0, b: 56 },
    { r: 202, g: 255, b: 167 },
    { r: 255, g: 54, b: 0 },
    { r: 22, g: 139, b: 97 },
    { r: 0, g: 0, b: 87 },
    { r: 79, g: 62, b: 62 },
    { r: 193, g: 108, b: 251 },
    { r: 30, g: 0, b: 0 },
    { r: 95, g: 0, b: 181 },
    { r: 109, g: 140, b: 0 },
    { r: 212, g: 233, b: 211 },
    { r: 77, g: 75, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 255, g: 102, b: 228 },
    { r: 190, g: 219, b: 131 },
    { r: 155, g: 88, b: 0 },
    { r: 0, g: 42, b: 0 },
    { r: 187, g: 178, b: 255 },
    { r: 0, g: 68, b: 0 },
    { r: 5, g: 0, b: 18 },
    { r: 14, g: 238, b: 177 },
    { r: 109, g: 113, b: 203 },
    { r: 8, g: 229, b: 237 },
    { r: 116, g: 55, b: 91 },
    { r: 28, g: 255, b: 0 },
    { r: 2, g: 70, b: 193 },
    { r: 199, g: 186, b: 0 },
    { r: 153, g: 88, b: 222 },
    { r: 255, g: 155, b: 217 },
    { r: 101, g: 30, b: 1 },
    { r: 174, g: 122, b: 111 },
    { r: 31, g: 108, b: 87 },
    { r: 125, g: 141, b: 166 },
    { r: 220, g: 143, b: 255 },
    { r: 0, g: 53, b: 69 },
    { r: 129, g: 255, b: 255 },
    { r: 206, g: 142, b: 158 },
    { r: 175, g: 121, b: 0 },
    { r: 0, g: 7, b: 0 },
    { r: 143, g: 186, b: 120 },
    { r: 255, g: 135, b: 115 },
    { r: 208, g: 118, b: 197 },
    { r: 59, g: 0, b: 118 },
    { r: 0, g: 221, b: 0 },
    { r: 109, g: 88, b: 67 },
    { r: 94, g: 104, b: 1 },
    { r: 21, g: 105, b: 221 },
    { r: 73, g: 0, b: 0 },
    { r: 255, g: 193, b: 72 },
    { r: 121, g: 28, b: 255 },
    { r: 77, g: 193, b: 73 },
    { r: 161, g: 220, b: 11 },
    { r: 186, g: 85, b: 119 },
    { r: 72, g: 125, b: 136 },
    { r: 128, g: 76, b: 142 },
    { r: 209, g: 184, b: 132 },
    { r: 113, g: 37, b: 137 },
    { r: 116, g: 201, b: 255 }
].map(rgbToOklab);

export function embedColors(colors: Buffer<ArrayBufferLike>): Vector {
    const res = Vector.fromNumbers(new Array(colorPalette.length).fill(0));

    const colorMap: Record<number, Vector> = {};
    let scaler = 1/Math.sqrt(colors.length)

    for (let i = 0; i + 3 < colors.length; i += 4) {
        const [r, g, b] = [colors[i], colors[i + 1], colors[i + 2]];

        const key = r * (255 * 255) + g * 255 + b;
        if (!(key in colorMap)) {
            const lab = rgbToOklab({ r, g, b });
            colorMap[key] = Vector.fromInverseDistance(lab, colorPalette, scaler)
        }

        res.add(colorMap[key]);

        // res.addSquaredDistance(colors.length, r / 255, base[0]);
        // res.addSquaredDistance(colors.length, g / 255, base[1]);
        // res.addSquaredDistance(colors.length, b / 255, base[2]);
        // skip alpha
    }

    res.normalize();

    return res;
}
