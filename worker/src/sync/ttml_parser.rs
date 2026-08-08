use pinyin::ToPinyin;

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

/// 解析 TTML 字节流
pub fn parse_ttml(content: &[u8]) -> anyhow::Result<ParsedTtml> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_reader(content);

    let mut buf = Vec::new();
    let mut lyric_text = String::new();
    let mut line_count = 0i32;

    // 当前 <p> 内累计的文本
    let mut in_p = false;
    let mut in_span = false;
    let mut current_line = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name();
                let name_ref = name.as_ref();
                if name_ref == b"p" {
                    in_p = true;
                    current_line.clear();
                } else if name_ref == b"span" {
                    in_span = true;
                }
            }
            Ok(Event::Empty(e)) => {
                // <span/> 空标签忽略
                let _ = e;
            }
            Ok(Event::End(e)) => {
                let name = e.name();
                let name_ref = name.as_ref();
                if name_ref == b"p" && in_p {
                    in_p = false;
                    if !current_line.is_empty() {
                        lyric_text.push_str(&current_line);
                        lyric_text.push('\n');
                        line_count += 1;
                    }
                } else if name_ref == b"span" {
                    in_span = false;
                }
            }
            Ok(Event::Text(e)) => {
                if in_p && in_span {
                    if let Ok(text) = e.unescape() {
                        current_line.push_str(&text);
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if in_p {
                    current_line.push_str(&String::from_utf8_lossy(e.as_ref()));
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(anyhow::anyhow!("parse ttml: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    let word_count = count_meaningful_chars(&lyric_text);

    Ok(ParsedTtml {
        lyric_text,
        line_count,
        word_count,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
