# Campaign final report workflow

Run from the repository root after the campaign's completed submissions are reviewed.

```bash
node scripts/campaign-final-report.cjs --campaign 2 --collect --out /workspace/reports
```

The command signs into Seoul Scent with `SEOUL_SCENT_ADMIN_EMAIL` and
`SEOUL_SCENT_ADMIN_PASSWORD`, downloads completed applications and all submitted
URLs, and produces an A4 four-page PDF, an XLSX review sheet, and a metrics JSON
cache. The PDF is marked as a review draft by default. Do not add account
credentials to a spreadsheet or source file.

`--collect` opens TikTok post pages in Chromium and records the public views,
likes, comments, and shares alongside the capture time and source. It uses an
ephemeral browser profile unless `--profile PATH` is provided. A dedicated
signed-in browser profile can be used when access to a post requires login.
Instagram, Facebook, Threads, and YouTube figures remain blank unless a reviewer
can verify them in a browser. Do not guess hidden values.

To add manually checked figures, edit a copy of the generated XLSX. Enter the
visible numeric values and `확인 시각 (KST)` in `YYYY-MM-DD HH:MM` format. Use
`확인 출처` to describe the post page or screenshot. Assign the same `원본 콘텐츠 그룹`
to posts made from the same original content across channels; assign a group to
every post before reporting the deduplicated original-content count. Then run:

```bash
node scripts/campaign-final-report.cjs --campaign 2 \
  --metrics-xlsx /path/to/checked-results.xlsx --out /workspace/reports
```

Review the PDF and XLSX before sharing. Only after the data has been checked,
pass `--approve` to remove the draft label. Missing metrics remain blank and are
excluded from top-content rankings and view sums. A full published-content URL
list is retained in the XLSX as the evidence behind the summary.
