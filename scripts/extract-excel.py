"""
Dev-machine-only script (not part of the app bundle). Extracts every
"<Month> <Year>" sheet from data/DEC__JAN.xlsx into assets/excel-seed.json,
which the app bundles and reads in src/excelImport.ts to bootstrap
categorization from the manually-maintained budget spreadsheet.

Run with the project's own throwaway venv (see README note below) — do not
run this against system Python, and do not run it from inside data/ since
that directory holds an untrusted downloaded file.

Usage:
    python3 -I scripts/extract-excel.py
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

PROJECT_ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = PROJECT_ROOT / "data" / "DEC__JAN.xlsx"
OUTPUT_PATH = PROJECT_ROOT / "assets" / "excel-seed.json"

MONTH_SHEET_RE = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$"
)

# Row 3 is the header (Group, Item, Budgeted, Date, Money Out, Transaction
# Charges, Money(In), Comments) in every month sheet observed; data starts row 4.
DATA_START_ROW = 4
MAX_SCAN_ROWS = 1000
BLANK_ROW_STREAK_TO_STOP = 20


def extract_sheet(ws) -> list[dict]:
    rows = []
    blank_streak = 0

    for row in ws.iter_rows(min_row=DATA_START_ROW, max_row=DATA_START_ROW + MAX_SCAN_ROWS, max_col=8):
        group, item, budgeted, date, money_out, charges, money_in, comments = (c.value for c in row)

        if group is None and item is None:
            blank_streak += 1
            if blank_streak >= BLANK_ROW_STREAK_TO_STOP:
                break
            continue
        blank_streak = 0

        date_str = date.date().isoformat() if isinstance(date, datetime) else None

        rows.append(
            {
                "group": str(group).strip() if group is not None else None,
                "item": str(item).strip() if item is not None else None,
                "budgeted": float(budgeted) if isinstance(budgeted, (int, float)) else None,
                "date": date_str,
                "moneyOut": float(money_out) if isinstance(money_out, (int, float)) else None,
                "transactionCharges": float(charges) if isinstance(charges, (int, float)) else None,
                "moneyIn": float(money_in) if isinstance(money_in, (int, float)) else None,
                "comments": str(comments).strip() if comments is not None else None,
            }
        )

    return rows


def main() -> None:
    if not XLSX_PATH.exists():
        print(f"error: {XLSX_PATH} not found", file=sys.stderr)
        sys.exit(1)

    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True, read_only=True)

    all_rows = []
    sheets_processed = []
    for name in wb.sheetnames:
        if not MONTH_SHEET_RE.match(name):
            continue
        rows = extract_sheet(wb[name])
        for row in rows:
            row["sheet"] = name
        all_rows.extend(rows)
        sheets_processed.append((name, len(rows)))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Compact (no indent) since this ships as a bundled app asset, not something hand-read.
    OUTPUT_PATH.write_text(json.dumps(all_rows, separators=(",", ":")), encoding="utf-8")

    print(f"Processed {len(sheets_processed)} month sheets, {len(all_rows)} total rows")
    for name, count in sheets_processed:
        if count:
            print(f"  {name}: {count} rows")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
