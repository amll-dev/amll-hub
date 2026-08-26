package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/amll-dev/amll-hub/backend/internal/model"
	"github.com/amll-dev/amll-hub/backend/internal/repository"
	"github.com/minio/minio-go/v7"
)

// SearchIPImagePrefix 搜索IP图片在 MinIO 中的前缀
const SearchIPImagePrefix = "search-ip/"

// SearchIPTempPrefix 搜索IP临时图片前缀，1 小时后清理
const SearchIPTempPrefix = "search-ip/tmp/"

// SearchIPTempTTL 临时文件存活时长
const SearchIPTempTTL = time.Hour

// SearchIPService 搜索IP投稿服务
type SearchIPService struct {
	repo   *repository.SearchIPRepo
	minio  *minio.Client
	bucket string
}

// NewSearchIPService 创建 SearchIPService
func NewSearchIPService(repo *repository.SearchIPRepo, minioClient *minio.Client, bucket string) *SearchIPService {
	return &SearchIPService{repo: repo, minio: minioClient, bucket: bucket}
}

// CreateSearchIPInput 创建搜索IP投稿入参
type CreateSearchIPInput struct {
	Title    string            // 投稿标题
	Data     map[string]any    // 原始 SearchIPData
	TempKeys map[string]string // 文件名 → 临时对象 key（已上传到 search-ip/tmp/）
}

// CreateSearchIPResult 创建投稿结果
type CreateSearchIPResult struct {
	ID         int64 `json:"id"`
	ImageCount int   `json:"imageCount"`
}

// MatchTeam 匹配到的团队
type MatchTeam struct {
	Name    string `json:"name"`
	LogoKey string `json:"logoKey"`
	Color   string `json:"color"`
}

// MatchMember 匹配到的成员
type MatchMember struct {
	Name      string `json:"name"`
	AvatarKey string `json:"avatarKey"`
	Color     string `json:"color"`
	Team      string `json:"team"`
}

// SearchIPListItem 搜索IP投稿列表项（精简）
type SearchIPListItem struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"` // 由 group 名拼接
	Status    string `json:"status"`
	Submitter string `json:"submitter"`
	CreatedAt string `json:"createdAt"`
}

// SearchIPListResult 搜索IP投稿列表结果
type SearchIPListResult struct {
	Total int64              `json:"total"`
	Items []SearchIPListItem `json:"items"`
}

// SearchIPDetail 搜索IP投稿详情
type SearchIPDetail struct {
	ID            int64            `json:"id"`
	Title         string           `json:"title"`
	Data          model.JSONObject `json:"data"`
	ImageKeys     model.JSONObject `json:"imageKeys"`
	Submitter     string           `json:"submitter"`
	SubmitterInfo model.JSONObject `json:"submitterInfo"`
	Status        string           `json:"status"`
	CreatedAt     string           `json:"createdAt"`
	UpdatedAt     string           `json:"updatedAt"`
}

// MatchResult 匹配结果
type MatchResult struct {
	Teams   map[string]MatchTeam   `json:"teams"`
	Members map[string]MatchMember `json:"members"`
}

// CreateSubmission 创建搜索IP投稿
// 过滤逻辑：移除没有上传图片的 member；移除既无 group 图片又无 member 的 group
// 图片处理：将临时对象（search-ip/tmp/）复制为正式对象（search-ip/），并删除临时对象
func (s *SearchIPService) CreateSubmission(ctx context.Context, submitter string, submitterInfo model.JSONObject, input *CreateSearchIPInput) (*CreateSearchIPResult, error) {
	groupsRaw, ok := input.Data["groups"]
	if !ok {
		return nil, errors.New("data.groups 字段缺失")
	}
	groups, ok := groupsRaw.(map[string]any)
	if !ok {
		return nil, errors.New("data.groups 格式错误")
	}

	imageKeys := model.JSONObject{}
	filteredGroups := map[string]any{}
	imageCount := 0

	// promote 将临时 key 复制为正式 key，并删除临时对象
	promote := func(fileName, tempKey string) (string, error) {
		formalKey, err := s.promoteTemp(ctx, fileName, tempKey)
		if err != nil {
			return "", err
		}
		// 删除临时对象（失败不影响主流程）
		_ = s.minio.RemoveObject(ctx, s.bucket, tempKey, minio.RemoveObjectOptions{})
		return formalKey, nil
	}

	for groupName, groupVal := range groups {
		group, ok := groupVal.(map[string]any)
		if !ok {
			continue
		}

		// 获取 group 图片文件名
		groupPic := ""
		if v, ok := group["pictures"].(string); ok {
			groupPic = v
		}

		// 检查 group 图片是否已上传（临时 key 存在）
		groupHasImage := false
		if groupPic != "" {
			if tempKey, exists := input.TempKeys[groupPic]; exists {
				formalKey, err := promote(groupPic, tempKey)
				if err != nil {
					return nil, fmt.Errorf("转存团队图片 %s 失败: %w", groupPic, err)
				}
				imageKeys[groupPic] = formalKey
				groupHasImage = true
				imageCount++
			}
		}

		// 过滤 members：只保留有上传图片的 member
		membersRaw, ok := group["members"].([]any)
		if !ok {
			// 没有 members 字段，只有 group 图片
			if groupHasImage {
				filteredGroups[groupName] = group
			}
			continue
		}

		filteredMembers := []any{}
		for _, memberVal := range membersRaw {
			member, ok := memberVal.(map[string]any)
			if !ok {
				continue
			}

			memberPic := ""
			if v, ok := member["pictures"].(string); ok {
				memberPic = v
			}

			if memberPic == "" {
				continue // member 没有图片文件名，跳过
			}

			tempKey, exists := input.TempKeys[memberPic]
			if !exists {
				continue // member 图片未上传，跳过
			}

			formalKey, err := promote(memberPic, tempKey)
			if err != nil {
				return nil, fmt.Errorf("转存成员图片 %s 失败: %w", memberPic, err)
			}
			imageKeys[memberPic] = formalKey
			imageCount++
			filteredMembers = append(filteredMembers, member)
		}

		// group 既无自己的图片，又没有有图片的 member → 整个 group 跳过
		if !groupHasImage && len(filteredMembers) == 0 {
			continue
		}

		// 用过滤后的 members 替换
		group["members"] = filteredMembers
		filteredGroups[groupName] = group
	}

	if len(filteredGroups) == 0 {
		return nil, errors.New("没有有效的数据（所有 group 均无图片）")
	}

	sub := &model.SearchIPSubmission{
		Title:         input.Title,
		Data:          model.JSONObject{"groups": filteredGroups},
		ImageKeys:     imageKeys,
		Submitter:     submitter,
		SubmitterInfo: submitterInfo,
		Status:        "pending",
	}

	if err := s.repo.Create(ctx, sub); err != nil {
		return nil, fmt.Errorf("创建投稿失败: %w", err)
	}

	return &CreateSearchIPResult{
		ID:         sub.ID,
		ImageCount: imageCount,
	}, nil
}

// UploadTemp 上传图片到 MinIO 临时区，返回临时 key
func (s *SearchIPService) UploadTemp(ctx context.Context, fileName string, content []byte) (string, error) {
	ext := path.Ext(fileName)
	if !isAllowedImageExt(ext) {
		return "", fmt.Errorf("不支持的图片格式: %s", ext)
	}
	key := fmt.Sprintf("%s%d-%d%s", SearchIPTempPrefix, time.Now().UnixNano(), len(content), ext)
	_, err := s.minio.PutObject(ctx, s.bucket, key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{
		ContentType: imageContentType(ext),
	})
	if err != nil {
		return "", err
	}
	return key, nil
}

// promoteTemp 将临时对象复制为正式对象，返回正式 key
func (s *SearchIPService) promoteTemp(ctx context.Context, fileName, tempKey string) (string, error) {
	if !strings.HasPrefix(tempKey, SearchIPTempPrefix) {
		return "", fmt.Errorf("非法的临时 key: %s", tempKey)
	}
	ext := path.Ext(fileName)
	formalKey := fmt.Sprintf("%s%d-%d%s", SearchIPImagePrefix, time.Now().UnixNano(), len(tempKey), ext)
	src := minio.CopySrcOptions{Bucket: s.bucket, Object: tempKey}
	dst := minio.CopyDestOptions{Bucket: s.bucket, Object: formalKey}
	if _, err := s.minio.CopyObject(ctx, dst, src); err != nil {
		return "", fmt.Errorf("复制对象失败: %w", err)
	}
	return formalKey, nil
}

// CleanTempFiles 清理超过 TTL 的临时文件
func (s *SearchIPService) CleanTempFiles(ctx context.Context) error {
	cutoff := time.Now().Add(-SearchIPTempTTL)
	objectCh := s.minio.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    SearchIPTempPrefix,
		Recursive: true,
	})
	var delErr error
	for obj := range objectCh {
		if obj.Err != nil {
			delErr = obj.Err
			continue
		}
		if obj.LastModified.Before(cutoff) {
			if err := s.minio.RemoveObject(ctx, s.bucket, obj.Key, minio.RemoveObjectOptions{}); err != nil {
				delErr = err
			}
		}
	}
	return delErr
}

// StartTempCleaner 启动临时文件清理定时任务（每 10 分钟清理一次）
func (s *SearchIPService) StartTempCleaner(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.CleanTempFiles(ctx)
			}
		}
	}()
}

// Match 匹配搜索IP
// 匹配规则：先用 group.aliases（含组名）匹配团队，只有团队匹配上后才查该团队下的成员
func (s *SearchIPService) Match(ctx context.Context, artists []string) (*MatchResult, error) {
	subs, err := s.repo.ListApproved(ctx)
	if err != nil {
		return nil, fmt.Errorf("查询投稿数据失败: %w", err)
	}

	// 将 artists 转为 set（小写）方便做大小写不敏感查找
	artistSet := map[string]bool{}
	for _, a := range artists {
		artistSet[strings.ToLower(a)] = true
	}

	result := &MatchResult{
		Teams:   map[string]MatchTeam{},
		Members: map[string]MatchMember{},
	}

	matchedArtists := map[string]bool{} // 已匹配的 artist 名

	for _, sub := range subs {
		groupsRaw, ok := sub.Data["groups"]
		if !ok {
			continue
		}
		groups, ok := groupsRaw.(map[string]any)
		if !ok {
			continue
		}

		imageKeys := map[string]string{}
		if sub.ImageKeys != nil {
			for k, v := range sub.ImageKeys {
				if s, ok := v.(string); ok {
					imageKeys[k] = s
				}
			}
		}

		for groupName, groupVal := range groups {
			group, ok := groupVal.(map[string]any)
			if !ok {
				continue
			}

			color := ""
			if v, ok := group["color"].(string); ok {
				color = v
			}

			// 构建 group 的所有别名（aliases + 组名本身）
			groupAliases := []string{groupName}
			if aliasesRaw, ok := group["aliases"].([]any); ok {
				for _, a := range aliasesRaw {
					if s, ok := a.(string); ok {
						groupAliases = append(groupAliases, s)
					}
				}
			}

			// 获取 group logo key（可能为空）
			groupLogoKey := ""
			if pic, ok := group["pictures"].(string); ok && pic != "" {
				groupLogoKey = imageKeys[pic]
			}

			// 检查是否有 artist 匹配到该团队（大小写不敏感）
			teamMatched := false
			for _, alias := range groupAliases {
				lowerAlias := strings.ToLower(alias)
				if artistSet[lowerAlias] && !matchedArtists[lowerAlias] {
					teamMatched = true
					matchedArtists[lowerAlias] = true
				}
			}

			// 团队未匹配上，跳过该团队（不查成员）
			if !teamMatched {
				continue
			}

			// 记录团队信息（用所有命中的 alias 作为 key）
			for _, alias := range groupAliases {
				if artistSet[strings.ToLower(alias)] {
					result.Teams[alias] = MatchTeam{
						Name:    groupName,
						LogoKey: groupLogoKey,
						Color:   color,
					}
				}
			}

			// 匹配该团队下的成员
			membersRaw, ok := group["members"].([]any)
			if !ok {
				continue
			}

			for _, memberVal := range membersRaw {
				member, ok := memberVal.(map[string]any)
				if !ok {
					continue
				}

				memberColor := color
				if v, ok := member["color"].(string); ok && v != "" {
					memberColor = v
				}

				// 获取 member 的所有别名（authors）
				authorsRaw, ok := member["authors"].([]any)
				if !ok {
					continue
				}

				memberAvatarKey := ""
				if pic, ok := member["pictures"].(string); ok && pic != "" {
					memberAvatarKey = imageKeys[pic]
				}

				for _, authorVal := range authorsRaw {
					author, ok := authorVal.(string)
					if !ok {
						continue
					}
					lowerAuthor := strings.ToLower(author)
					if artistSet[lowerAuthor] && !matchedArtists[lowerAuthor] {
						matchedArtists[lowerAuthor] = true
						result.Members[author] = MatchMember{
							Name:      author,
							AvatarKey: memberAvatarKey,
							Color:     memberColor,
							Team:      groupName,
						}
					}
				}
			}
		}
	}

	return result, nil
}

// toListItem 投稿转为列表项：优先用 title 字段，为空时从 data.groups 提取 group 名拼接
func toListItem(sub model.SearchIPSubmission) SearchIPListItem {
	title := sub.Title
	if title == "" {
		if groupsRaw, ok := sub.Data["groups"]; ok {
			if groups, ok := groupsRaw.(map[string]any); ok {
				names := make([]string, 0, len(groups))
				for name := range groups {
					names = append(names, name)
				}
				title = strings.Join(names, " / ")
			}
		}
	}
	return SearchIPListItem{
		ID:        sub.ID,
		Title:     title,
		Status:    sub.Status,
		Submitter: submitterLabel(sub),
		CreatedAt: sub.CreatedAt.Format("2006-01-02 15:04"),
	}
}

// submitterLabel 投稿人显示名
func submitterLabel(sub model.SearchIPSubmission) string {
	name, _ := sub.SubmitterInfo["name"].(string)
	displayName, _ := sub.SubmitterInfo["displayName"].(string)
	if displayName != "" && name != "" {
		return displayName + "@" + name
	}
	if name != "" {
		return name
	}
	if displayName != "" {
		return displayName
	}
	return sub.Submitter
}

// ListBySubmitter 按提交人查询投稿列表
func (s *SearchIPService) ListBySubmitter(ctx context.Context, submitter string) (*SearchIPListResult, error) {
	subs, err := s.repo.ListBySubmitter(ctx, submitter)
	if err != nil {
		return nil, fmt.Errorf("查询投稿列表失败: %w", err)
	}
	items := make([]SearchIPListItem, 0, len(subs))
	for _, sub := range subs {
		items = append(items, toListItem(sub))
	}
	return &SearchIPListResult{Total: int64(len(items)), Items: items}, nil
}

// ListAll 查询全部投稿列表，status 为空或 all 时不过滤
func (s *SearchIPService) ListAll(ctx context.Context, status string) (*SearchIPListResult, error) {
	subs, err := s.repo.ListAll(ctx, status)
	if err != nil {
		return nil, fmt.Errorf("查询投稿列表失败: %w", err)
	}
	items := make([]SearchIPListItem, 0, len(subs))
	for _, sub := range subs {
		items = append(items, toListItem(sub))
	}
	return &SearchIPListResult{Total: int64(len(items)), Items: items}, nil
}

// Review 审核搜索IP投稿
func (s *SearchIPService) Review(ctx context.Context, id int64, action string) error {
	var newStatus string
	switch action {
	case "approve":
		newStatus = "approved"
	case "reject":
		newStatus = "rejected"
	default:
		return fmt.Errorf("无效的审核动作: %s", action)
	}
	fromStatuses := []string{"pending"}

	if _, err := s.repo.GetByID(ctx, id); err != nil {
		return ErrSubmissionNotFound
	}

	ok, err := s.repo.UpdateStatusWhere(ctx, id, newStatus, fromStatuses)
	if err != nil {
		return fmt.Errorf("更新投稿状态失败: %w", err)
	}
	if !ok {
		return ErrInvalidStatus
	}
	return nil
}

// GetByID 查询投稿详情
func (s *SearchIPService) GetByID(ctx context.Context, id int64) (*SearchIPDetail, error) {
	sub, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("查询投稿详情失败: %w", err)
	}
	return &SearchIPDetail{
		ID:            sub.ID,
		Title:         sub.Title,
		Data:          sub.Data,
		ImageKeys:     sub.ImageKeys,
		Submitter:     sub.Submitter,
		SubmitterInfo: sub.SubmitterInfo,
		Status:        sub.Status,
		CreatedAt:     sub.CreatedAt.Format("2006-01-02 15:04"),
		UpdatedAt:     sub.UpdatedAt.Format("2006-01-02 15:04"),
	}, nil
}

// GetImage 从 MinIO 读取图片
func (s *SearchIPService) GetImage(ctx context.Context, key string) (io.ReadCloser, string, error) {
	// 安全校验：只允许 search-ip/ 前缀
	if !strings.HasPrefix(key, SearchIPImagePrefix) {
		return nil, "", ErrImageNotFound
	}

	obj, err := s.minio.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", err
	}

	if _, statErr := obj.Stat(); statErr != nil {
		_ = obj.Close()
		resp := minio.ToErrorResponse(statErr)
		if resp.Code == "NoSuchKey" {
			return nil, "", ErrImageNotFound
		}
		return nil, "", statErr
	}

	contentType := imageContentType(path.Ext(key))
	return obj, contentType, nil
}
