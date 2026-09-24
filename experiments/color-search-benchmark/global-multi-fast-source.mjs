// Same exact membership-atom score and params as MULTI_SCRIPT; one reusable source.
export const FAST_MULTI_SCRIPT = `
int cells = (int)params.cells;
int full = cells - 1;
List bits = params.bits;
List demands = params.demands;
int bitCount = bits.size();
int bit0 = (int)bits.get(0);
int bit1 = bitCount > 1 ? (int)bits.get(1) : 0;
int bit2 = bitCount > 2 ? (int)bits.get(2) : 0;
int bit3 = bitCount > 3 ? (int)bits.get(3) : 0;
int bit4 = bitCount > 4 ? (int)bits.get(4) : 0;
double requested = (double)params.requested;
boolean minimum = (boolean)params.minimum;
boolean bounded = (boolean)params.bounded;
double maxError = (double)params.maxError;
long total = doc['atom_total'].value;
List packed = doc['packed_atoms'];
int atomCount = packed.size();
double[] histogram = new double[cells];
for (int p = 0; p < atomCount; p++) {
  long atom = (long)packed.get(p);
  int mask = (int)(atom >>> 32);
  long count = atom & 4294967295L;
  int local = ((mask & bit0) != 0 ? 1 : 0)
            | ((mask & bit1) != 0 ? 2 : 0)
            | ((mask & bit2) != 0 ? 4 : 0)
            | ((mask & bit3) != 0 ? 8 : 0)
            | ((mask & bit4) != 0 ? 16 : 0);
  histogram[local] += count;
}
double unionAll = (total - histogram[0]) / total;
for (int bit = 1; bit < cells; bit <<= 1) {
  int stride = bit << 1;
  for (int base = 0; base < cells; base += stride) {
    int end = base + stride;
    for (int mask = base + bit; mask < end; mask++) histogram[mask] += histogram[mask - bit];
  }
}
double deficit = 0;
for (int selected = 1; selected < cells; selected++) {
  deficit = Math.max(deficit, (double)demands.get(selected) - (total - histogram[full ^ selected]) / total);
}
double error = Math.max(0, Math.min(1, deficit + (minimum ? 0 : Math.max(0, unionAll - requested))));
if (bounded && error > maxError + 0.0000000001) return 0;
return Math.max(0, Math.min(1, 1 - error));
`.trim();
