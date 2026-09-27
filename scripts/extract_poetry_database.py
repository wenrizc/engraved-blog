from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

BOOK_MARKERS = [
    ("美国现代诗选", "", ""),
    ("王尔德诗选", "奥斯卡·王尔德", "Oscar Wilde"),
    ("丁尼生诗选", "阿尔弗雷德·丁尼生", "Alfred, Lord Tennyson"),
    ("约翰·但恩诗选", "约翰·但恩", "John Donne"),
    ("豪斯曼诗选", "A. E. 豪斯曼", "A. E. Housman"),
    ("哈代诗选", "托马斯·哈代", "Thomas Hardy"),
    ("劳伦斯诗选", "D. H. 劳伦斯", "D. H. Lawrence"),
    ("勃朗宁夫人十四行诗", "伊丽莎白·巴雷特·勃朗宁", "Elizabeth Barrett Browning"),
    ("爱伦·坡诗选", "埃德加·爱伦·坡", "Edgar Allan Poe"),
    ("狄兰·托马斯诗选", "狄兰·托马斯", "Dylan Thomas"),
    ("惠特曼诗选", "沃尔特·惠特曼", "Walt Whitman"),
    ("勃朗宁诗选", "罗伯特·勃朗宁", "Robert Browning"),
    ("泰戈尔诗选", "泰戈尔", "Rabindranath Tagore"),
    ("彭斯诗选", "罗伯特·彭斯", "Robert Burns"),
    ("莎士比亚十四行诗", "威廉·莎士比亚", "William Shakespeare"),
    ("狄金森诗选", "艾米莉·狄金森", "Emily Dickinson"),
    ("华兹华斯诗选", "威廉·华兹华斯", "William Wordsworth"),
    ("雪莱诗选", "珀西·比希·雪莱", "Percy Bysshe Shelley"),
    ("拜伦诗选", "乔治·戈登·拜伦", "George Gordon Byron"),
    ("纪伯伦诗选", "纪伯伦", "Kahlil Gibran"),
    ("济慈诗选", "约翰·济慈", "John Keats"),
]

SKIP_TITLES = {
    "总目录", "目录", "Contents", "Copyright", "版权页", "书名页", "作者简介", "译序", "译　序", "译者前言",
    "前言", "前 言", "序", "译本序", "说明", "注释", "Notes", "Copyright Page",
}

SKIP_TITLE_PARTS = [
    "序《英诗经典名家名译》", "中译本序", "译者", "前言", "序言", "版权", "书名页", "作者简介", "传",
]

EN_LETTER_RE = re.compile(r"[A-Za-z]")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
BAD_CN_LINE_RE = re.compile(r"^(注释|注：|注|第[一二三四五六七八九十百〇○0-9]+[章节]|[①②③④⑤⑥⑦⑧⑨⑩]|\[[0-9]+\])")
BAD_EN_LINE_RE = re.compile(r"^(note|notes|chapter|copyright|contents)$", re.I)
CN_ANNOTATION_LINE_RE = re.compile(
    r"(原诗(?:韵式|抑扬格)|译诗每行|译文依|这首诗|出版于|亦译作|"
    r"古罗马宗教|北纬|南纬|指(?:的是|：)|注释|译者按)"
)
CN_TRAILING_LINE_NUMBER_RE = re.compile(r"(?<=[。！？；：])\s*\d{1,3}$")
COMPLETE_CN_END_RE = re.compile(r"[。！？][”’）》）】」』]*$")
ROMAN_RE = re.compile(r"^(?=[MDCLXVI]+\b)[MDCLXVI]+(?:[.、\s].*)?$", re.I)
ARABIC_RE = re.compile(r"^\d{1,3}$")
CN_NUMBER_RE = re.compile(r"^[一二三四五六七八九十百〇○零]{1,6}(?:[、\s].*)?$")
INLINE_BILINGUAL_FILES = {
    "text00327.html",
    "text00328.html",
    "text00738.html",
    "text01347.html",
}


class XHTMLTextParser(HTMLParser):
    block_tags = {"p", "h1", "h2", "h3", "h4", "h5", "li", "div", "blockquote"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.current: list[str] = []
        self.in_title = False
        self.title_parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style"}:
            self.skip_depth += 1
        if tag == "title":
            self.in_title = True
        if tag in self.block_tags:
            self.flush()
        if tag == "br":
            self.flush()

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style"} and self.skip_depth:
            self.skip_depth -= 1
        if tag == "title":
            self.in_title = False
        if tag in self.block_tags:
            self.flush()

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = normalize_space(data)
        if not text:
            return
        if self.in_title:
            self.title_parts.append(text)
            return
        self.current.append(text)

    def flush(self) -> None:
        text = normalize_space(" ".join(self.current))
        if text:
            self.lines.append(text)
        self.current = []

    def close(self) -> None:
        self.flush()
        super().close()

    @property
    def title(self) -> str:
        return normalize_space(" ".join(self.title_parts))


def normalize_space(value: str) -> str:
    value = value.replace("\u3000", " ").replace("\xa0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def clean_title(value: str) -> str:
    value = normalize_space(value)
    value = re.sub(r"\s*[①②③④⑤⑥⑦⑧⑨⑩]+\s*$", "", value)
    value = re.sub(r"\s*[【\[]\d+[】\]]\s*$", "", value)
    return value.strip()


def has_cjk(value: str) -> bool:
    return bool(CJK_RE.search(value))


def has_english(value: str) -> bool:
    return bool(EN_LETTER_RE.search(value))


def text_file_number(src: str) -> int:
    match = re.search(r"text(\d+)\.html", src)
    return int(match.group(1)) if match else -1


def read_xhtml(zf: zipfile.ZipFile, src: str) -> tuple[str, list[str]]:
    path = src.split("#", 1)[0]
    full = "OEBPS/" + path
    raw = zf.read(full).decode("utf-8", errors="ignore")
    return parse_xhtml_text(raw)


def parse_xhtml_text(raw: str) -> tuple[str, list[str]]:
    parser = XHTMLTextParser()
    parser.feed(raw)
    parser.close()
    return parser.title, [normalize_space(line) for line in parser.lines if normalize_space(line)]


def find_fragment_position(raw: str, fragment: str) -> int:
    if not fragment:
        return 0
    escaped = re.escape(fragment)
    pattern = re.compile(rf"<[^>]+(?:id|name)\s*=\s*['\"]{escaped}['\"][^>]*>", re.I)
    match = pattern.search(raw)
    return match.start() if match else 0


def build_html_cache(
    zf: zipfile.ZipFile,
    entries: list[dict[str, Any]],
    toc: list[dict[str, Any]],
) -> dict[str, tuple[str, list[str]]]:
    cache: dict[str, tuple[str, list[str]]] = {}
    raw_cache: dict[str, str] = {}
    position_cache: dict[tuple[str, str], int] = {}
    toc_by_file: dict[str, list[dict[str, Any]]] = {}

    for entry in toc:
        if entry["file"].endswith(".html"):
            toc_by_file.setdefault(entry["file"], []).append(entry)

    def read_raw(file: str) -> str:
        if file not in raw_cache:
            raw_cache[file] = zf.read("OEBPS/" + file).decode("utf-8", errors="ignore")
        return raw_cache[file]

    def fragment_position(file: str, fragment: str) -> int:
        key = (file, fragment)
        if key not in position_cache:
            position_cache[key] = find_fragment_position(read_raw(file), fragment)
        return position_cache[key]

    for entry in entries:
        key = entry["src"]
        file = entry["file"]
        if not file or key in cache or not file.endswith(".html"):
            continue
        try:
            raw = read_raw(file)
            start = fragment_position(file, entry["fragment"]) if entry["fragment"] else 0
            end = len(raw)
            for later in toc_by_file.get(file, []):
                if later["tocIndex"] <= entry["tocIndex"] or not later["fragment"]:
                    continue
                candidate_end = fragment_position(file, later["fragment"])
                if candidate_end > start:
                    end = candidate_end
                    break
            cache[key] = parse_xhtml_text(raw[start:end])
        except KeyError:
            continue
    return cache


def parse_toc(zf: zipfile.ZipFile) -> list[dict[str, Any]]:
    root = ET.fromstring(zf.read("OEBPS/toc.ncx"))
    ns = {"n": "http://www.daisy.org/z3986/2005/ncx/"}
    entries: list[dict[str, Any]] = []
    current_book: dict[str, str] | None = None

    for index, nav in enumerate(root.findall(".//n:navPoint", ns)):
        label_node = nav.find("./n:navLabel/n:text", ns)
        content_node = nav.find("./n:content", ns)
        label = clean_title("".join(label_node.itertext())) if label_node is not None else ""
        src = content_node.attrib.get("src", "") if content_node is not None else ""

        for marker, author_cn, author_en in BOOK_MARKERS:
            if marker in label and "英汉对照" in label:
                current_book = {
                    "bookTitle": label,
                    "bookMarker": marker,
                    "author": author_cn,
                    "authorEn": author_en,
                }
                break

        if current_book and current_book["bookMarker"] == "美国现代诗选":
            author_match = re.match(r"(.+?)（([^（）]+),\s*(\d{4})[—–-](\d{4})）", label)
            if author_match:
                current_book = {
                    **current_book,
                    "author": author_match.group(1).strip(),
                    "authorEn": author_match.group(2).split(",", 1)[0].strip(),
                    "dates": f"{author_match.group(3)}–{author_match.group(4)}",
                }

        book = dict(current_book) if current_book else None

        entries.append({
            "tocIndex": index,
            "label": label,
            "src": src,
            "file": src.split("#", 1)[0],
            "fragment": src.split("#", 1)[1] if "#" in src else "",
            "fileNumber": text_file_number(src),
            "book": book,
        })
    return entries


def collect_candidate_pairs(toc: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    i = 0
    while i < len(toc) - 1:
        en = toc[i]
        zh = toc[i + 1]
        if not en.get("book") or en.get("book") != zh.get("book"):
            i += 1
            continue
        en_title = clean_title(en["label"])
        zh_title = clean_title(zh["label"])
        if not is_english_title(en_title) or not is_chinese_title(zh_title):
            i += 1
            continue
        if en["fileNumber"] < 0 or zh["fileNumber"] < 0 or abs(en["fileNumber"] - zh["fileNumber"]) > 2:
            i += 1
            continue
        pairs.append((en, zh))
        i += 2
    return pairs


def is_skip_title(title: str) -> bool:
    plain = clean_title(title)
    if plain in SKIP_TITLES:
        return True
    return any(part in plain for part in SKIP_TITLE_PARTS)


def is_english_title(title: str) -> bool:
    if not title or is_skip_title(title):
        return False
    letters = len(EN_LETTER_RE.findall(title))
    cjk = len(CJK_RE.findall(title))
    return letters > 0 and letters >= cjk


def is_chinese_title(title: str) -> bool:
    if not title or is_skip_title(title):
        return False
    return has_cjk(title)


def clean_lines(lines: list[str], title: str, book_title: str | None, language: str) -> list[str]:
    cleaned: list[str] = []
    seen_body = False
    for line in lines:
        line = clean_line(line)
        if not line:
            continue
        if book_title and clean_title(line) == clean_title(book_title):
            continue
        if clean_title(line) == clean_title(title):
            continue
        if language == "zh":
            if BAD_CN_LINE_RE.search(line):
                if seen_body:
                    break
                continue
            if CN_ANNOTATION_LINE_RE.search(line):
                if seen_body:
                    break
                continue
            if line in {"注释", "注 释"}:
                break
            if not has_cjk(line) and len(line) < 24:
                continue
        else:
            if BAD_EN_LINE_RE.search(line):
                continue
            if not has_english(line) and len(line) < 24:
                continue
        cleaned.append(line)
        seen_body = True
    return cleaned


def clean_line(line: str) -> str:
    line = normalize_space(line)
    line = re.sub(r"\s*[①②③④⑤⑥⑦⑧⑨⑩]+\s*", "", line)
    line = re.sub(r"\s*[【\[]\d+[】\]]\s*", "", line)
    if has_cjk(line):
        line = CN_TRAILING_LINE_NUMBER_RE.sub("", line)
        line = normalize_chinese_punctuation(line)
    line = re.sub(r"\s+([，。！？；：、,.!?;:])", r"\1", line)
    return line.strip()


def normalize_chinese_punctuation(line: str) -> str:
    replacements = {
        ",": "，",
        ";": "；",
        ":": "：",
        "?": "？",
        "!": "！",
    }
    for source, target in replacements.items():
        line = line.replace(source, target)
    line = line.replace("——", "—")
    line = re.sub(r"\s*—\s*", "—", line)
    line = re.sub(r"\s+", " ", line)
    return line


def stable_id(*parts: str) -> str:
    raw = "|".join(parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:14]


def pair_poems(pairs: list[tuple[dict[str, Any], dict[str, Any]]], html_cache: dict[str, tuple[str, list[str]]]) -> list[dict[str, Any]]:
    poems: list[dict[str, Any]] = []
    for en, zh in pairs:
        en_title = clean_title(en["label"])
        zh_title = clean_title(zh["label"])

        _, en_lines_raw = html_cache.get(en["src"], ("", []))
        _, zh_lines_raw = html_cache.get(zh["src"], ("", []))
        book = en["book"]
        assert book is not None
        en_lines = clean_lines(en_lines_raw, en_title, book.get("bookTitle"), "en")
        zh_lines = clean_lines(zh_lines_raw, zh_title, book.get("bookTitle"), "zh")
        if len(en_lines) < 1 or len(zh_lines) < 1:
            continue

        poem_id = stable_id(book["authorEn"], en_title, zh_title, en["src"], zh["src"])
        poems.append({
            "id": poem_id,
            "author": book["author"],
            "authorEn": book["authorEn"],
            "collection": book["bookTitle"],
            "collectionKey": book["bookMarker"],
            "title": zh_title,
            "titleEn": en_title,
            "language": "zh-en",
            "source": {
                "epub": "英诗经典名家名译全集（套装共21本）（外研社出品）",
                "englishHref": "OEBPS/" + en["src"],
                "chineseHref": "OEBPS/" + zh["src"],
                "englishTocIndex": en["tocIndex"],
                "chineseTocIndex": zh["tocIndex"],
            },
            "lines": {
                "zh": zh_lines,
                "en": en_lines,
            },
            "stanzas": [{"zh": zh_lines, "en": en_lines}],
        })
    return poems


def is_inline_en_heading(line: str, author: str) -> bool:
    clean = clean_line(line)
    if not clean:
        return False
    if author in {"A. E. 豪斯曼", "伊丽莎白·巴雷特·勃朗宁"}:
        return bool(ROMAN_RE.match(clean))
    if author == "威廉·莎士比亚":
        return bool(ARABIC_RE.match(clean))
    return False


def is_inline_zh_heading(line: str, author: str) -> bool:
    clean = clean_line(line)
    if not clean:
        return False
    if author == "A. E. 豪斯曼":
        return bool(CN_NUMBER_RE.match(clean) or re.match(r"^后[·\s]*[一二三四五六七八九十百〇○零]+", clean))
    if author in {"伊丽莎白·巴雷特·勃朗宁", "威廉·莎士比亚"}:
        return bool(ARABIC_RE.match(clean))
    return False


def strip_note_tail(lines: list[str]) -> list[str]:
    result: list[str] = []
    for line in lines:
        if line.startswith("［浅释］") or line.startswith("[浅释]") or line.startswith("浅释"):
            break
        if line.startswith("[") and re.match(r"^\[\d+\]", line):
            break
        result.append(line)
    return result


def trim_inline_lines(lines: list[str], title: str, book_title: str, language: str) -> list[str]:
    cleaned = clean_lines(lines, title, book_title, language)
    return strip_note_tail(cleaned) if language == "zh" else cleaned


def make_poem(
    book: dict[str, str],
    title_en: str,
    title_zh: str,
    en_lines: list[str],
    zh_lines: list[str],
    source: dict[str, Any],
) -> dict[str, Any] | None:
    title_en = clean_title(title_en)
    title_zh = clean_title(title_zh)
    en_lines = trim_inline_lines(en_lines, title_en, book.get("bookTitle", ""), "en")
    zh_lines = trim_inline_lines(zh_lines, title_zh, book.get("bookTitle", ""), "zh")
    if not title_en or not title_zh or len(en_lines) < 1 or len(zh_lines) < 1:
        return None
    poem_id = stable_id(book["authorEn"], title_en, title_zh, str(source))
    return {
        "id": poem_id,
        "author": book["author"],
        "authorEn": book["authorEn"],
        "collection": book["bookTitle"],
        "collectionKey": book["bookMarker"],
        "title": title_zh,
        "titleEn": title_en,
        "language": "zh-en",
        "source": source,
        "lines": {
            "zh": zh_lines,
            "en": en_lines,
        },
        "stanzas": [{"zh": zh_lines, "en": en_lines}],
    }


def parse_inline_bilingual_poems(zf: zipfile.ZipFile, toc: list[dict[str, Any]]) -> list[dict[str, Any]]:
    poems: list[dict[str, Any]] = []
    seen_files: set[str] = set()
    for entry in toc:
        file = entry["file"]
        book = entry.get("book")
        if file not in INLINE_BILINGUAL_FILES or file in seen_files or not book:
            continue
        seen_files.add(file)
        _, raw_lines = read_xhtml(zf, file)
        lines = [clean_line(line) for line in raw_lines if clean_line(line)]
        title_en = ""
        en_lines: list[str] = []
        title_zh = ""
        zh_lines: list[str] = []
        state: str | None = None

        def flush() -> None:
            nonlocal title_en, en_lines, title_zh, zh_lines
            poem = make_poem(
                book,
                title_en,
                title_zh,
                en_lines,
                zh_lines,
                {
                    "epub": "英诗经典名家名译全集（套装共21本）（外研社出品）",
                    "englishHref": "OEBPS/" + file,
                    "chineseHref": "OEBPS/" + file,
                    "inlineBilingual": True,
                },
            )
            if poem:
                poems.append(poem)
            title_en = ""
            en_lines = []
            title_zh = ""
            zh_lines = []

        for line in lines:
            if not line or clean_title(line) == clean_title(book["bookTitle"]) or clean_title(line) == clean_title(book["bookMarker"]):
                continue
            if is_inline_en_heading(line, book["author"]):
                if title_en and title_zh:
                    flush()
                title_en = line
                state = "en"
                continue
            if title_en and is_inline_zh_heading(line, book["author"]):
                title_zh = line
                state = "zh"
                continue
            if state == "en":
                en_lines.append(line)
            elif state == "zh":
                zh_lines.append(line)
        if title_en and title_zh:
            flush()
    return poems


def merge_poems(primary: list[dict[str, Any]], extra: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for poem in primary + extra:
        key = (poem["authorEn"], poem["titleEn"], poem["title"])
        if key in seen:
            continue
        seen.add(key)
        merged.append(poem)
    return merged


def split_cn_sentences(lines: list[str]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    max_quote_lines = 8
    max_quote_chars = 120
    for start in range(len(lines)):
        previous = clean_line(lines[start - 1]) if start > 0 else ""
        if previous and not is_complete_chinese_sentence(previous):
            continue
        for span in range(1, max_quote_lines + 1):
            chunk = lines[start:start + span]
            if len(chunk) != span:
                continue
            quote_lines = [clean_line(line) for line in chunk]
            text = "\n".join(quote_lines)
            chars = len(re.sub(r"\s", "", text))
            if (
                10 <= chars <= max_quote_chars
                and has_cjk(text)
                and is_complete_chinese_sentence(text)
                and not BAD_CN_LINE_RE.search(text)
            ):
                candidates.append({
                    "text": text,
                    "quoteLines": quote_lines,
                    "lineStart": start + 1,
                    "lineEnd": start + span,
                    "span": span,
                })
    return candidates


def is_complete_chinese_sentence(text: str) -> bool:
    return bool(COMPLETE_CN_END_RE.search(clean_line(text)))


def score_quote(text: str, poem: dict[str, Any]) -> int:
    score = 0
    chars = len(re.sub(r"\s", "", text))
    line_count = text.count("\n") + 1
    if 18 <= chars <= 76:
        score += 16
    elif 77 <= chars <= 110:
        score += 8
    else:
        score += 3
    if is_complete_chinese_sentence(text):
        score += 32
    if 2 <= line_count <= 5:
        score += 6
    elif line_count > 6:
        score -= 5
    if re.search(r"[，；：、—]$", text):
        score -= 40
    if any(word in text for word in ["生命", "死亡", "心", "灵魂", "梦", "爱", "光", "黑夜", "春", "秋", "海", "星", "天空", "时间", "美", "自由", "孤独", "希望"]):
        score += 12
    if any(word in text for word in ["我", "你", "我们", "人间", "世界"]):
        score += 4
    if any(word in poem["title"] for word in ["夜莺", "西风", "云雀", "十四行诗", "飞鸟", "草叶", "尤利西斯", "水仙", "秋", "希望"]):
        score += 8
    if re.search(r"注释|译者|版权|目录|第.+章|[0-9]{3,}", text):
        score -= 50
    if len(set(text)) < max(4, len(text) // 4):
        score -= 8
    return score


def choose_quotes(poems: list[dict[str, Any]], max_per_poem: int = 1) -> list[dict[str, Any]]:
    quotes: list[dict[str, Any]] = []
    seen_texts: set[str] = set()
    for poem in poems:
        candidates = split_cn_sentences(poem["lines"]["zh"])
        if not candidates:
            continue
        ranked = sorted(candidates, key=lambda item: score_quote(item["text"], poem), reverse=True)
        picked = 0
        for candidate in ranked[:8]:
            text = candidate["text"]
            normalized = re.sub(r"\W+", "", text)
            if normalized in seen_texts:
                continue
            seen_texts.add(normalized)
            quote_id = stable_id(poem["id"], text, str(candidate["lineStart"]))
            quotes.append({
                "id": quote_id,
                "poemId": poem["id"],
                "text": text,
                "lines": candidate["quoteLines"],
                "author": poem["author"],
                "work": f"《{poem['title']}》",
            })
            picked += 1
            if picked >= max_per_poem:
                break
    return quotes


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_ts_quotes(path: Path, json_relative: str) -> None:
    path.write_text(
        "import poetryData from './" + json_relative + "';\n\n"
        "export interface PoetryQuote {\n"
        "  id: string;\n"
        "  poemId: string;\n"
        "  text: string;\n"
        "  lines: string[];\n"
        "  author: string;\n"
        "  work: string;\n"
        "}\n\n"
        "export const poetryQuotes = poetryData.quotes as PoetryQuote[];\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract bilingual poetry database and display quote candidates from an EPUB.")
    parser.add_argument("epub", nargs="?", default=None, help="Path to EPUB. Defaults to the first .epub in the project root.")
    parser.add_argument("--poems-out", default="src/data/generated/poetry-poems.json")
    parser.add_argument("--quotes-out", default="src/data/generated/poetry-quotes.json")
    parser.add_argument("--ts-out", default="src/data/poetryQuotes.ts")
    parser.add_argument("--max-per-poem", type=int, default=1)
    args = parser.parse_args()

    epub_path = Path(args.epub) if args.epub else next(Path(".").glob("*.epub"))
    with zipfile.ZipFile(epub_path) as zf:
        toc = parse_toc(zf)
        pairs = collect_candidate_pairs(toc)
        entries = [entry for pair in pairs for entry in pair]
        html_cache = build_html_cache(zf, entries, toc)
        poems = pair_poems(pairs, html_cache)
        poems = merge_poems(poems, parse_inline_bilingual_poems(zf, toc))

    quotes = choose_quotes(poems, args.max_per_poem)
    authors = sorted({poem["author"] for poem in poems})
    summary = {
        "source": epub_path.name,
        "poems": len(poems),
        "quotes": len(quotes),
        "authors": authors,
        "authorCount": len(authors),
    }

    write_json(Path(args.poems_out), {"summary": summary, "poems": poems})
    write_json(Path(args.quotes_out), {"summary": summary, "quotes": quotes})
    write_ts_quotes(Path(args.ts_out), "generated/poetry-quotes.json")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
