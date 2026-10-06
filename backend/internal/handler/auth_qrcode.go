package handler

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
)

// CreateQRCode POST /api/v1/auth/qrcode
// 网页端申请一个扫码登录票据（二维码内容为 deep link）
func (h *AuthHandler) CreateQRCode(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.CreateQRTicket(ctx)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// QRCodeStatus GET /api/v1/auth/qrcode/status?ticket=xxx
// 网页端轮询票据状态；confirmed 时返回 token（并销毁票据）
func (h *AuthHandler) QRCodeStatus(c *gin.Context) {
	ticket := c.Query("ticket")
	if strings.TrimSpace(ticket) == "" {
		pkg.BadRequest(c, "ticket 参数必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	result, err := h.svc.GetQRTicketStatus(ctx, ticket)
	if err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OK(c, result)
}

// MarkQRCodeScanned POST /api/v1/auth/qrcode/scanned
// App 扫到码、用户还没点确认时上报，让网页端展示「已扫码」
func (h *AuthHandler) MarkQRCodeScanned(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		Ticket string `json:"ticket" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "ticket 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.MarkQRTicketScanned(ctx, req.Ticket, userID); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已标记扫码")
}

// ConfirmQRCode POST /api/v1/auth/qrcode/confirm
// App 扫码后确认，把当前登录用户的 token 交给对应票据
func (h *AuthHandler) ConfirmQRCode(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		Ticket string `json:"ticket" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "ticket 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), longTimeout)
	defer cancel()

	if err := h.svc.ConfirmQRTicket(ctx, req.Ticket, userID); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已确认登录")
}

// CancelQRCode POST /api/v1/auth/qrcode/cancel
// App 端主动取消本次扫码登录
func (h *AuthHandler) CancelQRCode(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		pkg.Unauthorized(c)
		return
	}

	var req struct {
		Ticket string `json:"ticket" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		pkg.BadRequest(c, "ticket 必填")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), defaultTimeout)
	defer cancel()

	if err := h.svc.CancelQRTicket(ctx, req.Ticket); err != nil {
		writeAuthErr(c, err)
		return
	}
	pkg.OKWithMsg(c, nil, "已取消")
}
