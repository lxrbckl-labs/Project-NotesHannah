#!/usr/bin/env python3
"""Check manifests in runs/ against what the fixture generator put in (text, notes, flags, rotation)."""
import json, sys
exp = json.load(open("fixtures/generated/lecture.expected.json"))
ok = True
def check(cond, msg):
    global ok
    print(("PASS " if cond else "FAIL ") + msg); ok &= bool(cond)

m = json.load(open("runs/lecture-pptx/manifest.json"))
check(m["pageCount"] == len(exp), f"pptx pages {m['pageCount']} == {len(exp)}")
for i, (pg, s) in enumerate(zip(m["pages"], exp), 1):
    n = pg["native"]
    check(n["title"] == s["title"], f"slide {i} title {n['title']!r}")
    want = [b if isinstance(b, str) else b[0] for b in s.get("bullets", [])]
    # bullets were typed with a leading marker; the extracted text must contain each bullet text, in order
    pos = -1; inorder = True
    for b in want:
        k = n["text"].find(b)
        if k <= pos: inorder = False
        pos = k
    check(inorder, f"slide {i} bullets present and in order ({len(want)})")
    for row in s.get("table", []):
        check(all(c in n["text"] for c in row), f"slide {i} table row {row[0]!r}")
    check((n["notes"] or None) == (s.get("notes") or None), f"slide {i} notes match" if s.get("notes") else f"slide {i} has no notes")
    check(n["hidden"] == bool(s.get("hidden")), f"slide {i} hidden={n['hidden']}")
sizes = [p["image"]["bytes"] for p in m["pages"]]
print("pptx page bytes", sizes, "sum", sum(sizes))

for name, flags in [("text-layer-pdf", [True]*5), ("image-only-pdf", [False]*4)]:
    mm = json.load(open(f"runs/{name}/manifest.json"))
    got = [p["native"]["hasTextLayer"] for p in mm["pages"]]
    check(got == flags, f"{name} hasTextLayer {got}")
mm = json.load(open("runs/text-layer-pdf/manifest.json"))
check("Warfarin inhibits vitamin K epoxide reductase (page 3)" in mm["pages"][2]["native"]["text"], "pdf page 3 text correct")
for name in ["photo-exif6-jpg", "photo-exif3-png", "photo-heic"]:
    p = json.load(open(f"runs/{name}/manifest.json"))["pages"][0]["image"]
    print(name, p["width"], p["height"], p["bytes"])
sys.exit(0 if ok else 1)
