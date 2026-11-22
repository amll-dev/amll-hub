package service

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
)

// ipip.net IP 库解析器，支持两种格式：
//   - 17mon .dat：与 Casdoor 的 ip/17monipdb.dat 相同
//   - ipdb .ipdb：ipipfree.ipdb 及商业版
//
// 文件通过 SECURITY_IP_DB_FILE 指定；未配置或加载失败时退化为 /16、/48 网段判定。

var errInvalidIP = errors.New("invalid ip format")

// ipLocationFinder 把 IPv4 地址解析成国家、省、市
type ipLocationFinder interface {
	find(ipStr string) (country, region, city string)
}

type ipLocator struct {
	textData   []byte
	indexData1 []uint32
	indexData2 []int
	indexData3 []int
	index      []int
}

// newIPLocator 读取 IP 库文件，自动识别 17mon .dat 与 ipdb .ipdb 格式
func newIPLocator(path string) (ipLocationFinder, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return newIPLocatorWithData(data)
}

func newIPLocatorWithData(data []byte) (ipLocationFinder, error) {
	if isIPDB(data) {
		return newIPDBLocator(data)
	}
	return newIP17monLocator(data)
}

// isIPDB ipdb 文件以 4 字节元数据长度开头，紧接着是 JSON（形如 {"build":...}）；
// 17mon .dat 的前 4 字节是文本区偏移，偏移后是索引字节，不会出现 '{"'。
func isIPDB(data []byte) bool {
	return len(data) > 5 && bytes.HasPrefix(data[4:], []byte(`{"`))
}

// newIP17monLocator 解析 17mon .dat
func newIP17monLocator(data []byte) (*ipLocator, error) {
	// 最小结构：4 字节偏移 + 256*4 索引 + 1024 个 /24 偏移
	if len(data) < 4+1024+1024 {
		return nil, errors.New("ip database too short")
	}
	textOff := int(binary.BigEndian.Uint32(data[:4]))
	if textOff < 4+1024+1024 || textOff > len(data) {
		return nil, errors.New("ip database has invalid text offset")
	}

	loc := &ipLocator{textData: data[textOff-1024:]}
	loc.index = make([]int, 256)
	for i := 0; i < 256; i++ {
		off := 4 + i*4
		loc.index[i] = int(binary.LittleEndian.Uint32(data[off : off+4]))
	}

	nidx := (textOff - 4 - 1024 - 1024) / 8
	if nidx <= 0 {
		return nil, errors.New("ip database has no index entries")
	}
	loc.indexData1 = make([]uint32, nidx)
	loc.indexData2 = make([]int, nidx)
	loc.indexData3 = make([]int, nidx)
	for i := 0; i < nidx; i++ {
		off := 4 + 1024 + i*8
		loc.indexData1[i] = binary.BigEndian.Uint32(data[off : off+4])
		loc.indexData2[i] = int(uint32(data[off+4]) | uint32(data[off+5])<<8 | uint32(data[off+6])<<16)
		loc.indexData3[i] = int(data[off+7])
	}
	return loc, nil
}

// find 返回国家、省、市；IP 不在库里时返回空串
func (loc *ipLocator) find(ipStr string) (country, region, city string) {
	ip := net.ParseIP(ipStr).To4()
	if ip == nil {
		return "", "", ""
	}
	ipNum := binary.BigEndian.Uint32(ip)

	end := len(loc.indexData1) - 1
	if ipNum>>24 != 0xff {
		if int(ipNum>>24)+1 >= len(loc.index) {
			return "", "", ""
		}
		end = loc.index[(ipNum>>24)+1]
	}
	if end < 0 || end >= len(loc.indexData1) || loc.index[ipNum>>24] < 0 {
		return "", "", ""
	}

	idx := loc.findIndexOffset(ipNum, loc.index[ipNum>>24], end)
	if idx < 0 || idx >= len(loc.indexData2) {
		return "", "", ""
	}
	off := loc.indexData2[idx]
	length := loc.indexData3[idx]
	if off < 0 || length <= 0 || off+length > len(loc.textData) {
		return "", "", ""
	}

	fields := bytes.Split(loc.textData[off:off+length], []byte("\t"))
	if len(fields) < 3 {
		return "", "", ""
	}
	return cleanIPField(fields[0]), cleanIPField(fields[1]), cleanIPField(fields[2])
}

func (loc *ipLocator) findIndexOffset(ip uint32, start, end int) int {
	for start < end {
		mid := (start + end) / 2
		if ip > loc.indexData1[mid] {
			start = mid + 1
		} else {
			end = mid
		}
	}
	if loc.indexData1[end] >= ip {
		return end
	}
	return start
}

// cleanIPField 把 IP 库里的占位符统一成空串，避免出现 "N/A N/A 内网IP" 这种展示
func cleanIPField(raw []byte) string {
	s := string(bytes.TrimSpace(raw))
	switch s {
	case "", "N/A", "未知", "内网IP", "局域网":
		return ""
	}
	return s
}

// ipdbHeader ipdb 文件的元数据（4 字节长度 + JSON）
type ipdbHeader struct {
	IPVersion uint16         `json:"ip_version"`
	Languages map[string]int `json:"languages"`
	NodeCount int            `json:"node_count"`
	TotalSize int            `json:"total_size"`
	Fields    []string       `json:"fields"`
}

// ipdbLocator ipip.net ipdb 格式解析器。
//
// 布局：4 字节元数据长度 + 元数据 JSON + 二叉前缀树（每节点 8 字节，两个大端 uint32）
// + 数据区（每条记录 2 字节长度 + 制表符分隔的字段）。叶节点值为
// nodeCount + 数据区字节偏移。
type ipdbLocator struct {
	data      []byte
	nodeCount int
	v4Offset  int
	langOff   int
	fieldCnt  int
}

func newIPDBLocator(data []byte) (*ipdbLocator, error) {
	if len(data) < 4 {
		return nil, errors.New("ipdb too short")
	}
	metaLen := int(binary.BigEndian.Uint32(data[:4]))
	if metaLen <= 0 || 4+metaLen > len(data) {
		return nil, errors.New("ipdb has an invalid meta length")
	}

	var header ipdbHeader
	if err := json.Unmarshal(data[4:4+metaLen], &header); err != nil {
		return nil, fmt.Errorf("decode ipdb meta failed: %w", err)
	}
	if header.NodeCount <= 0 || len(header.Fields) == 0 {
		return nil, errors.New("ipdb meta is incomplete")
	}
	if header.TotalSize <= 0 || 4+metaLen+header.TotalSize > len(data) {
		return nil, errors.New("ipdb file is truncated")
	}
	if header.IPVersion&1 == 0 {
		return nil, errors.New("ipdb has no ipv4 data")
	}

	loc := &ipdbLocator{
		data:      data[4+metaLen:],
		nodeCount: header.NodeCount,
		langOff:   header.Languages["CN"],
		fieldCnt:  len(header.Fields),
	}

	// IPv4 子树入口：先沿 80 个 0 位、再沿 16 个 1 位向下走（与 ipdb 官方实现一致）
	node := 0
	for i := 0; i < 96 && node >= 0 && node < header.NodeCount; i++ {
		index := 0
		if i >= 80 {
			index = 1
		}
		node = loc.readNode(node, index)
	}
	if node < 0 || node >= header.NodeCount {
		return nil, errors.New("ipdb has no valid ipv4 subtree")
	}
	loc.v4Offset = node
	return loc, nil
}

func (loc *ipdbLocator) readNode(node, index int) int {
	off := node*8 + index*4
	if node < 0 || off+4 > len(loc.data) {
		return -1
	}
	return int(binary.BigEndian.Uint32(loc.data[off : off+4]))
}

// resolve 叶节点值 → 数据区记录内容
func (loc *ipdbLocator) resolve(node int) ([]byte, bool) {
	off := loc.nodeCount*8 + node - loc.nodeCount
	if off < 0 || off+2 > len(loc.data) {
		return nil, false
	}
	size := int(binary.BigEndian.Uint16(loc.data[off : off+2]))
	if off+2+size > len(loc.data) {
		return nil, false
	}
	return loc.data[off+2 : off+2+size], true
}

func (loc *ipdbLocator) find(ipStr string) (country, region, city string) {
	ip := net.ParseIP(ipStr).To4()
	if ip == nil {
		return "", "", ""
	}

	node := loc.v4Offset
	for i := 0; i < 32; i++ {
		if node < 0 || node >= loc.nodeCount {
			break
		}
		bit := int(ip[i>>3]>>uint(7-(i%8))) & 1
		node = loc.readNode(node, bit)
	}
	if node <= loc.nodeCount {
		return "", "", ""
	}

	raw, ok := loc.resolve(node)
	if !ok {
		return "", "", ""
	}
	fields := strings.Split(string(raw), "\t")
	if loc.langOff < 0 || loc.langOff+loc.fieldCnt > len(fields) || loc.fieldCnt < 3 {
		return "", "", ""
	}
	fields = fields[loc.langOff : loc.langOff+loc.fieldCnt]
	return cleanIPField([]byte(fields[0])), cleanIPField([]byte(fields[1])), cleanIPField([]byte(fields[2]))
}
