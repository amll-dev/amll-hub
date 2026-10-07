use std::sync::Arc;

use anyhow::{Context, Result};
use lapin::{
    options::{BasicAckOptions, BasicConsumeOptions, BasicNackOptions, BasicPublishOptions,
        BasicQosOptions, ConfirmSelectOptions, ExchangeDeclareOptions, QueueBindOptions,
        QueueDeclareOptions},
    types::{AMQPValue, FieldTable},
    BasicProperties, Channel, Connection, ConnectionProperties, ExchangeKind,
};

use crate::config::{
    Config, MIGRATION_CLOSE_ROUTING, MIGRATION_DLX_EXCHANGE, MIGRATION_DLQ_ROUTING,
    MIGRATION_EXCHANGE, MIGRATION_USER_ROUTING,
};

/// 初始化 RabbitMQ 连接与队列声明
pub struct RabbitMq {
    /// 持有底层连接防止其被提前 Drop（channel 依赖该连接存活）
    #[allow(dead_code)]
    pub conn: Connection,
    pub channel: Channel,
    /// not_found 消费者使用的独立 channel（避免与主消费者共享同一 channel）
    pub nf_channel: Channel,
    /// 迁移（migration.user）消费者 channel，QoS=1
    pub mig_channel: Channel,
    /// 关闭 PR（migration.close_pr）消费者 channel，QoS=1
    pub mig_close_channel: Channel,
    /// 迁移发布 channel（开启 publisher confirm，用于投递 migration.close_pr）
    pub mig_publish_channel: Channel,
}

/// 以 publisher confirm 模式发布一条 JSON 消息
pub async fn publish_json(
    channel: &Channel,
    exchange: &str,
    routing_key: &str,
    body: &[u8],
    message_id: &str,
) -> Result<()> {
    channel
        .basic_publish(
            exchange,
            routing_key,
            BasicPublishOptions {
                mandatory: true,
                ..Default::default()
            },
            body,
            BasicProperties::default()
                .with_content_type("application/json".into())
                .with_delivery_mode(2)
                .with_message_id(message_id.into()),
        )
        .await
        .context("basic_publish")?
        .await
        .context("publish confirm")?;
    Ok(())
}

/// 通用消费循环骨架
pub async fn consume_loop<F, Fut>(
    channel: Channel,
    queue: String,
    consumer_tag: &str,
    shutdown: Arc<tokio::sync::Notify>,
    handler: F,
) -> Result<()>
where
    F: Fn(lapin::message::Delivery) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<()>>,
{
    use futures_lite::StreamExt;

    let mut consumer = channel
        .basic_consume(
            &queue,
            consumer_tag,
            BasicConsumeOptions::default(),
            FieldTable::default(),
        )
        .await
        .context("basic_consume")?;

    tracing::info!(queue = %queue, consumer_tag, "consumer started");

    let notified = shutdown.notified();
    tokio::pin!(notified);
    loop {
        tokio::select! {
            _ = &mut notified => {
                tracing::info!(queue = %queue, "shutdown signal received, stopping consumer");
                break;
            }
            msg = consumer.next() => {
                let Some(delivery) = msg else { break; };
                let delivery = match delivery {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::error!(error = %e, "consumer error");
                        break;
                    }
                };
                let tag = delivery.delivery_tag;
                match handler(delivery).await {
                    Ok(()) => {
                        let _ = channel
                            .basic_ack(tag, BasicAckOptions::default())
                            .await;
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "task failed after retries, sending to DLQ");
                        // nack(requeue=false) 触发 dead-lettering 到 DLQ，避免毒消息无限重投
                        let _ = channel
                            .basic_nack(
                                tag,
                                BasicNackOptions {
                                    multiple: false,
                                    requeue: false,
                                },
                            )
                            .await;
                    }
                }
            }
        }
    }

    Ok(())
}

pub async fn init_rabbitmq(cfg: &Config) -> Result<RabbitMq> {
    let conn = Connection::connect(&cfg.rabbitmq.url, ConnectionProperties::default())
        .await
        .context("connect rabbitmq")?;

    let channel = conn.create_channel().await.context("create channel")?;

    // DLX exchange + queue
    let dlx = "ttml.sync.dlx";
    channel
        .exchange_declare(
            dlx,
            ExchangeKind::Direct,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare dlx exchange")?;

    channel
        .queue_declare(
            &cfg.rabbitmq.dlq,
            QueueDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare dlq")?;
    channel
        .queue_bind(
            &cfg.rabbitmq.dlq,
            dlx,
            "sync.failed",
            QueueBindOptions::default(),
            FieldTable::default(),
        )
        .await
        .context("bind dlq")?;

    // 主 exchange + queue（绑定 DLX）
    let ex = "ttml.sync";
    channel
        .exchange_declare(
            ex,
            ExchangeKind::Direct,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare exchange")?;

    let mut args = FieldTable::default();
    args.insert(
        "x-dead-letter-exchange".into(),
        AMQPValue::LongString("ttml.sync.dlx".into()),
    );
    args.insert(
        "x-dead-letter-routing-key".into(),
        AMQPValue::LongString("sync.failed".into()),
    );
    channel
        .queue_declare(
            &cfg.rabbitmq.queue,
            QueueDeclareOptions {
                durable: true,
                ..Default::default()
            },
            args,
        )
        .await
        .context("declare queue")?;
    channel
        .queue_bind(
            &cfg.rabbitmq.queue,
            ex,
            "sync.request",
            QueueBindOptions::default(),
            FieldTable::default(),
        )
        .await
        .context("bind queue")?;

    channel
        .basic_qos(1, BasicQosOptions { global: false })
        .await
        .context("qos")?;

    // === not_found 解析队列（独立交换机/队列/DLQ） ===
    let nf_dlx = "ttml.not_found.dlx";
    channel
        .exchange_declare(
            nf_dlx,
            ExchangeKind::Direct,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare nf dlx exchange")?;

    channel
        .queue_declare(
            &cfg.rabbitmq.nf_dlq,
            QueueDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare nf dlq")?;
    channel
        .queue_bind(
            &cfg.rabbitmq.nf_dlq,
            nf_dlx,
            "not_found.failed",
            QueueBindOptions::default(),
            FieldTable::default(),
        )
        .await
        .context("bind nf dlq")?;

    let nf_ex = "ttml.not_found";
    channel
        .exchange_declare(
            nf_ex,
            ExchangeKind::Direct,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare nf exchange")?;

    let mut nf_args = FieldTable::default();
    nf_args.insert(
        "x-dead-letter-exchange".into(),
        AMQPValue::LongString(nf_dlx.into()),
    );
    nf_args.insert(
        "x-dead-letter-routing-key".into(),
        AMQPValue::LongString("not_found.failed".into()),
    );
    channel
        .queue_declare(
            &cfg.rabbitmq.nf_queue,
            QueueDeclareOptions {
                durable: true,
                ..Default::default()
            },
            nf_args,
        )
        .await
        .context("declare nf queue")?;
    channel
        .queue_bind(
            &cfg.rabbitmq.nf_queue,
            nf_ex,
            "not_found.parse",
            QueueBindOptions::default(),
            FieldTable::default(),
        )
        .await
        .context("bind nf queue")?;

    // 为 not_found 消费者创建独立 channel，并设置 QoS=5
    let nf_channel = conn.create_channel().await.context("create nf channel")?;
    nf_channel
        .basic_qos(5, BasicQosOptions { global: false })
        .await
        .context("nf channel qos")?;

    // === 投稿数据迁移队列（独立交换机/队列/DLQ）===
    declare_migration_topology(&channel, cfg).await?;

    // 迁移消费者使用独立 channel（QoS=1）
    let mig_channel = conn.create_channel().await.context("create migration channel")?;
    mig_channel
        .basic_qos(1, BasicQosOptions { global: false })
        .await
        .context("migration channel qos")?;

    let mig_close_channel = conn
        .create_channel()
        .await
        .context("create migration close channel")?;
    mig_close_channel
        .basic_qos(1, BasicQosOptions { global: false })
        .await
        .context("migration close channel qos")?;

    // 迁移发布 channel：开启 publisher confirm，保证 migration.close_pr 投递可靠
    let mig_publish_channel = conn
        .create_channel()
        .await
        .context("create migration publish channel")?;
    mig_publish_channel
        .confirm_select(ConfirmSelectOptions::default())
        .await
        .context("enable publisher confirm")?;

    Ok(RabbitMq {
        conn,
        channel,
        nf_channel,
        mig_channel,
        mig_close_channel,
        mig_publish_channel,
    })
}

/// 声明迁移交换机 / DLX / DLQ / 队列
async fn declare_migration_topology(channel: &Channel, cfg: &Config) -> Result<()> {
    channel
        .exchange_declare(
            MIGRATION_DLX_EXCHANGE,
            ExchangeKind::Direct,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare migration dlx exchange")?;

    for dlq in [
        &cfg.rabbitmq.migration_dlq,
        &cfg.rabbitmq.migration_close_dlq,
    ] {
        channel
            .queue_declare(
                dlq,
                QueueDeclareOptions {
                    durable: true,
                    ..Default::default()
                },
                FieldTable::default(),
            )
            .await
            .with_context(|| format!("declare migration dlq {}", dlq))?;
        channel
            .queue_bind(
                dlq,
                MIGRATION_DLX_EXCHANGE,
                MIGRATION_DLQ_ROUTING,
                QueueBindOptions::default(),
                FieldTable::default(),
            )
            .await
            .with_context(|| format!("bind migration dlq {}", dlq))?;
    }

    channel
        .exchange_declare(
            MIGRATION_EXCHANGE,
            ExchangeKind::Direct,
            ExchangeDeclareOptions {
                durable: true,
                ..Default::default()
            },
            FieldTable::default(),
        )
        .await
        .context("declare migration exchange")?;

    let mut args = FieldTable::default();
    args.insert(
        "x-dead-letter-exchange".into(),
        AMQPValue::LongString(MIGRATION_DLX_EXCHANGE.into()),
    );
    args.insert(
        "x-dead-letter-routing-key".into(),
        AMQPValue::LongString(MIGRATION_DLQ_ROUTING.into()),
    );

    for (queue, routing) in [
        (&cfg.rabbitmq.migration_queue, MIGRATION_USER_ROUTING),
        (
            &cfg.rabbitmq.migration_close_queue,
            MIGRATION_CLOSE_ROUTING,
        ),
    ] {
        channel
            .queue_declare(
                queue,
                QueueDeclareOptions {
                    durable: true,
                    ..Default::default()
                },
                args.clone(),
            )
            .await
            .with_context(|| format!("declare migration queue {}", queue))?;
        channel
            .queue_bind(
                queue,
                MIGRATION_EXCHANGE,
                routing,
                QueueBindOptions::default(),
                FieldTable::default(),
            )
            .await
            .with_context(|| format!("bind migration queue {}", queue))?;
    }

    Ok(())
}
