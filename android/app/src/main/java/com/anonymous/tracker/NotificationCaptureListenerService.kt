package com.anonymous.tracker

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.Locale

class NotificationCaptureListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return

    val notification = sbn.notification ?: return
    val extras = notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()

    // For SMS-app notifications, EXTRA_TITLE is the sender ID/name (what shows
    // in the Messages app's conversation list) — Safaricom's own confirmations
    // always come from sender "MPESA". Matching on that instead of "does the
    // body mention mpesa anywhere" avoids false positives like a bank's own
    // SMS that happens to reference "M-Pesa" in its text (e.g. an NCBA
    // transaction alert), which isn't a real M-Pesa transaction record.
    if (title.trim().lowercase(Locale.ROOT) != "mpesa") {
      return
    }

    // Prefer the fullest body text available, matching what the SMS-inbox backfill
    // path (SmsReaderModule) reads as `body`, so the parser sees consistent input
    // regardless of which path captured the message.
    val bodyText = when {
      bigText.isNotBlank() -> bigText
      text.isNotBlank() -> text
      else -> listOf(title, text, bigText).joinToString(" ").trim()
    }

    TransactionDb.insertRawCapture(applicationContext, bodyText, sbn.postTime)
  }
}
