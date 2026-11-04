import json
import re
from pathlib import Path

from scripts.knowledge_rechunk_pilot import context_dependent_start, is_sentence_complete, word_count


root = Path("knowledge_pilot/everything_store")
paragraphs = [json.loads(line) for line in (root / "paragraphs.jsonl").read_text().splitlines()]
chunks = [json.loads(line) for line in (root / "chunks.jsonl").read_text().splitlines()]
assert [p["text"] for p in paragraphs] == [p for c in chunks for p in c["text"].split("\n\n")]
assert len({c["id"] for c in chunks}) == len(chunks)
assert all(c["word_count"] == word_count(c["text"]) for c in chunks)
assert all(c["section"] is None and c["book_pillar"] == "money_game" and c["pillars"] == []
           and "pillar" not in c for c in chunks)
assert all(is_sentence_complete(c["text"]) for c in chunks)
assert not any(re.search(r"[A-Za-z][.!?][0-9]+", c["text"]) for c in chunks)
assert not any(context_dependent_start(c["text"]) for c in chunks)
for phrase in ("what was in their yard", "Now suppliers needed Amazon more than Amazon needed them"):
    assert sum(phrase in c["text"] for c in chunks) == 1
summary = {
    "source_paragraphs": len(paragraphs),
    "source_words": sum(word_count(p["text"]) for p in paragraphs),
    "exact_paragraph_coverage": True,
    "sentence_endings_complete": True,
    "metadata_valid": True,
    "joined_note_references": 0,
    "dependent_pronoun_or_demonstrative_starts": 0,
    "over_700": [{"id": c["id"], "words": c["word_count"]} for c in chunks if c["word_count"] > 700],
}
(root / "quality_checks.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
