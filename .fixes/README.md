# 诗歌数据修复补丁规范

所有子智能体只写本目录下的 JSON 补丁，不直接修改 `src/data/generated/*.json`。
统一由 `scripts/apply_poetry_fixes.py` 应用。

## 补丁格式

```json
{
  "lineReplacements": [
    {
      "poemId": "07b2f066d500f5",
      "old": "原文整行（必须与 poem zh 行完全一致，含标点）",
      "new": "修正后的整行（行数不变）",
      "note": "依据：findings-verified.json 的 id 与英文原句"
    }
  ],
  "quoteLines": [
    {
      "id": "0403dc881fd543",
      "lines": ["修正后的第一行", "修正后的第二行"],
      "note": "说明：为何这样截取；必须是 poem zh 中连续行"
    }
  ],
  "poemStanzas": [
    {
      "id": "07b2f066d500f5",
      "stanzas": [
        {"zh": ["..."], "en": ["..."]}
      ],
      "note": "说明：英文节如何重排；zh 行必须与原来完全一致"
    }
  ]
}
```

## 规则

- `lineReplacements`：只做同位置整行替换，不增删行。`old` 必须能在该 poem 的 `lines.zh` 中找到。
- `quoteLines`：摘录必须对应 poem 中一段连续 zh 行；用于修复引号/括号失衡、半句起摘。
- `poemStanzas`：只允许重排 `en` 行或把 zh 的相邻节合并；不得增删任何 zh 行，不得改写 en 文本。
- 每个补丁文件只写自己负责的类别，避免与其他智能体冲突。
- 所有结论以 `docs/poetry-audit/findings-verified.json` 的 confirmed 条目为准。
