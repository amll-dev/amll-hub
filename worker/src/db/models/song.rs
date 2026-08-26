use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "songs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(column_type = "JsonBinary")]
    pub music_name: Json,
    #[sea_orm(column_type = "JsonBinary")]
    pub album: Json,
    pub isrc: Option<String>,
    #[sea_orm(unique)]
    pub raw_lyric_file: String,
    pub minio_path: String,
    pub lyric_text: Option<String>,
    pub ttml_author_github: Option<String>,
    pub ttml_author_github_login: Option<String>,
    pub word_count: i32,
    pub line_count: i32,
    pub is_deleted: bool,
    pub deleted_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
    /// 提交 UNIX 毫秒时间戳（从 raw_lyric_file 文件名解析）
    pub commit_timestamp: Option<i64>,
    /// 人类可读的提交时间
    pub commit_time: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::song_artist::Entity")]
    SongArtist,
    #[sea_orm(has_many = "super::platform_mapping::Entity")]
    PlatformMapping,
}

impl Related<super::song_artist::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::SongArtist.def()
    }
}

impl Related<super::platform_mapping::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::PlatformMapping.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
