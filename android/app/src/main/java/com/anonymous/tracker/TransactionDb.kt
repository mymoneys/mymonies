package com.anonymous.tracker

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File

/**
 * Writes directly into the same SQLite file that the JS side manages via expo-sqlite
 * (see src/db.ts). Rows are inserted raw/unparsed (is_parsed = 0); the TypeScript
 * parser fills in amount/type/sender lazily via parsePendingTransactions() whenever
 * the app is opened, since a background native service has no way to call into the
 * JS parser directly.
 *
 * Path mirrors expo-sqlite's documented default location:
 * `${FileSystem.documentDirectory}SQLite/<name>` -> `<filesDir>/SQLite/<name>` on Android.
 * If a future expo-sqlite version changes that default, this must be updated to match.
 */
object TransactionDb {
  private const val DB_NAME = "mpesa.db"

  private fun dbFile(context: Context): File {
    val dir = File(context.filesDir, "SQLite")
    if (!dir.exists()) dir.mkdirs()
    return File(dir, DB_NAME)
  }

  private fun open(context: Context): SQLiteDatabase {
    val db = SQLiteDatabase.openOrCreateDatabase(dbFile(context), null)
    db.execSQL("PRAGMA journal_mode = WAL;")
    db.execSQL("PRAGMA busy_timeout = 3000;")
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY NOT NULL,
        raw_text TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        transaction_type TEXT NOT NULL DEFAULT 'INFO',
        counterparty_name TEXT NOT NULL DEFAULT '',
        counterparty_number TEXT,
        account_number TEXT,
        timestamp INTEGER NOT NULL,
        balance REAL,
        transaction_cost REAL,
        category TEXT NOT NULL DEFAULT 'Uncategorized',
        "group" TEXT NOT NULL DEFAULT 'Uncategorized',
        is_parsed INTEGER NOT NULL DEFAULT 0
      );
      """.trimIndent()
    )
    return db
  }

  /** Must match makeTransactionId() in src/db.ts exactly, or dedup breaks across sources. */
  private fun fnv1a(input: String): String {
    var hash = 0x811c9dc5.toInt()
    for (ch in input) {
      hash = hash xor ch.code
      hash *= 0x01000193
    }
    return String.format("%08x", hash)
  }

  fun insertRawCapture(context: Context, rawText: String, timestamp: Long) {
    val id = fnv1a("$rawText:$timestamp")
    val db = open(context)
    try {
      db.execSQL(
        """INSERT OR IGNORE INTO transactions
           (id, raw_text, timestamp, category, "group", is_parsed)
           VALUES (?, ?, ?, 'Uncategorized', 'Uncategorized', 0)""",
        arrayOf(id, rawText, timestamp)
      )
    } finally {
      db.close()
    }
  }
}
