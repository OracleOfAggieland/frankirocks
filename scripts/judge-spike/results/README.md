# Judge spike results

Live harness runs write here (brief 006 item 4): one `<date>-<source>.json` with every row, the line set's commit and hash, the audio source, the model IDs and the date, and one `<date>-<source>.md` summary beside it.

No audio goes in this folder, and runs on the owner's own takes carry no transcripts. Dry runs on the fake transport write to `scripts/judge-spike/dist/dry-run/` instead, which is gitignored.
