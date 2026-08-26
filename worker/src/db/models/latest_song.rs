use sea_orm::entity::prelude::*;

/// latest_songs 表：每次同步完成后记录新增歌曲快照
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "latest_songs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub sync_history_id: i64,
    pub song_id: i64,
    #[sea_orm(default_value = "")]
    pub ncm_id: String,
    #[sea_orm(default_value = "")]
    pub title: String,
    #[sea_orm(default_value = "")]
    pub artist: String,
    #[sea_orm(default_value = "")]
    pub cover_url: String,
    pub sort_order: i32,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
