import encoded from '../fixtures/prototype/utilities.json';

// Frozen expected values are IEEE 754 float32s stored in big-endian byte order.
// Decode the retained prototype data without invoking the production encoder.
const reference = {
  ...encoded,
  cases: encoded.cases.map(({ utilities, ...entry }) => {
    const bytes = Buffer.from(utilities, 'base64');
    if (bytes.length !== encoded.utilityKeys.length * 4) {
      throw new Error(`Invalid frozen utility count for ${entry.name}`);
    }
    return {
      ...entry,
      utilities: Object.fromEntries(
        encoded.utilityKeys.map((key, index) => [key, bytes.readFloatBE(index * 4)])
      ),
    };
  }),
};

export default reference;
