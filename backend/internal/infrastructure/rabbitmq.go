package infrastructure

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	amqp "github.com/rabbitmq/amqp091-go"
	logrus "github.com/sirupsen/logrus"
)

// RabbitMQ 封装连接与通道
type RabbitMQ struct {
	mu      sync.RWMutex
	Conn    *amqp.Connection
	Channel *amqp.Channel
	Queue   amqp.Queue
	DLQ     amqp.Queue
	NFQueue amqp.Queue // 无歌词解析队列
	NFDLQ   amqp.Queue // 无歌词死信队列
	cfg     config.RabbitMQConfig
}

// 无歌词解析相关常量
const (
	NFExchange    = "ttml.not_found"
	NFRoutingKey  = "not_found.parse"
	NFDLXExchange = "ttml.not_found.dlx"
	NFDLQRouting  = "not_found.failed"
	NFQueueName   = "not_found_parse_queue"
	NFDLQName     = "not_found_parse_queue.dlq"
)

// NewRabbitMQ 初始化 RabbitMQ，声明主队列 + 死信队列
func NewRabbitMQ(cfg config.RabbitMQConfig) (*RabbitMQ, error) {
	r := &RabbitMQ{cfg: cfg}
	if err := r.connect(); err != nil {
		return nil, err
	}
	return r, nil
}

// 建立连接+通道+声明拓扑
func (r *RabbitMQ) connect() error {
	conn, err := amqp.DialConfig(r.cfg.URL, amqp.Config{
		Heartbeat: 30 * time.Second,
		Locale:    "en_US",
		Dial: func(network, addr string) (net.Conn, error) {
			return net.DialTimeout(network, addr, 10*time.Second)
		},
	})
	if err != nil {
		return fmt.Errorf("dial rabbitmq: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("open channel: %w", err)
	}

	queue, dlq, nfQueue, nfDlq, err := r.declareTopology(ch)
	if err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return err
	}

	r.mu.Lock()
	r.Conn = conn
	r.Channel = ch
	r.Queue = queue
	r.DLQ = dlq
	r.NFQueue = nfQueue
	r.NFDLQ = nfDlq
	r.mu.Unlock()
	return nil
}

// 声明所有交换机/队列/绑定
func (r *RabbitMQ) declareTopology(ch *amqp.Channel) (queue, dlq, nfQueue, nfDlq amqp.Queue, err error) {
	// 声明死信交换机与队列
	dlxName := "ttml.sync.dlx"
	if err = ch.ExchangeDeclare(
		dlxName, "direct", true, false, false, false, nil,
	); err != nil {
		err = fmt.Errorf("declare dlx exchange: %w", err)
		return
	}

	dlq, err = ch.QueueDeclare(
		r.cfg.DLQ, true, false, false, false, nil,
	)
	if err != nil {
		err = fmt.Errorf("declare dlq: %w", err)
		return
	}
	if err = ch.QueueBind(dlq.Name, "sync.failed", dlxName, false, nil); err != nil {
		err = fmt.Errorf("bind dlq: %w", err)
		return
	}

	// 声明主交换机与队列（绑定 DLX）
	exName := "ttml.sync"
	if err = ch.ExchangeDeclare(
		exName, "direct", true, false, false, false, nil,
	); err != nil {
		err = fmt.Errorf("declare exchange: %w", err)
		return
	}

	queue, err = ch.QueueDeclare(
		r.cfg.Queue, true, false, false, false,
		amqp.Table{
			"x-dead-letter-exchange":    dlxName,
			"x-dead-letter-routing-key": "sync.failed",
		},
	)
	if err != nil {
		err = fmt.Errorf("declare queue: %w", err)
		return
	}
	if err = ch.QueueBind(queue.Name, "sync.request", exName, false, nil); err != nil {
		err = fmt.Errorf("bind queue: %w", err)
		return
	}

	// QoS：串行消费
	if err = ch.Qos(1, 0, false); err != nil {
		err = fmt.Errorf("qos: %w", err)
		return
	}

	// === 无歌词解析队列（独立交换机/队列/DLQ） ===
	nfDlxName := NFDLXExchange
	if err = ch.ExchangeDeclare(
		nfDlxName, "direct", true, false, false, false, nil,
	); err != nil {
		err = fmt.Errorf("declare nf dlx exchange: %w", err)
		return
	}

	nfDlq, err = ch.QueueDeclare(
		NFDLQName, true, false, false, false, nil,
	)
	if err != nil {
		err = fmt.Errorf("declare nf dlq: %w", err)
		return
	}
	if err = ch.QueueBind(nfDlq.Name, NFDLQRouting, nfDlxName, false, nil); err != nil {
		err = fmt.Errorf("bind nf dlq: %w", err)
		return
	}

	nfExName := NFExchange
	if err = ch.ExchangeDeclare(
		nfExName, "direct", true, false, false, false, nil,
	); err != nil {
		err = fmt.Errorf("declare nf exchange: %w", err)
		return
	}

	nfQueue, err = ch.QueueDeclare(
		NFQueueName, true, false, false, false,
		amqp.Table{
			"x-dead-letter-exchange":    nfDlxName,
			"x-dead-letter-routing-key": NFDLQRouting,
		},
	)
	if err != nil {
		err = fmt.Errorf("declare nf queue: %w", err)
		return
	}
	if err = ch.QueueBind(nfQueue.Name, NFRoutingKey, nfExName, false, nil); err != nil {
		err = fmt.Errorf("bind nf queue: %w", err)
		return
	}
	return
}

// 关闭旧连接并重新建立
func (r *RabbitMQ) reconnect() error {
	r.mu.Lock()
	if r.Channel != nil {
		_ = r.Channel.Close()
	}
	if r.Conn != nil {
		_ = r.Conn.Close()
	}
	r.Channel = nil
	r.Conn = nil
	r.mu.Unlock()
	return r.connect()
}

// 带指数退避重连
func (r *RabbitMQ) reconnectWithBackoff(ctx context.Context) error {
	backoff := 2 * time.Second
	maxBackoff := 30 * time.Second
	for {
		if err := r.reconnect(); err == nil {
			logrus.Info("rabbitmq reconnected")
			return nil
		} else {
			logrus.WithError(err).Warn("rabbitmq reconnect failed")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		if backoff < maxBackoff {
			backoff *= 2
		}
	}
}

// 后台监听连接关闭并自动重连
func (r *RabbitMQ) WatchAndReconnect(ctx context.Context) {
	go func() {
		for {
			r.mu.RLock()
			conn := r.Conn
			r.mu.RUnlock()
			if conn == nil {
				if err := r.reconnectWithBackoff(ctx); err != nil {
					return
				}
				continue
			}
			closeCh := conn.NotifyClose(make(chan *amqp.Error, 1))
			select {
			case <-ctx.Done():
				return
			case err, ok := <-closeCh:
				if !ok {
					return
				}
				logrus.WithError(err).Warn("rabbitmq connection lost, will reconnect")
				r.mu.Lock()
				r.Conn = nil
				r.Channel = nil
				r.mu.Unlock()
			}
		}
	}()
}

// 在当前通道上发布消息
func (r *RabbitMQ) publish(exchange, key string, msg amqp.Publishing) error {
	r.mu.RLock()
	ch := r.Channel
	r.mu.RUnlock()

	if ch == nil {
		if err := r.reconnect(); err != nil {
			return fmt.Errorf("rabbitmq not connected: %w", err)
		}
		r.mu.RLock()
		ch = r.Channel
		r.mu.RUnlock()
	}

	if err := ch.Publish(exchange, key, false, false, msg); err != nil {
		logrus.WithError(err).Warn("rabbitmq publish failed, reconnecting and retrying once")
		if rerr := r.reconnect(); rerr != nil {
			return fmt.Errorf("publish: %w (reconnect: %v)", err, rerr)
		}
		r.mu.RLock()
		ch = r.Channel
		r.mu.RUnlock()
		return ch.Publish(exchange, key, false, false, msg)
	}
	return nil
}

// PublishSyncRequest 发布一条同步任务到主队列
func (r *RabbitMQ) PublishSyncRequest(body []byte, requestID string, triggeredBy string) error {
	return r.publish(
		"ttml.sync",
		"sync.request",
		amqp.Publishing{
			ContentType:  "application/json",
			DeliveryMode: amqp.Persistent,
			MessageId:    requestID,
			Timestamp:    time.Now(),
			Headers: amqp.Table{
				"x-request-id":   requestID,
				"x-triggered-by": triggeredBy,
			},
			Body: body,
		},
	)
}

// NotFoundParseMessage 无歌词解析消息体
type NotFoundParseMessage struct {
	Platform   string `json:"platform"`
	PlatformID string `json:"platformId"`
	ClientIP   string `json:"clientIp"`
}

// PublishNotFoundParse 发布一条无歌词解析任务
func (r *RabbitMQ) PublishNotFoundParse(msg NotFoundParseMessage) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal nf message: %w", err)
	}
	return r.publish(
		NFExchange,
		NFRoutingKey,
		amqp.Publishing{
			ContentType:  "application/json",
			DeliveryMode: amqp.Persistent,
			Timestamp:    time.Now(),
			MessageId:    fmt.Sprintf("%s:%s", msg.Platform, msg.PlatformID),
			Body:         body,
		},
	)
}

// Close 关闭连接
func (r *RabbitMQ) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.Channel != nil {
		_ = r.Channel.Close()
	}
	if r.Conn != nil {
		return r.Conn.Close()
	}
	return nil
}
