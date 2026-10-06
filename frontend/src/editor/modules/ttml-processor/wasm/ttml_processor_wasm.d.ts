/* tslint:disable */
/* eslint-disable */

/**
 * 便捷方法，将 AMLL 格式的歌词和元数据生成为 TTML 字符串
 *
 * 会对文本进行规范化，例如清理空格、移除背景人声括号等
 */
export function amllToTtml(amll_val: any, options_val: any, config_val: any): any;

/**
 * 工具方法，将 AMLL 格式的歌词和元数据转换为 TTMLResult 结构
 *
 * 会对文本进行规范化，例如清理空格、移除背景人声括号等
 */
export function amllToTtmlResult(amll_val: any, options_val: any): any;

/**
 * 将解析后的 TTML 结构体生成为 TTML 字符串
 */
export function generateTtml(ttml_result_val: any, config_val: any): any;

export function main_js(): void;

/**
 * 解析 TTML 字符串为 TTMLResult
 */
export function parseTtml(ttml_content: string): any;

/**
 * 工具方法，将本解析器复杂的数据结构降级为 AMLL 所使用的较简单的数据结构
 */
export function ttmlResultToAmll(ttml_result_val: any, options_val: any): any;

/**
 * 便捷方法，将 TTML 字符串转换并降级为 AMLL 所使用的较简单的结构
 */
export function ttmlToAmll(ttml_content: string, options_val: any): any;
