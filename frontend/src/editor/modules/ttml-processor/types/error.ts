export interface JsError {
  /**
   * 解析错误类型，可以为 `ParseError`，`IoError`，`Utf8Error`，`FromUtf8Error`
   *
   * `ParseError` 包含更详细的错误信息，包括 `byteOffset`，`lineId` 和 `tagStack` 等
   */
  kind: string;

  /**
   * 用户友好的英文错误消息
   */
  message?: string;

  /**
   * 错误发生时解析器在文件中的字节偏移量
   */
  byteOffset?: number;

  /**
   * 当前解析到的歌词行 ID（例如 "L3"），如果尚未解析到则为 None
   */
  lineId?: string;

  /**
   * 当前的 XML 标签路径栈（例如 `["tt", "body", "div", "p", "span"]`）
   */
  tagStack?: string[];

  /**
   * 正在处理的属性名
   */
  currentAttribute?: string;

  /**
   * 引发错误的具体原文字符串
   */
  offendingString?: string;
}
