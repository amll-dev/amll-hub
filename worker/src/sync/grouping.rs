use std::collections::HashMap;

/// 参与分组的歌曲元数据（由 repository 一次性批量加载）
#[derive(Debug, Clone)]
pub struct GroupInput {
    pub song_id: i64,
    pub music_name: Vec<String>,
    /// 已排序，保证 name_key 稳定
    pub artists: Vec<String>,
    /// (platform, platform_id)
    pub platform_mappings: Vec<(String, String)>,
    pub commit_timestamp: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupAssignment {
    pub song_id: i64,
    pub group_id: i64,
    pub is_head: bool,
}

/// 计算全量分组。输入会被按 song_id 排序，输出同样按 song_id 升序。
pub fn compute_groups(mut songs: Vec<GroupInput>) -> Vec<GroupAssignment> {
    if songs.is_empty() {
        return Vec::new();
    }
    songs.sort_by_key(|s| s.song_id);
    let n = songs.len();

    let mut parent: Vec<usize> = (0..n).collect();

    fn find(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]]; // 路径减半
            x = parent[x];
        }
        x
    }
    fn union(parent: &mut [usize], a: usize, b: usize) {
        let (ra, rb) = (find(parent, a), find(parent, b));
        if ra == rb {
            return;
        }
        // 小索引用作根 => 根恒为组内最小 song_id（songs 已升序）
        if ra < rb {
            parent[rb] = ra;
        } else {
            parent[ra] = rb;
        }
    }

    let mut id_owner: HashMap<(String, String), usize> = HashMap::new();
    let mut name_owner: HashMap<String, usize> = HashMap::new();

    for (i, s) in songs.iter().enumerate() {
        let mut has_id = false;
        for (platform, pid) in &s.platform_mappings {
            if pid.is_empty() {
                continue;
            }
            has_id = true;
            let key = (platform.clone(), pid.clone());
            match id_owner.get(&key) {
                Some(&owner) => union(&mut parent, i, owner),
                None => {
                    id_owner.insert(key, i);
                }
            }
        }
        // 没有任何平台 ID 的文件，按「歌名 + 歌手」兜底归组
        if !has_id {
            let key = name_key(s);
            match name_owner.get(&key) {
                Some(&owner) => union(&mut parent, i, owner),
                None => {
                    name_owner.insert(key, i);
                }
            }
        }
    }

    // 按根聚合
    let mut buckets: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        buckets.entry(root).or_default().push(i);
    }

    let mut out = Vec::with_capacity(n);
    for members in buckets.into_values() {
        let group_id = members.iter().map(|&i| songs[i].song_id).min().unwrap();

        // head：commit_timestamp 最大；NULL 视为最旧；同分取 song_id 最大（自增 => 更新）
        let head = *members
            .iter()
            .max_by_key(|&&i| {
                (
                    songs[i].commit_timestamp.unwrap_or(i64::MIN),
                    songs[i].song_id,
                )
            })
            .unwrap();

        for i in members {
            out.push(GroupAssignment {
                song_id: songs[i].song_id,
                group_id,
                is_head: i == head,
            });
        }
    }
    out.sort_by_key(|a| a.song_id);
    out
}

fn name_key(s: &GroupInput) -> String {
    let name = s
        .music_name
        .first()
        .map(|n| n.trim().to_lowercase())
        .unwrap_or_default();

    if name.is_empty() {
        // 无歌名 => 独立成组，键必须唯一
        return format!("id:{}", s.song_id);
    }

    let mut artists = s.artists.clone();
    artists.sort(); // ★ 必须排序：song_artists 的 JOIN 顺序不稳定
    format!("name:{}|{}", name, artists.join("/").to_lowercase())
}

/// 对比新旧分组，返回需要写库 + 刷索引的行
pub fn diff_groups(
    old: &HashMap<i64, (i64, bool)>,
    new: &[GroupAssignment],
) -> Vec<GroupAssignment> {
    new.iter()
        .filter(|g| old.get(&g.song_id) != Some(&(g.group_id, g.is_head)))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(
        id: i64,
        name: &str,
        artists: &[&str],
        pms: &[(&str, &str)],
        ts: Option<i64>,
    ) -> GroupInput {
        GroupInput {
            song_id: id,
            music_name: vec![name.to_string()],
            artists: artists.iter().map(|s| s.to_string()).collect(),
            platform_mappings: pms
                .iter()
                .map(|(p, i)| (p.to_string(), i.to_string()))
                .collect(),
            commit_timestamp: ts,
        }
    }

    #[test]
    fn merges_by_shared_platform_id() {
        let out = compute_groups(vec![
            song(1, "晴天", &["周杰伦"], &[("ncm", "111")], Some(100)),
            song(
                2,
                "晴天",
                &["周杰伦"],
                &[("ncm", "111"), ("qq", "222")],
                Some(200),
            ),
        ]);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|a| a.group_id == 1));
        assert_eq!(out.iter().filter(|a| a.is_head).count(), 1);
        assert!(out.iter().find(|a| a.is_head).unwrap().song_id == 2);
    }

    #[test]
    fn transitive_closure() {
        // A(ncm:1) + B(ncm:1,qq:2) + C(qq:2) => 同一组
        let out = compute_groups(vec![
            song(1, "a", &[], &[("ncm", "1")], None),
            song(2, "b", &[], &[("ncm", "1"), ("qq", "2")], None),
            song(3, "c", &[], &[("qq", "2")], None),
        ]);
        assert_eq!(
            out.iter().map(|a| a.group_id).collect::<Vec<_>>(),
            vec![1, 1, 1]
        );
    }

    #[test]
    fn name_fallback_is_stable_regardless_of_artist_order() {
        let a = compute_groups(vec![
            song(1, "Song", &["X", "Y"], &[], Some(1)),
            song(2, "Song", &["Y", "X"], &[], Some(2)),
        ]);
        assert_eq!(a[0].group_id, a[1].group_id, "歌手顺序不同也应同组");

        let b = compute_groups(vec![
            song(1, "Song", &["X", "Y"], &[], Some(1)),
            song(2, "Song", &["Z"], &[], Some(2)),
        ]);
        assert_ne!(b[0].group_id, b[1].group_id, "歌手不同不应同组");
    }

    #[test]
    fn head_falls_back_to_song_id_without_timestamp() {
        let out = compute_groups(vec![
            song(7, "a", &[], &[("ncm", "9")], None),
            song(3, "b", &[], &[("ncm", "9")], None),
        ]);
        assert_eq!(out.iter().find(|a| a.is_head).unwrap().song_id, 7);
    }
}
