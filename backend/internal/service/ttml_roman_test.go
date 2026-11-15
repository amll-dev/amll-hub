package service

import (
	"strings"
	"testing"
)

// 去重只应删掉重复 key 对应的 <text> 块，
// 其余节点（注释、无 for 的 text、其它命名空间节点、分组与属性）必须原样保留。
func TestDedupeTransliterationsKeepsUnrelatedNodes(t *testing.T) {
	doc := `<tt><body><div><span begin="00:00.100" end="00:00.200">a</span></div></body>` +
		`<transliterations xml:lang="zh">` +
		`<!-- 保留这段注释 -->` +
		`<transliteration lang="zh-Hans"><text for="song">first</text></transliteration>` +
		`<text>没有 for 的裸 text</text>` +
		`<foo:extra xmlns:foo="urn:x">保留</foo:extra>` +
		`<transliteration><text for="song">second</text></transliteration>` +
		`</transliterations></tt>`

	got := dedupeTransliterations(doc)
	for _, want := range []string{
		`xml:lang="zh"`,
		`保留这段注释`,
		`没有 for 的裸 text`,
		`保留</foo:extra>`,
		`lang="zh-Hans"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("去重后丢失 %q:\n%s", want, got)
		}
	}
	if n := strings.Count(got, `<text for="song"`); n != 1 {
		t.Errorf("重复 key 未收敛为 1 个，实际 %d 个:\n%s", n, got)
	}
	if !strings.HasSuffix(got, `</transliterations></tt>`) {
		t.Errorf("文档尾段被改写:\n%s", got)
	}
}

func TestDedupeTransliterationsNoopWithoutDuplicates(t *testing.T) {
	doc := `<tt><transliterations><transliteration><text for="a">x</text></transliteration></transliterations></tt>`
	if got := dedupeTransliterations(doc); got != doc {
		t.Errorf("无重复 key 时应原样返回，实际:\n%s", got)
	}
}
