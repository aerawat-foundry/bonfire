// Point zxing-wasm at the local .wasm file when running under Node.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareZXingModule } from 'zxing-wasm/reader';

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
prepareZXingModule({ overrides: { wasmBinary: wasm }, fireImmediately: true });
