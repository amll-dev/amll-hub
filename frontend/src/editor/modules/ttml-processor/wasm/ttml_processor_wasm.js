/* @ts-self-types="./ttml_processor_wasm.d.ts" */
import * as wasm from './ttml_processor_wasm_bg.wasm';
import { __wbg_set_wasm } from './ttml_processor_wasm_bg.js';

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
  amllToTtml,
  amllToTtmlResult,
  generateTtml,
  main_js,
  parseTtml,
  ttmlResultToAmll,
  ttmlToAmll,
} from './ttml_processor_wasm_bg.js';
