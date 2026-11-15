use sea_orm::entity::prelude::*;

/// song_groups 表：歌曲文件的分组合并结果，由 Worker 同步后全量重算
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "song_groups")]
pub struct Model {
    /// 主键即外键，非自增
    #[sea_orm(primary_key, auto_increment = false)]
    pub song_id: i64,
    pub group_id: i64,
    pub is_head: bool,
    pub computed_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
