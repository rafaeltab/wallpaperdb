'use strict';

const path = require('node:path');
const sharp = require('sharp');

// A generated ISO representation fixture, not a claim of Android camera capture.
const input = path.join(__dirname, 'fixtures/gainmap/gainmap-apple-new.jpg');
const output = process.argv[2] || path.join(__dirname, 'fixtures/gainmap/gainmap-android-iso.jpg');
sharp(input).withGainMap().keepIccProfile()
  .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
  .toFile(output)
  .catch((error) => { console.error(error); process.exitCode = 1; });
