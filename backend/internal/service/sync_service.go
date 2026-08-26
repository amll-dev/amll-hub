package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/config"
	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/google/uuid"
	logrus "github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

// SyncService 同步触发与状态查询
type SyncService struct {
	cfg          *config.Config
	syncRepo     *repository.SyncRepo
	progressRepo *repository.SyncProgressRepo
	rabbitMQ     *infrastructure.RabbitMQ
	httpClient   *http.Client
}

func NewSyncService(
	cfg *config.Config,
	syncRepo *repository.SyncRepo,
	progressRepo *repository.SyncProgressRepo,
	mq *infrastructure.RabbitMQ,
) *SyncService {
	return &SyncService{
		cfg:          cfg,
		syncRepo:     syncRepo,
		progressRepo: progressRepo,
		rabbitMQ:     mq,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

// TriggerSyncResult 触发同步结果
type TriggerSyncResult struct {
	Status           string `json:"status"`
	Message          string `json:"message"`
	RequestID        string `json:"requestId,omitempty"`
	PreviousCommit   string `json:"previousCommit,omitempty"`
	TargetCommit     string `json:"targetCommit,omitempty"`
	StartedAt        string `json:"startedAt,omitempty"`
	QueuePosition    int    `json:"queuePosition,omitempty"`
	CurrentSyncReqID string `json:"currentSyncRequestId,omitempty"`
	CurrentSyncStart string `json:"currentSyncStartedAt,omitempty"`
	LastSyncedCommit string `json:"lastSyncedCommit,omitempty"`
	LastSyncedAt     string `json:"lastSyncedAt,omitempty"`
}

// TriggerSync 触发同步
func (s *SyncService) TriggerSync(ctx context.Context, triggeredBy string) (*TriggerSyncResult, error) {
	requestID := uuid.NewString()
	log := logrus.WithField("request_id", requestID)

	remoteCommit, err := s.fetchRemoteCommit(ctx)
	if err != nil {
		log.WithError(err).Error("fetch remote commit failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	localCommit, err := s.syncRepo.GetLastSyncedCommit(ctx)
	if err != nil {
		logrus.WithError(err).Error("get last synced commit failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	lastSyncedAt, _ := s.syncRepo.GetLastSyncedAt(ctx)

	if localCommit != "" && localCommit == remoteCommit {
		return &TriggerSyncResult{
			Status:           "up_to_date",
			Message:          "当前已为最新版本",
			LastSyncedCommit: localCommit,
			LastSyncedAt:     lastSyncedAt,
		}, nil
	}

	running, err := s.syncRepo.GetLatestRunningHistory(ctx)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		logrus.WithError(err).Error("check running sync failed")
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if running != nil {
		if err := s.enqueue(ctx, requestID, triggeredBy); err != nil {
			return nil, err
		}
		return &TriggerSyncResult{
			Status:           "queued",
			Message:          "当前有同步任务进行中，已加入队列等待",
			RequestID:        requestID,
			QueuePosition:    1,
			CurrentSyncReqID: "",
			CurrentSyncStart: running.StartedAt.UTC().Format(time.RFC3339),
		}, nil
	}

	if err := s.enqueue(ctx, requestID, triggeredBy); err != nil {
		return nil, err
	}

	return &TriggerSyncResult{
		Status:         "syncing",
		Message:        "同步任务已开始",
		RequestID:      requestID,
		PreviousCommit: localCommit,
		TargetCommit:   remoteCommit,
		StartedAt:      now,
	}, nil
}

func (s *SyncService) enqueue(ctx context.Context, requestID, triggeredBy string) error {
	body, _ := json.Marshal(map[string]any{
		"request_id":   requestID,
		"triggered_by": triggeredBy,
		"triggered_at": time.Now().UTC().Format(time.RFC3339),
	})
	if err := s.rabbitMQ.PublishSyncRequest(body, requestID, triggeredBy); err != nil {
		logrus.WithError(err).Error("publish sync request failed")
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	return nil
}

func (s *SyncService) fetchRemoteCommit(ctx context.Context) (string, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/commits/%s",
		s.cfg.GitHub.Repo, s.cfg.GitHub.Branch)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "amll-ttml-api")
	if s.cfg.GitHub.Token != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.GitHub.Token)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			logrus.Errorf("close response body: %v", err)
		}
	}()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("github api status %d: %s", resp.StatusCode, string(body))
	}

	var data struct {
		SHA string `json:"sha"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if data.SHA == "" {
		return "", errors.New("empty commit sha")
	}
	return data.SHA, nil
}

// SyncStatusResult 同步状态查询结果
type SyncStatusResult struct {
	Syncing          bool           `json:"syncing"`
	StartedAt        string         `json:"startedAt,omitempty"`
	LastSyncedAt     string         `json:"lastSyncedAt,omitempty"`
	LastSyncedCommit string         `json:"lastSyncedCommit,omitempty"`
	Progress         map[string]any `json:"progress,omitempty"`
}

// GetStatus 查询当前同步状态
func (s *SyncService) GetStatus(ctx context.Context) (*SyncStatusResult, error) {
	running, err := s.syncRepo.GetLatestRunningHistory(ctx)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if running != nil {
		progress, _ := s.progressRepo.GetProgressByHistoryID(ctx, running.ID)
		result := &SyncStatusResult{
			Syncing:   true,
			StartedAt: running.StartedAt.UTC().Format(time.RFC3339),
		}
		if progress != nil {
			result.Progress = map[string]any{
				"total":       progress.Total,
				"downloaded":  progress.Downloaded,
				"failed":      progress.Failed,
				"currentFile": progress.CurrentFile,
			}
		}
		return result, nil
	}

	lastAt, _ := s.syncRepo.GetLastSyncedAt(ctx)
	lastCommit, _ := s.syncRepo.GetLastSyncedCommit(ctx)
	return &SyncStatusResult{
		Syncing:          false,
		LastSyncedAt:     lastAt,
		LastSyncedCommit: lastCommit,
	}, nil
}
