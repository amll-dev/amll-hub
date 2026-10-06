/* tslint:disable */
/**
 * ttml_processor_wasm_bg.js 的类型声明。
 * 该文件是 wasm-bindgen 生成的 JS glue，运行时由 processor.ts 手工实例化并注入。
 *
 * 注意：以下函数均返回 Rust 侧的 { success, data, error? } 结构，
 * 而不是裸值 —— 与 wasm 的 serde 序列化约定一致。
 */

/** wasm 的统一返回结构 */
export type WasmResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: { kind: string; message: string } };

export function __wbg_set_wasm(val: unknown): void;

/** 解析 TTML 字符串为 TTMLResult */
export function parseTtml(ttml_content: string): WasmResult<unknown>;

/** 将 TTMLResult 生成为 TTML 字符串 */
export function generateTtml(ttml_result_val: unknown, config_val: unknown): WasmResult<string>;

/** TTMLResult 降级为 AMLL 使用的简单结构 */
export function ttmlResultToAmll(
  ttml_result_val: unknown,
  options_val: unknown
): WasmResult<unknown>;

/** 便捷方法：TTML 字符串 → AMLL 结构 */
export function ttmlToAmll(
  ttml_content: string,
  options_val: unknown,
  config_val: unknown
): WasmResult<unknown>;

/** 便捷方法：AMLL 结构 → TTML 字符串 */
export function amllToTtml(
  amll_val: unknown,
  options_val: unknown,
  config_val: unknown
): WasmResult<string>;

/** 便捷方法：AMLL 结构 → TTMLResult */
export function amllToTtmlResult(amll_val: unknown, options_val: unknown): WasmResult<unknown>;

export function main_js(): void;
