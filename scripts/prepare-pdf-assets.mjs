import { cp, mkdir } from 'node:fs/promises';
// Serve CJK character maps and font/decoder resources from our own domain.
// Generated dependencies stay out of Git and are copied after npm ci/install.
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  const destination = new URL(`../public/pdfjs/${directory}/`, import.meta.url);
  await mkdir(destination, { recursive: true });
  await cp(new URL(`../node_modules/pdfjs-dist/${directory}/`, import.meta.url), destination, { recursive: true });
}
console.log('PDF character maps, fonts and decoders prepared.');
