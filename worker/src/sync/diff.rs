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
