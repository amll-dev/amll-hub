use pinyin::ToPinyin;
use ttml_processor::model::TTMLResult;

/// TTML 解析结果
#[derive(Debug, Default)]
pub struct ParsedTtml {
    /// 提取的纯歌词文本
    pub lyric_text: String,
    /// 行数
    pub line_count: i32,
    /// 字数
    pub word_count: i32,
}

/// 解析 TTML 字节流。
/// 与 /validate 端点共用 ttml_processor 的解析逻辑，保证校验与入库统计口径一致
pub fn parse_ttml(content: &[u8]) -> anyhow::Result<ParsedTtml> {
    let text = String::from_utf8_lossy(content);
    let parsed = ttml_processor::parse_ttml(&text)?;

    let lyric_text = extract_lyric_text(&parsed);
    let line_count = parsed
        .lines
        .iter()
        .filter(|l| !l.text.trim().is_empty())
        .count() as i32;
    let word_count = count_meaningful_chars(&lyric_text);

    Ok(ParsedTtml {
        lyric_text,
        line_count,
        word_count,
    })
}

/// 拼接所有非空歌词行（LyricLine.text 由解析器填充为整行文本）
fn extract_lyric_text(result: &TTMLResult) -> String {
    let mut out = String::new();
    for line in &result.lines {
        let text = line.text.trim();
        if !text.is_empty() {
            out.push_str(text);
            out.push('\n');
        }
    }
    out
}

/// 计算有效字符数（去除空白、标点）
fn count_meaningful_chars(s: &str) -> i32 {
    s.chars()
        .filter(|c| !c.is_whitespace() && !is_punctuation(*c))
        .count() as i32
}

fn is_punctuation(c: char) -> bool {
    matches!(
        c,
        '，' | '。'
            | '！'
            | '？'
            | '、'
            | '；'
            | '：'
            | '"'
            | '\''
            | '’'
            | '（'
            | '）'
            | '《'
            | '》'
            | '【'
            | '】'
            | ','
            | '.'
            | '!'
            | '?'
            | ';'
            | ':'
            | '('
            | ')'
            | '<'
            | '>'
            | '['
            | ']'
            | '-'
            | '—'
            | '~'
    )
}

/// 提取文本中所有中文字符的拼音
pub fn extract_pinyin_string(text: &str) -> String {
    let mut out = String::new();
    let mut need_space = false;
    for c in text.chars() {
        if let Some(p) = c.to_pinyin() {
            if need_space {
                out.push(' ');
            }
            out.push_str(p.plain());
            need_space = true;
        }
    }
    out
}

/// 提取多字段拼音
pub fn extract_pinyin_list(text: &str) -> Vec<String> {
    let s = extract_pinyin_string(text);
    if s.is_empty() {
        return Vec::new();
    }

    let mut result: Vec<String> = s.split_whitespace().map(|s| s.to_string()).collect();
    // 额外添加连写版本
    let joined: String = result.join("");
    if !joined.is_empty() && !result.contains(&joined) {
        result.push(joined);
    }
    result
}

/// 提取拼音首字母（每个中文字符取其拼音首字母，连写为一个词）
/// 如 "中国人会飞" -> "zgrhf"，用于首字母搜索
pub fn extract_pinyin_initials(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if let Some(p) = c.to_pinyin()
            && let Some(first) = p.plain().chars().next()
        {
            out.push(first);
        }
    }
    out
}

/// 提取多个名称的拼音首字母列表（逐名称提取，跳过无中文的名称）
pub fn extract_pinyin_initials_list(texts: &[String]) -> Vec<String> {
    texts
        .iter()
        .map(|t| extract_pinyin_initials(t))
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lines_and_counts() {
        let ttml = concat!(
            r#"<tt xmlns="http://www.w3.org/ns/ttml"><body><div>"#,
            r#"<p begin="00:01.000" end="00:02.000">"#,
            r#"<span begin="00:01.000" end="00:01.500">晴天</span>"#,
            r#"<span begin="00:01.500" end="00:02.000">雨天</span></p>"#,
            r#"<p begin="00:02.000" end="00:03.000"><span begin="00:02.000" end="00:03.000">你好</span></p>"#,
            "</div></body></tt>"
        );
        let parsed = parse_ttml(ttml.as_bytes()).unwrap();
        assert_eq!(parsed.line_count, 2);
        assert_eq!(parsed.word_count, 6);
        assert_eq!(parsed.lyric_text, "晴天雨天\n你好\n");
    }

    #[test]
    fn skips_blank_lines() {
        let ttml = concat!(
            r#"<tt xmlns="http://www.w3.org/ns/ttml"><body><div>"#,
            r#"<p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:02.000"> </span></p>"#,
            r#"<p begin="00:02.000" end="00:03.000"><span begin="00:02.000" end="00:03.000">歌词</span></p>"#,
            "</div></body></tt>"
        );
        let parsed = parse_ttml(ttml.as_bytes()).unwrap();
        assert_eq!(parsed.line_count, 1);
        assert_eq!(parsed.lyric_text, "歌词\n");
    }

    #[test]
    fn rejects_malformed_xml() {
        assert!(parse_ttml(b"<tt><body><p>unclosed").is_err());
    }

    #[test]
    fn extracts_pinyin() {
        assert_eq!(extract_pinyin_string("普阿山"), "pu a shan");
        assert_eq!(extract_pinyin_string("宜"), "yi");
        // 英文字符忽略
        assert_eq!(extract_pinyin_string("Hello 世界"), "shi jie");
    }

    #[test]
    fn extracts_pinyin_list_with_joined() {
        // 逐字拼音 + 连写版本
        assert_eq!(extract_pinyin_list("晴天"), vec!["qing", "tian", "qingtian"]);
        assert_eq!(extract_pinyin_list("普阿山"), vec!["pu", "a", "shan", "puashan"]);
        // 单字情况：逐字和连写相同，不重复
        assert_eq!(extract_pinyin_list("宜"), vec!["yi"]);
        // 空字符串
        assert_eq!(extract_pinyin_list(""), Vec::<String>::new());
    }

    #[test]
    fn extracts_pinyin_initials() {
        // 每个汉字取拼音首字母连写
        assert_eq!(extract_pinyin_initials("中国人会飞"), "zgrhf");
        assert_eq!(extract_pinyin_initials("晴天"), "qt");
        // 英文字符忽略
        assert_eq!(extract_pinyin_initials("Hello 世界"), "sj");
        // 空字符串
        assert_eq!(extract_pinyin_initials(""), "");
    }

    #[test]
    fn extracts_pinyin_initials_list_per_name() {
        // 逐名称提取，跳过无中文的名称
        assert_eq!(
            extract_pinyin_initials_list(&["中国人会飞".to_string(), "Sunny Day".to_string()]),
            vec!["zgrhf"]
        );
        assert_eq!(
            extract_pinyin_initials_list(&["晴天".to_string(), "雨天".to_string()]),
            vec!["qt", "yt"]
        );
    }
}
