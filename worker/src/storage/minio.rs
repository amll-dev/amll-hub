use anyhow::{Context, Result};
use aws_sdk_s3::Client as S3Client;

use crate::config::MinioConfig;

/// 根据配置构建 S3/MinIO 客户端（path-style 访问）
pub fn build_s3_client(minio: &MinioConfig) -> Result<S3Client> {
    let cfg = aws_sdk_s3::Config::builder()
        .behavior_version(aws_config::BehaviorVersion::latest())
        .region(aws_sdk_s3::config::Region::new(minio.region().to_string()))
        .endpoint_url(minio.endpoint_url())
        .credentials_provider(aws_sdk_s3::config::Credentials::new(
            &minio.access_key,
            &minio.secret_key,
            None,
            None,
            "static",
        ))
        .force_path_style(true)
        .build();
    Ok(S3Client::from_conf(cfg))
}

/// 确保 bucket 存在
pub async fn ensure_bucket(s3: &S3Client, bucket: &str) -> Result<()> {
    let exists = s3.head_bucket().bucket(bucket).send().await.is_ok();
    if !exists {
        s3.create_bucket()
            .bucket(bucket)
            .send()
            .await
            .with_context(|| format!("create bucket {}", bucket))?;
        tracing::info!(bucket, "created minio bucket");
    }
    Ok(())
}
