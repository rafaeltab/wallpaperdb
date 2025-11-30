import { closestMatch } from "./closest_match.ts";
import { hexToColor, oklabDistance, rgbToOklab } from "./colors.ts";
import { embed, embedColors } from "./embed.ts";
import { loadImages } from "./files.ts";
import { cosineSimilarity } from "./similarity.ts";
import { createInterface } from "readline/promises";

const images = await loadImages("/home/rafaeltab/Downloads/wallpapermadness");
const embeddings = await Promise.all(images.map((x) => embed(x.image).then((embedding) => ({ embedding: embedding, path: x.path }))));
//
//

console.log(embeddings);

const readlineInterface = createInterface({
    input: process.stdin,
    output: process.stdout
});

while (true) {
    let answer = await readlineInterface.question("What color would you like to try? enter it in the format: #FFFFFF or type 'exit':");
    answer = answer.trim();
    if (answer == "exit") {
        break;
    }
    if (answer.startsWith("#") && answer.length == 7) {
        // let's check it
        let color = hexToColor(answer);
        const colorEmbedding = embedColors(Buffer.from(Uint8Array.from([color.r, color.g, color.b, 255])));

        const closestMatches = closestMatch(colorEmbedding, embeddings)
        const top5 = closestMatches.reverse().slice(0, 5);
        for (let i = 1; i <= top5.length; i++) {
            console.log(`  ${i}. ${top5[i - 1].path}`);
        }
    }
}
readlineInterface.close();

// console.log(closestMatch(colorEmbedding, embeddings));
//
// console.log(colorEmbedding);


// const c = hexToColor("#061E43")
// const colorEmbedding = embedColors(Buffer.from(Uint8Array.from([c.r, c.g, c.b, 255])));
// colorEmbedding.print();

// console.log(oklabDistance(rgbToOklab({ r: 255, g: 255, b: 255 }), rgbToOklab({ r: 255, g: 255, b: 255 })))
// console.log(oklabDistance(rgbToOklab({ r: 255, g: 255, b: 255 }), rgbToOklab({ r: 255, g: 255, b: 0 })))
// console.log(oklabDistance(rgbToOklab({ r: 255, g: 255, b: 255 }), rgbToOklab({ r: 0, g: 0, b: 0 })))
