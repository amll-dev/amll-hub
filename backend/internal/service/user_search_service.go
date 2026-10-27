package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/amll-dev/amll-hub/backend/internal/infrastructure"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
)

// 用户搜索结果条数上限
const (
	userSearchDefaultLimit = 20
	userSearchMaxLimit     = 50
)

// UserSearchItem 用户搜索结果项
type UserSearchItem struct {
	Name          string `json:"name"`
	DisplayName   string `json:"displayName"`
	Avatar        string `json:"avatar"`
	Bio           string `json:"bio"`
	ApprovedCount int64  `json:"approvedCount"`
	CreatedTime   string `json:"createdTime,omitempty"`
}

// UserSearchResult 用户搜索结果
type UserSearchResult struct {
	Items []UserSearchItem `json:"items"`
	// Total 本次返回的条数；Casdoor 不提供命中总数，是否还有更多看 HasMore
	Total   int  `json:"total"`
	Limit   int  `json:"limit"`
	HasMore bool `json:"hasMore"`
}

// UserSearchService 按用户名 / 昵称搜索站点用户。
//
// 账号权威数据在 Casdoor（昵称、头像、注册时间），主页资料（签名）在 user_profiles，
// 投稿数从 submissions 聚合，三者按 username 合并。
type UserSearchService struct {
	casdoor  *infrastructure.CasdoorClient
	profiles *repository.UserProfileRepo
	subs     *repository.SubmissionRepo
}

// NewUserSearchService 创建服务
func NewUserSearchService(
	casdoor *infrastructure.CasdoorClient,
	profiles *repository.UserProfileRepo,
	subs *repository.SubmissionRepo,
) *UserSearchService {
	return &UserSearchService{casdoor: casdoor, profiles: profiles, subs: subs}
}

// Search 搜索用户，返回已聚合签名与已通过投稿数的结果
func (s *UserSearchService) Search(ctx context.Context, keyword string, limit int) (*UserSearchResult, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return &UserSearchResult{Items: []UserSearchItem{}, Limit: limit}, nil
	}
	if limit <= 0 {
		limit = userSearchDefaultLimit
	}
	if limit > userSearchMaxLimit {
		limit = userSearchMaxLimit
	}

	// 多取一条用于判断是否还有更多
	users, err := s.casdoor.SearchUsers(ctx, keyword, limit+1)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	hasMore := len(users) > limit
	if hasMore {
		users = users[:limit]
	}

	names := make([]string, 0, len(users))
	for i := range users {
		names = append(names, users[i].Name)
	}

	// 两个补充查询失败不应该让整个搜索失败，降级为空即可
	profiles, err := s.profiles.ListByUsernames(ctx, names)
	if err != nil {
		profiles = nil
	}
	counts, err := s.subs.CountApprovedBySubmitters(ctx, names)
	if err != nil {
		counts = nil
	}

	items := make([]UserSearchItem, 0, len(users))
	for i := range users {
		u := users[i]
		item := UserSearchItem{
			Name:        u.Name,
			DisplayName: u.DisplayName,
			Avatar:      u.Avatar,
			CreatedTime: u.CreatedTime,
		}
		if p, ok := profiles[u.Name]; ok && p != nil {
			item.Bio = p.Bio
		}
		item.ApprovedCount = counts[u.Name]
		items = append(items, item)
	}

	return &UserSearchResult{
		Items:   items,
		Total:   len(items),
		Limit:   limit,
		HasMore: hasMore,
	}, nil
}

// Count 返回可枚举的匹配数（达到 cap 即认为「更多」，与前端 N+ 的展示约定一致）
func (s *UserSearchService) Count(ctx context.Context, keyword string, cap int) (int, bool, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return 0, false, nil
	}
	if cap <= 0 {
		cap = userSearchDefaultLimit
	}
	users, err := s.casdoor.SearchUsers(ctx, keyword, cap+1)
	if err != nil {
		if errors.Is(err, infrastructure.ErrCasdoorUserNotFound) {
			return 0, false, nil
		}
		return 0, false, err
	}
	if len(users) > cap {
		return cap, true, nil
	}
	return len(users), false, nil
}
