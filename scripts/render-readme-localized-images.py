#!/usr/bin/env python3
"""Render localized README diagrams from shared SpecNav B+D base images.

The base images keep the accepted visual style. This script renders deterministic
English and Simplified Chinese copy layers over the same base images so README
visuals stay compositionally identical across languages.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "docs" / "assets" / "readme"
OUT_DIRS = {
    "en": ASSET_DIR / "en",
    "zh-CN": ASSET_DIR / "zh-CN",
}

FONT_EN_REGULAR = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
FONT_EN_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
FONT_ZH = Path("/System/Library/Fonts/Hiragino Sans GB.ttc")
FONT_ZH_FALLBACK = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")

W, H = 2560, 1440


@dataclass(frozen=True)
class LocalizedText:
    title: str
    subtitle: str
    stage_chip: str
    goal: str
    cards: tuple[tuple[str, str], ...]
    gates: tuple[str, ...]


ASSETS = {
    "specnav-overview-bd-2k": {
        "source": "specnav-overview-bd-2k.png",
        "en": LocalizedText(
            title="SpecNav Lifecycle Map",
            subtitle="OpenSpec-governed delivery from bootstrap to archive",
            stage_chip="Overview",
            goal="Goal: keep every AI coding step evidence-backed and gated.",
            cards=(
                ("Bootstrap", "Initialize OpenSpec state"),
                ("Discovery", "Read repository evidence"),
                ("Requirements", "Negotiate specs and acceptance"),
                ("Prototype", "Build reviewable artifacts"),
                ("Development", "Implement scoped vertical slices"),
                ("Verification", "Run six-domain evidence checks"),
                ("Operations", "Release, monitor, and archive"),
            ),
            gates=("OpenSpec present", "Foundation specs ready", "Fresh green verification", "Archive receipt written"),
        ),
        "zh-CN": LocalizedText(
            title="SpecNav 生命周期地图",
            subtitle="用 OpenSpec 约束从初始化到归档的完整交付链路",
            stage_chip="总览",
            goal="目标：让每一次 AI 编码都有证据、有阶段门、有下一步边界。",
            cards=(
                ("初始化", "建立 OpenSpec 状态"),
                ("规范发现", "读取仓库事实证据"),
                ("需求", "收敛规格与验收"),
                ("原型", "产出可审阅原型"),
                ("开发", "垂直切片实现"),
                ("验证", "六域证据检查"),
                ("运维", "发布、监控与归档"),
            ),
            gates=("OpenSpec 已存在", "Foundation specs 就绪", "验证新鲜且为绿", "归档回执已写入"),
        ),
    },
    "stage-1-bootstrap-bd-2k": {
        "source": "stage-1-bootstrap-bd-2k.png",
        "en": LocalizedText(
            title="Bootstrap Stage",
            subtitle="Create the project state that makes SpecNav legal to run",
            stage_chip="Stage 1",
            goal="Goal: turn a plain repo into a SpecNav-governed project.",
            cards=(
                ("Doctor", "Check CLI, plugins, hooks"),
                ("Detect", "Find missing OpenSpec state"),
                ("Bootstrap", "Create scaffold and markers"),
                ("State", "Write workflow state"),
                ("Next Actions", "Report legal commands"),
            ),
            gates=("OpenSpec exists", "project marker written", "hooks trusted"),
        ),
        "zh-CN": LocalizedText(
            title="初始化阶段",
            subtitle="创建让 SpecNav 可以合法运行的项目状态",
            stage_chip="阶段 1",
            goal="目标：把普通仓库变成受 SpecNav 约束的项目。",
            cards=(
                ("Doctor", "检查 CLI、插件、hooks"),
                ("缺失判断", "发现 OpenSpec 状态缺口"),
                ("Bootstrap", "创建脚手架与标记"),
                ("状态写入", "写入 workflow state"),
                ("下一步", "输出合法命令"),
            ),
            gates=("OpenSpec 存在", "项目标记已写入", "hooks 已信任"),
        ),
    },
    "stage-2-discovery-bd-2k": {
        "source": "stage-2-discovery-bd-2k.png",
        "en": LocalizedText(
            title="Discovery Stage",
            subtitle="Read repository evidence before writing or asking requirements",
            stage_chip="Stage 2",
            goal="Goal: discover facts before forming foundation specs.",
            cards=(
                ("Read Only", "Scan repo structure"),
                ("Evidence", "Archive observed facts"),
                ("Gaps", "List missing contracts"),
                ("Foundation", "Create four base specs"),
                ("Validate", "Check spec contract"),
            ),
            gates=("evidence captured", "foundation specs exist", "validator green"),
        ),
        "zh-CN": LocalizedText(
            title="规范发现阶段",
            subtitle="在写需求或追问前，先读取真实仓库证据",
            stage_chip="阶段 2",
            goal="目标：先发现事实，再形成 foundation specs。",
            cards=(
                ("只读扫描", "扫描仓库结构"),
                ("证据归档", "记录观察事实"),
                ("缺口识别", "列出合同缺口"),
                ("Foundation", "创建四类基础 spec"),
                ("合同校验", "检查 spec 合同"),
            ),
            gates=("证据已捕获", "foundation specs 存在", "validator 通过"),
        ),
    },
    "stage-3-requirements-bd-2k": {
        "source": "stage-3-requirements-bd-2k.png",
        "en": LocalizedText(
            title="Requirements Stage",
            subtitle="Ask in decision units after foundation specs are ready",
            stage_chip="Stage 3",
            goal="Goal: converge requirements into acceptance and impact maps.",
            cards=(
                ("Gate Check", "Verify foundations"),
                ("Context", "Read specs and evidence"),
                ("Question", "Ask one decision at a time"),
                ("Artifacts", "Write requirements and maps"),
                ("Contract", "Close unresolved gaps"),
            ),
            gates=("foundation ok", "no unresolved gaps", "active change clear"),
        ),
        "zh-CN": LocalizedText(
            title="需求问需阶段",
            subtitle="foundation specs 就绪后，以决策单元追问需求",
            stage_chip="阶段 3",
            goal="目标：把需求收敛成验收标准和影响地图。",
            cards=(
                ("前置校验", "确认基础 specs"),
                ("读取上下文", "读取规格与证据"),
                ("一次一问", "每次解锁一个决策"),
                ("写入产物", "生成需求与映射"),
                ("合同收敛", "关闭未决缺口"),
            ),
            gates=("foundation ok", "无未决缺口", "active change 清楚"),
        ),
    },
    "stage-4-prototype-bd-2k": {
        "source": "stage-4-prototype-bd-2k.png",
        "en": LocalizedText(
            title="Prototype Stage",
            subtitle="Build something reviewable before production development",
            stage_chip="Stage 4",
            goal="Goal: make decisions visible before implementation hardens.",
            cards=(
                ("Precheck", "Confirm contracts"),
                ("Classify", "Sort open questions"),
                ("Prototype", "Create runnable artifact"),
                ("Verify", "Record behavior evidence"),
                ("Handoff", "Capture approval"),
            ),
            gates=("requirements ok", "runtime evidence", "user approved"),
        ),
        "zh-CN": LocalizedText(
            title="原型验证阶段",
            subtitle="进入生产开发前，先做可审阅的运行产物",
            stage_chip="阶段 4",
            goal="目标：在实现固化前，让关键决策可见。",
            cards=(
                ("合同预检", "确认上游合同"),
                ("问题分类", "整理开放问题"),
                ("可运行原型", "创建审阅产物"),
                ("验证报告", "记录行为证据"),
                ("批准交接", "捕获用户批准"),
            ),
            gates=("requirements ok", "runtime evidence", "user approved"),
        ),
    },
    "stage-5-development-bd-2k": {
        "source": "stage-5-development-bd-2k.png",
        "en": LocalizedText(
            title="Development Stage",
            subtitle="Implement through scoped vertical slices",
            stage_chip="Stage 5",
            goal="Goal: change production code only inside a locked scope.",
            cards=(
                ("Entry", "Check upstream gates"),
                ("Scope Lock", "Freeze allowed files"),
                ("Tasks", "Use checkbox ledger"),
                ("Implement", "Ship vertical slices"),
                ("Review", "Run fix and handoff"),
            ),
            gates=("entry ok", "scope ok", "review passed"),
        ),
        "zh-CN": LocalizedText(
            title="垂直开发阶段",
            subtitle="通过受限 scope 的垂直切片实现功能",
            stage_chip="阶段 5",
            goal="目标：只在锁定范围内修改生产代码。",
            cards=(
                ("开发入口", "检查上游 gate"),
                ("Scope Lock", "冻结允许文件"),
                ("任务切片", "使用 checkbox ledger"),
                ("垂直实现", "交付切片功能"),
                ("Review", "修复并交接"),
            ),
            gates=("entry ok", "scope ok", "review passed"),
        ),
    },
    "stage-6-verification-bd-2k": {
        "source": "stage-6-verification-bd-2k.png",
        "en": LocalizedText(
            title="Verification Stage",
            subtitle="Run six explicit domains before release",
            stage_chip="Stage 6",
            goal="Goal: prove the change with fresh, linked evidence.",
            cards=(
                ("Plan", "Select domains"),
                ("Six Domains", "Run evidence checks"),
                ("Aggregate", "Merge reports"),
                ("HTML", "Publish review page"),
                ("Rerun", "Fix stale or red domains"),
            ),
            gates=("handoff ok", "six domains green", "report fresh"),
        ),
        "zh-CN": LocalizedText(
            title="六域验证阶段",
            subtitle="发布前执行六个明确测试域",
            stage_chip="阶段 6",
            goal="目标：用新鲜且可追溯的证据证明变更。",
            cards=(
                ("验证计划", "选择测试域"),
                ("六域执行", "运行证据检查"),
                ("聚合报告", "合并验证结果"),
                ("HTML 报告", "生成审阅页面"),
                ("修复重跑", "处理 stale 或 red"),
            ),
            gates=("handoff ok", "六域全绿", "report fresh"),
        ),
    },
    "stage-7-operations-bd-2k": {
        "source": "stage-7-operations-bd-2k.png",
        "en": LocalizedText(
            title="Operations Stage",
            subtitle="Release, monitor, rollback, and archive with receipts",
            stage_chip="Stage 7",
            goal="Goal: close the change only after operational evidence exists.",
            cards=(
                ("Target", "Select release target"),
                ("Plan", "Write release plan"),
                ("Readiness", "Check deploy gates"),
                ("Operate", "Deploy, monitor, rollback"),
                ("Archive", "Write receipt"),
            ),
            gates=("verify green", "release target clear", "archive receipt"),
        ),
        "zh-CN": LocalizedText(
            title="运维归档阶段",
            subtitle="用回执完成发布、监控、回滚与归档",
            stage_chip="阶段 7",
            goal="目标：只有运维证据存在后，才关闭 change。",
            cards=(
                ("目标选择", "确认 release target"),
                ("发布计划", "写入 release plan"),
                ("Readiness", "检查部署 gate"),
                ("运行治理", "部署、监控、回滚"),
                ("归档", "写入 archive receipt"),
            ),
            gates=("verify green", "release target 清楚", "archive receipt"),
        ),
    },
}


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.truetype(str(FONT_ZH_FALLBACK), size)


def fonts(lang: str) -> dict[str, ImageFont.FreeTypeFont]:
    if lang == "zh-CN":
        regular = FONT_ZH if FONT_ZH.exists() else FONT_ZH_FALLBACK
        bold = regular
    else:
        regular = FONT_EN_REGULAR
        bold = FONT_EN_BOLD
    return {
        "title": font(bold, 60),
        "subtitle": font(regular, 31),
        "chip": font(bold, 25),
        "goal": font(regular, 26),
        "card_title": font(bold, 29),
        "card_body": font(regular, 23),
        "gate": font(bold, 22),
    }


def text_width(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0]


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    fnt: ImageFont.FreeTypeFont,
    max_width: int,
    lang: str,
) -> list[str]:
    if text_width(draw, text, fnt) <= max_width:
        return [text]
    units: Iterable[str]
    if lang == "zh-CN":
        units = list(text)
    else:
        units = text.split()
    lines: list[str] = []
    current = ""
    for unit in units:
        candidate = (current + unit) if lang == "zh-CN" else (unit if not current else f"{current} {unit}")
        if text_width(draw, candidate, fnt) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = unit
    if current:
        lines.append(current)
    return lines[:2]


def draw_text_lines(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    lines: Iterable[str],
    fnt: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    line_gap: int = 6,
) -> int:
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        box = draw.textbbox((x, y), line, font=fnt)
        y = box[3] + line_gap
    return y


def draw_arrow(draw: ImageDraw.ImageDraw, x1: int, y: int, x2: int) -> None:
    color = (20, 92, 91)
    draw.line((x1, y, x2, y), fill=color, width=5)
    draw.polygon([(x2, y), (x2 - 16, y - 10), (x2 - 16, y + 10)], fill=color)


def draw_localized(base_path: Path, text: LocalizedText, lang: str, out_path: Path) -> None:
    f = fonts(lang)
    base = Image.open(base_path).convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    # The AI-generated bases contain embedded labels. Treat them as a shared
    # visual layer, not as readable copy, so language variants can be identical
    # except for the deterministic text rendered below.
    bg = base.filter(ImageFilter.GaussianBlur(4.1))
    bg = ImageEnhance.Contrast(bg).enhance(0.7)
    bg = ImageEnhance.Color(bg).enhance(0.86)
    canvas = bg.convert("RGBA")

    wash = Image.new("RGBA", (W, H), (246, 239, 221, 152))
    canvas.alpha_composite(wash)
    draw = ImageDraw.Draw(canvas)

    navy = (22, 43, 55)
    teal = (18, 112, 111)
    cream = (252, 246, 231)
    paper = (248, 240, 221)
    coral = (191, 91, 70)
    line = (24, 94, 93)

    # Header panel.
    draw.rounded_rectangle((72, 56, 1450, 248), radius=24, fill=(*cream, 235), outline=line, width=4)
    draw.rounded_rectangle((105, 86, 260, 128), radius=14, fill=teal, outline=(10, 65, 65), width=2)
    chip_w = text_width(draw, text.stage_chip, f["chip"])
    draw.text((105 + (155 - chip_w) / 2, 94), text.stage_chip, font=f["chip"], fill=(255, 255, 245))
    draw.text((295, 78), text.title, font=f["title"], fill=navy)
    draw.text((298, 151), text.subtitle, font=f["subtitle"], fill=(52, 70, 72))
    goal_lines = wrap_text(draw, text.goal, f["goal"], 1080, lang)
    draw_text_lines(draw, (298, 194), goal_lines, f["goal"], coral, 4)

    # Footer route panel.
    draw.rounded_rectangle((72, 1118, 2488, 1378), radius=28, fill=(*paper, 238), outline=line, width=4)
    n = len(text.cards)
    gap = 18
    card_y = 1152
    card_h = 132
    left = 118
    usable = 2324
    card_w = int((usable - gap * (n - 1)) / n)

    centers: list[tuple[int, int]] = []
    for i, (title, body) in enumerate(text.cards, start=1):
        x = left + (i - 1) * (card_w + gap)
        centers.append((x + card_w // 2, card_y + 66))
        draw.rounded_rectangle((x, card_y, x + card_w, card_y + card_h), radius=18, fill=(255, 252, 242, 245), outline=(109, 135, 127), width=3)
        draw.ellipse((x + 18, card_y + 22, x + 62, card_y + 66), fill=teal, outline=(10, 65, 65), width=2)
        num = str(i)
        nw = text_width(draw, num, f["card_title"])
        draw.text((x + 40 - nw / 2, card_y + 25), num, font=f["card_title"], fill=(255, 255, 246))
        draw.text((x + 78, card_y + 18), title, font=f["card_title"], fill=navy)
        body_lines = wrap_text(draw, body, f["card_body"], card_w - 98, lang)
        draw_text_lines(draw, (x + 78, card_y + 62), body_lines, f["card_body"], (65, 75, 72), 3)

    for (x1, y1), (x2, _) in zip(centers, centers[1:]):
        draw_arrow(draw, x1 + card_w // 2 - 10, y1, x2 - card_w // 2 + 10)

    # Gate pills.
    gate_y = 1312
    gate_gap = 18
    gate_widths = [max(260, text_width(draw, gate, f["gate"]) + 56) for gate in text.gates]
    total_gate_width = sum(gate_widths) + gate_gap * (len(gate_widths) - 1)
    gx = int((W - total_gate_width) / 2)
    for gate, gw in zip(text.gates, gate_widths):
        draw.rounded_rectangle((gx, gate_y, gx + gw, gate_y + 44), radius=22, fill=(21, 58, 67, 240), outline=(10, 38, 43), width=2)
        draw.text((gx + 28, gate_y + 10), gate, font=f["gate"], fill=(250, 247, 235))
        gx += gw + gate_gap

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out_path, "JPEG", quality=91, optimize=True, progressive=True)


def main() -> None:
    for out_dir in OUT_DIRS.values():
        out_dir.mkdir(parents=True, exist_ok=True)
    for slug, config in ASSETS.items():
        base_path = ASSET_DIR / config["source"]
        if not base_path.exists():
            raise FileNotFoundError(base_path)
        for lang in ("en", "zh-CN"):
            out_path = OUT_DIRS[lang] / f"{slug}.jpg"
            draw_localized(base_path, config[lang], lang, out_path)
            print(out_path.relative_to(ROOT))


if __name__ == "__main__":
    main()
