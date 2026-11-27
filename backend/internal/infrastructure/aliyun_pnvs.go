package infrastructure

import (
	"context"
	"fmt"
	"strings"

	"github.com/aliyun/alibaba-cloud-sdk-go/services/dypnsapi"
)

// AliyunPnvsClient 阿里云号码认证服务（PNVS）客户端。
//
// 网页一键登录只需要 GetAuthToken：前端拿着 accessToken/jwtToken 调起运营商 H5 授权页，
// 取号（spToken）后的换号逻辑由 Casdoor 的 H5 grant 完成，AccessKey 不下发前端。
type AliyunPnvsClient struct {
	core      *dypnsapi.Client
	sceneCode string
}

// OneClickAuthToken 前端 H5 取号 SDK 所需的临时凭据
type OneClickAuthToken struct {
	AccessToken string `json:"accessToken"`
	JwtToken    string `json:"jwtToken"`
}

// NewAliyunPnvsClient 创建 PNVS 客户端
func NewAliyunPnvsClient(accessKeyID, accessKeySecret, sceneCode, regionID string) (*AliyunPnvsClient, error) {
	if regionID == "" {
		regionID = "cn-hangzhou"
	}
	client, err := dypnsapi.NewClientWithAccessKey(regionID, accessKeyID, accessKeySecret)
	if err != nil {
		return nil, err
	}
	return &AliyunPnvsClient{core: client, sceneCode: sceneCode}, nil
}

// GetAuthToken 获取 H5 取号所需的 AccessToken / JwtToken。
// origin 为调用页面的来源（协议 + 域名 + 端口）；阿里云要求 Url / Origin 必填，
// 缺任一项会直接返回 MissingUrl / MissingOrigin。
func (c *AliyunPnvsClient) GetAuthToken(ctx context.Context, origin string) (*OneClickAuthToken, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	if origin == "" {
		return nil, fmt.Errorf("PNVS GetAuthToken requires h5 page origin")
	}

	request := dypnsapi.CreateGetAuthTokenRequest()
	request.Scheme = "https"
	request.SceneCode = c.sceneCode
	request.Origin = origin
	request.Url = origin + "/"

	response, err := c.core.GetAuthToken(request)
	if err != nil {
		return nil, err
	}
	if response.Code != "OK" {
		if response.Message != "" {
			return nil, fmt.Errorf("PNVS GetAuthToken failed with code: %s, %s", response.Code, response.Message)
		}
		return nil, fmt.Errorf("PNVS GetAuthToken failed with code: %s", response.Code)
	}
	if response.TokenInfo.AccessToken == "" || response.TokenInfo.JwtToken == "" {
		return nil, fmt.Errorf("PNVS GetAuthToken returned empty token")
	}

	return &OneClickAuthToken{
		AccessToken: response.TokenInfo.AccessToken,
		JwtToken:    response.TokenInfo.JwtToken,
	}, nil
}
