package repository

// normalizePage 规范化分页参数：页码最小 1，每页默认 20、最大 50
func normalizePage(page, size int) (int, int) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 50 {
		size = 50
	}
	return page, size
}
