use std::collections::HashSet;

use crate::sync::index_parser::IndexEntry;

/// 差异计算结果
#[derive(Debug, Default)]
pub struct Diff {
    pub to_add: Vec<IndexEntry>,
    pub to_delete: Vec<String>,
}

/// 计算远程索引与本地已有 raw_lyric_file 的差异
pub fn compute_diff(remote: Vec<IndexEntry>, local: HashSet<String>) -> Diff {
    let mut to_add = Vec::new();
    let mut remote_seen: HashSet<String> = HashSet::new();

    for entry in remote {
        if let Some(raw) = entry.raw_file() {
            let raw = raw.to_string();
            remote_seen.insert(raw.clone());

            // 单向差集：仅取"远程有、本地没有"的文件
            if !local.contains(&raw) {
                to_add.push(entry);
            }
        }
    }

    // to_delete 预留：本地有但远程无
    let to_delete: Vec<String> = local
        .iter()
        .filter(|k| !remote_seen.contains(*k))
        .cloned()
        .collect();

    Diff { to_add, to_delete }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(raw: &str) -> IndexEntry {
        let mut e = IndexEntry::default();
        e.raw_lyric_file = Some(raw.to_string());
        e
    }

    fn local_set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn pure_add_when_remote_has_new_files() {
        let remote = vec![entry("a.ttml"), entry("b.ttml"), entry("c.ttml")];
        let local = local_set(&["c.ttml"]);
        let d = compute_diff(remote, local);
        assert_eq!(d.to_add.len(), 2);
        assert!(d
            .to_add
            .iter()
            .all(|e| e.raw_file() != Some("c.ttml")));
        assert!(d.to_delete.is_empty());
    }

    #[test]
    fn pure_delete_when_remote_removed_files() {
        let remote = vec![entry("a.ttml")];
        let local = local_set(&["a.ttml", "b.ttml"]);
        let d = compute_diff(remote, local);
        assert!(d.to_add.is_empty());
        assert_eq!(d.to_delete, vec!["b.ttml".to_string()]);
    }

    #[test]
    fn no_diff_when_remote_matches_local() {
        let remote = vec![entry("a.ttml"), entry("b.ttml")];
        let local = local_set(&["a.ttml", "b.ttml"]);
        let d = compute_diff(remote, local);
        assert!(d.to_add.is_empty());
        assert!(d.to_delete.is_empty());
    }

    #[test]
    fn empty_input_yields_empty_diff() {
        let d = compute_diff(Vec::new(), HashSet::new());
        assert!(d.to_add.is_empty());
        assert!(d.to_delete.is_empty());
    }

    #[test]
    fn entries_without_raw_file_are_ignored() {
        let mut no_raw = IndexEntry::default();
        no_raw.raw_lyric_file = None;
        let remote = vec![entry("a.ttml"), no_raw];
        let d = compute_diff(remote, HashSet::new());
        // 无 raw_file 的条目既不进入 to_add 也不影响 to_delete
        assert_eq!(d.to_add.len(), 1);
        assert!(d.to_delete.is_empty());
    }
}
