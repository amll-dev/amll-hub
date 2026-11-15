package handler

import (
	"errors"
	"github.com/amll-dev/amll-hub/backend/internal/middleware"
	"github.com/amll-dev/amll-hub/backend/internal/pkg"
	"github.com/amll-dev/amll-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"strconv"
)

type ReviewerRecruitmentHandler struct {
	svc *service.ReviewerRecruitmentService
}

func NewReviewerRecruitmentHandler(s *service.ReviewerRecruitmentService) *ReviewerRecruitmentHandler {
	return &ReviewerRecruitmentHandler{svc: s}
}
func recruitmentError(c *gin.Context, e error) {
	if e == nil {
		return
	}
	if errors.Is(e, service.ErrForbidden) {
		pkg.Forbidden(c)
		return
	}
	if errors.Is(e, service.ErrInvalidInput) {
		pkg.BadRequest(c, "请求参数非法")
		return
	}
	var v *service.ValidationError
	if errors.As(e, &v) {
		pkg.BadRequest(c, v.Message)
		return
	}
	if errors.Is(e, gorm.ErrRecordNotFound) {
		pkg.NotFound(c, "招募不存在")
		return
	}
	pkg.InternalError(c, "审核招募操作失败")
}
func (h *ReviewerRecruitmentHandler) Active(c *gin.Context) {
	p, e := h.svc.Active(c.Request.Context())
	if e != nil {
		recruitmentError(c, e)
		return
	}
	pkg.OK(c, gin.H{"active": p})
}
func (h *ReviewerRecruitmentHandler) Dashboard(c *gin.Context) {
	d, e := h.svc.Dashboard(c.Request.Context())
	if e != nil {
		recruitmentError(c, e)
		return
	}
	pkg.OK(c, d)
}
func (h *ReviewerRecruitmentHandler) Create(c *gin.Context) {
	var in service.RecruitmentInput
	if e := c.ShouldBindJSON(&in); e != nil {
		pkg.BadRequest(c, "参数错误")
		return
	}
	p, e := h.svc.Create(c.Request.Context(), middleware.GetUserName(c), in)
	if e != nil {
		recruitmentError(c, e)
		return
	}
	pkg.OK(c, p)
}
func (h *ReviewerRecruitmentHandler) Me(c *gin.Context) {
	m, e := h.svc.Me(c.Request.Context(), middleware.GetUserName(c))
	if e != nil {
		recruitmentError(c, e)
		return
	}
	pkg.OK(c, gin.H{"member": m})
}
func (h *ReviewerRecruitmentHandler) Exit(c *gin.Context) {
	e := h.svc.Exit(c.Request.Context(), middleware.GetUserName(c))
	if e != nil {
		recruitmentError(c, e)
		return
	}
	pkg.OK(c, nil)
}
func (h *ReviewerRecruitmentHandler) Progress(c *gin.Context) {
	id, e := strconv.ParseInt(c.Param("id"), 10, 64)
	if e != nil {
		pkg.BadRequest(c, "投稿 ID 无效")
		return
	}
	p, e := h.svc.Progress(c.Request.Context(), id, middleware.GetUserName(c), false)
	if e != nil {
		recruitmentError(c, e)
		return
	}
	pkg.OK(c, p)
}
