#!/bin/bash
# seed-dev-data.sh — Populate ChatLab production DB with dev team mock data
# Usage: bash scripts/seed-dev-data.sh
#
# ChatLab app must be closed before running this script.

DB="C:/Users/HW/AppData/Roaming/ChatLab/data/databases/global/collaboration.db"

echo "[Seed] Checking database: $DB"

# Add progress column if missing (idempotent)
sqlite3 "$DB" "ALTER TABLE personal_todo ADD COLUMN progress INTEGER DEFAULT 0;" 2>/dev/null
echo "[Seed] Progress column ensured."

# Run the seed SQL
sqlite3 "$DB" < scripts/seed-dev-data.sql
echo "[Seed] Done! Open ChatLab to see the data in the Task/Todo/Focus pages."
