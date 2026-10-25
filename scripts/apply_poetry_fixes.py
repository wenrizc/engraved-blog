#!/usr/bin/env python3
"""Apply curated fixes to the generated poetry database.

The generated JSON files are checked in, so this script is the single place
where editorial/format repairs are applied.  It is intentionally conservative:
it refuses to drop or rewrite a line unless the patch explicitly says how.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
QUOTES_PATH = ROOT / "src/data/generated/poetry-quotes.json"
POEMS_PATH = ROOT / "src/data/generated/poetry-poems.json"
FIX_DIR = ROOT / ".fixes"
BACKUP_DIR = FIX_DIR / "backup"

SECTION_MARKER_RE = re.compile(r"^[一二三四五六七八九十百〇○零]{1,6}[、.]?$")
PART_HEADING_RE = re.compile(r"^第[一二三四五六七八九十百0-9]+[部卷篇章]$")
SPEAKER_RE = re.compile(
    r"^(?:第?[一二三四五六七八九十]+个?精灵|精灵[一二三四五六七八九十]+|"
    r"First Spirit\.?|Second Spirit\.?|Third Spirit\.?)$"
)
NON_VERSE_LABELS = {
    "剪影",
    "月之逃逸",
    "合唱：",
    "合唱",
    "第二部",
    "第一卷",
    "第二卷",
}
NON_VERSE_EN = {"Le Réveillon", "Part First", "Part Second", "Part Third"}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def flatten_zh(poem: dict[str, Any]) -> list[str]:
    return [line for stanza in poem["stanzas"] for line in stanza.get("zh", [])]


def flatten_en(poem: dict[str, Any]) -> list[str]:
    return [line for stanza in poem["stanzas"] for line in stanza.get("en", [])]


def replace_all_occurrences(lines: list[str], old: str, new: str) -> int:
    count = 0
    for index, line in enumerate(lines):
        if line == old:
            lines[index] = new
            count += 1
    return count


def normalize_zh_line(line: str) -> str:
    line = line.replace("⋯", "…")
    line = re.sub(r"(?<=[\u4e00-\u9fff])[ \u3000]+(?=[\u4e00-\u9fff])", "", line)
    line = re.sub(r"[ \u3000]+(?=[，。！？；：、”“‘’《》〈〉])", "", line)
    line = re.sub(r"(?<=[，。！？；：、”“‘’《》〈〉])[ \u3000]+", "", line)
    return line.strip()


# Do not filter lines merely because they equal the poem title: Dickinson and
# other untitled poems use the first line as the title.  These are the two
# confirmed title leaks in the current database.
TITLE_LEAKS = {
    ("7a3230d1ae6a2c", "露西·格瑞"),
    ("5277957ffb15e9", "露西·格瑞"),
    ("0cfd175ae7aa3d", "法兰西"),
    ("eb15657205c3fe", "法兰西"),
}


def is_non_verse_line(line: str, poem: dict[str, Any], is_first: bool) -> bool:
    value = line.strip()
    if not value:
        return True
    if SECTION_MARKER_RE.fullmatch(value):
        return True
    if PART_HEADING_RE.fullmatch(value):
        return True
    if SPEAKER_RE.fullmatch(value):
        return True
    if value in NON_VERSE_LABELS:
        return True
    if (poem["id"], value) in TITLE_LEAKS:
        return True
    return False


def clean_poem(poem: dict[str, Any]) -> None:
    # lines.zh mirrors the stanzas, but keep both in sync.
    cleaned_zh: list[str] = []
    for line in poem.get("lines", {}).get("zh", []):
        if not is_non_verse_line(line, poem, not cleaned_zh):
            cleaned_zh.append(normalize_zh_line(line))
    poem.setdefault("lines", {})["zh"] = cleaned_zh

    stanazs: list[dict[str, Any]] = []
    for stanza in poem.get("stanzas", []):
        zh = [
            normalize_zh_line(line)
            for index, line in enumerate(stanza.get("zh", []))
            if not is_non_verse_line(line, poem, index == 0)
        ]
        en = [line for line in stanza.get("en", []) if line.strip() and line.strip() not in NON_VERSE_EN]
        if not zh and not en:
            continue
        stanazs.append({"zh": zh, "en": en})
    poem["stanzas"] = stanazs
    # Keep the canonical en list untouched except for known headings.
    poem.setdefault("lines", {})["en"] = [
        line for line in poem.get("lines", {}).get("en", []) if line.strip() and line.strip() not in NON_VERSE_EN
    ]


def clean_quote_lines(lines: list[str], poem: dict[str, Any]) -> list[str]:
    return [
        normalize_zh_line(line)
        for index, line in enumerate(lines)
        if not is_non_verse_line(line, poem, index == 0)
    ]


def extend_short_quote(quote: dict[str, Any], poem: dict[str, Any]) -> list[str] | None:
    """If cleaning left fewer than two lines, take one neighbour from the poem."""
    lines = quote["lines"]
    if len(lines) >= 2:
        return lines
    zh = flatten_zh(poem)
    for start in range(0, len(zh) - len(lines) + 1):
        if zh[start : start + len(lines)] != lines:
            continue
        if start > 0:
            return [zh[start - 1], *lines]
        if start + len(lines) < len(zh):
            return [*lines, zh[start + len(lines)]]
    return None


def find_contiguous(poem: dict[str, Any], lines: list[str]) -> bool:
    zh = flatten_zh(poem)
    if not lines:
        return False
    width = len(lines)
    return any(zh[index : index + width] == lines for index in range(0, len(zh) - width + 1))


def load_patch_files() -> list[dict[str, Any]]:
    names = [
        ".fixes/text-fixes.json",
        ".fixes/translations-1.json",
        ".fixes/translations-2.json",
        ".fixes/consistency.json",
        ".fixes/manual.json",
        ".fixes/boundaries.json",
        ".fixes/alignment.json",
    ]
    patches = []
    for name in names:
        path = ROOT / name
        if path.exists():
            patches.append({"name": name, "data": read_json(path)})
    return patches


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate patches without writing")
    args = parser.parse_args()

    quotes_doc = read_json(QUOTES_PATH)
    poems_doc = read_json(POEMS_PATH)
    quotes = quotes_doc["quotes"]
    poems = poems_doc["poems"]
    poem_by_id = {poem["id"]: poem for poem in poems}
    quote_by_id = {quote["id"]: quote for quote in quotes}
    patches = load_patch_files()

    errors: list[str] = []
    stats = {
        "lineReplacements": 0,
        "lineInsertions": 0,
        "quoteLines": 0,
        "poemStanzas": 0,
        "droppedQuotes": 0,
    }

    # 1) Line replacements first: they are the least invasive and keep quote
    #    lines identical to their source poem lines.
    for patch in patches:
        for replacement in patch["data"].get("lineReplacements", []):
            poem = poem_by_id.get(replacement.get("poemId"))
            old = replacement.get("old", "")
            new = replacement.get("new", "")
            if not poem or not old or not new or "\n" in new:
                errors.append(f"{patch['name']}: invalid replacement {replacement!r}")
                continue
            poem_hits = replace_all_occurrences(poem["lines"]["zh"], old, new)
            for stanza in poem["stanzas"]:
                poem_hits += replace_all_occurrences(stanza["zh"], old, new)
            quote_hits = 0
            for quote in quotes:
                if quote["poemId"] == poem["id"]:
                    quote_hits += replace_all_occurrences(quote["lines"], old, new)
            if poem_hits == 0:
                errors.append(f"{patch['name']}: old line not found in {poem['id']}: {old!r}")
                continue
            stats["lineReplacements"] += 1

    # 1b) Explicit line insertions (a source line missing from the extraction).
    for patch in patches:
        for insertion in patch["data"].get("lineInsertions", []):
            poem = poem_by_id.get(insertion.get("poemId"))
            before = insertion.get("before")
            line = insertion.get("line")
            if not poem or not before or not line:
                errors.append(f"{patch['name']}: invalid insertion {insertion!r}")
                continue
            if line in poem["lines"]["zh"]:
                continue
            for collection in [poem["lines"]["zh"], *(stanza["zh"] for stanza in poem["stanzas"])]:
                if before in collection:
                    collection.insert(collection.index(before), line)
            quote = quote_by_id.get(insertion.get("quoteId"))
            if quote and before in quote["lines"]:
                quote["lines"].insert(quote["lines"].index(before), line)
            if line not in poem["lines"]["zh"]:
                errors.append(f"{patch['name']}: insertion anchor not found for {poem['id']}")
                continue
            stats["lineInsertions"] += 1

    # 2) Alignment patches reshape stanzas only; verify every zh/en line is
    #    preserved in order before accepting them.
    for patch in patches:
        for entry in patch["data"].get("poemStanzas", []):
            poem = poem_by_id.get(entry.get("id"))
            if not poem:
                errors.append(f"{patch['name']}: unknown poem {entry.get('id')}")
                continue
            old_zh = flatten_zh(poem)
            old_en = flatten_en(poem)
            new_stanzas = entry.get("stanzas") or []
            new_zh = [line for stanza in new_stanzas for line in stanza.get("zh", [])]
            new_en = [line for stanza in new_stanzas for line in stanza.get("en", [])]
            if old_zh != new_zh or old_en != new_en:
                errors.append(
                    f"{patch['name']}: alignment changed lines for {poem['id']} "
                    f"(zh {len(old_zh)}->{len(new_zh)}, en {len(old_en)}->{len(new_en)})"
                )
                continue
            poem["stanzas"] = new_stanzas
            stats["poemStanzas"] += 1

    # 3) Quote boundary overrides before cleaning; lines must be contiguous in
    #    the (possibly line-replaced) poem.
    for patch in patches:
        for entry in patch["data"].get("quoteLines", []):
            quote = quote_by_id.get(entry.get("id"))
            if not quote:
                errors.append(f"{patch['name']}: unknown quote {entry.get('id')}")
                continue
            lines = entry.get("lines") or []
            poem = poem_by_id[quote["poemId"]]
            if not find_contiguous(poem, lines):
                errors.append(f"{patch['name']}: quote lines not contiguous for {quote['id']}")
                continue
            quote["lines"] = lines
            stats["quoteLines"] += 1

    # 4) Clean the data itself: non-verse lines and CJK spacing.  Display code
    #    repeats this defensively, but keeping the JSON clean avoids downstream
    #    consumers seeing the artefacts.
    for poem in poems:
        clean_poem(poem)

    # 4a) If a stanza has English but no Chinese (rare extraction artefact),
    #     merge its English into a neighbour instead of dropping it.
    merged_stanzas = 0
    for poem in poems:
        changed = True
        while changed:
            changed = False
            for index, stanza in enumerate(poem["stanzas"]):
                if stanza["en"] and not stanza["zh"]:
                    if index + 1 < len(poem["stanzas"]):
                        poem["stanzas"][index + 1]["en"] = stanza["en"] + poem["stanzas"][index + 1]["en"]
                    elif index > 0:
                        poem["stanzas"][index - 1]["en"] += stanza["en"]
                    else:
                        continue
                    del poem["stanzas"][index]
                    merged_stanzas += 1
                    changed = True
                    break
    stats["mergedStanzas"] = merged_stanzas

    # 4b) Where the whole poem has the same number of zh/en lines but the
    #     stanza boundaries drifted, rebuild zh/en pairs from the English
    #     stanza lengths.  This is deterministic and only applies when no
    #     explicit alignment patch handled the poem.
    patched_poems = {
        entry.get("id")
        for patch in patches
        for entry in patch["data"].get("poemStanzas", [])
    }
    auto_aligned = 0
    for poem in poems:
        if poem["id"] in patched_poems:
            continue
        zh = flatten_zh(poem)
        en = flatten_en(poem)
        if not zh or not en or len(zh) != len(en):
            continue
        if all(len(stanza["zh"]) == len(stanza["en"]) for stanza in poem["stanzas"]):
            continue
        # Preserve the Chinese stanza layout and distribute the English
        # lines across those groups.  Using English stanza lengths here would
        # collapse long poems whose English was extracted as one block.
        zh_groups = [len(stanza["zh"]) for stanza in poem["stanzas"] if stanza["zh"]]
        if not zh_groups or sum(zh_groups) != len(zh):
            continue
        rebuilt = []
        offset = 0
        for size in zh_groups:
            rebuilt.append({"zh": zh[offset : offset + size], "en": en[offset : offset + size]})
            offset += size
        if offset != len(zh):
            continue
        poem["stanzas"] = rebuilt
        auto_aligned += 1
    stats["autoAlignedPoems"] = auto_aligned

    for quote in quotes:
        poem = poem_by_id[quote["poemId"]]
        original_length = len(quote["lines"])
        quote["lines"] = clean_quote_lines(quote["lines"], poem)
        # Only re-extend excerpts that lost lines to marker/heading removal;
        # the site intentionally contains some one-line excerpts.
        if original_length >= 2:
            extended = extend_short_quote(quote, poem)
            if extended:
                quote["lines"] = extended
        quote["text"] = "\n".join(quote["lines"])

    dropped = [quote for quote in quotes if not quote["lines"]]
    if dropped:
        stats["droppedQuotes"] = len(dropped)
        quotes = [quote for quote in quotes if quote["lines"]]
        quotes_doc["quotes"] = quotes

    # 5) Update summary counts and reindex.
    quotes_doc["summary"]["quotes"] = len(quotes)
    quotes_doc["summary"]["poems"] = len(poems)
    authors = sorted({quote["author"] for quote in quotes})
    quotes_doc["summary"]["authors"] = authors
    quotes_doc["summary"]["authorCount"] = len(authors)

    # Final invariant checks.
    for quote in quotes:
        poem = poem_by_id[quote["poemId"]]
        if quote["text"] != "\n".join(quote["lines"]):
            errors.append(f"text/lines mismatch after fixes: {quote['id']}")
        if quote["lines"] and not find_contiguous(poem, quote["lines"]):
            errors.append(f"quote no longer contiguous: {quote['id']}")

    print(json.dumps({"stats": stats, "errors": errors[:50], "errorCount": len(errors)}, ensure_ascii=False, indent=2))
    if errors:
        print("Refusing to write because validation failed.")
        return 1
    if args.check:
        print("Check only; data not written.")
        return 0

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(QUOTES_PATH, BACKUP_DIR / "poetry-quotes.json")
    shutil.copy2(POEMS_PATH, BACKUP_DIR / "poetry-poems.json")
    write_json(QUOTES_PATH, quotes_doc)
    write_json(POEMS_PATH, poems_doc)
    print(f"Wrote {QUOTES_PATH} and {POEMS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
