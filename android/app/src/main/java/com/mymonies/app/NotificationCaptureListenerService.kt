package com.mymonies.app

import android.app.Notification
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.Locale

class NotificationCaptureListenerService : NotificationListenerService() {
  // Every notification on the phone lands here, so the opt-in sender list is
  // cached rather than read from SQLite each time. Settings changes in the
  // app take effect within this window.
  private var cachedSenders: Set<String> = emptySet()
  private var sendersReadAt = 0L

  private fun contributeSenders(): Set<String> {
    val now = System.currentTimeMillis()
    if (now - sendersReadAt > SENDERS_CACHE_MS) {
      cachedSenders = TransactionDb.readContributeSenders(applicationContext)
      sendersReadAt = now
    }
    return cachedSenders
  }

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
    val sender = title.trim().uppercase(Locale.ROOT)
    val isMpesa = sender == "MPESA"
    // Extra (opt-in) senders are only trusted from the default SMS app — a
    // bank's own app or a chat named "KCB" could otherwise post a matching title.
    val isContributeSender = !isMpesa &&
      sbn.packageName == Telephony.Sms.getDefaultSmsPackage(applicationContext) &&
      sender in contributeSenders()
    if (!isMpesa && !isContributeSender) {
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

    if (isMpesa) {
      TransactionDb.insertRawCapture(applicationContext, bodyText, sbn.postTime)
    } else {
      // Never into transactions — there's no parser for these yet.
      TransactionDb.insertContribution(applicationContext, sender, bodyText, sbn.postTime)
    }
  }

  companion object {
    private const val SENDERS_CACHE_MS = 30_000L
  }
}
