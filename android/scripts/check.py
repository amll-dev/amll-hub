#!/usr/bin/env python3
"""Android 资源与构建脚本的本地静态检查。

在没有 Android SDK 的环境里，用它提前发现 XML 语法、注释非法字符、
compileSdk 不足、AGP 9 插件残留、gradlew 权限/换行等问题，
避免每次都等 CI 报错。

用法：
    python3 android/scripts/check.py

退出码 0 表示通过，1 表示有问题。
"""

from __future__ import annotations

import re
import subprocess
import sys
import xml.dom.minidom
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []

# Compose BOM 2026.06 / Navigation 2.10 / Coil 3.6 / OkHttp 5.5 等依赖的共同要求
REQUIRED_COMPILE_SDK = 37


def _strip_comments(text: str, prefixes: tuple[str, ...]) -> str:
    """去掉整行注释，避免注释里的关键字被当成真实声明。"""
    return "\n".join(
        line for line in text.splitlines() if not line.strip().startswith(prefixes)
    )


def check_xml() -> None:
    """XML 必须能被解析，且注释内不能出现 '--'（XML 规范禁止）。"""
    files = list((ROOT / "app/src").rglob("*.xml"))
    if not files:
        errors.append("未找到任何 XML 文件，路径可能有误")
        return
    for f in files:
        text = f.read_text(encoding="utf-8")
        try:
            xml.dom.minidom.parseString(text)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{f.relative_to(ROOT)}: XML 解析失败 {exc}")
            continue
        for m in re.finditer(r"<!--(.*?)-->", text, re.S):
            if "--" in m.group(1):
                errors.append(
                    f"{f.relative_to(ROOT)}: 注释内含非法 '--' -> {m.group(1).strip()[:60]!r}"
                )


def check_agp9() -> None:
    """AGP 9 使用内置 Kotlin：不能声明 kotlin-android 插件，也不能用 kotlinOptions。"""
    toml = ROOT / "gradle/libs.versions.toml"
    props = ROOT / "gradle.properties"

    if toml.exists():
        code = _strip_comments(toml.read_text(encoding="utf-8"), ("#",))
        if "kotlin-android" in code or "kotlin.android" in code:
            errors.append(
                "libs.versions.toml 仍声明 kotlin-android 插件："
                "AGP 9 已内置 Kotlin，声明它会报 BaseExtension ClassCastException"
            )

    for script in (ROOT / "build.gradle.kts", ROOT / "app/build.gradle.kts"):
        if not script.exists():
            continue
        code = _strip_comments(script.read_text(encoding="utf-8"), ("//",))
        if "kotlin.android" in code:
            errors.append(f"{script.relative_to(ROOT)}: 不应再应用 kotlin-android 插件")
        if re.search(r"\bkotlinOptions\s*\{", code):
            errors.append(
                f"{script.relative_to(ROOT)}: android.kotlinOptions 已被 AGP 9 移除，"
                "请改用顶层 kotlin.compilerOptions"
            )

    if props.exists() and "android.builtInKotlin=true" not in props.read_text(encoding="utf-8"):
        errors.append("gradle.properties 建议显式设置 android.builtInKotlin=true")


def check_wrapper() -> None:
    """gradlew 必须在项目根，且在 git 索引里是可执行位，否则 Linux CI 会失败。

    注意：Windows 文件系统不保留 Unix 权限位，所以要看 git 索引（100755），
    直接检查本地文件会误报。
    """
    for name in ("gradlew", "gradlew.bat"):
        f = ROOT / name
        if not f.exists():
            errors.append(f"缺少 {name}（应在项目根，与 settings.gradle.kts 同级）")
            continue
        if name == "gradlew":
            # 只有 shell 脚本需要 shebang；.bat 是 Windows 批处理
            first = f.read_bytes().split(b"\n", 1)[0]
            if not first.startswith(b"#!") or b"\r" in first:
                errors.append(f"{name} 的 shebang 有误（疑似 CRLF 换行）: {first!r}")

    try:
        out = subprocess.run(
            ["git", "ls-files", "-s", "android/gradlew"],
            cwd=ROOT.parent,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
    except Exception:  # noqa: BLE001
        return
    if out and not out.startswith("100755"):
        mode = out.split()[0] if out else "?"
        errors.append(
            f"git 索引中 gradlew 权限为 {mode} 而非 100755，"
            "Linux CI 上 ./gradlew 会报 Permission denied；"
            "请执行 git update-index --chmod=+x android/gradlew"
        )


def check_gradle_versions() -> None:
    """Gradle 必须满足 AGP 9.4 的下限，且 AGP 需与 Hilt 2.60+ 匹配。"""
    props = ROOT / "gradle/wrapper/gradle-wrapper.properties"
    toml = ROOT / "gradle/libs.versions.toml"
    if not props.exists() or not toml.exists():
        return
    m = re.search(r"gradle-(\d+)\.(\d+)", props.read_text(encoding="utf-8"))
    if not m:
        errors.append("gradle-wrapper.properties 里未解析到 Gradle 版本")
        return
    major, minor = int(m.group(1)), int(m.group(2))
    if (major, minor) < (9, 6):
        errors.append(f"Gradle {major}.{minor} 低于 AGP 9.4 要求的 9.6")

    agp = re.search(r'^agp\s*=\s*"([\w.]+)"', toml.read_text(encoding="utf-8"), re.M)
    if agp and not agp.group(1).startswith("9."):
        errors.append(
            f"AGP {agp.group(1)} 与 Hilt 2.60+ 不兼容（Hilt 2.60+ 需要 AGP >= 9.0.0）"
        )


def check_compile_sdk() -> None:
    """compileSdk 必须 >= 37，否则 checkDebugAarMetadata 会因二十多个依赖集体报错。

    targetSdk 与 compileSdk 相互独立，这里只校验 compileSdk。
    """
    script = ROOT / "app/build.gradle.kts"
    if not script.exists():
        return
    code = _strip_comments(script.read_text(encoding="utf-8"), ("//",))
    m = re.search(r"\bcompileSdk\s*=\s*(\d+)", code)
    if not m:
        errors.append("app/build.gradle.kts 里未找到 compileSdk 声明")
        return
    if int(m.group(1)) < REQUIRED_COMPILE_SDK:
        errors.append(
            f"compileSdk {m.group(1)} 过低：Compose BOM 2026.06 / Navigation 2.10 / "
            f"Coil 3.6 / OkHttp 5.5 等依赖要求 >= {REQUIRED_COMPILE_SDK}"
        )


def main() -> int:
    check_xml()
    check_agp9()
    check_wrapper()
    check_gradle_versions()
    check_compile_sdk()

    if errors:
        print("发现问题：")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("静态检查通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
