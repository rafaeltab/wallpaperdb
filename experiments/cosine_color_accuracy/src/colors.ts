let paused = false;

const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

const srgb8ToLinear = (u8: number) => {
    const v = clamp(u8, 0, 255) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export type RGB = { r: number, g: number, b: number };
export type XYZ = { x: number, y: number, z: number };
export type OkLab = { L: number, a: number, b: number };
export type Lab = { L: number, a: number, b: number };

// sRGB (D65) -> XYZ (D65)
const rgbToXyz = (c: RGB) => {
    const r = srgb8ToLinear(c.r);
    const g = srgb8ToLinear(c.g);
    const b = srgb8ToLinear(c.b);

    // sRGB to XYZ matrix (D65), clamp to [0,1] domain
    const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;

    return { x, y, z };
};


export function rgbToOklab(input: RGB): OkLab {
    // 1) Normalize to 0..1
    const r = input.r / 255;
    const g = input.g / 255;
    const b = input.b / 255;

    // 2) Inverse sRGB companding
    const rl = srgb8ToLinear(r);
    const gl = srgb8ToLinear(g);
    const bl = srgb8ToLinear(b);

    // 3) Linear sRGB to LMS (via OKLab’s matrix)
    const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
    const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
    const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;

    // 4) Nonlinearity (cube roots)
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    // 5) LMS to OKLab
    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

    return { L, a, b: b2 };
}

// XYZ (D65) -> Lab (D65)
const xyzToLab = (xyz: XYZ): Lab => {
    // D65 reference white for sRGB
    const Xn = 0.95047;
    const Yn = 1.0;
    const Zn = 1.08883;

    const f = (t) => {
        const delta = 6 / 29;
        const delta3 = delta * delta * delta;
        return t > delta3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
    };

    const fx = f(xyz.x / Xn);
    const fy = f(xyz.y / Yn);
    const fz = f(xyz.z / Zn);

    const L = 116 * fy - 16;
    const a = 500 * (fx - fy);
    const b = 200 * (fy - fz);

    return { L, a, b };
};

const rgbToLab = (c) => {
    return xyzToLab(rgbToXyz(c));
};

// CIEDE2000 (ΔE00) implementation
// Reference: Sharma, W. Wu, & Dalal (2005)
const deltaE00 = (lab1: Lab, lab2: Lab) => {
    const { L: L1, a: a1, b: b1 } = lab1;
    const { L: L2, a: a2, b: b2 } = lab2;

    const avgLp = (L1 + L2) / 2;

    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const avgC = (C1 + C2) / 2;

    const G =
        0.5 *
        (1 -
            Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));

    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;

    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const avgCp = (C1p + C2p) / 2;

    const h = (x, y) => {
        if (x === 0 && y === 0) return 0;
        const ang = (Math.atan2(y, x) * 180) / Math.PI;
        return ang >= 0 ? ang : ang + 360;
    };

    const h1p = h(a1p, b1);
    const h2p = h(a2p, b2);

    const dLp = L2 - L1;
    const dCp = C2p - C1p;

    let dhp = 0;
    if (C1p * C2p === 0) {
        dhp = 0;
    } else {
        let dh = h2p - h1p;
        if (dh > 180) dh -= 360;
        if (dh < -180) dh += 360;
        dhp = dh;
    }
    const dHp =
        2 * Math.sqrt(C1p * C2p) * Math.sin(((dhp * Math.PI) / 180) / 2);

    // Weighting functions
    const avgHp = (() => {
        if (C1p * C2p === 0) return h1p + h2p;
        const sum = h1p + h2p;
        if (Math.abs(h1p - h2p) > 180) {
            return (sum + 360) / 2;
        }
        return sum / 2;
    })();

    const T =
        1 -
        0.17 * Math.cos(((avgHp - 30) * Math.PI) / 180) +
        0.24 * Math.cos(((2 * avgHp) * Math.PI) / 180) +
        0.32 * Math.cos(((3 * avgHp + 6) * Math.PI) / 180) -
        0.2 * Math.cos(((4 * avgHp - 63) * Math.PI) / 180);

    const Sl =
        1 +
        (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
    const Sc = 1 + 0.045 * avgCp;
    const Sh = 1 + 0.015 * avgCp * T;

    const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
    const Rc =
        2 *
        Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
    const Rt = -Rc * Math.sin((2 * deltaTheta * Math.PI) / 180);

    const Kl = 1;
    const Kc = 1;
    const Kh = 1;

    const termL = dLp / (Kl * Sl);
    const termC = dCp / (Kc * Sc);
    const termH = dHp / (Kh * Sh);

    const deltaE = Math.sqrt(
        termL * termL + termC * termC + termH * termH + Rt * termC * termH
    );
    return deltaE;
};

function unscaledOklabDistance(c1: OkLab, c2: OkLab) {
    const dL = c1.L - c2.L;
    const da = c1.a - c2.a;
    const db = c1.b - c2.b;
    return Math.hypot(dL, da, db);
}

const distanceBetweenWhiteAndBlack = unscaledOklabDistance(rgbToOklab({ r: 255, g: 255, b: 255 }), rgbToOklab({ r: 0, g: 0, b: 0 }));
const distanceBetweenAlmostSame = unscaledOklabDistance(rgbToOklab({ r: 128, g: 128, b: 128 }), rgbToOklab({ r: 128, g: 127, b: 128 }));
const distanceBetweenRedAndGreen = unscaledOklabDistance(rgbToOklab({ r: 255, g: 0, b: 0 }), rgbToOklab({ r: 0, g: 255, b: 0 }));

export function oklabDistance(c1: OkLab, c2: OkLab) {
    return unscaledOklabDistance(c1, c2) * (1 / distanceBetweenWhiteAndBlack);
}

console.log(distanceBetweenAlmostSame)
console.log(distanceBetweenWhiteAndBlack)
console.log(distanceBetweenRedAndGreen)

/**
 * Perceptual distance in [0,1] using CIEDE2000 (ΔE00 / 100).
 * - 0 means indistinguishable
 * - 1 is approximately the difference between black and white
 */
function perceptionDistanceUsingDeltaE(a: RGB, b: RGB) {
    const labA = rgbToLab(a);
    const labB = rgbToLab(b);
    return Math.min(1, deltaE00(labA, labB) / 100);
};

export function perceptualDistanceUsingOkLab(c1: RGB, c2: RGB) {
    const o1 = rgbToOklab(c1);
    const o2 = rgbToOklab(c2);
    return oklabDistance(o1, o2);
}

export function perceptualDistanceUsingOklabTuple(c1: RGB, c2: RGB) {
    const o1 = rgbToOklab(c1);
    const o2 = rgbToOklab(c2);
    return oklabDistance(o1, o2);
}
export function hexToColor(hex: string): RGB {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) throw new Error("Hex must be like #RRGGBB");
    const n = parseInt(m[1], 16);
    return {
        r: (n >> 16) & 0xff,
        g: (n >> 8) & 0xff,
        b: n & 0xff,
    };
};
