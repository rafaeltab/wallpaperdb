import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export async function loadImages(dir: string) {
    const files = await readdir(dir)
    const imagePaths = files.filter((x) => x.endsWith(".png") || x.endsWith(".jpg")).map((x) => join(dir, x));
    const images = await Promise.all(imagePaths.map((imagePath) => readFile(imagePath).then((data) => sharp(data)).then((imgData) => ({ image: imgData, path: imagePath }))));
    return images;
}
