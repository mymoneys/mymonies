package com.anonymous.tracker

import android.Manifest
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
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
   */
  @ReactMethod
  fun getInboxMessages(sinceMs: Double, promise: Promise) {
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

    val sinceLong = sinceMs.toLong()
    val (selection, selectionArgs) = if (sinceLong > 0) {
      "UPPER(${Telephony.Sms.Inbox.ADDRESS}) = ? AND ${Telephony.Sms.Inbox.DATE} >= ?" to
        arrayOf("MPESA", sinceLong.toString())
    } else {
      "UPPER(${Telephony.Sms.Inbox.ADDRESS}) = ?" to arrayOf("MPESA")
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
}
