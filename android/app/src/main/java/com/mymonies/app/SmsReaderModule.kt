package com.mymonies.app

import android.Manifest
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray

/**
 * Exposes read-only access to the SMS inbox (content://sms/inbox) for the one-time
 * "Backfill History" flow. Registered under the classic NativeModule/ReactPackage
 * API, which RN 0.81's new-architecture interop layer supports without needing
 * Codegen specs for a module this simple.
 */
class SmsReaderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SmsReaderModule"

  private fun checkReadSmsPermission(): Boolean =
    ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.READ_SMS
    ) == PackageManager.PERMISSION_GRANTED

  /**
   * sinceMs = 0 scans the whole inbox (full backfill); any other value scans
   * only messages at/after that timestamp (incremental sync — the caller is
   * expected to subtract its own overlap window before calling this).
   * `senders` are matched case-insensitively against the SMS address
   * (MPESA plus any opt-in contribution senders, see src/contributions.ts).
   */
  @ReactMethod
  fun getInboxMessages(sinceMs: Double, senders: ReadableArray, promise: Promise) {
    val context = reactApplicationContext

    if (!checkReadSmsPermission()) {
      promise.reject("PERMISSION_DENIED", "READ_SMS permission has not been granted.")
      return
    }

    val projection = arrayOf(
      Telephony.Sms.Inbox.ADDRESS,
      Telephony.Sms.Inbox.BODY,
      Telephony.Sms.Inbox.DATE
    )

    val senderList = (0 until senders.size())
      .mapNotNull { senders.getString(it)?.trim()?.uppercase() }
      .filter { it.isNotEmpty() }
      .distinct()
    if (senderList.isEmpty()) {
      promise.resolve(Arguments.createArray())
      return
    }
    val placeholders = senderList.joinToString(", ") { "?" }
    val sinceLong = sinceMs.toLong()
    val (selection, selectionArgs) = if (sinceLong > 0) {
      "UPPER(${Telephony.Sms.Inbox.ADDRESS}) IN ($placeholders) AND ${Telephony.Sms.Inbox.DATE} >= ?" to
        (senderList + sinceLong.toString()).toTypedArray()
    } else {
      "UPPER(${Telephony.Sms.Inbox.ADDRESS}) IN ($placeholders)" to senderList.toTypedArray()
    }

    val results: WritableArray = Arguments.createArray()

    try {
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        projection,
        selection,
        selectionArgs,
        "${Telephony.Sms.Inbox.DATE} DESC"
      )?.use { cursor ->
        val addressIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.Inbox.ADDRESS)
        val bodyIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.Inbox.BODY)
        val dateIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.Inbox.DATE)

        while (cursor.moveToNext()) {
          val map = Arguments.createMap()
          map.putString("address", cursor.getString(addressIndex) ?: "")
          map.putString("body", cursor.getString(bodyIndex) ?: "")
          // WritableMap has no putLong; epoch millis safely fit in a double (< 2^53).
          map.putDouble("date", cursor.getLong(dateIndex).toDouble())
          results.pushMap(map)
        }
      }
      promise.resolve(results)
    } catch (error: Exception) {
      promise.reject("SMS_QUERY_FAILED", error.message, error)
    }
  }

  /** Count-only query (no row iteration) — backs the sync-coverage percentage. */
  @ReactMethod
  fun getInboxMessageCount(promise: Promise) {
    val context = reactApplicationContext

    if (!checkReadSmsPermission()) {
      promise.reject("PERMISSION_DENIED", "READ_SMS permission has not been granted.")
      return
    }

    val selection = "UPPER(${Telephony.Sms.Inbox.ADDRESS}) = ?"
    val selectionArgs = arrayOf("MPESA")

    try {
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(Telephony.Sms.Inbox._ID),
        selection,
        selectionArgs,
        null
      )?.use { cursor ->
        promise.resolve(cursor.count)
        return
      }
      promise.resolve(0)
    } catch (error: Exception) {
      promise.reject("SMS_QUERY_FAILED", error.message, error)
    }
  }

  /**
   * Distinct business sender IDs in the inbox with message counts, most
   * frequent first. Only addresses containing a letter are returned — plain
   * phone numbers are people, and their conversations are none of our
   * business. MPESA is excluded since it's always captured.
   */
  @ReactMethod
  fun getInboxSenders(limit: Double, promise: Promise) {
    val context = reactApplicationContext

    if (!checkReadSmsPermission()) {
      promise.reject("PERMISSION_DENIED", "READ_SMS permission has not been granted.")
      return
    }

    try {
      val counts = HashMap<String, Int>()
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(Telephony.Sms.Inbox.ADDRESS),
        null,
        null,
        null
      )?.use { cursor ->
        val addressIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.Inbox.ADDRESS)
        while (cursor.moveToNext()) {
          val address = cursor.getString(addressIndex)?.trim()?.uppercase() ?: continue
          if (address == "MPESA" || address.none { it.isLetter() }) continue
          counts[address] = (counts[address] ?: 0) + 1
        }
      }

      val results: WritableArray = Arguments.createArray()
      counts.entries
        .sortedByDescending { it.value }
        .take(limit.toInt())
        .forEach { (address, count) ->
          val map = Arguments.createMap()
          map.putString("address", address)
          map.putInt("count", count)
          results.pushMap(map)
        }
      promise.resolve(results)
    } catch (error: Exception) {
      promise.reject("SMS_QUERY_FAILED", error.message, error)
    }
  }
}
